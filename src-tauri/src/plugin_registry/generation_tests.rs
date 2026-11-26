use super::*;
use crate::plugin_integrity::IntegrityLimits;
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

fn fixture() -> (TempDir, LocationLease, PreparedGeneration) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("owned-root");
    let lease = LocationLease::acquire(&root).unwrap();
    fs::create_dir(&root).unwrap();
    let generation = PreparedGeneration::create(&lease, Path::new("candidate"), limits()).unwrap();
    (directory, lease, generation)
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    name.into()
}

fn assert_owned(root: &Path, database: &Path) {
    assert!(LocationLease::acquire(root).is_err());
    assert!(Store::open(database, limits()).is_err());
}

#[test]
fn constructor_requires_existing_root_and_never_creates_it() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("absent");
    let lease = LocationLease::acquire(&root).unwrap();
    assert!(PreparedGeneration::create(&lease, Path::new("candidate"), limits()).is_err());
    assert!(!root.exists());
}

#[test]
fn constructor_refuses_non_single_component_names_without_storage_changes() {
    let (_directory, lease, generation) = fixture();
    for name in [
        "",
        ".",
        "..",
        "../escape",
        "nested/name",
        "/absolute",
        "candidate/",
    ] {
        assert!(
            matches!(
                PreparedGeneration::create(&lease, Path::new(name), limits()),
                Err(RegistryError::InvalidInput(_))
            ),
            "{name}"
        );
    }
    assert_eq!(fs::read_dir(lease.root()).unwrap().count(), 1);
    drop(generation);
}

#[test]
fn constructor_never_reuses_existing_directory_file_or_symlink() {
    let (_directory, lease, generation) = fixture();
    fs::write(lease.root().join("file"), b"preserve").unwrap();
    fs::create_dir(lease.root().join("empty")).unwrap();
    for name in ["candidate", "file", "empty"] {
        assert!(PreparedGeneration::create(&lease, Path::new(name), limits()).is_err());
    }
    assert_eq!(fs::read(lease.root().join("file")).unwrap(), b"preserve");
    assert_eq!(fs::read_dir(lease.root().join("empty")).unwrap().count(), 0);
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("missing", lease.root().join("link")).unwrap();
        assert!(PreparedGeneration::create(&lease, Path::new("link"), limits()).is_err());
        assert!(fs::symlink_metadata(lease.root().join("link"))
            .unwrap()
            .is_symlink());
    }
    drop(generation);
}

#[test]
fn seal_is_bound_to_its_generation_and_retains_both_ownership_locks() {
    let (_directory, lease, first) = fixture();
    let second = PreparedGeneration::create(&lease, Path::new("other"), limits()).unwrap();
    let root = lease.root().to_path_buf();
    let path = first.generation.database.clone();
    first
        .store
        .test_connection()
        .execute("UPDATE host_settings SET permission_mode='trust'", [])
        .unwrap();
    assert!(fs::metadata(sidecar(&path, "-wal")).unwrap().len() > 0);
    drop(lease);
    assert_owned(&root, &path);
    let sealed = first.seal().unwrap();
    assert_eq!(sealed.database_path(), path);
    assert_eq!(sealed.directory(), root.join("candidate"));
    assert_owned(&root, &path);
    assert_eq!(
        second
            .store
            .test_connection()
            .query_row("SELECT permission_mode FROM host_settings", [], |r| r
                .get::<_, String>(0),)
            .unwrap(),
        "secure"
    );
    drop(second);
    assert_owned(&root, &path);
    drop(sealed);
    let _lease = LocationLease::acquire(&root).unwrap();
    let mut store = Store::open(&path, limits()).unwrap();
    assert_eq!(
        store
            .test_connection()
            .query_row("SELECT permission_mode FROM host_settings", [], |r| r
                .get::<_, String>(0),)
            .unwrap(),
        "trust"
    );
    store.read_settings().unwrap();
}

