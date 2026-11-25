use super::*;

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    initialize(&mut connection).unwrap();
    connection
}

#[test]
fn creates_exact_schema_and_required_rows_atomically() {
    let mut connection = database();
    validate(&connection).unwrap();
    let tables: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name<>'sqlite_sequence'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 20);
    let namespace: Vec<u8> = connection
        .query_row(
            "SELECT identity_namespace FROM registry_metadata",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(namespace.len(), 16);
    assert!(initialize(&mut connection).is_err());
    validate(&connection).unwrap();
    connection
        .execute_batch("DELETE FROM host_settings")
        .unwrap();
    assert!(validate(&connection).is_err());
    assert!(initialize(&mut connection).is_err());
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM host_settings", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn rejects_unknown_schema_version_changed_schema_catalog_and_sequences() {
    for alteration in [
        "UPDATE registry_metadata SET schema_version=2",
        "DROP TRIGGER artifact_components_owner_update",
        "DELETE FROM native_permissions WHERE operation='external.open'",
        "INSERT INTO native_permissions VALUES ('unknown','unknown')",
        "INSERT INTO sqlite_sequence VALUES ('packages',-1)",
        "INSERT INTO sqlite_sequence VALUES ('components',0); INSERT INTO sqlite_sequence VALUES ('components',0)",
    ] {
        let connection = database();
        connection.execute_batch(alteration).unwrap();
        assert!(matches!(validate(&connection), Err(RegistryError::RecoveryRequired(_))), "{alteration}");
    }
}

#[test]
fn constraints_protect_shapes_ownership_and_immutable_parents() {
    let connection = database();
    connection.execute_batch(
        "INSERT INTO packages(name) VALUES ('one'),('two');
         INSERT INTO components(package_id,local_id) VALUES (1,'component'),(2,'component');
         INSERT INTO package_version_history VALUES (1,'1.0.0','writers-ide.file-set/1',zeroblob(32));
         INSERT INTO accepted_artifacts VALUES (zeroblob(16),1,'1.0.0',1,'writers-ide.artifact-store/1','One','Description');"
    ).unwrap();
    for invalid in [
        "UPDATE packages SET name='renamed' WHERE id=1",
        "UPDATE components SET package_id=1 WHERE id=2",
        "UPDATE accepted_artifacts SET package_id=2",
        "UPDATE package_version_history SET fingerprint=randomblob(32)",
        "INSERT INTO artifact_components VALUES (zeroblob(16),2,'C','D','frontend','project',1)",
        "INSERT INTO package_installation_state(package_id) VALUES (1)",
        "INSERT INTO permission_approvals VALUES (1,'external.open','http-https','project',NULL,'explicit')",
        "INSERT INTO recovered_permission_approvals VALUES (1,'external.open','http-https','application',NULL,0,0)",
        "INSERT INTO component_scope_acknowledgements VALUES (1,1,'1.0.0','scope-change',NULL,1,'application')",
        "DELETE FROM package_version_history",
    ] {
        assert!(connection.execute_batch(invalid).is_err(), "{invalid}");
    }
    connection.execute_batch("INSERT INTO permission_approvals VALUES (1,'external.open','http-https','application',NULL,'explicit')").unwrap();
    assert!(connection.execute_batch("INSERT INTO permission_approvals VALUES (1,'external.open','http-https','application',NULL,'automatic')").is_err());
    validate(&connection).unwrap();
}

#[test]
fn startup_detects_foreign_keys_and_cross_row_rules_even_after_external_edits() {
    let connection = database();
    connection.execute_batch("PRAGMA foreign_keys=OFF; INSERT INTO components(package_id,local_id) VALUES (999,'missing')").unwrap();
    assert!(validate(&connection).is_err());
    let connection = database();
    connection.execute_batch(
        "INSERT INTO packages(name) VALUES ('one');
         INSERT INTO components(package_id,local_id) VALUES (1,'component');
         INSERT INTO package_version_history VALUES (1,'1.0.0','writers-ide.file-set/1',zeroblob(32));
         INSERT INTO accepted_artifacts VALUES (zeroblob(16),1,'1.0.0',1,'writers-ide.artifact-store/1','One','Description');
         INSERT INTO artifact_components VALUES (zeroblob(16),1,'C','D','frontend','application',0);
         INSERT INTO artifact_package_permissions VALUES (zeroblob(16),'project.files.read','project');"
    ).unwrap();
    assert!(validate(&connection).is_err());
}

#[test]
fn fixed_schema_catalog_and_value_checks_reject_large_persisted_strings() {
    let connection = database();
    connection
        .execute(
            "UPDATE native_permissions SET operation=?1 WHERE operation='external.open'",
            ["x".repeat(100_000)],
        )
        .unwrap();
    assert!(validate(&connection).is_err());
    let connection = database();
    connection
        .execute(
            "INSERT INTO packages(name) VALUES (?1)",
            ["a".repeat(100_000)],
        )
        .unwrap();
    assert!(validate(&connection).is_err());
    let connection = database();
    connection
        .execute_batch("CREATE INDEX unapproved_extra_object ON packages(name)")
        .unwrap();
    assert!(validate(&connection).is_err());
    let connection = database();
    connection
        .execute_batch("DROP TRIGGER packages_identity_immutable")
        .unwrap();
    connection.execute_batch(&format!("CREATE TRIGGER packages_identity_immutable BEFORE UPDATE ON packages BEGIN SELECT '{}'; END", "x".repeat(100_000))).unwrap();
    assert!(validate(&connection).is_err());
}

#[test]
fn explicit_host_limits_bound_rows_values_and_total_payload() {
    let connection = database();
    let mut limits = RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits::default(),
        max_rows: 3,
        max_snapshot_bytes: 100_000,
        max_text_bytes: 1000,
        max_location_bytes: 1000,
        max_review_items: 3,
    };
    validate_with_limits(&connection, &limits).unwrap();
    connection
        .execute_batch("INSERT INTO packages(name) VALUES ('one'),('two'),('three'),('four')")
        .unwrap();
    assert!(matches!(
        validate_with_limits(&connection, &limits),
        Err(RegistryError::LimitExceeded(_))
    ));
    limits.max_rows = 10;
    connection
        .execute(
            "UPDATE host_settings SET repair_conflict_policy='keep-update'",
            [],
        )
        .unwrap();
    limits.max_text_bytes = 3;
    assert!(matches!(
        validate_with_limits(&connection, &limits),
        Err(RegistryError::LimitExceeded(_))
    ));
    limits.max_text_bytes = 1000;
    limits.max_snapshot_bytes = 1;
    assert!(matches!(
        validate_with_limits(&connection, &limits),
        Err(RegistryError::LimitExceeded(_))
    ));
}

#[test]
fn failed_initialization_leaves_no_partial_schema() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA max_page_count=2").unwrap();
    assert!(initialize(&mut connection).is_err());
    let count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
