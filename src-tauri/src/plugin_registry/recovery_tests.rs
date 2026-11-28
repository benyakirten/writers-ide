use super::*;
use tempfile::tempdir;

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

// Test-only convenience. Production restore callers must supply host budgets.
fn prepare_restore(
    backup: &Path,
    current: Option<&Path>,
    destination: &Path,
    acknowledge_loss: bool,
) -> Result<()> {
    super::prepare_restore(backup, current, destination, acknowledge_loss, &limits())
}

fn database(path: &Path) -> Connection {
    let mut connection = Connection::open(path).unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0").unwrap();
    schema::initialize(&mut connection).unwrap();
    connection
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
    connection.execute("INSERT INTO package_version_history SELECT id,?2,'writers-ide.file-set/1',?3 FROM packages WHERE name=?1", params![name,version,vec![digest;32]]).unwrap();
}

#[test]
fn sqlite_backup_includes_uncheckpointed_wal_and_never_overwrites() {
    let directory = tempdir().unwrap();
    let source_path = directory.path().join("source.db");
    let backup_path = directory.path().join("backup.db");
    let source = database(&source_path);
    history(&source, "package", "1.0.0+build.1", 1);
    assert!(
        directory
            .path()
            .join("source.db-wal")
            .metadata()
            .unwrap()
            .len()
            > 0
    );
    backup_database(&source, &backup_path).unwrap();
    let backup = open_existing(&backup_path).unwrap();
    schema::validate(&backup).unwrap();
    assert_eq!(namespace(&source), namespace(&backup));
    assert_eq!(
        backup
            .query_row("SELECT version FROM package_version_history", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "1.0.0+build.1"
    );
    let bytes = std::fs::read(&backup_path).unwrap();
    assert!(backup_database(&source, &backup_path).is_err());
    assert_eq!(bytes, std::fs::read(&backup_path).unwrap());
    let empty = directory.path().join("empty.db");
    std::fs::write(&empty, []).unwrap();
    assert!(backup_database(&source, &empty).is_err());
    assert_eq!(std::fs::metadata(empty).unwrap().len(), 0);
}

#[test]
fn restores_history_by_canonical_identity_and_preserves_all_high_water_marks() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    history(&current, "base", "1.0.0+one", 1);
    backup_database(&current, &backup_path).unwrap();
    // Post-backup entities deliberately collide with the local IDs that an
    // incautious restore merge would allocate.
    history(&current, "new-package", "1.0.0+two", 2);
    current.execute_batch("INSERT INTO components(id,package_id,local_id) VALUES (90,1,'deleted'); DELETE FROM components; INSERT INTO project_registrations VALUES (120,'Gone','test',x'01','test',x'02',1); DELETE FROM project_registrations; UPDATE sqlite_sequence SET seq=200 WHERE name='packages'; UPDATE host_settings SET permission_mode='trust'").unwrap();
    prepare_restore(&backup_path, Some(&current_path), &target_path, false).unwrap();
    let target = open_existing(&target_path).unwrap();
    schema::validate(&target).unwrap();
    assert_eq!(namespace(&target), namespace(&current));
    assert_eq!(schema::allocation_bounds(&target).unwrap(), [201, 90, 120]);
    let id: i64 = target
        .query_row(
            "SELECT id FROM packages WHERE name='new-package'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(id, 201);
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM package_version_history", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        2
    );
    assert_eq!(
        open_existing(&backup_path)
            .unwrap()
            .query_row("SELECT count(*) FROM packages", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        current
            .query_row("SELECT permission_mode FROM host_settings", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "trust"
    );
}

#[test]
fn conflicts_roll_back_entire_preparation_and_cannot_be_bypassed_with_loss_ack() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    current
        .execute_batch("UPDATE host_settings SET permission_mode='trust'")
        .unwrap();
    backup_database(&current, &backup_path).unwrap();
    let backup = Connection::open(&backup_path).unwrap();
    history(&backup, "z-conflict", "1.0.0", 1);
    history(&current, "a-merged-first", "1.0.0", 3);
    history(&current, "z-conflict", "1.0.0", 2);
    let backup_bytes = std::fs::read(&backup_path).unwrap();
    assert!(matches!(
        prepare_restore(&backup_path, Some(&current_path), &target_path, true),
        Err(RegistryError::VersionConflict(_))
    ));
    let target = open_existing(&target_path).unwrap();
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM packages WHERE name='a-merged-first'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        target
            .query_row("SELECT permission_mode FROM host_settings", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "trust"
    );
    assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
    schema::validate(&current).unwrap();
    schema::validate(&backup).unwrap();
}

#[test]
fn loss_recovery_requires_ack_and_always_uses_fresh_namespace() {
    let directory = tempdir().unwrap();
    let backup_path = directory.path().join("backup.db");
    let broken_path = directory.path().join("broken.db");
    let backup = database(&backup_path);
    let missing_path = directory.path().join("missing.db");
    std::fs::write(&broken_path, b"unreadable original").unwrap();
    for (index, current) in [
        None,
        Some(broken_path.as_path()),
        Some(missing_path.as_path()),
    ]
    .into_iter()
    .enumerate()
    {
        let target_path = directory.path().join(format!("target-{index}.db"));
        assert!(prepare_restore(&backup_path, current, &target_path, false).is_err());
        assert!(!target_path.exists());
        prepare_restore(&backup_path, current, &target_path, true).unwrap();
        let target = open_existing(&target_path).unwrap();
        assert_ne!(namespace(&target), namespace(&backup));
        schema::validate(&target).unwrap();
    }
    assert_eq!(std::fs::read(broken_path).unwrap(), b"unreadable original");
}

#[test]
fn valid_different_namespace_is_rejected_even_with_loss_ack() {
    let directory = tempdir().unwrap();
    let backup_path = directory.path().join("backup.db");
    let current_path = directory.path().join("current.db");
    let _backup = database(&backup_path);
    let _current = database(&current_path);
    assert!(prepare_restore(
        &backup_path,
        Some(&current_path),
        &directory.path().join("target.db"),
        true
    )
    .is_err());
}

#[test]
fn quarantine_ors_source_facts_keeps_denials_and_does_not_merge_current_grants() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    current.execute_batch(
        "INSERT INTO packages(name) VALUES ('package');
         INSERT INTO components(package_id,local_id) VALUES (1,'component');
         INSERT INTO project_registrations VALUES (1,'Project','test',x'01','test',x'02',1);
         UPDATE host_settings SET permission_mode='trust';
         INSERT INTO permission_approvals VALUES (1,'external.open','http-https','application',NULL,'explicit');
         INSERT INTO recovered_permission_approvals VALUES (1,'external.open','http-https','application',NULL,0,1);
         INSERT INTO permission_approvals VALUES (1,'project.files.read','project','project',1,'automatic');
         INSERT INTO recovered_permission_approvals VALUES (1,'project.files.read','project','project',1,1,0);
         INSERT INTO permission_approvals VALUES (1,'project.files.list','project','project',1,'explicit');
         INSERT INTO permission_denials VALUES (1,'project.files.read','project','project',1);"
    ).unwrap();
    backup_database(&current, &backup_path).unwrap();
    current.execute_batch("INSERT INTO permission_approvals VALUES (1,'external.open','http-https','project',1,'explicit')").unwrap();
    prepare_restore(&backup_path, Some(&current_path), &target_path, false).unwrap();
    let target = open_existing(&target_path).unwrap();
    for (query, expected) in [
        ("SELECT count(*) FROM permission_approvals",0),
        ("SELECT count(*) FROM recovered_permission_approvals",3),
        ("SELECT count(*) FROM recovered_permission_approvals WHERE had_explicit_approval=1 AND had_automatic_approval=1",2),
        ("SELECT count(*) FROM permission_denials",1),
    ] {
        assert_eq!(target.query_row(query, [], |row| row.get::<_, i64>(0)).unwrap(), expected);
    }
    assert_eq!(
        target
            .query_row("SELECT permission_mode FROM host_settings", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "secure"
    );
    schema::validate(&target).unwrap();
}

#[test]
fn restore_never_overwrites_a_destination_or_downgrades_an_unsupported_current() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    backup_database(&current, &backup_path).unwrap();
    std::fs::write(&target_path, b"existing destination").unwrap();
    assert!(prepare_restore(&backup_path, Some(&current_path), &target_path, false).is_err());
    assert_eq!(
        std::fs::read(&target_path).unwrap(),
        b"existing destination"
    );
    current
        .execute_batch("UPDATE registry_metadata SET schema_version=3")
        .unwrap();
    let unused_path = directory.path().join("unused.db");
    assert!(matches!(
        prepare_restore(&backup_path, Some(&current_path), &unused_path, true),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert!(!unused_path.exists());
}

#[test]
fn unrelated_current_settings_failure_preserves_history_and_conflicts() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    history(&current, "package", "1.0.0", 1);
    backup_database(&current, &backup_path).unwrap();
    history(&current, "newer", "2.0.0", 2);
    current.execute_batch("DELETE FROM host_settings").unwrap();
    assert!(schema::validate(&current).is_err());
    prepare_restore(&backup_path, Some(&current_path), &target_path, false).unwrap();
    let target = open_existing(&target_path).unwrap();
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM package_version_history", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        2
    );
    assert_eq!(namespace(&target), namespace(&current));
    let backup = Connection::open(&backup_path).unwrap();
    history(&backup, "newer", "2.0.0", 3);
    assert!(matches!(
        prepare_restore(
            &backup_path,
            Some(&current_path),
            &directory.path().join("conflict.db"),
            true
        ),
        Err(RegistryError::VersionConflict(_))
    ));
}

