use super::*;
use crate::plugin_integrity::IntegrityLimits;
use rusqlite::types::Value;

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: IntegrityLimits::default(),
        max_rows: 100,
        max_snapshot_bytes: 1024 * 1024,
        max_text_bytes: 65536,
        max_location_bytes: 4096,
        max_review_items: 100,
    }
}

fn v1() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    schema::initialize_v1(&mut connection).unwrap();
    connection
}

fn populate(connection: &Connection) {
    connection.execute_batch(
        "UPDATE host_settings SET permission_mode='trust', repair_conflict_policy='ask-before-replacing-update';
         INSERT INTO packages(namespace,name,installation_revision) VALUES ('example','one',9);
         INSERT INTO components(package_id,local_id) VALUES (1,'component');
         INSERT INTO project_registrations VALUES (1,'Project','test',x'01','test',x'02',7);
         INSERT INTO package_version_history VALUES (1,'1.2.3+kept','writers-ide.file-set/1',zeroblob(32));
         INSERT INTO permission_approvals VALUES (1,'external.open','http-https','application',NULL,'automatic');
         INSERT INTO permission_denials VALUES (1,'project.files.read','project','project',1);
         INSERT INTO recovered_permission_approvals VALUES (1,'project.files.list','project','project',1,1,1);
         INSERT INTO component_enablement_defaults VALUES (1,0);
         INSERT INTO project_component_overrides VALUES (1,1,1);
         INSERT INTO component_scope_state VALUES (1,'project',3);
         UPDATE sqlite_sequence SET seq=1000000 WHERE name IN ('packages','components','project_registrations');"
    ).unwrap();
}

// Capture every unrelated table, including retained sqlite_sequence high-water marks.
fn unrelated(connection: &Connection) -> Vec<(String, Vec<Vec<Value>>)> {
    let mut statement = connection.prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT IN ('host_settings','registry_metadata') ORDER BY name"
    ).unwrap();
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
                .collect::<rusqlite::Result<Vec<_>>>()
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

fn settings(connection: &Connection) -> Vec<Value> {
    let mut statement = connection.prepare("SELECT * FROM host_settings").unwrap();
    let columns = statement.column_count();
    statement
        .query_row([], |row| (0..columns).map(|index| row.get(index)).collect())
        .unwrap()
}

#[test]
fn real_upgrade_preserves_all_unrelated_data_namespace_choices_and_backup() {
    let mut connection = v1();
    populate(&connection);
    let original_rows = unrelated(&connection);
    let original_namespace = namespace(&connection);
    let original_settings = settings(&connection);
    let dir = tempfile::tempdir().unwrap();
    let backup = dir.path().join("pre-upgrade.sqlite");
    upgrade_to_current(&mut connection, &backup, &limits()).unwrap();
    store::validate_snapshot(&connection, &limits()).unwrap();
    assert_eq!(schema::validate_supported(&connection).unwrap(), 2);
    assert_eq!(unrelated(&connection), original_rows);
    assert_eq!(namespace(&connection), original_namespace);
    assert_eq!(&settings(&connection)[..3], original_settings.as_slice());

    let mut fresh = Connection::open_in_memory().unwrap();
    schema::initialize(&mut fresh).unwrap();
    assert_eq!(&settings(&connection)[3..], &settings(&fresh)[3..]);
    // Exact-schema validation compares all table, index and trigger SQL with fresh v2.
    schema::validate(&connection).unwrap();
    let old = Connection::open(&backup).unwrap();
    assert_eq!(schema::validate_supported(&old).unwrap(), 1);
    assert_eq!(settings(&old), original_settings);
    assert_eq!(unrelated(&old), original_rows);
    assert_eq!(namespace(&old), original_namespace);
    drop(old);
    let backup_bytes = std::fs::read(&backup).unwrap();
    upgrade_to_current(&mut connection, &backup, &limits()).unwrap();
    assert_eq!(std::fs::read(&backup).unwrap(), backup_bytes);
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM sqlite_temp_schema", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn restore_copy_upgrades_without_touching_original_or_creating_extra_backup() {
    let source = v1();
    populate(&source);
    let dir = tempfile::tempdir().unwrap();
    let backup = dir.path().join("original.sqlite");
    recovery::backup_database_supported(&source, &backup).unwrap();
    let bytes = std::fs::read(&backup).unwrap();
    let working = dir.path().join("working.sqlite");
    std::fs::copy(&backup, &working).unwrap();
    let mut copy = Connection::open(&working).unwrap();
    copy.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    upgrade_restore_copy(&mut copy, &limits()).unwrap();
    store::validate_snapshot(&copy, &limits()).unwrap();
    assert_eq!(unrelated(&copy), unrelated(&source));
    assert_eq!(namespace(&copy), namespace(&source));
    assert_eq!(std::fs::read(&backup).unwrap(), bytes);
    assert_eq!(schema::validate_supported(&source).unwrap(), 1);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    upgrade_restore_copy(&mut copy, &limits()).unwrap();
}

