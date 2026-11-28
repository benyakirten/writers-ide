use super::*;
use crate::plugin_registry::schema;
use rusqlite::Connection;
use std::{future::Future, path::Path};

fn run<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits::default(),
        max_rows: 100,
        max_snapshot_bytes: 1024 * 1024,
        max_text_bytes: 65536,
        max_location_bytes: 4096,
        max_review_items: 100,
    }
}

fn fixture(legacy: bool) -> (tempfile::TempDir, LocationLease, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    std::fs::create_dir(&root).unwrap();
    let path = root.join("registry.sqlite");
    let mut connection = Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    if legacy {
        schema::initialize_v1(&mut connection).unwrap();
    } else {
        schema::initialize(&mut connection).unwrap();
    }
    connection.execute_batch("UPDATE host_settings SET permission_mode='trust',repair_conflict_policy='ask-before-replacing-update'").unwrap();
    connection.close().unwrap();
    (directory, lease, path)
}

fn version(path: &Path) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row("SELECT schema_version FROM registry_metadata", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn owned_upgrade_returns_ready_settings_only_after_preserved_backup_and_validation() {
    let (directory, lease, path) = fixture(true);
    let backup = directory.path().join("before-upgrade.sqlite");
    let session = run(Registry::open_owned_with_upgrade(
        lease.clone(),
        path.clone(),
        backup.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap(),
    ))
    .unwrap();
    let saved = run(session.handle.read_command_resource_settings()).unwrap();
    assert_eq!(saved.settings, CommandResourceSettings::default());
    assert_eq!(saved.revision, CommandResourceRevision::default());
    let host = run(session.handle.read_settings()).unwrap();
    assert_eq!(host.permission_mode, PermissionMode::Trust);
    assert_eq!(
        host.repair_conflict_policy,
        RepairConflictPolicy::AskBeforeReplacingUpdate
    );
    assert_eq!(version(&backup), 1);
    assert_eq!(version(&path), schema::VERSION);
    let source = Connection::open(&backup).unwrap();
    let target = Connection::open(&path).unwrap();
    let namespace = |connection: &Connection| {
        connection
            .query_row(
                "SELECT identity_namespace FROM registry_metadata",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .unwrap()
    };
    assert_eq!(namespace(&source), namespace(&target));
    source.close().unwrap();
    target.close().unwrap();
    run(session.owner.shutdown()).unwrap();
    assert!(matches!(
        run(session.handle.read_command_resource_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    let reopened = run(Registry::open_owned(
        lease,
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap(),
    ))
    .unwrap();
    assert_eq!(
        run(reopened.handle.read_command_resource_settings()).unwrap(),
        saved
    );
    run(reopened.owner.shutdown()).unwrap();
}

#[test]
fn legacy_open_without_explicit_backup_never_returns_a_ready_handle() {
    let (_directory, lease, path) = fixture(true);
    assert!(matches!(
        run(Registry::open_owned(
            lease,
            path.clone(),
            limits(),
            crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap()
        )),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert_eq!(version(&path), 1);
}

#[test]
fn occupied_backup_or_unknown_schema_never_exposes_a_ready_service() {
    let (directory, lease, path) = fixture(true);
    let backup = directory.path().join("keep.sqlite");
    std::fs::write(&backup, b"existing evidence").unwrap();
    assert!(run(Registry::open_owned_with_upgrade(
        lease.clone(),
        path.clone(),
        backup.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap(),
    ))
    .is_err());
    assert_eq!(std::fs::read(&backup).unwrap(), b"existing evidence");
    assert_eq!(version(&path), 1);
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch("UPDATE registry_metadata SET schema_version=3")
        .unwrap();
    connection.close().unwrap();
    let unused = directory.path().join("unused.sqlite");
    assert!(matches!(
        run(Registry::open_owned_with_upgrade(
            lease,
            path.clone(),
            unused.clone(),
            limits(),
            crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap()
        )),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert!(!unused.exists());
    assert_eq!(version(&path), 3);
}

#[test]
fn current_schema_upgrade_open_preserves_saved_limits_and_never_overwrites_backup() {
    let (directory, lease, path) = fixture(false);
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "UPDATE host_settings SET command_max_caller_pending=9,command_resource_revision=3",
        )
        .unwrap();
    connection.close().unwrap();
    let backup = directory.path().join("already-present.sqlite");
    std::fs::write(&backup, b"retained backup").unwrap();
    let session = run(Registry::open_owned_with_upgrade(
        lease,
        path,
        backup.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap(),
    ))
    .unwrap();
    let settings = run(session.handle.read_command_resource_settings()).unwrap();
    assert_eq!(settings.settings.max_caller_pending, 9);
    assert_eq!(settings.revision.value(), 3);
    assert_eq!(std::fs::read(backup).unwrap(), b"retained backup");
    run(session.owner.shutdown()).unwrap();
}
