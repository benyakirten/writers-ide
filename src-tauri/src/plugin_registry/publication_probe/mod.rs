//! Test-only lifecycle and filesystem experiment. Not an application publisher.
//! A successful probe is not certification of power-loss durability.
#![cfg(test)]

mod platform;
mod process_tests;
mod sealing;
mod tests;
mod windows_conformance;

use super::{
    error::{RegistryError, Result},
    model::RegistryLimits,
    schema,
    worker::{Registry, RegistryHandle, RegistrySession},
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    thread::{self, JoinHandle},
};
use tokio::sync::oneshot;

const MAGIC: &[u8] = b"WIDE-PROBE-1\n";
const SELECTOR_BYTES: usize = MAGIC.len() + 16 + 32;
const ROOT: &str = "registry";
const ACTIVE: &str = "active.probe";

#[derive(Clone)]
pub(super) struct LocationLease {
    _guard: Arc<File>,
    parent: PathBuf,
}
impl LocationLease {
    pub(super) fn acquire(parent: &Path) -> Result<Self> {
        let parent = parent.canonicalize()?;
        let path = parent.join("registry-publication-probe.lock");
        if path.try_exists()? && !fs::symlink_metadata(&path)?.is_file() {
            return Err(RegistryError::RecoveryRequired(
                "probe lease is not a regular file".into(),
            ));
        }
        let guard = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        guard.try_lock().map_err(|e| {
            RegistryError::Unavailable(format!("probe location already owned: {e}"))
        })?;
        Ok(Self {
            _guard: Arc::new(guard),
            parent,
        })
    }
    pub(super) fn guard(&self) -> Arc<File> {
        self._guard.clone()
    }
    fn root(&self) -> PathBuf {
        self.parent.join(ROOT)
    }
    fn is_fresh(&self) -> Result<bool> {
        match fs::symlink_metadata(self.root()) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(true),
            Err(e) => Err(e.into()),
            Ok(metadata) if metadata.is_dir() => {
                read_selector(self)?;
                Ok(false)
            }
            Ok(_) => Err(RegistryError::RecoveryRequired(
                "probe root is not a directory".into(),
            )),
        }
    }
    fn initialize(&self) -> Result<()> {
        if !self.is_fresh()? {
            return Err(RegistryError::Conflict("probe already initialized".into()));
        }
        fs::create_dir(self.root())?;
        fs::create_dir(self.root().join("generations"))?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GenerationId([u8; 16]);
impl GenerationId {
    fn random() -> Result<Self> {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes)
            .map_err(|e| RegistryError::Unavailable(format!("probe randomness: {e}")))?;
        Ok(Self(bytes))
    }
    fn name(self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
    fn directory(self, lease: &LocationLease) -> PathBuf {
        lease.root().join("generations").join(self.name())
    }
    fn database(self, lease: &LocationLease) -> PathBuf {
        self.directory(lease).join("registry.sqlite")
    }
    fn encode(self) -> Vec<u8> {
        let mut record = Vec::with_capacity(SELECTOR_BYTES);
        record.extend_from_slice(MAGIC);
        record.extend_from_slice(&self.0);
        let checksum = Sha256::digest(&record);
        record.extend_from_slice(&checksum);
        record
    }
    fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != SELECTOR_BYTES
            || !bytes.starts_with(MAGIC)
            || Sha256::digest(&bytes[..MAGIC.len() + 16])[..] != bytes[MAGIC.len() + 16..]
        {
            return Err(RegistryError::RecoveryRequired(
                "invalid probe selector".into(),
            ));
        }
        Ok(Self(
            bytes[MAGIC.len()..MAGIC.len() + 16]
                .try_into()
                .expect("checked selector length"),
        ))
    }
}

