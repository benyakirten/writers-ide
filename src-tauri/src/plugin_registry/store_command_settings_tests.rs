use super::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let limits = RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits::default(),
        max_rows: 512,
        max_snapshot_bytes: 1_048_576,
        max_text_bytes: 4096,
        max_location_bytes: 1024,
        max_review_items: 32,
    };
    let store = Store::create(&dir.path().join("registry.sqlite"), limits).unwrap();
    (dir, store)
}

fn fields(settings: &mut CommandResourceSettings) -> [&mut u64; 8] {
    [
        &mut settings.max_caller_pending,
        &mut settings.max_provider_pending,
        &mut settings.max_window_pending,
        &mut settings.max_payload_bytes,
        &mut settings.max_payload_depth,
        &mut settings.max_payload_entries,
        &mut settings.max_component_bytes,
        &mut settings.max_window_bytes,
    ]
}

const COLUMNS: [&str; 9] = [
    "command_max_caller_pending",
    "command_max_provider_pending",
    "command_max_window_pending",
    "command_max_payload_bytes",
    "command_max_payload_depth",
    "command_max_payload_entries",
    "command_max_component_bytes",
    "command_max_window_bytes",
    "command_resource_revision",
];

#[test]
fn command_resource_revision_uses_only_canonical_decimal_strings() {
    for value in [0, 1, 9_007_199_254_740_992, i64::MAX] {
        let revision = CommandResourceRevision::new(value).unwrap();
        let encoded = serde_json::to_string(&revision).unwrap();
        assert_eq!(encoded, format!("\"{value}\""));
        assert_eq!(
            serde_json::from_str::<CommandResourceRevision>(&encoded).unwrap(),
            revision
        );
    }
    for invalid in [
        "0",
        "1",
        "null",
        "true",
        "\"\"",
        "\"00\"",
        "\"01\"",
        "\"+1\"",
        "\"-1\"",
        "\" 1\"",
        "\"1 \"",
        "\"1.0\"",
        "\"1e2\"",
        "\"9223372036854775808\"",
    ] {
        assert!(
            serde_json::from_str::<CommandResourceRevision>(invalid).is_err(),
            "{invalid}"
        );
    }
    assert!(CommandResourceRevision::new(-1).is_err());
    assert_eq!(CommandResourceRevision::default().value(), 0);
    assert!(matches!(
        CommandResourceRevision::new(i64::MAX).unwrap().next(),
        Err(RegistryError::LimitExceeded(_))
    ));
}

#[test]
fn command_resource_defaults_and_all_numeric_boundaries_are_atomic() {
    let (_dir, mut store) = store();
    let original = store.read_command_resource_settings().unwrap();
    assert_eq!(original.settings, CommandResourceSettings::default());
    assert_eq!(original.revision.value(), 0);
    for index in 0..8 {
        for invalid in [0, CommandResourceSettings::MAX_SAFE_INTEGER + 1, u64::MAX] {
            let mut settings = original.settings;
            // A valid change in another field must not leak through a rejected write.
            settings.max_window_bytes = 1;
            *fields(&mut settings)[index] = invalid;
            assert!(matches!(
                store.set_command_resource_settings(original.revision, settings),
                Err(RegistryError::InvalidInput(_))
            ));
            assert_eq!(store.read_command_resource_settings().unwrap(), original);
        }
    }
    let mut current = original;
    for index in 0..8 {
        for valid in [1, CommandResourceSettings::MAX_SAFE_INTEGER] {
            let mut settings = current.settings;
            *fields(&mut settings)[index] = valid;
            current = store
                .set_command_resource_settings(current.revision, settings)
                .unwrap();
            assert_eq!(current.settings, settings);
            assert_eq!(store.read_command_resource_settings().unwrap(), current);
        }
    }
}

