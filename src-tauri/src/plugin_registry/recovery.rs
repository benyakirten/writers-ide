use std::{fs::OpenOptions, path::Path, time::Duration};

use rusqlite::{
    backup::{Backup, StepResult},
    params, Connection, OpenFlags, OptionalExtension,
};

use super::{
    error::{RegistryError, Result},
    model::RegistryLimits,
    schema,
};

fn open_existing(path: &Path) -> Result<Connection> {
    if !path.is_file() {
        return Err(RegistryError::RecoveryRequired(format!(
            "registry file missing: {}",
            path.display()
        )));
    }
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

fn claim_destination(destination: &Path) -> Result<Connection> {
    // Retain a failed staging file as evidence. Never repurpose an existing file,
    // including a zero-byte file or a symlink.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?
        .sync_all()?;
    let connection = Connection::open_with_flags(
        destination,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
    Ok(connection)
}

fn sync_destination(destination: &Path) -> Result<()> {
    // Windows FlushFileBuffers requires a handle opened for writing.
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(destination)?
        .sync_all()?;
    Ok(())
}

fn copy(source: &Connection, destination: &mut Connection) -> Result<()> {
    // Contention is a failed backup, not an unbounded worker shutdown delay.
    destination.busy_timeout(Duration::ZERO)?;
    let backup = Backup::new(source, destination)?;
    loop {
        match backup.step(128)? {
            StepResult::Done => return Ok(()),
            StepResult::More => {}
            StepResult::Busy => {
                return Err(RegistryError::Unavailable(
                    "SQLite backup source or destination is busy; backup was not completed".into(),
                ))
            }
            StepResult::Locked => {
                return Err(RegistryError::Unavailable(
                    "SQLite backup source or destination is locked; backup was not completed"
                        .into(),
                ))
            }
            _ => {
                return Err(RegistryError::Unavailable(
                    "unrecognized SQLite backup step outcome".into(),
                ))
            }
        }
    }
}

pub(crate) fn backup_database(source: &Connection, destination: &Path) -> Result<()> {
    let snapshot = source.unchecked_transaction()?;
    schema::validate(&snapshot)?;
    let mut target = claim_destination(destination)?;
    copy(&snapshot, &mut target)?;
    schema::validate(&target)?;
    target.close().map_err(|(_, error)| error)?;
    sync_destination(destination)?;
    snapshot.commit()?;
    Ok(())
}

pub(crate) fn prepare_restore(
    backup: &Path,
    current: Option<&Path>,
    destination: &Path,
    acknowledge_loss: bool,
    limits: &RegistryLimits,
) -> Result<()> {
    limits.validate()?;
    let source = open_existing(backup)?;
    let source_snapshot = source.unchecked_transaction()?;
    super::store::validate_snapshot(&source_snapshot, limits)?;

    // Hold both read transactions until preparation completes. Validation,
    // history reads and the SQLite backup must refer to the same snapshots.
    let current_connection = match current {
        None => None,
        Some(path) => match open_existing(path) {
            Ok(connection) => Some(connection),
            Err(RegistryError::RecoveryRequired(_)) => None,
            Err(RegistryError::Storage(error)) => {
                let unreadable = error.downcast_ref::<std::io::Error>().is_some()
                    || matches!(error.downcast_ref::<rusqlite::Error>(),
                        Some(rusqlite::Error::SqliteFailure(sqlite, _)) if matches!(sqlite.code,
                            rusqlite::ErrorCode::CannotOpen | rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt));
                if !unreadable {
                    return Err(RegistryError::Storage(error));
                }
                None
            }
            Err(error) => return Err(error),
        },
    };
    let current_snapshot = match current_connection.as_ref() {
        Some(connection) => Some(connection.unchecked_transaction()?),
        None => None,
    };
    let evidence = match current_snapshot.as_ref() {
        Some(connection) => {
            match connection.query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            }) {
                Ok(_) => schema::inspect_restore_evidence(connection, limits)?,
                Err(rusqlite::Error::SqliteFailure(error, _))
                    if matches!(
                        error.code,
                        rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt
                    ) =>
                {
                    schema::RestoreEvidence::default()
                }
                Err(error) => return Err(error.into()),
            }
        }
        None => schema::RestoreEvidence::default(),
    };
    let source_namespace: Vec<u8> = source_snapshot.query_row(
        "SELECT identity_namespace FROM registry_metadata",
        [],
        |row| row.get(0),
    )?;
    if let Some(namespace) = evidence.namespace {
        if namespace.as_slice() != source_namespace {
            return Err(RegistryError::RecoveryRequired(
                "ordinary restore requires the same registry namespace".into(),
            ));
        }
    }
    let mut bounds = schema::allocation_bounds(&source_snapshot)?;
    let current_bounds = match current_snapshot.as_ref() {
        Some(current) => match schema::allocation_bounds(current) {
            Ok(bounds) => Some(bounds),
            Err(RegistryError::RecoveryRequired(_) | RegistryError::Storage(_)) => None,
            Err(error) => return Err(error),
        },
        None => None,
    };
    let fresh_identity = !evidence.complete || current_bounds.is_none();
    if fresh_identity && !acknowledge_loss {
        return Err(RegistryError::RecoveryRequired("current history, namespace or allocation evidence is incomplete; explicit loss acknowledgement required".into()));
    }
    if let Some(current_bounds) = current_bounds {
        for (bound, current_bound) in bounds.iter_mut().zip(current_bounds) {
            *bound = (*bound).max(current_bound);
        }
    }
    let mut target = claim_destination(destination)?;
    copy(&source_snapshot, &mut target)?;
    let transaction = target.transaction()?;
    // Raise the sequences before merging any new package identities. Matching
    // numeric IDs in different snapshots are not evidence of matching identity.
    for (table, bound) in schema::IDENTITY_TABLES.iter().zip(bounds) {
        transaction.execute("DELETE FROM sqlite_sequence WHERE name=?1", [table])?;
        transaction.execute(
            "INSERT INTO sqlite_sequence(name,seq) VALUES (?1,?2)",
            params![table, bound],
        )?;
    }
    merge_history(&evidence.pins, &transaction)?;
    if fresh_identity {
        transaction.execute(
            "UPDATE registry_metadata SET identity_namespace=?1",
            [schema::fresh_namespace()?.as_slice()],
        )?;
    }
    quarantine_approvals(&transaction)?;
    transaction.execute("UPDATE host_settings SET permission_mode='secure'", [])?;
    super::store::validate_snapshot(&transaction, limits)?;
    transaction.commit()?;
    super::store::validate_snapshot(&target, limits)?;
    target.close().map_err(|(_, error)| error)?;
    sync_destination(destination)?;
    Ok(())
}