fn read_selector(lease: &LocationLease) -> Result<GenerationId> {
    let path = lease.root().join(ACTIVE);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|e| RegistryError::RecoveryRequired(format!("probe selector unavailable: {e}")))?;
    if !metadata.is_file() || metadata.len() != SELECTOR_BYTES as u64 {
        return Err(RegistryError::RecoveryRequired(
            "probe selector shape invalid".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(SELECTOR_BYTES);
    File::open(path)?
        .take(SELECTOR_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    GenerationId::decode(&bytes)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    GenerationCreated,
    DatabasePrepared,
    BeforeSeal,
    GenerationSealed,
    GenerationDirectorySync,
    GenerationsDirectorySync,
    RootDirectorySync,
    ParentDirectorySync,
    BeforeSelectorCreate,
    SelectorWrite,
    SelectorFileSync,
    BeforeReplace,
    AfterReplace,
    PublishedDirectorySync,
    SelectorConfirmed,
    BeforeReopen,
}
trait Control {
    fn at(&mut self, _phase: Phase) -> io::Result<()> {
        Ok(())
    }
    fn write_selector(&mut self, file: &mut File, record: &[u8]) -> io::Result<()> {
        file.write_all(record)
    }
}
struct Native;
impl Control for Native {}

// Only preparation and successful sealing construct this value. It does not
// claim that the generation directory or its selector has been synchronized.
struct SealedGeneration {
    id: GenerationId,
}
fn prepare(
    lease: &LocationLease,
    limits: &RegistryLimits,
    control: &mut impl Control,
) -> Result<SealedGeneration> {
    let id = GenerationId::random()?;
    fs::create_dir(id.directory(lease))?;
    control.at(Phase::GenerationCreated)?;
    let path = id.database(lease);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    let mut connection = Connection::open(&path)?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    )?;
    schema::initialize(&mut connection)?;
    control.at(Phase::DatabasePrepared)?;
    control.at(Phase::BeforeSeal)?;
    sealing::seal(connection, &path, limits).map_err(|failure| failure.error)?;
    control.at(Phase::GenerationSealed)?;
    Ok(SealedGeneration { id })
}

async fn publish(
    lease: LocationLease,
    generation: &SealedGeneration,
    replace: bool,
    limits: RegistryLimits,
    control: &mut impl Control,
) -> Result<ProbeSession> {
    if replace {
        read_selector(&lease)?;
    } else if lease.root().join(ACTIVE).try_exists()? {
        return Err(RegistryError::Conflict(
            "first publication cannot replace a selector".into(),
        ));
    }
    for (phase, directory) in [
        (
            Phase::GenerationDirectorySync,
            generation.id.directory(&lease),
        ),
        (
            Phase::GenerationsDirectorySync,
            lease.root().join("generations"),
        ),
        (Phase::RootDirectorySync, lease.root()),
        (Phase::ParentDirectorySync, lease.parent.clone()),
    ] {
        control.at(phase)?;
        // Windows deliberately refuses here. Its native move candidate is tested
        // separately; this coordinator never manufactures a durable success.
        platform::sync_directory(&directory)?;
    }
    control.at(Phase::BeforeSelectorCreate)?;
    let temporary = lease
        .root()
        .join(format!("selector-{}.tmp", GenerationId::random()?.name()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    control.at(Phase::SelectorWrite)?;
    control.write_selector(&mut file, &generation.id.encode())?;
    control.at(Phase::SelectorFileSync)?;
    file.sync_all()?;
    drop(file);
    control.at(Phase::BeforeReplace)?;
    let uncertain = |error: io::Error| {
        RegistryError::OutcomeUnknown(format!("probe selector publication: {error}"))
    };
    platform::replace_selector(&temporary, &lease.root().join(ACTIVE), replace)
        .map_err(uncertain)?;
    control.at(Phase::AfterReplace).map_err(uncertain)?;
    control
        .at(Phase::PublishedDirectorySync)
        .map_err(uncertain)?;
    platform::sync_directory(&lease.root()).map_err(uncertain)?;
    // This phase follows successful required barriers. A later readiness failure
    // cannot be recast as a failed or uncertain selector operation.
    control.at(Phase::SelectorConfirmed).map_err(|e| {
        RegistryError::RecoveryRequired(format!("probe post-publication failure: {e}"))
    })?;
    if read_selector(&lease)? != generation.id {
        return Err(RegistryError::RecoveryRequired(
            "probe selector changed after publication".into(),
        ));
    }
    control
        .at(Phase::BeforeReopen)
        .map_err(|e| RegistryError::RecoveryRequired(format!("probe fresh opening failed: {e}")))?;
    open_selected(lease, limits).await
}

async fn open_selected(lease: LocationLease, limits: RegistryLimits) -> Result<ProbeSession> {
    let selected = read_selector(&lease)?;
    let startup = super::worker::ProbeStartup {
        lease: lease.guard(),
        after_open: None,
    };
    let session = Registry::open_for_probe(
        selected.database(&lease),
        limits,
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
        startup,
    )
    .await
    .map_err(|e| {
        RegistryError::RecoveryRequired(format!("probe selected registry failed readiness: {e}"))
    })?;
    ProbeSession::new(session, lease)
}

/// A test-only coordinator keeps the lease until actual worker shutdown finishes,
/// including when its caller stops waiting or drops the session.
pub(super) struct ProbeSession {
    pub(super) handle: RegistryHandle,
    stop: Option<mpsc::Sender<()>>,
    done: Option<oneshot::Receiver<Result<()>>>,
    cleanup: Option<JoinHandle<()>>,
}
impl ProbeSession {
    pub(super) fn new(session: RegistrySession, lease: LocationLease) -> Result<Self> {
        session.owner.retain_probe_lease(lease._guard.clone())?;
        let (stop, receive) = mpsc::channel();
        let (done, completion) = oneshot::channel();
        let cleanup = thread::Builder::new()
            .name("registry-probe-coordinator".into())
            .spawn(move || {
                let _lease = lease;
                let _ = receive.recv();
                let result = tokio::runtime::Builder::new_current_thread()
                    .build()
                    .map_err(RegistryError::from)
                    .and_then(|runtime| runtime.block_on(session.owner.shutdown()));
                // Shutdown, including worker destruction, precedes lease release.
                drop(_lease);
                let _ = done.send(result);
            })?;
        Ok(Self {
            handle: session.handle,
            stop: Some(stop),
            done: Some(completion),
            cleanup: Some(cleanup),
        })
    }
    pub(super) fn completion(&mut self) -> oneshot::Receiver<Result<()>> {
        self.done.take().expect("probe completion owned once")
    }
    async fn shutdown(mut self) -> Result<()> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let result = self
            .completion()
            .await
            .map_err(|_| RegistryError::Unavailable("probe coordinator completion lost".into()))?;
        if let Some(cleanup) = self.cleanup.take() {
            tokio::task::spawn_blocking(move || cleanup.join())
                .await
                .map_err(|e| RegistryError::Unavailable(format!("probe join: {e}")))?
                .map_err(|_| RegistryError::Unavailable("probe coordinator panic".into()))?;
        }
        result
    }
}
impl Drop for ProbeSession {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}