#[test]
fn preclose_validation_failure_retains_connection_generation_and_locks() {
    let (_directory, lease, generation) = fixture();
    let root = lease.root().to_path_buf();
    generation
        .store
        .test_connection()
        .execute("DELETE FROM host_settings", [])
        .unwrap();
    drop(lease);
    let failure = generation.seal().unwrap_err();
    assert!(matches!(
        failure.error(),
        RegistryError::RecoveryRequired(_)
    ));
    assert!(failure.has_connection());
    assert_eq!(failure.directory(), root.join("candidate"));
    assert_owned(&root, failure.database_path());
    assert_eq!(
        failure
            .store
            .as_ref()
            .unwrap()
            .test_connection()
            .query_row("SELECT count(*) FROM host_settings", [], |r| r
                .get::<_, i64>(0),)
            .unwrap(),
        0
    );
    assert!(
        fs::metadata(sidecar(failure.database_path(), "-wal"))
            .unwrap()
            .len()
            > 0
    );
    let path = failure.database_path().to_path_buf();
    drop(failure);
    let _lease = LocationLease::acquire(&root).unwrap();
    // Invalid content is preserved, not silently repaired during failure cleanup.
    let connection = Connection::open(path).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM host_settings", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn sealing_revalidates_bounds() {
    let (_directory, _lease, generation) = fixture();
    generation
        .store
        .test_connection()
        .execute("INSERT INTO packages(name) VALUES (?1)", ["x".repeat(4097)])
        .unwrap();
    let failure = generation.seal().unwrap_err();
    assert!(matches!(failure.error(), RegistryError::LimitExceeded(_)));
    assert!(failure.has_connection());
}

