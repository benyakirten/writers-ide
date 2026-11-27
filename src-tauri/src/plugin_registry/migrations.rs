//! Recognized internal schema upgrades. The version-1 baseline was never shipped.
//! Plans are native static definitions, never caller-provided SQL or plugin data.
use super::{
    error::{RegistryError, Result},
    model::RegistryLimits,
    recovery, schema, store,
};
use rusqlite::Connection;
use std::path::Path;

struct Migration {
    from: i64,
    to: i64,
    sql: &'static str,
}

const SUPPORTED: [Migration; 1] = [Migration {
    from: 1,
    to: 2,
    sql: include_str!("migration_v1_to_v2.sql"),
}];

/// The caller supplies an explicit non-overwriting pre-upgrade backup destination.
/// A validated current database needs no backup or mutation.
pub(super) fn upgrade_to_current(
    connection: &mut Connection,
    backup: &Path,
    limits: &RegistryLimits,
) -> Result<()> {
    prepare_upgrade(connection, limits)?;
    if store::validate_supported_snapshot(connection, limits)? == schema::VERSION {
        return Ok(());
    }
    execute_supported(
        connection,
        &SUPPORTED,
        backup,
        limits,
        store::validate_snapshot,
    )
}

/// Only for a caller-owned restore working copy whose verified source is retained.
/// This never creates another backup or modifies the original restore source.
pub(super) fn upgrade_restore_copy(
    connection: &mut Connection,
    limits: &RegistryLimits,
) -> Result<()> {
    prepare_upgrade(connection, limits)?;
    let original = store::validate_supported_snapshot(connection, limits)?;
    if original == schema::VERSION {
        return Ok(());
    }
    validate_chain(original, &SUPPORTED, limits)?;
    apply_chain(
        connection,
        &SUPPORTED,
        original,
        limits,
        store::validate_snapshot,
    )
}

fn prepare_upgrade(connection: &Connection, limits: &RegistryLimits) -> Result<()> {
    limits.validate()?;
    if !connection.is_autocommit() {
        return Err(RegistryError::InvalidInput(
            "migration cannot nest a transaction".into(),
        ));
    }
    Ok(())
}

// The chain and target validator remain private, native definitions.
fn execute_supported(
    connection: &mut Connection,
    steps: &[Migration],
    backup: &Path,
    limits: &RegistryLimits,
    validate_target: fn(&Connection, &RegistryLimits) -> Result<()>,
) -> Result<()> {
    prepare_upgrade(connection, limits)?;
    let original = store::validate_supported_snapshot(connection, limits)?;
    validate_chain(original, steps, limits)?;
    // No schema mutation is attempted unless the SQLite-aware backup succeeds.
    recovery::backup_database_supported(connection, backup)?;
    apply_chain(connection, steps, original, limits, validate_target)
}

fn validate_chain(original: i64, steps: &[Migration], limits: &RegistryLimits) -> Result<()> {
    if steps.is_empty() || steps.len() > limits.max_review_items {
        return Err(RegistryError::InvalidInput(
            "migration requires a bounded supported chain".into(),
        ));
    }
    let mut expected = original;
    for step in steps {
        if step.from != expected
            || step.to
                != step
                    .from
                    .checked_add(1)
                    .ok_or_else(|| RegistryError::InvalidInput("schema version exhausted".into()))?
            || step.sql.len() > limits.max_snapshot_bytes
        {
            return Err(RegistryError::InvalidInput(
                "unsupported migration chain".into(),
            ));
        }
        expected = step.to;
    }
    Ok(())
}

