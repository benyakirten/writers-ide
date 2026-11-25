//! Checked SQLite sealing for the test-only publication probe.
#![cfg(test)]

use std::{fs, fs::OpenOptions, path::Path, time::Duration};

use rusqlite::Connection;

use super::super::{
    error::{RegistryError, Result},
    model::RegistryLimits,
    store,
};

#[derive(Debug)]
pub(super) struct SealFailure {
    pub error: RegistryError,
    pub connection: Option<Connection>,
}

/// The caller retains exclusive generation ownership throughout this operation.
/// Directory barriers and selector publication belong to the parent probe.
pub(super) fn seal(
    connection: Connection,
    path: &Path,
    limits: &RegistryLimits,
) -> std::result::Result<(), SealFailure> {
    if let Err(error) = prepare(&connection, limits) {
        return Err(SealFailure {
            error,
            connection: Some(connection),
        });
    }
    if let Err((connection, error)) = connection.close() {
        return Err(SealFailure {
            error: error.into(),
            connection: Some(connection),
        });
    }
    finish_closed(path).map_err(|error| SealFailure {
        error,
        connection: None,
    })
}

fn prepare(connection: &Connection, limits: &RegistryLimits) -> Result<()> {
    if !connection.is_autocommit() {
        return Err(RegistryError::Unavailable(
            "cannot seal a registry with an active transaction".into(),
        ));
    }
    // A caller-supplied busy handler must not turn this probe into a retry loop.
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
    // query_row owns and finalizes its statement before checked close is attempted.
    let counters = connection.query_row("PRAGMA main.wal_checkpoint(TRUNCATE)", [], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    check_checkpoint(counters)
}

fn check_checkpoint((busy, log, checkpointed): (i64, i64, i64)) -> Result<()> {
    // WAL mode was verified separately. SQLite may report no WAL ever existed.
    if busy == 0 && ((log == 0 && checkpointed == 0) || (log == -1 && checkpointed == -1)) {
        return Ok(());
    }
    Err(RegistryError::Unavailable(format!(
        "registry TRUNCATE checkpoint incomplete: busy={busy}, log={log}, checkpointed={checkpointed}"
    )))
}

fn finish_closed(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-journal"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        match fs::symlink_metadata(Path::new(&sidecar)) {
            Ok(metadata) => {
                // Do not guess whether an unexplained journal is cold. Preserve it.
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
    // Never open an unrelated raw database descriptor while SQLite owns locks.
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?
        .sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::super::schema;
    use super::*;
    use crate::plugin_integrity::IntegrityLimits;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn limits() -> RegistryLimits {
        RegistryLimits {
            integrity: IntegrityLimits {
                max_files: 64,
                max_file_bytes: 65536,
                max_total_bytes: 262144,
                max_path_bytes: 256,
                max_depth: 8,
            },
            max_rows: 512,
            max_snapshot_bytes: 1048576,
            max_text_bytes: 4096,
            max_location_bytes: 1024,
            max_review_items: 32,
        }
    }

    fn fixture() -> (TempDir, PathBuf, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("registry.sqlite");
        let mut connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
            )
            .unwrap();
        schema::initialize(&mut connection).unwrap();
        (directory, path, connection)
    }

    fn sidecar(path: &Path, suffix: &str) -> PathBuf {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        name.into()
    }

    #[test]
    fn seals_committed_wal_and_reopens_a_valid_registry() {
        let (_directory, path, connection) = fixture();
        connection
            .execute("UPDATE host_settings SET permission_mode='trust'", [])
            .unwrap();
        assert!(fs::metadata(sidecar(&path, "-wal")).unwrap().len() > 0);
        seal(connection, &path, &limits()).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        store::validate_snapshot(&connection, &limits()).unwrap();
        let mode: String = connection
            .query_row("SELECT permission_mode FROM host_settings", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(mode, "trust");
        let journal: String = connection
            .query_row("PRAGMA main.journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal, "wal");
    }

    #[test]
    fn accepts_only_complete_truncate_or_verified_no_wal_counters() {
        for counters in [(0, 0, 0), (0, -1, -1)] {
            check_checkpoint(counters).unwrap();
        }
        for counters in [
            (1, 0, 0),
            (1, -1, -1),
            (0, 4, 4),
            (0, 4, 3),
            (0, -1, 0),
            (0, 0, -1),
            (-1, 0, 0),
        ] {
            assert!(check_checkpoint(counters).is_err(), "{counters:?}");
        }
    }

    #[test]
    fn seals_wal_mode_without_pending_frames() {
        let (_directory, path, connection) = fixture();
        connection.close().unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL")
            .unwrap();
        seal(connection, &path, &limits()).unwrap();
    }

    #[test]
    fn validation_failure_retains_connection_and_evidence() {
        let (_directory, path, connection) = fixture();
        connection.execute("DELETE FROM host_settings", []).unwrap();
        let failure = seal(connection, &path, &limits()).unwrap_err();
        assert!(matches!(failure.error, RegistryError::RecoveryRequired(_)));
        let connection = failure.connection.unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM host_settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(path.exists());
        assert!(fs::metadata(sidecar(&path, "-wal")).unwrap().len() > 0);
    }

    #[test]
    fn validation_honors_host_bounds_and_retains_connection() {
        let (_directory, path, connection) = fixture();
        let mut bounded = limits();
        bounded.max_snapshot_bytes = 1;
        let failure = seal(connection, &path, &bounded).unwrap_err();
        assert!(failure.connection.is_some());
        assert!(matches!(failure.error, RegistryError::LimitExceeded(_)));
    }

    #[test]
    fn rejects_incorrect_configuration_without_reconfiguring_it() {
        for pragma in [
            "PRAGMA journal_mode=DELETE",
            "PRAGMA synchronous=NORMAL",
            "PRAGMA foreign_keys=OFF",
        ] {
            let (_directory, path, connection) = fixture();
            connection.execute_batch(pragma).unwrap();
            let failure = seal(connection, &path, &limits()).unwrap_err();
            assert!(
                matches!(failure.error, RegistryError::Unavailable(_)),
                "{pragma}"
            );
            let connection = failure.connection.unwrap();
            assert!(connection.is_autocommit());
            if pragma.contains("DELETE") {
                let mode: String = connection
                    .query_row("PRAGMA main.journal_mode", [], |r| r.get(0))
                    .unwrap();
                assert_eq!(mode, "delete");
            }
        }
    }

    #[test]
    fn active_transaction_is_not_committed_or_rolled_back() {
        let (_directory, path, connection) = fixture();
        connection
            .execute_batch("BEGIN IMMEDIATE; DELETE FROM host_settings;")
            .unwrap();
        let failure = seal(connection, &path, &limits()).unwrap_err();
        assert!(matches!(failure.error, RegistryError::Unavailable(_)));
        let connection = failure.connection.unwrap();
        assert!(!connection.is_autocommit());
        connection.execute_batch("ROLLBACK").unwrap();
        store::validate_snapshot(&connection, &limits()).unwrap();
    }

    #[test]
    fn active_reader_makes_checkpoint_busy_and_retains_connection() {
        let (_directory, path, connection) = fixture();
        let reader = Connection::open(&path).unwrap();
        reader
            .execute_batch("BEGIN; SELECT * FROM host_settings;")
            .unwrap();
        connection
            .execute("UPDATE host_settings SET permission_mode='trust'", [])
            .unwrap();
        let failure = seal(connection, &path, &limits()).unwrap_err();
        assert!(
            matches!(&failure.error, RegistryError::Unavailable(message) if message.contains("busy=1"))
        );
        let connection = failure.connection.unwrap();
        store::validate_snapshot(&connection, &limits()).unwrap();
        assert!(fs::metadata(sidecar(&path, "-wal")).unwrap().len() > 0);
        reader.execute_batch("ROLLBACK").unwrap();
        reader.close().unwrap();
        // Retrying is an explicit test action, never an automatic seal fallback.
        seal(connection, &path, &limits()).unwrap();
    }

    #[test]
    fn actual_checked_close_failure_retains_returned_connection() {
        let (_directory, path, connection) = fixture();
        let mut statement = std::ptr::null_mut();
        // SAFETY: the connection remains alive through prepare and failed close.
        // This unstepped SELECT owns no read transaction. Finalize it exactly once
        // while the returned connection is still alive, before retrying close.
        unsafe {
            assert_eq!(
                rusqlite::ffi::sqlite3_prepare_v2(
                    connection.handle(),
                    c"SELECT 1".as_ptr(),
                    -1,
                    &mut statement,
                    std::ptr::null_mut(),
                ),
                rusqlite::ffi::SQLITE_OK
            );
        }
        let result = seal(connection, &path, &limits());
        // SAFETY: sqlite3_close returns SQLITE_BUSY without destroying the handle
        // while this statement exists, so finalization is valid on either result.
        unsafe {
            assert_eq!(
                rusqlite::ffi::sqlite3_finalize(statement),
                rusqlite::ffi::SQLITE_OK
            );
        }
        let failure = result.unwrap_err();
        assert!(matches!(failure.error, RegistryError::Storage(_)));
        let connection = failure.connection.unwrap();
        store::validate_snapshot(&connection, &limits()).unwrap();
        seal(connection, &path, &limits()).unwrap();
    }

    #[test]
    fn unexplained_sidecars_fail_closed_and_are_not_deleted() {
        let (_directory, path, connection) = fixture();
        seal(connection, &path, &limits()).unwrap();
        for suffix in ["-wal", "-journal"] {
            let evidence = sidecar(&path, suffix);
            fs::write(&evidence, b"unexplained recovery evidence").unwrap();
            assert!(matches!(
                finish_closed(&path),
                Err(RegistryError::RecoveryRequired(_))
            ));
            assert_eq!(
                fs::read(&evidence).unwrap(),
                b"unexplained recovery evidence"
            );
            // Only the fixture removes its fabricated evidence between cases.
            fs::remove_file(&evidence).unwrap();
        }
        let shm = sidecar(&path, "-shm");
        fs::write(&shm, b"preserved shared memory").unwrap();
        finish_closed(&path).unwrap();
        assert_eq!(fs::read(shm).unwrap(), b"preserved shared memory");
    }

    #[test]
    fn post_close_file_error_has_no_connection_and_does_not_create_file() {
        let (directory, _path, connection) = fixture();
        let absent = directory.path().join("absent.sqlite");
        let failure = seal(connection, &absent, &limits()).unwrap_err();
        assert!(matches!(failure.error, RegistryError::Storage(_)));
        assert!(failure.connection.is_none());
        assert!(!absent.exists());
    }
}