#[test]
fn real_upgrade_rolls_back_rebuilt_table_and_version_on_target_failure() {
    let mut connection = v1();
    populate(&connection);
    let before = unrelated(&connection);
    let saved_settings = settings(&connection);
    let saved_namespace = namespace(&connection);
    let dir = tempfile::tempdir().unwrap();
    let backup = dir.path().join("backup.sqlite");
    let reject = |connection: &Connection, limits: &RegistryLimits| {
        store::validate_snapshot(connection, limits)?;
        Err(RegistryError::RecoveryRequired(
            "injected target failure".into(),
        ))
    };
    assert!(execute_supported(&mut connection, &SUPPORTED, &backup, &limits(), reject).is_err());
    assert!(connection.is_autocommit());
    assert_eq!(schema::validate_supported(&connection).unwrap(), 1);
    assert_eq!(unrelated(&connection), before);
    assert_eq!(settings(&connection), saved_settings);
    assert_eq!(namespace(&connection), saved_namespace);
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM sqlite_temp_schema", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        schema::validate_supported(&Connection::open(backup).unwrap()).unwrap(),
        1
    );
}

#[test]
fn backup_failure_prevents_real_upgrade_and_preserves_existing_destination() {
    let mut connection = v1();
    populate(&connection);
    let original = settings(&connection);
    let dir = tempfile::tempdir().unwrap();
    let backup = dir.path().join("occupied.sqlite");
    std::fs::write(&backup, b"do not overwrite").unwrap();
    assert!(upgrade_to_current(&mut connection, &backup, &limits()).is_err());
    assert_eq!(std::fs::read(&backup).unwrap(), b"do not overwrite");
    assert_eq!(schema::validate_supported(&connection).unwrap(), 1);
    assert_eq!(settings(&connection), original);
    assert!(upgrade_to_current(
        &mut connection,
        &dir.path().join("absent/backup.sqlite"),
        &limits()
    )
    .is_err());
    assert_eq!(schema::validate_supported(&connection).unwrap(), 1);
}

#[test]
fn unsupported_or_invalid_sources_and_over_budget_rows_never_create_backup() {
    for version in [0_i64, -1, 3, i64::MAX] {
        let mut connection = v1();
        connection
            .execute_batch("PRAGMA ignore_check_constraints=ON")
            .unwrap();
        connection
            .execute("UPDATE registry_metadata SET schema_version=?1", [version])
            .unwrap();
        connection
            .execute_batch("PRAGMA ignore_check_constraints=OFF")
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.sqlite");
        assert!(upgrade_to_current(&mut connection, &backup, &limits()).is_err());
        assert!(!backup.exists());
        assert!(upgrade_restore_copy(&mut connection, &limits()).is_err());
        assert_eq!(
            connection
                .query_row("SELECT schema_version FROM registry_metadata", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            version
        );
    }
    for alteration in [
        "DELETE FROM host_settings",
        "DROP TRIGGER packages_identity_immutable",
        "INSERT INTO components(package_id,local_id) VALUES (999,'orphan')",
        "INSERT INTO packages(name) VALUES ('one'),('two'),('three'),('four')",
    ] {
        let mut connection = v1();
        connection.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
        connection.execute_batch(alteration).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup.sqlite");
        let mut bounded = limits();
        bounded.max_rows = 3;
        assert!(
            upgrade_to_current(&mut connection, &backup, &bounded).is_err(),
            "{alteration}"
        );
        assert!(!backup.exists());
        assert!(upgrade_restore_copy(&mut connection, &bounded).is_err());
    }
}

#[test]
fn current_version_validates_without_backup_or_default_reset_and_refuses_nesting() {
    let mut connection = Connection::open_in_memory().unwrap();
    schema::initialize(&mut connection).unwrap();
    connection
        .execute_batch(
            "UPDATE host_settings SET command_max_payload_depth=7, command_resource_revision=11",
        )
        .unwrap();
    let original = settings(&connection);
    let dir = tempfile::tempdir().unwrap();
    let backup = dir.path().join("absent/backup.sqlite");
    upgrade_to_current(&mut connection, &backup, &limits()).unwrap();
    upgrade_restore_copy(&mut connection, &limits()).unwrap();
    assert_eq!(settings(&connection), original);
    assert!(!backup.exists());
    connection.execute_batch("BEGIN").unwrap();
    assert!(matches!(
        upgrade_to_current(&mut connection, &backup, &limits()),
        Err(RegistryError::InvalidInput(_))
    ));
    assert!(matches!(
        upgrade_restore_copy(&mut connection, &limits()),
        Err(RegistryError::InvalidInput(_))
    ));
    connection
        .execute_batch("ROLLBACK; DELETE FROM host_settings")
        .unwrap();
    assert!(upgrade_to_current(&mut connection, &backup, &limits()).is_err());
    assert!(upgrade_restore_copy(&mut connection, &limits()).is_err());
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM host_settings", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