#[test]
fn restore_bounds_fail_without_loss_fallback_and_merged_overflow_rolls_back() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let current = database(&current_path);
    backup_database(&current, &backup_path).unwrap();
    for index in 0..9 {
        history(&current, &format!("package-{index}"), "1.0.0", 1);
    }
    let mut small = limits();
    small.max_rows = 8; // Also accommodates the full validator's schema-object budget.
    let target = directory.path().join("limited.db");
    assert!(matches!(
        super::prepare_restore(&backup_path, Some(&current_path), &target, true, &small),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert!(!target.exists());
    current.execute_batch("DELETE FROM package_version_history WHERE package_id=9; DELETE FROM packages WHERE id=9").unwrap();
    let backup = Connection::open(&backup_path).unwrap();
    history(&backup, "different", "1.0.0", 1);
    assert!(matches!(
        super::prepare_restore(&backup_path, Some(&current_path), &target, false, &small),
        Err(RegistryError::LimitExceeded(_))
    ));
    let target = open_existing(&target).unwrap();
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM packages", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn missing_or_damaged_counters_require_loss_ack_but_preserve_history_pins() {
    for damage in [
        "DELETE FROM sqlite_sequence WHERE name='packages'",
        "UPDATE sqlite_sequence SET seq='damaged' WHERE name='packages'",
    ] {
        let directory = tempdir().unwrap();
        let current_path = directory.path().join("current.db");
        let backup_path = directory.path().join("backup.db");
        let target_path = directory.path().join("target.db");
        let current = database(&current_path);
        history(&current, "base", "1.0.0", 1);
        backup_database(&current, &backup_path).unwrap();
        history(&current, "newer", "2.0.0", 2);
        current.execute_batch(damage).unwrap();
        assert!(schema::allocation_bounds(&current).is_err());
        assert!(prepare_restore(&backup_path, Some(&current_path), &target_path, false).is_err());
        assert!(!target_path.exists());
        prepare_restore(&backup_path, Some(&current_path), &target_path, true).unwrap();
        let target = open_existing(&target_path).unwrap();
        assert_ne!(namespace(&target), namespace(&current));
        assert_eq!(
            target
                .query_row("SELECT count(*) FROM package_version_history", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            2
        );
        super::super::store::validate_snapshot(&target, &limits()).unwrap();
        // Missing allocation evidence must not hide a known accepted-content
        // conflict, even though recovery establishes a new namespace.
        let backup = Connection::open(&backup_path).unwrap();
        history(&backup, "newer", "2.0.0", 3);
        assert!(matches!(
            prepare_restore(
                &backup_path,
                Some(&current_path),
                &directory.path().join("conflict.db"),
                true
            ),
            Err(RegistryError::VersionConflict(_))
        ));
    }
}

#[test]
fn restore_rejects_corrupted_file_digests_before_claiming_destination() {
    use super::super::{
        preparation::{PreparedArtifact, PublicationReceipt},
        store::Store,
    };
    use crate::plugin_integrity::{create_record, verify_package};
    let directory = tempdir().unwrap();
    let package = directory.path().join("package");
    std::fs::create_dir(&package).unwrap();
    std::fs::write(
        package.join("manifest.toml"),
        r#"manifest_version = 1
[package]
name = "sample"
display_name = "Sample"
version = "1.0.0"
description = "Package description"
[[components]]
id = "main"
display_name = "Main"
description = "Component description"
kind = "frontend"
entry = "main.js"
runtime_profile = "writers-ide.frontend/1"
activation_scope = "project"
capabilities = []
"#,
    )
    .unwrap();
    std::fs::write(package.join("main.js"), b"export default {};").unwrap();
    let budgets = limits();
    let record = create_record(&package, &budgets.integrity).unwrap();
    let verified = verify_package(&package, &record, &budgets.integrity).unwrap();
    let prepared = PreparedArtifact::from_verified(
        &verified,
        Path::new("/test-only-artifact-store"),
        &budgets,
    )
    .unwrap();
    let receipt = PublicationReceipt::for_test(&prepared);
    let source_path = directory.path().join("source.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let mut source = Store::create(&source_path, budgets.clone()).unwrap();
    source.accept_artifact(prepared, receipt).unwrap();
    source.backup(&backup_path).unwrap();
    let backup = Connection::open(&backup_path).unwrap();
    super::super::store::validate_snapshot(&backup, &budgets).unwrap();
    backup
        .execute(
            "UPDATE artifact_files SET sha256=zeroblob(32) WHERE path='main.js'",
            [],
        )
        .unwrap();
    schema::validate(&backup).unwrap();
    assert!(prepare_restore(&backup_path, None, &target_path, true).is_err());
    assert!(!target_path.exists());
}

#[test]
fn backup_copy_fails_promptly_on_external_destination_contention() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("destination.db");
    let source = Connection::open_in_memory().unwrap();
    source
        .execute_batch("CREATE TABLE payload(value INTEGER); INSERT INTO payload VALUES (1)")
        .unwrap();
    let mut destination = Connection::open(&path).unwrap();
    destination
        .execute_batch("CREATE TABLE original(value INTEGER); INSERT INTO original VALUES (2)")
        .unwrap();
    let locker = Connection::open(&path).unwrap();
    locker
        .execute_batch("BEGIN EXCLUSIVE; UPDATE original SET value=3")
        .unwrap();
    let started = std::time::Instant::now();
    assert!(matches!(
        copy(&source, &mut destination),
        Err(RegistryError::Unavailable(_)) | Err(RegistryError::Storage(_))
    ));
    assert!(started.elapsed() < Duration::from_secs(2));
    locker.execute_batch("ROLLBACK").unwrap();
    assert_eq!(
        destination
            .query_row("SELECT value FROM original", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn backup_copy_fails_promptly_when_source_connection_is_write_locked() {
    let source = Connection::open_in_memory().unwrap();
    source
        .execute_batch(
            "CREATE TABLE payload(value INTEGER); BEGIN IMMEDIATE; INSERT INTO payload VALUES (1)",
        )
        .unwrap();
    let mut destination = Connection::open_in_memory().unwrap();
    let started = std::time::Instant::now();
    assert!(matches!(
        copy(&source, &mut destination),
        Err(RegistryError::Unavailable(_)) | Err(RegistryError::Storage(_))
    ));
    assert!(started.elapsed() < Duration::from_secs(2));
    source.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn missing_history_table_allows_only_acknowledged_fresh_namespace_recovery() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    history(&current, "base", "1.0.0", 1);
    backup_database(&current, &backup_path).unwrap();
    let original_namespace = namespace(&current);
    current
        .execute_batch("DROP TABLE package_version_history")
        .unwrap();
    assert!(prepare_restore(&backup_path, Some(&current_path), &target_path, false).is_err());
    assert!(!target_path.exists());
    prepare_restore(&backup_path, Some(&current_path), &target_path, true).unwrap();
    let target = open_existing(&target_path).unwrap();
    assert_ne!(namespace(&target), original_namespace);
    super::super::store::validate_snapshot(&target, &limits()).unwrap();
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM package_version_history", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
    assert_eq!(
        current
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='package_version_history'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn missing_namespace_metadata_preserves_safe_pins_and_still_rejects_conflicts() {
    for damage in [
        "DELETE FROM registry_metadata",
        "DROP TABLE registry_metadata",
        "PRAGMA ignore_check_constraints=ON; UPDATE registry_metadata SET identity_namespace=x'01'; PRAGMA ignore_check_constraints=OFF",
    ] {
        let directory = tempdir().unwrap();
        let current_path = directory.path().join("current.db");
        let backup_path = directory.path().join("backup.db");
        let target_path = directory.path().join("target.db");
        let current = database(&current_path);
        history(&current, "base", "1.0.0", 1);
        backup_database(&current, &backup_path).unwrap();
        let original_namespace = namespace(&current);
        history(&current, "retained", "2.0.0", 2);
        current.execute_batch(damage).unwrap();
        assert!(prepare_restore(&backup_path, Some(&current_path), &target_path, false).is_err());
        assert!(!target_path.exists());
        prepare_restore(&backup_path, Some(&current_path), &target_path, true).unwrap();
        let target = open_existing(&target_path).unwrap();
        assert_ne!(namespace(&target), original_namespace);
        assert_eq!(target.query_row("SELECT count(*) FROM package_version_history", [], |row| row.get::<_,i64>(0)).unwrap(), 2);
        super::super::store::validate_snapshot(&target, &limits()).unwrap();
        let backup = Connection::open(&backup_path).unwrap();
        history(&backup, "retained", "2.0.0", 3);
        assert!(matches!(prepare_restore(&backup_path, Some(&current_path), &directory.path().join("conflict.db"), true), Err(RegistryError::VersionConflict(_))));
    }
}

#[test]
fn malformed_history_rows_do_not_discard_safe_pins_or_allow_conflict_bypass() {
    for damage in [
        "INSERT INTO package_version_history VALUES (1,'not-semver','writers-ide.file-set/1',zeroblob(32))",
        "INSERT INTO package_version_history VALUES (1,'3.0.0','unsupported-scheme',zeroblob(32))",
        "PRAGMA foreign_keys=OFF; INSERT INTO package_version_history VALUES (999,'3.0.0','writers-ide.file-set/1',zeroblob(32)); PRAGMA foreign_keys=ON",
        "PRAGMA ignore_check_constraints=ON; INSERT INTO package_version_history VALUES (1,'3.0.0','writers-ide.file-set/1',x'01'); PRAGMA ignore_check_constraints=OFF",
        "INSERT INTO packages(name) VALUES ('INVALID')",
    ] {
        let directory = tempdir().unwrap();
        let current_path = directory.path().join("current.db");
        let backup_path = directory.path().join("backup.db");
        let target_path = directory.path().join("target.db");
        let current = database(&current_path);
        history(&current, "base", "1.0.0", 1);
        backup_database(&current, &backup_path).unwrap();
        let original_namespace = namespace(&current);
        history(&current, "retained", "2.0.0", 2);
        current.execute_batch(damage).unwrap();
        assert!(prepare_restore(&backup_path, Some(&current_path), &target_path, false).is_err());
        prepare_restore(&backup_path, Some(&current_path), &target_path, true).unwrap();
        let target = open_existing(&target_path).unwrap();
        assert_ne!(namespace(&target), original_namespace);
        assert_eq!(target.query_row("SELECT count(*) FROM package_version_history", [], |row| row.get::<_,i64>(0)).unwrap(), 2);
        super::super::store::validate_snapshot(&target, &limits()).unwrap();
        let backup = Connection::open(&backup_path).unwrap();
        history(&backup, "retained", "2.0.0", 3);
        assert!(matches!(prepare_restore(&backup_path, Some(&current_path), &directory.path().join("conflict.db"), true), Err(RegistryError::VersionConflict(_))), "{damage}");
    }
}

#[test]
fn incomplete_history_cannot_downgrade_known_namespace_or_unsupported_version() {
    for incompatible_namespace in [false, true] {
        let directory = tempdir().unwrap();
        let current_path = directory.path().join("current.db");
        let backup_path = directory.path().join("backup.db");
        let target_path = directory.path().join("target.db");
        let current = database(&current_path);
        backup_database(&current, &backup_path).unwrap();
        current
            .execute_batch("DROP TABLE package_version_history")
            .unwrap();
        if incompatible_namespace {
            current
                .execute(
                    "UPDATE registry_metadata SET identity_namespace=?1",
                    [schema::fresh_namespace().unwrap().as_slice()],
                )
                .unwrap();
        } else {
            current.execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE registry_metadata SET schema_version=3,identity_namespace=x'01'; PRAGMA ignore_check_constraints=OFF").unwrap();
        }
        assert!(matches!(
            prepare_restore(&backup_path, Some(&current_path), &target_path, true),
            Err(RegistryError::RecoveryRequired(_))
        ));
        assert!(!target_path.exists());
    }
}

#[test]
fn missing_history_row_with_surviving_artifact_requires_ack_without_inventing_a_pin() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    backup_database(&current, &backup_path).unwrap();
    let original_namespace = namespace(&current);
    history(&current, "base", "1.0.0", 1);
    history(&current, "base", "2.0.0", 2);
    current.execute_batch("INSERT INTO accepted_artifacts VALUES (zeroblob(16),1,'2.0.0',1,'writers-ide.artifact-store/1','Base','Description'); PRAGMA foreign_keys=OFF; DELETE FROM package_version_history WHERE version='2.0.0'; PRAGMA foreign_keys=ON").unwrap();
    assert!(prepare_restore(&backup_path, Some(&current_path), &target_path, false).is_err());
    assert!(!target_path.exists());
    prepare_restore(&backup_path, Some(&current_path), &target_path, true).unwrap();
    let target = open_existing(&target_path).unwrap();
    assert_ne!(namespace(&target), original_namespace);
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM package_version_history", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM accepted_artifacts", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    super::super::store::validate_snapshot(&target, &limits()).unwrap();
    let backup = Connection::open(&backup_path).unwrap();
    history(&backup, "base", "1.0.0", 3);
    assert!(matches!(
        prepare_restore(
            &backup_path,
            Some(&current_path),
            &directory.path().join("conflict.db"),
            true
        ),
        Err(RegistryError::VersionConflict(_))
    ));
}

#[test]
fn granular_evidence_does_not_bypass_explicit_limits() {
    let directory = tempdir().unwrap();
    let current_path = directory.path().join("current.db");
    let backup_path = directory.path().join("backup.db");
    let target_path = directory.path().join("target.db");
    let current = database(&current_path);
    backup_database(&current, &backup_path).unwrap();
    current
        .execute_batch("DELETE FROM registry_metadata")
        .unwrap();
    for index in 0..9 {
        history(&current, &format!("package-{index}"), "1.0.0", 1);
    }
    let mut budgets = limits();
    budgets.max_rows = 8;
    assert!(matches!(
        super::prepare_restore(
            &backup_path,
            Some(&current_path),
            &target_path,
            true,
            &budgets
        ),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert!(!target_path.exists());
    budgets.max_rows = 100;
    current
        .execute(
            "INSERT INTO packages(name) VALUES (?1)",
            ["a".repeat(budgets.max_text_bytes + 1)],
        )
        .unwrap();
    assert!(matches!(
        super::prepare_restore(
            &backup_path,
            Some(&current_path),
            &target_path,
            true,
            &budgets
        ),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert!(!target_path.exists());
}

#[test]
fn invalid_backup_and_unsupported_versions_do_not_create_destination() {
    let directory = tempdir().unwrap();
    let backup_path = directory.path().join("backup.db");
    let backup = database(&backup_path);
    backup
        .execute_batch("UPDATE registry_metadata SET schema_version=3")
        .unwrap();
    let target = directory.path().join("target.db");
    assert!(matches!(
        prepare_restore(&backup_path, None, &target, true),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert!(!target.exists());
}

#[test]
fn backups_preserve_supported_versions_and_read_only_sources_without_schema_writes() {
    for legacy in [false, true] {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.sqlite");
        let mut source = Connection::open(&source_path).unwrap();
        if legacy {
            schema::initialize_v1(&mut source).unwrap();
        } else {
            schema::initialize(&mut source).unwrap();
        }
        source.close().unwrap();
        let original = std::fs::read(&source_path).unwrap();
        let source = open_existing(&source_path).unwrap();
        assert!(source.is_readonly("main").unwrap());
        let schema_version: i64 = source
            .query_row("PRAGMA schema_version", [], |r| r.get(0))
            .unwrap();
        let destination = directory.path().join("backup.sqlite");
        if legacy {
            let refused = directory.path().join("current-only.sqlite");
            assert!(matches!(
                backup_database(&source, &refused),
                Err(RegistryError::RecoveryRequired(_))
            ));
            assert!(!refused.exists());
        }
        backup_database_supported(&source, &destination).unwrap();
        let target = open_existing(&destination).unwrap();
        assert_eq!(
            schema::validate_supported(&target).unwrap(),
            if legacy { 1 } else { schema::VERSION }
        );
        assert_eq!(
            source
                .query_row("PRAGMA schema_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            schema_version
        );
        assert_eq!(std::fs::read(&source_path).unwrap(), original);
        if !legacy {
            backup_database(&source, &directory.path().join("current.sqlite")).unwrap();
        }
    }
}
