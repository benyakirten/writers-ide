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
        "UPDATE registry_metadata SET schema_version=3",
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

const RESOURCE_COLUMNS: [(&str, i64); 8] = [
    ("command_max_caller_pending", 32),
    ("command_max_provider_pending", 64),
    ("command_max_window_pending", 256),
    ("command_max_payload_bytes", 8388608),
    ("command_max_payload_depth", 64),
    ("command_max_payload_entries", 100000),
    ("command_max_component_bytes", 33554432),
    ("command_max_window_bytes", 134217728),
];

#[test]
fn resource_defaults_and_independent_safe_integer_constraints() {
    let connection = database();
    for (column, default) in RESOURCE_COLUMNS {
        let query = format!("SELECT {column} FROM host_settings");
        assert_eq!(
            connection
                .query_row(&query, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            default
        );
        for invalid in [
            "0",
            "-1",
            "9007199254740992",
            "NULL",
            "1.5",
            "'invalid'",
            "x'01'",
        ] {
            assert!(
                connection
                    .execute_batch(&format!("UPDATE host_settings SET {column}={invalid}"))
                    .is_err(),
                "{column}={invalid}"
            );
        }
        for valid in [1_i64, 9007199254740991] {
            connection
                .execute(&format!("UPDATE host_settings SET {column}=?1"), [valid])
                .unwrap();
            validate(&connection).unwrap();
        }
    }
    assert_eq!(
        connection
            .query_row(
                "SELECT command_resource_revision FROM host_settings",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert!(connection
        .execute_batch("UPDATE host_settings SET command_resource_revision=-1")
        .is_err());
    assert!(connection
        .execute_batch("UPDATE host_settings SET command_resource_revision=NULL")
        .is_err());
    connection
        .execute(
            "UPDATE host_settings SET command_resource_revision=?1",
            [i64::MAX],
        )
        .unwrap();
    validate(&connection).unwrap();
}

#[test]
fn supported_validation_keeps_exact_version_specific_definitions() {
    let mut old = Connection::open_in_memory().unwrap();
    initialize_v1(&mut old).unwrap();
    assert_eq!(validate_supported(&old).unwrap(), 1);
    assert!(validate(&old).is_err());
    old.execute_batch("UPDATE registry_metadata SET schema_version=2")
        .unwrap();
    assert!(validate_supported(&old).is_err());
    let connection = database();
    assert_eq!(validate_supported(&connection).unwrap(), 2);
    connection
        .execute_batch("UPDATE registry_metadata SET schema_version=1")
        .unwrap();
    assert!(validate_supported(&connection).is_err());
    for version in [3_i64, i64::MAX] {
        connection
            .execute("UPDATE registry_metadata SET schema_version=?1", [version])
            .unwrap();
        assert!(matches!(
            validate_supported(&connection),
            Err(RegistryError::RecoveryRequired(_))
        ));
    }
}

#[test]
fn supported_validation_bounds_v1_and_v2_and_never_repairs_settings() {
    let limits = RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits::default(),
        max_rows: 3,
        max_snapshot_bytes: 100_000,
        max_text_bytes: 1000,
        max_location_bytes: 1000,
        max_review_items: 3,
    };
    for version in [1, VERSION] {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_version(&mut connection, version).unwrap();
        assert_eq!(
            validate_supported_with_limits(&connection, &limits).unwrap(),
            version
        );
        assert!(
            inspect_restore_evidence(&connection, &limits)
                .unwrap()
                .complete
        );
        connection
            .execute_batch("INSERT INTO packages(name) VALUES ('one'),('two'),('three'),('four')")
            .unwrap();
        assert!(matches!(
            validate_supported_with_limits(&connection, &limits),
            Err(RegistryError::LimitExceeded(_))
        ));
        connection
            .execute_batch("DELETE FROM packages; DELETE FROM host_settings")
            .unwrap();
        assert!(validate_supported_with_limits(&connection, &limits).is_err());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM host_settings", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn readonly_reopen_rejects_damaged_resource_domains_explicitly() {
    let mut cases = Vec::new();
    for (column, _) in RESOURCE_COLUMNS {
        cases.push((column, 0_i64));
        cases.push((column, 9007199254740992));
    }
    cases.push(("command_resource_revision", -1));
    for (column, invalid) in cases {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("damaged.sqlite");
        let mut damaged = Connection::open(&path).unwrap();
        initialize(&mut damaged).unwrap();
        damaged
            .execute_batch("PRAGMA ignore_check_constraints=ON")
            .unwrap();
        damaged
            .execute(&format!("UPDATE host_settings SET {column}=?1"), [invalid])
            .unwrap();
        damaged.close().unwrap();

        let probe =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(
            probe
                .query_row("PRAGMA ignore_check_constraints", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(
            matches!(validate(&probe), Err(RegistryError::RecoveryRequired(_))),
            "{column}={invalid}"
        );
        assert!(
            matches!(
                validate_supported(&probe),
                Err(RegistryError::RecoveryRequired(_))
            ),
            "{column}={invalid}"
        );

        // Disable SQLite's CHECK verification on the probe too. Rejection must
        // still come from our scalar domain check, not integrity_check.
        probe
            .execute_batch("PRAGMA ignore_check_constraints=ON")
            .unwrap();
        for result in [validate(&probe), validate_supported(&probe).map(|_| ())] {
            assert!(
                matches!(result, Err(RegistryError::RecoveryRequired(message)) if message == "invalid stored command resource settings"),
                "{column}={invalid}"
            );
        }
        assert_eq!(
            probe
                .query_row(&format!("SELECT {column} FROM host_settings"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            invalid
        );
    }
}

#[test]
fn validation_rejects_resource_corruption_without_resetting_it() {
    let connection = database();
    connection.execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET command_max_payload_depth=0; PRAGMA ignore_check_constraints=OFF").unwrap();
    assert!(validate(&connection).is_err());
    assert!(validate_supported(&connection).is_err());
    assert_eq!(
        connection
            .query_row(
                "SELECT command_max_payload_depth FROM host_settings",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}