fn apply_chain(
    connection: &mut Connection,
    steps: &[Migration],
    original: i64,
    limits: &RegistryLimits,
    validate_target: fn(&Connection, &RegistryLimits) -> Result<()>,
) -> Result<()> {
    connection.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let current = store::validate_supported_snapshot(connection, limits)?;
        if current != original {
            return Err(RegistryError::Conflict(
                "schema changed after backup".into(),
            ));
        }
        for step in steps {
            connection.execute_batch(step.sql)?;
            if connection.execute("UPDATE registry_metadata SET schema_version=?1 WHERE singleton=1 AND schema_version=?2", rusqlite::params![step.to, step.from])? != 1 {
                return Err(RegistryError::RecoveryRequired("migration version row changed unexpectedly".into()));
            }
        }
        validate_target(connection, limits)
    })();
    if let Err(error) = result {
        if !connection.is_autocommit() {
            connection.execute_batch("ROLLBACK").map_err(|rollback| {
                RegistryError::OutcomeUnknown(format!(
                    "migration rollback not established: {rollback}; cause: {error}"
                ))
            })?;
        }
        return Err(error);
    }
    connection.execute_batch("COMMIT").map_err(|error| {
        let _ = connection.execute_batch("ROLLBACK");
        RegistryError::OutcomeUnknown(format!("migration commit outcome unknown: {error}"))
    })?;
    Ok(())
}

#[cfg(test)]
#[path = "migrations_stage_a_tests.rs"]
mod stage_a_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_integrity::IntegrityLimits;
    use crate::plugin_registry::schema;
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
    fn database() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        schema::initialize(&mut c).unwrap();
        c
    }
    // Version 3 is a test fixture only, not a registered production migration.
    fn target(c: &Connection, _: &RegistryLimits) -> Result<()> {
        let version: i64 =
            c.query_row("SELECT schema_version FROM registry_metadata", [], |r| {
                r.get(0)
            })?;
        let value: i64 = c.query_row("SELECT value FROM migration_probe", [], |r| r.get(0))?;
        if version != 3 || value != 7 {
            return Err(RegistryError::RecoveryRequired(
                "test target invalid".into(),
            ));
        }
        Ok(())
    }
    fn first() -> Migration {
        Migration { from: 2, to: 3, sql: "CREATE TABLE migration_probe(value INTEGER); INSERT INTO migration_probe VALUES(7);" }
    }
    #[test]
    fn backs_up_before_upgrade_and_preserves_old_schema() {
        let mut c = database();
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup");
        execute_supported(&mut c, &[first()], &backup, &limits(), target).unwrap();
        target(&c, &limits()).unwrap();
        let old = Connection::open(backup).unwrap();
        schema::validate(&old).unwrap();
        assert_eq!(
            old.query_row("SELECT schema_version FROM registry_metadata", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn later_step_failure_rolls_back_all_schema_and_version_changes() {
        let mut c = database();
        let dir = tempfile::tempdir().unwrap();
        let bad = Migration {
            from: 3,
            to: 4,
            sql: "INSERT INTO table_that_does_not_exist VALUES(1);",
        };
        assert!(execute_supported(
            &mut c,
            &[first(), bad],
            &dir.path().join("backup"),
            &limits(),
            target
        )
        .is_err());
        schema::validate(&c).unwrap();
        assert!(c.prepare("SELECT * FROM migration_probe").is_err());
    }
    #[test]
    fn target_validation_failure_rolls_back_and_backup_failure_never_starts() {
        let mut c = database();
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup");
        let reject = |_: &Connection, _: &RegistryLimits| {
            Err(RegistryError::RecoveryRequired("test rejection".into()))
        };
        assert!(execute_supported(&mut c, &[first()], &backup, &limits(), reject).is_err());
        schema::validate(&c).unwrap();
        let original = std::fs::read(&backup).unwrap();
        assert!(execute_supported(&mut c, &[first()], &backup, &limits(), target).is_err());
        assert_eq!(std::fs::read(&backup).unwrap(), original);
        schema::validate(&c).unwrap();
    }
    #[test]
    fn unrecognized_chain_is_rejected_before_backup() {
        let mut c = database();
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup");
        let wrong = Migration {
            from: 3,
            to: 4,
            sql: "SELECT 1",
        };
        assert!(execute_supported(&mut c, &[wrong], &backup, &limits(), target).is_err());
        assert!(!backup.exists());
        schema::validate(&c).unwrap();
    }
}