#[test]
fn incorrect_configuration_retains_same_connection_without_reconfiguring() {
    for pragma in [
        "PRAGMA journal_mode=DELETE",
        "PRAGMA synchronous=NORMAL",
        "PRAGMA foreign_keys=OFF",
    ] {
        let (_directory, _lease, generation) = fixture();
        generation
            .store
            .test_connection()
            .execute_batch(pragma)
            .unwrap();
        let failure = generation.seal().unwrap_err();
        assert!(matches!(failure.error(), RegistryError::Unavailable(_)));
        assert!(failure.has_connection());
        let connection = failure.store.as_ref().unwrap().test_connection();
        if pragma.contains("DELETE") {
            assert_eq!(
                connection
                    .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "delete"
            );
        } else if pragma.contains("NORMAL") {
            assert_eq!(
                connection
                    .query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
        } else {
            assert_eq!(
                connection
                    .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
}

#[test]
fn active_transaction_is_preserved_on_same_thread() {
    let (_directory, _lease, generation) = fixture();
    generation
        .store
        .test_connection()
        .execute_batch("BEGIN IMMEDIATE; DELETE FROM host_settings")
        .unwrap();
    let failure = generation.seal().unwrap_err();
    let connection = failure.store.as_ref().unwrap().test_connection();
    assert!(!connection.is_autocommit());
    connection.execute_batch("ROLLBACK").unwrap();
    store::validate_snapshot(connection, &limits()).unwrap();
}

#[test]
fn reader_blocks_checkpoint_without_losing_connection_or_ownership() {
    let (_directory, lease, generation) = fixture();
    let root = lease.root().to_path_buf();
    let reader = Connection::open(&generation.generation.database).unwrap();
    reader
        .execute_batch("BEGIN; SELECT * FROM host_settings")
        .unwrap();
    generation
        .store
        .test_connection()
        .execute("UPDATE host_settings SET permission_mode='trust'", [])
        .unwrap();
    drop(lease);
    let failure = generation.seal().unwrap_err();
    assert!(
        matches!(failure.error(), RegistryError::Unavailable(message) if message.contains("busy=1"))
    );
    assert!(failure.has_connection());
    assert_owned(&root, failure.database_path());
    assert!(
        fs::metadata(sidecar(failure.database_path(), "-wal"))
            .unwrap()
            .len()
            > 0
    );
    reader.execute_batch("ROLLBACK").unwrap();
    reader.close().unwrap();
}

#[test]
fn actual_checked_close_failure_retains_store_and_generation_lease() {
    let (_directory, lease, generation) = fixture();
    let root = lease.root().to_path_buf();
    let mut statement = std::ptr::null_mut();
    // SAFETY: this unstepped statement remains valid through a failed checked close.
    // The returned store stays alive until the statement is finalized exactly once.
    unsafe {
        assert_eq!(
            rusqlite::ffi::sqlite3_prepare_v2(
                generation.store.test_connection().handle(),
                c"SELECT 1".as_ptr(),
                -1,
                &mut statement,
                std::ptr::null_mut(),
            ),
            rusqlite::ffi::SQLITE_OK
        );
    }
    drop(lease);
    let result = generation.seal();
    // SAFETY: sqlite3_close returns BUSY without destroying the live handle.
    unsafe {
        assert_eq!(
            rusqlite::ffi::sqlite3_finalize(statement),
            rusqlite::ffi::SQLITE_OK
        );
    }
    let failure = result.unwrap_err();
    assert!(matches!(failure.error(), RegistryError::Storage(_)));
    assert!(failure.has_connection());
    assert_owned(&root, failure.database_path());
    store::validate_snapshot(failure.store.as_ref().unwrap().test_connection(), &limits()).unwrap();
}

#[test]
fn postclose_sidecar_failure_has_no_connection_and_preserves_evidence_and_locks() {
    let (_directory, lease, generation) = fixture();
    let root = lease.root().to_path_buf();
    let journal = sidecar(&generation.generation.database, "-journal");
    fs::write(&journal, b"unexplained evidence").unwrap();
    drop(lease);
    let failure = generation.seal().unwrap_err();
    assert!(matches!(
        failure.error(),
        RegistryError::RecoveryRequired(_)
    ));
    assert!(!failure.has_connection());
    assert_owned(&root, failure.database_path());
    assert_eq!(fs::read(&journal).unwrap(), b"unexplained evidence");
    let path = failure.database_path().to_path_buf();
    drop(failure);
    let _lease = LocationLease::acquire(&root).unwrap();
    fs::remove_file(journal).unwrap();
    Store::open(&path, limits()).unwrap();
}

#[test]
fn sidecar_checks_preserve_nonempty_files_directories_and_shared_memory() {
    let (_directory, _lease, generation) = fixture();
    let sealed = generation.seal().unwrap();
    let path = sealed.database_path();
    for suffix in ["-wal", "-journal"] {
        let evidence = sidecar(path, suffix);
        fs::write(&evidence, b"evidence").unwrap();
        assert!(matches!(
            finish_closed(path),
            Err(RegistryError::RecoveryRequired(_))
        ));
        assert_eq!(fs::read(&evidence).unwrap(), b"evidence");
        fs::remove_file(&evidence).unwrap();
        fs::create_dir(&evidence).unwrap();
        assert!(finish_closed(path).is_err());
        fs::remove_dir(&evidence).unwrap();
        fs::write(&evidence, b"").unwrap();
        finish_closed(path).unwrap();
        fs::remove_file(&evidence).unwrap();
    }
    let shm = sidecar(path, "-shm");
    fs::write(&shm, b"preserve").unwrap();
    finish_closed(path).unwrap();
    assert_eq!(fs::read(shm).unwrap(), b"preserve");
}

#[test]
fn closed_file_sync_does_not_create_a_missing_database() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("absent.sqlite");
    assert!(matches!(
        finish_closed(&missing),
        Err(RegistryError::Storage(_))
    ));
    assert!(!missing.exists());
}

#[test]
fn accepts_only_complete_checkpoint_counters() {
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
