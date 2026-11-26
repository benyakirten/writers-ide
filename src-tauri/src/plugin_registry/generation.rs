//! Generation-bound checked sealing. This does not publish or select a generation.
use std::{
    fmt,
    fs::{self, File, OpenOptions},
    marker::PhantomData,
    path::{Component, Path, PathBuf},
    rc::Rc,
    time::Duration,
};

use rusqlite::Connection;

use super::{
    error::{RegistryError, Result},
    location::LocationLease,
    model::RegistryLimits,
    store::{self, Store},
};

#[cfg(test)]
#[path = "generation_tests.rs"]
mod tests;

// Keep SQLite preparation and recovery ownership on the caller's registry thread.
struct Generation {
    directory: PathBuf,
    database: PathBuf,
    _lease: LocationLease,
    _thread: PhantomData<Rc<()>>,
}

pub(super) struct PreparedGeneration {
    store: Store,
    generation: Generation,
}

pub(super) struct SealedGeneration {
    _ownership: File,
    generation: Generation,
}

pub(super) struct SealFailure {
    store: Option<Box<Store>>,
    _ownership: Option<File>,
    error: RegistryError,
    generation: Box<Generation>,
}

impl PreparedGeneration {
    /// The host supplies an existing owned root and one local directory name.
    /// Neither this name nor the database filename defines a selector format.
    pub(super) fn create(
        lease: &LocationLease,
        name: &Path,
        limits: RegistryLimits,
    ) -> Result<Self> {
        limits.validate()?;
        let mut components = name.components();
        let safe = matches!(components.next(), Some(Component::Normal(component))
            if component == name.as_os_str());
        if !safe || components.next().is_some() {
            return Err(RegistryError::InvalidInput(
                "generation name must be one normal path component".into(),
            ));
        }
        if !fs::symlink_metadata(lease.root())?.is_dir() {
            return Err(RegistryError::InvalidInput(
                "generation root must be an existing owned directory".into(),
            ));
        }
        let directory = lease.root().join(name);
        // Never reuse or clean up a destination, even when initialization fails.
        fs::create_dir(&directory)?;
        let database = directory.join("registry.sqlite");
        let store = Store::create(&database, limits)?;
        Ok(Self {
            store,
            generation: Generation {
                directory,
                database,
                _lease: lease.clone(),
                _thread: PhantomData,
            },
        })
    }

    pub(super) fn seal(self) -> std::result::Result<SealedGeneration, SealFailure> {
        let Self { store, generation } = self;
        let ownership = match store.seal() {
            Ok(ownership) => ownership,
            Err((error, store)) => {
                return Err(SealFailure {
                    store: Some(store),
                    _ownership: None,
                    error,
                    generation: Box::new(generation),
                });
            }
        };
        if let Err(error) = finish_closed(&generation.database) {
            return Err(SealFailure {
                store: None,
                _ownership: Some(ownership),
                error,
                generation: Box::new(generation),
            });
        }
        Ok(SealedGeneration {
            _ownership: ownership,
            generation,
        })
    }
}

impl SealedGeneration {
    // Read-only association for a future consuming publisher. No reopen API.
    pub(super) fn directory(&self) -> &Path {
        &self.generation.directory
    }

    pub(super) fn database_path(&self) -> &Path {
        &self.generation.database
    }
}

impl SealFailure {
    pub(super) fn error(&self) -> &RegistryError {
        &self.error
    }

    pub(super) fn directory(&self) -> &Path {
        &self.generation.directory
    }

    pub(super) fn database_path(&self) -> &Path {
        &self.generation.database
    }

    pub(super) fn has_connection(&self) -> bool {
        self.store.is_some()
    }
}

impl fmt::Debug for PreparedGeneration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparedGeneration")
            .field("directory", &self.generation.directory)
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for SealedGeneration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SealedGeneration")
            .field("directory", &self.generation.directory)
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for SealFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SealFailure")
            .field("directory", &self.generation.directory)
            .field("error", &self.error)
            .field("has_connection", &self.has_connection())
            .finish_non_exhaustive()
    }
}

pub(super) fn prepare(connection: &Connection, limits: &RegistryLimits) -> Result<()> {
    if !connection.is_autocommit() {
        return Err(RegistryError::Unavailable(
            "cannot seal a registry with an active transaction".into(),
        ));
    }
    connection.busy_timeout(Duration::ZERO)?;
    let journal: String = connection.query_row("PRAGMA main.journal_mode", [], |row| row.get(0))?;
    let synchronous: i64 = connection.query_row("PRAGMA main.synchronous", [], |row| row.get(0))?;
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if !journal.eq_ignore_ascii_case("wal") || synchronous != 2 || foreign_keys != 1 {
        return Err(RegistryError::Unavailable(
            "registry sealing requires WAL, synchronous=FULL and foreign_keys=ON".into(),
        ));
    }
    store::validate_snapshot(connection, limits)?;
    let counters = connection.query_row("PRAGMA main.wal_checkpoint(TRUNCATE)", [], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    check_checkpoint(counters)
}

pub(super) fn check_checkpoint((busy, log, checkpointed): (i64, i64, i64)) -> Result<()> {
    // WAL mode was verified separately. SQLite may report no WAL ever existed.
    if busy == 0 && ((log == 0 && checkpointed == 0) || (log == -1 && checkpointed == -1)) {
        return Ok(());
    }
    Err(RegistryError::Unavailable(format!(
        "registry TRUNCATE checkpoint incomplete: busy={busy}, log={log}, checkpointed={checkpointed}"
    )))
}

pub(super) fn finish_closed(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-journal"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        match fs::symlink_metadata(Path::new(&sidecar)) {
            Ok(metadata) => {
                // Preserve unexplained journals rather than guessing whether they are cold.
                if !metadata.is_file() || metadata.len() != 0 {
                    return Err(RegistryError::RecoveryRequired(format!(
                        "unexplained registry sidecar after checked close: {}",
                        Path::new(&sidecar).display()
                    )));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    // Only open this raw descriptor after SQLite's checked close has succeeded.
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?
        .sync_all()?;
    Ok(())
}
