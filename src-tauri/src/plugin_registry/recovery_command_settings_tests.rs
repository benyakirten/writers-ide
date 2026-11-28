use super::*;
use crate::plugin_registry::{
    migrations,
    model::{
        CommandResourceRevision, CommandResourceSettings, CommandResourceSettingsSnapshot,
        PermissionMode, RepairConflictPolicy,
    },
    store::{self, Store},
};
use rusqlite::types::Value;

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits::default(),
        max_rows: 100,
        max_snapshot_bytes: 1_000_000,
        max_text_bytes: 65_536,
        max_location_bytes: 4096,
        max_review_items: 100,
    }
}

fn database(path: &Path, version: i64) -> Connection {
    let mut connection = Connection::open(path).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    if version == 1 {
        schema::initialize_v1(&mut connection).unwrap();
    } else {
        assert_eq!(version, schema::VERSION);
        schema::initialize(&mut connection).unwrap();
    }
    connection
}

fn custom_settings() -> CommandResourceSettings {
    CommandResourceSettings {
        max_caller_pending: 3,
        max_provider_pending: 5,
        max_window_pending: 7,
        max_payload_bytes: 11,
        max_payload_depth: 13,
        max_payload_entries: 17,
        max_component_bytes: 19,
        max_window_bytes: CommandResourceSettings::MAX_SAFE_INTEGER,
    }
}

fn set_resources(connection: &Connection, settings: CommandResourceSettings, revision: i64) {
    settings.validate().unwrap();
    connection
        .execute(
            "UPDATE host_settings SET command_max_caller_pending=?1,
         command_max_provider_pending=?2,command_max_window_pending=?3,
         command_max_payload_bytes=?4,command_max_payload_depth=?5,
         command_max_payload_entries=?6,command_max_component_bytes=?7,
         command_max_window_bytes=?8,command_resource_revision=?9",
            params![
                settings.max_caller_pending as i64,
                settings.max_provider_pending as i64,
                settings.max_window_pending as i64,
                settings.max_payload_bytes as i64,
                settings.max_payload_depth as i64,
                settings.max_payload_entries as i64,
                settings.max_component_bytes as i64,
                settings.max_window_bytes as i64,
                revision,
            ],
        )
        .unwrap();
}

// Fixture rows are bounded. Capture every table, including metadata and sequences.
fn contents(connection: &Connection) -> Vec<(String, Vec<Vec<Value>>)> {
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap();
    let tables: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    tables
        .into_iter()
        .map(|table| {
            let mut statement = connection
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            let rows = statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|index| row.get(index))
                        .collect::<rusqlite::Result<Vec<Value>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            (table, rows)
        })
        .collect()
}