#[test]
fn command_resource_noop_stale_aba_and_exhaustion() {
    let (_dir, mut store) = store();
    let original = store.read_command_resource_settings().unwrap();
    assert_eq!(
        store
            .set_command_resource_settings(original.revision, original.settings)
            .unwrap(),
        original
    );
    let changed = CommandResourceSettings {
        max_caller_pending: 1,
        ..original.settings
    };
    let next = store
        .set_command_resource_settings(original.revision, changed)
        .unwrap();
    assert_eq!(next.revision.value(), 1);
    assert!(matches!(
        store.set_command_resource_settings(original.revision, changed),
        Err(RegistryError::Conflict(_))
    ));
    let back = store
        .set_command_resource_settings(next.revision, original.settings)
        .unwrap();
    assert_eq!(back.revision.value(), 2);
    assert!(matches!(
        store.set_command_resource_settings(original.revision, original.settings),
        Err(RegistryError::Conflict(_))
    ));
    assert_eq!(store.read_command_resource_settings().unwrap(), back);
    store
        .connection
        .execute(
            "UPDATE host_settings SET command_resource_revision=?1",
            [i64::MAX],
        )
        .unwrap();
    let exhausted = store.read_command_resource_settings().unwrap();
    assert_eq!(
        store
            .set_command_resource_settings(exhausted.revision, exhausted.settings)
            .unwrap(),
        exhausted
    );
    assert!(matches!(
        store.set_command_resource_settings(exhausted.revision, changed),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert_eq!(store.read_command_resource_settings().unwrap(), exhausted);
}

fn assert_invalid_command_settings(store: &mut Store, read_first: bool) {
    let result = if read_first {
        store.read_command_resource_settings()
    } else {
        store.set_command_resource_settings(
            CommandResourceRevision::default(),
            CommandResourceSettings::default(),
        )
    };
    assert!(matches!(result, Err(RegistryError::RecoveryRequired(_))));
    assert_eq!(store.recovery(), Some(StoreRecovery::DomainInvalid));
    assert!(matches!(
        store.read_command_resource_settings(),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        store.set_command_resource_settings(
            CommandResourceRevision::default(),
            CommandResourceSettings::default(),
        ),
        Err(RegistryError::Unavailable(_))
    ));
}

#[test]
fn command_resource_rejects_invalid_stored_values_and_missing_row() {
    for column in COLUMNS {
        let invalid_values: &[i64] = if column == "command_resource_revision" {
            &[-1]
        } else {
            &[-1, 0, 9_007_199_254_740_992, i64::MAX]
        };
        for value in invalid_values {
            for read_first in [true, false] {
                let (_dir, mut store) = store();
                store
                    .connection
                    .execute_batch("PRAGMA ignore_check_constraints=ON")
                    .unwrap();
                store
                    .connection
                    .execute(&format!("UPDATE host_settings SET {column}=?1"), [value])
                    .unwrap();
                // Exercise both decoders as the first failing operation on a fresh store.
                assert_invalid_command_settings(&mut store, read_first);
                let retained: i64 = store
                    .connection
                    .query_row(&format!("SELECT {column} FROM host_settings"), [], |r| {
                        r.get(0)
                    })
                    .unwrap();
                assert_eq!(retained, *value);
            }
        }
    }
    for read_first in [true, false] {
        let (_dir, mut store) = store();
        store
            .connection
            .execute("DELETE FROM host_settings", [])
            .unwrap();
        assert_invalid_command_settings(&mut store, read_first);
    }
}

#[test]
fn command_resource_rejects_noninteger_storage_without_coercion() {
    use rusqlite::types::Value;

    let invalid_values = [
        Value::Null,
        Value::Real(1.5),
        Value::Text("x".repeat(1_048_576)),
        Value::Blob(vec![0; 1_048_576]),
    ];
    for column in COLUMNS {
        for value in &invalid_values {
            for read_first in [true, false] {
                let (_dir, mut store) = store();
                // Shadow the strict production table to model malformed storage types.
                store
                    .connection
                    .execute_batch(
                        "CREATE TEMP TABLE host_settings AS SELECT * FROM main.host_settings;",
                    )
                    .unwrap();
                store
                    .connection
                    .execute(&format!("UPDATE host_settings SET {column}=?1"), [value])
                    .unwrap();
                assert_invalid_command_settings(&mut store, read_first);
            }
        }
    }
}

#[test]
fn command_resource_commit_failure_is_unknown_and_poisoned() {
    let (_dir, mut store) = store();
    let original = store.read_command_resource_settings().unwrap();
    // The update succeeds, but a deferred constraint fails at COMMIT.
    store
        .connection
        .execute_batch(
            "CREATE TEMP TABLE resource_parent (id INTEGER PRIMARY KEY);
         CREATE TEMP TABLE resource_child (parent INTEGER REFERENCES resource_parent(id)
             DEFERRABLE INITIALLY DEFERRED);
         CREATE TEMP TRIGGER resource_commit_failure AFTER UPDATE OF command_resource_revision
             ON host_settings BEGIN INSERT INTO resource_child VALUES (1); END;",
        )
        .unwrap();
    let changed = CommandResourceSettings {
        max_caller_pending: 1,
        ..original.settings
    };
    assert!(matches!(
        store.set_command_resource_settings(original.revision, changed),
        Err(RegistryError::OutcomeUnknown(_))
    ));
    assert!(matches!(
        store.read_command_resource_settings(),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        store.set_command_resource_settings(original.revision, changed),
        Err(RegistryError::Unavailable(_))
    ));
    let invalid = CommandResourceSettings {
        max_caller_pending: 0,
        ..changed
    };
    assert!(matches!(
        store.set_command_resource_settings(original.revision, invalid),
        Err(RegistryError::Unavailable(_))
    ));
}

#[test]
fn command_resource_write_uses_mutate_rollback_and_poisoning() {
    let (_dir, mut store) = store();
    let original = store.read_command_resource_settings().unwrap();
    store.connection.execute_batch("CREATE TEMP TRIGGER reject_resource_update AFTER UPDATE OF command_resource_revision ON host_settings BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    let changed = CommandResourceSettings {
        max_caller_pending: 1,
        ..original.settings
    };
    assert!(matches!(
        store.set_command_resource_settings(original.revision, changed),
        Err(RegistryError::Storage(_))
    ));
    assert_eq!(store.read_command_resource_settings().unwrap(), original);
    store.fail_rollback = true;
    assert!(matches!(
        store.set_command_resource_settings(original.revision, changed),
        Err(RegistryError::OutcomeUnknown(_))
    ));
    assert!(matches!(
        store.read_command_resource_settings(),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        store.set_command_resource_settings(original.revision, changed),
        Err(RegistryError::Unavailable(_))
    ));
}
