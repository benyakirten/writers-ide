//! Trusted migration execution infrastructure. Version 1 has no shipped predecessors.
//! Plans are native static definitions, never caller-provided SQL or plugin data.
use super::{
    error::{RegistryError, Result},
    model::RegistryLimits,
    recovery, store,
};
use rusqlite::Connection;
use std::path::Path;

pub(super) struct Migration {
    pub from: i64,
    pub to: i64,
    pub sql: &'static str,
}

/// The future version-specific opener supplies a reviewed chain and its target
/// validator. Normal version-1 opening never guesses or applies an unknown plan.
pub(super) fn execute_supported(
    connection: &mut Connection,
    steps: &[Migration],
    backup: &Path,
    limits: &RegistryLimits,
    validate_target: fn(&Connection) -> Result<()>,
) -> Result<()> {
    limits.validate()?;
    if !connection.is_autocommit() {
        return Err(RegistryError::InvalidInput(
            "migration cannot nest a transaction".into(),
        ));
    }
    store::validate_snapshot(connection, limits)?;
    let original: i64 = connection.query_row(
        "SELECT schema_version FROM registry_metadata WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
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
    // No schema mutation is attempted unless the SQLite-aware backup succeeds.
    recovery::backup_database(connection, backup)?;
    connection.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        let current: i64 = connection.query_row(
            "SELECT schema_version FROM registry_metadata WHERE singleton=1",
            [],
            |r| r.get(0),
        )?;
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
        validate_target(connection)
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
    // Version 2 is a test fixture only, not a registered production migration.
    fn target(c: &Connection) -> Result<()> {
        let version: i64 =
            c.query_row("SELECT schema_version FROM registry_metadata", [], |r| {
                r.get(0)
            })?;
        let value: i64 = c.query_row("SELECT value FROM migration_probe", [], |r| r.get(0))?;
        if version != 2 || value != 7 {
            return Err(RegistryError::RecoveryRequired(
                "test target invalid".into(),
            ));
        }
        Ok(())
    }
    fn first() -> Migration {
        Migration { from: 1, to: 2, sql: "CREATE TABLE migration_probe(value INTEGER); INSERT INTO migration_probe VALUES(7);" }
    }
    #[test]
    fn backs_up_before_upgrade_and_preserves_old_schema() {
        let mut c = database();
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup");
        execute_supported(&mut c, &[first()], &backup, &limits(), target).unwrap();
        target(&c).unwrap();
        let old = Connection::open(backup).unwrap();
        schema::validate(&old).unwrap();
        assert_eq!(
            old.query_row("SELECT schema_version FROM registry_metadata", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn later_step_failure_rolls_back_all_schema_and_version_changes() {
        let mut c = database();
        let dir = tempfile::tempdir().unwrap();
        let bad = Migration {
            from: 2,
            to: 3,
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
        let reject = |_: &Connection| Err(RegistryError::RecoveryRequired("test rejection".into()));
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
            from: 2,
            to: 3,
            sql: "SELECT 1",
        };
        assert!(execute_supported(&mut c, &[wrong], &backup, &limits(), target).is_err());
        assert!(!backup.exists());
        schema::validate(&c).unwrap();
    }
}