fn merge_history(pins: &[schema::RestoreHistoryPin], target: &Connection) -> Result<()> {
    for pin in pins {
        let namespace = &pin.namespace;
        let name = &pin.name;
        let version = &pin.version;
        let scheme = "writers-ide.file-set/1";
        let fingerprint = pin.fingerprint.as_slice();
        let canonical = match namespace {
            Some(namespace) => format!("@{namespace}/{name}"),
            None => name.clone(),
        };
        let package_id: Option<i64> = target
            .query_row(
                "SELECT id FROM packages WHERE canonical_id=?1",
                [&canonical],
                |row| row.get(0),
            )
            .optional()?;
        let package_id = match package_id {
            Some(id) => id,
            None => {
                let high_water: i64 = target.query_row(
                    "SELECT coalesce(max(seq),0) FROM sqlite_sequence WHERE name='packages'",
                    [],
                    |row| row.get(0),
                )?;
                if high_water == i64::MAX {
                    return Err(RegistryError::LimitExceeded(
                        "package allocation exhausted during restore".into(),
                    ));
                }
                target.execute(
                    "INSERT INTO packages(namespace,name) VALUES (?1,?2)",
                    params![namespace, name],
                )?;
                target.last_insert_rowid()
            }
        };
        let existing: Option<(String, Vec<u8>)> = target.query_row(
            "SELECT fingerprint_scheme,fingerprint FROM package_version_history WHERE package_id=?1 AND version=?2",
            params![package_id,version], |row| Ok((row.get(0)?,row.get(1)?))).optional()?;
        if let Some((old_scheme, old_fingerprint)) = existing {
            if old_scheme != scheme || old_fingerprint != fingerprint {
                return Err(RegistryError::VersionConflict(format!(
                    "{canonical} {version}"
                )));
            }
        } else {
            target.execute(
                "INSERT INTO package_version_history VALUES (?1,?2,?3,?4)",
                params![package_id, version, scheme, fingerprint],
            )?;
        }
    }
    Ok(())
}

fn quarantine_approvals(connection: &Connection) -> Result<()> {
    // The partial indexes encode nullable project identity. Match it explicitly
    // with IS; ordinary equality would miss application-wide candidates.
    connection.execute_batch(
        "UPDATE recovered_permission_approvals AS r SET
            had_explicit_approval = max(had_explicit_approval, EXISTS (
                SELECT 1 FROM permission_approvals a WHERE a.component_id=r.component_id
                AND a.operation=r.operation AND a.resource=r.resource
                AND a.coverage_scope=r.coverage_scope AND a.project_registration_id IS r.project_registration_id
                AND a.source='explicit')),
            had_automatic_approval = max(had_automatic_approval, EXISTS (
                SELECT 1 FROM permission_approvals a WHERE a.component_id=r.component_id
                AND a.operation=r.operation AND a.resource=r.resource
                AND a.coverage_scope=r.coverage_scope AND a.project_registration_id IS r.project_registration_id
                AND a.source='automatic'));
         INSERT INTO recovered_permission_approvals
            SELECT a.component_id,a.operation,a.resource,a.coverage_scope,a.project_registration_id,
                   a.source='explicit',a.source='automatic'
            FROM permission_approvals a WHERE NOT EXISTS (
                SELECT 1 FROM recovered_permission_approvals r WHERE a.component_id=r.component_id
                AND a.operation=r.operation AND a.resource=r.resource
                AND a.coverage_scope=r.coverage_scope AND a.project_registration_id IS r.project_registration_id);
         DELETE FROM permission_approvals;"
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