fn namespace(connection: &Connection) -> Vec<u8> {
    connection
        .query_row(
            "SELECT identity_namespace FROM registry_metadata",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn history(connection: &Connection, name: &str, version: &str, digest: u8) {
    connection
        .execute("INSERT OR IGNORE INTO packages(name) VALUES (?1)", [name])
        .unwrap();
    connection.execute(
        "INSERT INTO package_version_history SELECT id,?2,'writers-ide.file-set/1',?3 FROM packages WHERE name=?1",
        params![name, version, vec![digest; 32]],
    ).unwrap();
}

fn assert_history(connection: &Connection, expected: &[(&str, &str, u8)]) {
    let mut statement = connection
        .prepare(
            "SELECT p.canonical_id,h.version,h.fingerprint FROM package_version_history h
         JOIN packages p ON p.id=h.package_id ORDER BY p.canonical_id,h.version",
        )
        .unwrap();
    let actual = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    let expected: Vec<_> = expected
        .iter()
        .map(|(name, version, digest)| (name.to_string(), version.to_string(), vec![*digest; 32]))
        .collect();
    assert_eq!(actual, expected);
}

#[test]
fn v2_restore_preserves_all_backed_up_resource_values_and_revision_but_forces_secure() {
    let dir = tempfile::tempdir().unwrap();
    let current_path = dir.path().join("current.sqlite");
    let backup_path = dir.path().join("backup.sqlite");
    let target_path = dir.path().join("restored.sqlite");
    let current = database(&current_path, 2);
    current.execute_batch(
        "UPDATE host_settings SET permission_mode='trust',repair_conflict_policy='ask-before-replacing-update';",
    ).unwrap();
    set_resources(&current, custom_settings(), i64::MAX);
    history(&current, "base", "1.0.0", 1);
    backup_database(&current, &backup_path).unwrap();
    let source = open_existing(&backup_path).unwrap();
    let source_contents = contents(&source);
    let source_namespace = namespace(&source);
    let backup_bytes = std::fs::read(&backup_path).unwrap();
    set_resources(&current, CommandResourceSettings::default(), 23);
    history(&current, "later", "2.0.0", 2);
    let current_contents = contents(&current);
    let current_bytes = std::fs::read(&current_path).unwrap();

    prepare_restore(
        &backup_path,
        Some(&current_path),
        &target_path,
        false,
        &limits(),
    )
    .unwrap();

    assert_eq!(contents(&source), source_contents);
    assert_eq!(contents(&current), current_contents);
    assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
    assert_eq!(std::fs::read(&current_path).unwrap(), current_bytes);
    let target = open_existing(&target_path).unwrap();
    store::validate_snapshot(&target, &limits()).unwrap();
    assert_eq!(namespace(&target), source_namespace);
    assert_history(&target, &[("base", "1.0.0", 1), ("later", "2.0.0", 2)]);
    drop(target);
    let mut restored = Store::open(&target_path, limits()).unwrap();
    assert_eq!(
        restored.read_command_resource_settings().unwrap(),
        CommandResourceSettingsSnapshot {
            revision: CommandResourceRevision::new(i64::MAX).unwrap(),
            settings: custom_settings(),
        }
    );
    let settings = restored.read_settings().unwrap();
    assert_eq!(settings.permission_mode, PermissionMode::Secure);
    assert_eq!(
        settings.repair_conflict_policy,
        RepairConflictPolicy::AskBeforeReplacingUpdate
    );
}

#[test]
fn v1_backup_is_read_only_and_restore_upgrades_only_target_preserving_history_and_high_water() {
    let dir = tempfile::tempdir().unwrap();
    let current_path = dir.path().join("current.sqlite");
    let backup_path = dir.path().join("v1-backup.sqlite");
    let migration_backup = dir.path().join("pre-upgrade.sqlite");
    let target_path = dir.path().join("restored.sqlite");
    let mut current = database(&current_path, 1);
    current
        .execute("UPDATE host_settings SET permission_mode='trust'", [])
        .unwrap();
    history(&current, "base", "1.0.0+kept", 1);
    backup_database_supported(&current, &backup_path).unwrap();
    let source = open_existing(&backup_path).unwrap();
    assert_eq!(
        store::validate_supported_snapshot(&source, &limits()).unwrap(),
        1
    );
    assert!(source
        .execute("UPDATE host_settings SET permission_mode='secure'", [])
        .is_err());
    let source_contents = contents(&source);
    let source_namespace = namespace(&source);
    let backup_bytes = std::fs::read(&backup_path).unwrap();

    migrations::upgrade_to_current(&mut current, &migration_backup, &limits()).unwrap();
    let migration_bytes = std::fs::read(&migration_backup).unwrap();
    set_resources(&current, custom_settings(), 41);
    history(&current, "later", "2.0.0+kept", 2);
    current
        .execute_batch(
            "INSERT INTO components(id,package_id,local_id) VALUES (90,1,'gone');
         DELETE FROM components;
         INSERT INTO project_registrations VALUES (120,'Gone','test',x'01','test',x'02',1);
         DELETE FROM project_registrations;
         UPDATE sqlite_sequence SET seq=200 WHERE name='packages';",
        )
        .unwrap();
    let current_contents = contents(&current);
    let current_bytes = std::fs::read(&current_path).unwrap();

    prepare_restore(
        &backup_path,
        Some(&current_path),
        &target_path,
        false,
        &limits(),
    )
    .unwrap();

    assert_eq!(contents(&source), source_contents);
    assert_eq!(schema::validate_supported(&source).unwrap(), 1);
    assert_eq!(contents(&current), current_contents);
    assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
    assert_eq!(std::fs::read(&migration_backup).unwrap(), migration_bytes);
    assert_eq!(std::fs::read(&current_path).unwrap(), current_bytes);
    let target = open_existing(&target_path).unwrap();
    assert_eq!(schema::validate_supported(&target).unwrap(), 2);
    store::validate_snapshot(&target, &limits()).unwrap();
    assert_eq!(namespace(&target), source_namespace);
    assert_history(
        &target,
        &[("base", "1.0.0+kept", 1), ("later", "2.0.0+kept", 2)],
    );
    assert_eq!(schema::allocation_bounds(&target).unwrap(), [201, 90, 120]);
    drop(target);
    let mut restored = Store::open(&target_path, limits()).unwrap();
    assert_eq!(
        restored.read_command_resource_settings().unwrap(),
        CommandResourceSettingsSnapshot {
            revision: CommandResourceRevision::default(),
            settings: CommandResourceSettings::default(),
        }
    );
    assert_eq!(
        restored.read_settings().unwrap().permission_mode,
        PermissionMode::Secure
    );
}

#[test]
fn invalid_v2_resources_or_missing_settings_reject_before_destination_creation() {
    for invalid_sql in [
        "PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET command_max_payload_bytes=0;",
        "PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET command_max_window_bytes=9007199254740992;",
        "PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET command_resource_revision=-1;",
        "DELETE FROM host_settings;",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let current_path = dir.path().join("current.sqlite");
        let backup_path = dir.path().join("backup.sqlite");
        let target_path = dir.path().join("restored.sqlite");
        let current = database(&current_path, 2);
        set_resources(&current, custom_settings(), 9);
        backup_database(&current, &backup_path).unwrap();
        let damaged = Connection::open(&backup_path).unwrap();
        damaged.execute_batch(invalid_sql).unwrap();
        drop(damaged);
        let backup_bytes = std::fs::read(&backup_path).unwrap();
        let current_contents = contents(&current);
        let current_bytes = std::fs::read(&current_path).unwrap();
        for acknowledge_loss in [false, true] {
            let probe = open_existing(&backup_path).unwrap();
            assert!(matches!(
                schema::validate_supported(&probe),
                Err(RegistryError::RecoveryRequired(_))
            ));
            drop(probe);
            assert!(matches!(
                prepare_restore(&backup_path, Some(&current_path), &target_path, acknowledge_loss, &limits()),
                Err(RegistryError::RecoveryRequired(_))
            ), "{invalid_sql}");
            assert!(!target_path.exists(), "destination created for {invalid_sql}");
            assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
            assert_eq!(std::fs::read(&current_path).unwrap(), current_bytes);
            assert_eq!(contents(&current), current_contents);
        }
    }
}

#[test]
fn invalid_or_future_current_version_never_creates_restore_destination() {
    for version in [0_i64, -1, schema::VERSION + 1, i64::MAX] {
        let dir = tempfile::tempdir().unwrap();
        let current_path = dir.path().join("current.sqlite");
        let backup_path = dir.path().join("backup.sqlite");
        let target_path = dir.path().join("restored.sqlite");
        let current = database(&current_path, 2);
        set_resources(&current, custom_settings(), 27);
        backup_database(&current, &backup_path).unwrap();
        current
            .execute_batch("PRAGMA ignore_check_constraints=ON")
            .unwrap();
        current
            .execute("UPDATE registry_metadata SET schema_version=?1", [version])
            .unwrap();
        let current_contents = contents(&current);
        let current_bytes = std::fs::read(&current_path).unwrap();
        let backup_bytes = std::fs::read(&backup_path).unwrap();
        for acknowledge_loss in [false, true] {
            assert!(
                matches!(
                    prepare_restore(
                        &backup_path,
                        Some(&current_path),
                        &target_path,
                        acknowledge_loss,
                        &limits()
                    ),
                    Err(RegistryError::RecoveryRequired(_))
                ),
                "current version {version}"
            );
            assert!(!target_path.exists());
            assert_eq!(contents(&current), current_contents);
            assert_eq!(std::fs::read(&current_path).unwrap(), current_bytes);
            assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
        }
    }
}

fn catalog_bytes(connection: &Connection) -> usize {
    let bytes: i64 = connection.query_row(
        "SELECT coalesce(sum(coalesce(length(CAST(name AS BLOB)),0)+coalesce(length(CAST(sql AS BLOB)),0)),0) FROM sqlite_schema",
        [], |row| row.get(0),
    ).unwrap();
    usize::try_from(bytes).unwrap()
}

#[test]
fn failed_working_copy_upgrade_retains_sources_and_never_exposes_ready_store() {
    let dir = tempfile::tempdir().unwrap();
    let current_path = dir.path().join("current.sqlite");
    let backup_path = dir.path().join("v1-backup.sqlite");
    let target_path = dir.path().join("failed-working-copy.sqlite");
    let current = database(&current_path, 1);
    history(&current, "base", "1.0.0", 1);
    backup_database_supported(&current, &backup_path).unwrap();
    let source = open_existing(&backup_path).unwrap();
    let source_contents = contents(&source);
    let current_contents = contents(&current);
    let backup_bytes = std::fs::read(&backup_path).unwrap();
    let current_bytes = std::fs::read(&current_path).unwrap();
    let v2 = database(&dir.path().join("v2-reference.sqlite"), 2);
    let v1_catalog_bytes = catalog_bytes(&source);
    assert!(catalog_bytes(&v2) > v1_catalog_bytes);
    let mut bounded = limits();
    bounded.max_snapshot_bytes = v1_catalog_bytes;
    assert!(include_str!("migration_v1_to_v2.sql").len() <= bounded.max_snapshot_bytes);
    assert_eq!(
        store::validate_supported_snapshot(&source, &bounded).unwrap(),
        1
    );
    assert!(matches!(
        store::validate_snapshot(&v2, &bounded),
        Err(RegistryError::LimitExceeded(_))
    ));

    assert!(matches!(
        prepare_restore(
            &backup_path,
            Some(&current_path),
            &target_path,
            false,
            &bounded
        ),
        Err(RegistryError::LimitExceeded(_))
    ));

    assert!(target_path.exists());
    let failed = open_existing(&target_path).unwrap();
    // Target validation failed inside the migration transaction and rolled it back.
    assert_eq!(schema::validate_supported(&failed).unwrap(), 1);
    assert_eq!(contents(&failed), source_contents);
    assert!(Store::open(&target_path, limits()).is_err());
    assert_eq!(contents(&source), source_contents);
    assert_eq!(contents(&current), current_contents);
    assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
    assert_eq!(std::fs::read(&current_path).unwrap(), current_bytes);
}
