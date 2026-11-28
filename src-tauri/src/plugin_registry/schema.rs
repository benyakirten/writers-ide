use rusqlite::Connection;

use super::{
    error::{RegistryError, Result},
    model::RegistryLimits,
};

pub(crate) const VERSION: i64 = 2;
const SQL: &str = include_str!("schema.sql");
const SQL_V1: &str = include_str!("schema_v1.sql");

fn supported_sql(version: i64) -> Result<&'static str> {
    match version {
        1 => Ok(SQL_V1),
        VERSION => Ok(SQL),
        _ => Err(RegistryError::RecoveryRequired(format!(
            "unsupported registry schema version {version}"
        ))),
    }
}

fn supported_version(connection: &Connection) -> Result<i64> {
    let version = connection
        .query_row(
            "SELECT schema_version FROM registry_metadata WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| {
            RegistryError::RecoveryRequired(format!(
                "registry validation failed: cannot read schema version: {error}"
            ))
        })?;
    supported_sql(version)?;
    Ok(version)
}
pub(crate) const IDENTITY_TABLES: [&str; 3] = ["packages", "components", "project_registrations"];

pub(crate) fn fresh_namespace() -> Result<[u8; 16]> {
    let mut namespace = [0; 16];
    getrandom::fill(&mut namespace)
        .map_err(|error| RegistryError::Unavailable(format!("namespace randomness: {error}")))?;
    Ok(namespace)
}

pub(crate) fn initialize(connection: &mut Connection) -> Result<()> {
    initialize_version(connection, VERSION)
}

#[cfg(test)]
pub(crate) fn initialize_v1(connection: &mut Connection) -> Result<()> {
    initialize_version(connection, 1)
}

fn initialize_version(connection: &mut Connection, version: i64) -> Result<()> {
    let namespace = fresh_namespace()?;
    let transaction = connection.transaction()?;
    let objects: i64 = transaction.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if objects != 0 {
        return Err(RegistryError::RecoveryRequired(
            "initialization requires an empty database".into(),
        ));
    }
    transaction.execute_batch(supported_sql(version)?)?;
    transaction.execute(
        "INSERT INTO registry_metadata VALUES (1, ?1, ?2)",
        rusqlite::params![version, namespace.as_slice()],
    )?;
    transaction.execute("INSERT INTO host_settings(singleton) VALUES (1)", [])?;
    validate_version(&transaction, version)?;
    transaction.commit()?;
    Ok(())
}

pub(crate) fn validate(connection: &Connection) -> Result<()> {
    validate_version(connection, VERSION)
}

// Live-store health needs domain evidence, not opening's recovery wrapper around
// ordinary storage failures. Keep those failures in their original category.
pub(super) fn validate_live(connection: &Connection) -> Result<()> {
    validate_inner(connection, VERSION)
}

pub(crate) fn validate_supported(connection: &Connection) -> Result<i64> {
    let version = supported_version(connection)?;
    validate_version(connection, version)?;
    Ok(version)
}

fn validate_version(connection: &Connection, version: i64) -> Result<()> {
    validate_inner(connection, version).map_err(|error| match error {
        RegistryError::RecoveryRequired(_) => error,
        _ => RegistryError::RecoveryRequired(format!("registry validation failed: {error}")),
    })
}

fn text<'a>(row: &'a rusqlite::Row<'_>, index: usize) -> Result<&'a str> {
    row.get_ref(index)?
        .as_str()
        .map_err(|_| RegistryError::RecoveryRequired("invalid stored UTF-8 text".into()))
}

fn validate_objects(connection: &Connection, version: i64) -> Result<()> {
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(supported_sql(version)?)?;
    let query = "SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
    let count_query =
        "SELECT count(*) FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'";
    let expected_count: i64 = expected.query_row(count_query, [], |row| row.get(0))?;
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM (SELECT 1 FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' LIMIT ?1)",
        [expected_count + 1], |row| row.get(0),
    )?;
    if count != expected_count {
        return Err(RegistryError::RecoveryRequired(
            "unsupported or incomplete registry schema".into(),
        ));
    }
    for column in ["type", "name", "sql"] {
        let maximum: i64 = expected.query_row(
            &format!("SELECT max(length(CAST({column} AS BLOB))) FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"), [], |row| row.get(0),
        )?;
        let oversized: bool = connection.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND length(CAST({column} AS BLOB))>?1)"), [maximum], |row| row.get(0),
        )?;
        if oversized {
            return Err(RegistryError::RecoveryRequired(
                "oversized registry schema definition".into(),
            ));
        }
    }
    let mut actual_statement = connection.prepare(query)?;
    let mut expected_statement = expected.prepare(query)?;
    let mut actual_rows = actual_statement.query([])?;
    let mut expected_rows = expected_statement.query([])?;
    loop {
        let Some(expected_row) = expected_rows.next()? else {
            break;
        };
        let actual_row = actual_rows
            .next()?
            .ok_or_else(|| RegistryError::RecoveryRequired("incomplete registry schema".into()))?;
        for index in 0..3 {
            // Borrow SQLite's value. In particular, never allocate an attacker-
            // sized schema definition before comparing it to the fixed baseline.
            if text(actual_row, index)? != text(expected_row, index)? {
                return Err(RegistryError::RecoveryRequired(
                    "unsupported registry schema definition".into(),
                ));
            }
        }
    }
    Ok(())
}

fn require_absent(connection: &Connection, query: &str, message: &str) -> Result<()> {
    if connection.prepare(query)?.exists([])? {
        return Err(RegistryError::RecoveryRequired(message.into()));
    }
    Ok(())
}

fn validate_inner(connection: &Connection, version: i64) -> Result<()> {
    // Compare definitions, not just object names: missing constraints and changed
    // triggers must not turn an unsupported database into a ready registry.
    validate_objects(connection, version)?;
    let mut statement = connection.prepare("PRAGMA integrity_check")?;
    let mut rows = statement.query([])?;
    let mut checked = false;
    loop {
        let Some(row) = rows.next()? else { break };
        if text(row, 0)? != "ok" {
            return Err(RegistryError::RecoveryRequired(
                "SQLite integrity check failed".into(),
            ));
        }
        checked = true;
    }
    if !checked {
        return Err(RegistryError::RecoveryRequired(
            "empty integrity check".into(),
        ));
    }
    require_absent(
        connection,
        "PRAGMA foreign_key_check",
        "foreign-key violation",
    )?;
    let metadata: (i64, i64, bool) = connection.query_row(
        "SELECT singleton, schema_version, typeof(identity_namespace)='blob' AND length(identity_namespace)=16 FROM registry_metadata",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if metadata.0 != 1 || metadata.1 != version || !metadata.2 {
        return Err(RegistryError::RecoveryRequired(
            "unsupported registry version or namespace".into(),
        ));
    }
    for table in ["registry_metadata", "host_settings"] {
        let count: i64 = connection.query_row(
            &format!("SELECT count(*) FROM (SELECT 1 FROM {table} LIMIT 2)"),
            [],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(RegistryError::RecoveryRequired(format!(
                "missing required {table} singleton"
            )));
        }
    }
    if version == VERSION {
        // Check persisted domains explicitly: integrity_check alone is not a
        // reliable guard for values written with CHECK constraints disabled.
        require_absent(
            connection,
            "SELECT 1 FROM host_settings WHERE
                typeof(command_max_caller_pending) <> 'integer'
                OR command_max_caller_pending NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_provider_pending) <> 'integer'
                OR command_max_provider_pending NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_window_pending) <> 'integer'
                OR command_max_window_pending NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_payload_bytes) <> 'integer'
                OR command_max_payload_bytes NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_payload_depth) <> 'integer'
                OR command_max_payload_depth NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_payload_entries) <> 'integer'
                OR command_max_payload_entries NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_component_bytes) <> 'integer'
                OR command_max_component_bytes NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_max_window_bytes) <> 'integer'
                OR command_max_window_bytes NOT BETWEEN 1 AND 9007199254740991
                OR typeof(command_resource_revision) <> 'integer'
                OR command_resource_revision < 0
             LIMIT 1",
            "invalid stored command resource settings",
        )?;
    }
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM (SELECT 1 FROM native_permissions LIMIT 4)",
        [],
        |row| row.get(0),
    )?;
    if count != 3 {
        return Err(RegistryError::RecoveryRequired(
            "unsupported permission catalog".into(),
        ));
    }
    require_absent(connection,
        "SELECT 1 FROM native_permissions WHERE length(CAST(operation AS BLOB))>18 OR length(CAST(resource AS BLOB))>10",
        "unsupported permission catalog value")?;
    let mut statement = connection.prepare(
        "SELECT operation, resource FROM native_permissions ORDER BY operation, resource",
    )?;
    let mut rows = statement.query([])?;
    for (operation, resource) in [
        ("external.open", "http-https"),
        ("project.files.list", "project"),
        ("project.files.read", "project"),
    ] {
        let row = rows.next()?.ok_or_else(|| {
            RegistryError::RecoveryRequired("missing permission catalog row".into())
        })?;
        if text(row, 0)? != operation || text(row, 1)? != resource {
            return Err(RegistryError::RecoveryRequired(
                "unsupported permission catalog".into(),
            ));
        }
    }
    allocation_bounds(connection)?;
    validate_identifiers(connection)?;
    require_absent(connection,
        "SELECT 1 FROM artifact_components ac JOIN accepted_artifacts a ON a.id=ac.artifact_id JOIN components c ON c.id=ac.component_id WHERE a.package_id<>c.package_id",
        "artifact/component package mismatch")?;
    require_absent(connection,
        "SELECT 1 FROM package_version_history WHERE fingerprint_scheme <> 'writers-ide.file-set/1'",
        "unsupported fingerprint scheme")?;
    require_absent(connection,
        "SELECT 1 FROM accepted_artifacts WHERE integrity_record_version <> 1 OR storage_layout <> 'writers-ide.artifact-store/1'",
        "unsupported artifact format or layout")?;
    let mut versions = connection.prepare("SELECT version FROM package_version_history")?;
    let mut rows = versions.query([])?;
    loop {
        let Some(row) = rows.next()? else { break };
        let version = text(row, 0)?;
        if version.len() > crate::plugin_manifest::parse::MAX_MANIFEST_BYTES
            || semver::Version::parse(version).is_err()
        {
            return Err(RegistryError::RecoveryRequired(
                "invalid stored version".into(),
            ));
        }
    }
    require_absent(connection,
        "SELECT 1 FROM package_installation_state s JOIN accepted_artifacts selected ON selected.id=s.selected_artifact_id JOIN accepted_artifacts staged ON staged.id=s.staged_artifact_id JOIN accepted_artifacts repair ON repair.id=s.pending_repair_artifact_id WHERE repair.version<>selected.version OR staged.version=selected.version",
        "invalid pending-repair release relationship")?;
    require_absent(connection,
        "SELECT 1 FROM artifact_components ac WHERE ac.activation_scope='application' AND (EXISTS (SELECT 1 FROM artifact_package_permissions p WHERE p.artifact_id=ac.artifact_id AND p.resource='project') OR EXISTS (SELECT 1 FROM artifact_component_permissions p WHERE p.artifact_id=ac.artifact_id AND p.component_id=ac.component_id AND p.resource='project'))",
        "application component requires project-file permission")?;
    require_absent(connection,
        "SELECT 1 FROM component_scope_acknowledgements a LEFT JOIN component_scope_state s ON s.component_id=a.component_id WHERE (a.review_kind='initial' AND s.component_id IS NOT NULL) OR (a.review_kind='scope-change' AND (s.component_id IS NULL OR s.scope_revision<>a.expected_scope_revision OR s.last_reviewed_scope<>a.previous_scope))",
        "scope acknowledgement does not match retained baseline")?;
    require_absent(connection,
        "SELECT 1 FROM component_scope_acknowledgements ack WHERE NOT EXISTS (SELECT 1 FROM package_installation_state i JOIN accepted_artifacts a ON a.id IN (i.selected_artifact_id,i.staged_artifact_id,i.previous_artifact_id,i.pending_repair_artifact_id) JOIN artifact_components ac ON ac.artifact_id=a.id WHERE i.package_id=ack.package_id AND a.version=ack.target_version AND ac.component_id=ack.component_id AND ac.activation_scope=ack.target_scope)",
        "scope acknowledgement has no matching retained target declaration")?;
    Ok(())
}

pub(crate) fn allocation_bounds(connection: &Connection) -> Result<[i64; 3]> {
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM (SELECT 1 FROM sqlite_sequence LIMIT 4)",
        [],
        |row| row.get(0),
    )?;
    if count > 3 {
        return Err(RegistryError::RecoveryRequired(
            "unexpected allocation history rows".into(),
        ));
    }
    require_absent(connection,
        "SELECT 1 FROM sqlite_sequence WHERE name NOT IN ('packages','components','project_registrations') OR typeof(seq)<>'integer' OR seq<0 UNION ALL SELECT 1 FROM sqlite_sequence GROUP BY name HAVING count(*)<>1",
        "invalid allocation history")?;
    let mut bounds = [0; 3];
    for (index, table) in IDENTITY_TABLES.iter().enumerate() {
        require_absent(
            connection,
            &format!("SELECT 1 FROM {table} WHERE id<=0"),
            "nonpositive stable identity",
        )?;
        let maximum: i64 = connection.query_row(
            &format!("SELECT coalesce(max(id),0) FROM {table}"),
            [],
            |row| row.get(0),
        )?;
        let sequence: Option<i64> = connection.query_row(
            "SELECT max(seq) FROM sqlite_sequence WHERE name=?1",
            [table],
            |row| row.get(0),
        )?;
        if maximum < 0 || sequence.unwrap_or(0) < maximum {
            return Err(RegistryError::RecoveryRequired(format!(
                "missing or invalid {table} allocation history"
            )));
        }
        bounds[index] = sequence.unwrap_or(0);
    }
    Ok(bounds)
}

fn validate_identifiers(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare(
        "SELECT namespace FROM packages WHERE namespace IS NOT NULL UNION ALL SELECT name FROM packages UNION ALL SELECT local_id FROM components",
    )?;
    let mut rows = statement.query([])?;
    loop {
        let Some(row) = rows.next()? else { break };
        let identifier = text(row, 0)?;
        if identifier.is_empty()
            || identifier.len() > 256
            || !identifier.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
        {
            return Err(RegistryError::RecoveryRequired(
                "invalid stored package/component identifier".into(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_with_limits(connection: &Connection, limits: &RegistryLimits) -> Result<()> {
    validate_objects(connection, VERSION)?;
    check_limits(connection, limits, VERSION)?;
    validate(connection)
}

pub(crate) fn validate_supported_with_limits(
    connection: &Connection,
    limits: &RegistryLimits,
) -> Result<i64> {
    let version = supported_version(connection)?;
    validate_objects(connection, version)?;
    check_limits(connection, limits, version)?;
    validate_version(connection, version)?;
    Ok(version)
}

// The list is the fixed schema contract, not caller-controlled SQL.
const TABLES: [&str; 20] = [
    "registry_metadata",
    "host_settings",
    "packages",
    "components",
    "package_version_history",
    "project_registrations",
    "accepted_artifacts",
    "artifact_files",
    "artifact_components",
    "native_permissions",
    "artifact_package_permissions",
    "artifact_component_permissions",
    "package_installation_state",
    "permission_approvals",
    "permission_denials",
    "recovered_permission_approvals",
    "component_enablement_defaults",
    "project_component_overrides",
    "component_scope_state",
    "component_scope_acknowledgements",
];

fn check_limits(connection: &Connection, limits: &RegistryLimits, version: i64) -> Result<()> {
    limits.validate()?;
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(supported_sql(version)?)?;
    let mut total = 0_u64;
    for table in TABLES {
        let count: i64 = connection.query_row(
            &format!("SELECT count(*) FROM (SELECT 1 FROM {table} LIMIT ?1)"),
            [limits.max_rows as i64 + 1],
            |row| row.get(0),
        )?;
        if count > limits.max_rows as i64 {
            return Err(RegistryError::LimitExceeded(format!("{table} row budget")));
        }
        // Column metadata comes only from the embedded, trusted schema. Length
        // queries return integers and never copy persisted payloads into Rust.
        let mut columns = expected.prepare(&format!("PRAGMA table_info({table})"))?;
        let mut rows = columns.query([])?;
        loop {
            let Some(row) = rows.next()? else { break };
            let column = text(row, 1)?;
            let kind = text(row, 2)?;
            if kind != "TEXT" && kind != "BLOB" {
                continue;
            }
            let maximum = match (table, column) {
                ("project_registrations", "path_bytes" | "directory_identity_bytes") => {
                    limits.max_location_bytes
                }
                ("artifact_files", "path") => limits.integrity.max_path_bytes,
                (
                    _,
                    "id"
                    | "artifact_id"
                    | "identity_namespace"
                    | "selected_artifact_id"
                    | "staged_artifact_id"
                    | "previous_artifact_id"
                    | "pending_repair_artifact_id",
                ) => 16,
                (_, "sha256" | "fingerprint") => 32,
                _ => limits.max_text_bytes,
            };
            let mut lengths = connection.prepare(&format!(
                "SELECT coalesce(length(CAST({column} AS BLOB)),0) FROM {table}"
            ))?;
            let mut lengths = lengths.query([])?;
            loop {
                let Some(row) = lengths.next()? else { break };
                let length = row.get::<_, i64>(0)? as u64;
                if length > maximum as u64 {
                    return Err(RegistryError::LimitExceeded(format!(
                        "{table}.{column} byte budget"
                    )));
                }
                total = total.checked_add(length).ok_or_else(|| {
                    RegistryError::LimitExceeded("registry payload overflow".into())
                })?;
                if total > limits.max_snapshot_bytes as u64 {
                    return Err(RegistryError::LimitExceeded(
                        "registry payload budget".into(),
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(crate) struct RestoreHistoryPin {
    package_id: i64,
    pub namespace: Option<String>,
    pub name: String,
    pub version: String,
    pub fingerprint: [u8; 32],
}

#[derive(Default)]
pub(crate) struct RestoreEvidence {
    pub namespace: Option<[u8; 16]>,
    pub pins: Vec<RestoreHistoryPin>,
    pub complete: bool,
}

fn unreadable_evidence(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(sqlite, _) if matches!(sqlite.code,
        rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt))
}

fn charge_evidence(bytes: &mut usize, additional: usize, limits: &RegistryLimits) -> Result<()> {
    *bytes = bytes
        .checked_add(additional)
        .ok_or_else(|| RegistryError::LimitExceeded("restore evidence payload overflow".into()))?;
    if *bytes > limits.max_snapshot_bytes {
        return Err(RegistryError::LimitExceeded(
            "restore evidence payload budget".into(),
        ));
    }
    Ok(())
}

fn bound_evidence_row(
    row: &rusqlite::Row<'_>,
    columns: usize,
    bytes: &mut usize,
    limits: &RegistryLimits,
) -> Result<()> {
    for column in 0..columns {
        let (length, maximum) = match row.get_ref(column)? {
            rusqlite::types::ValueRef::Text(value) => (value.len(), limits.max_text_bytes),
            rusqlite::types::ValueRef::Blob(value) => (value.len(), limits.max_text_bytes.max(32)),
            _ => (0, 0),
        };
        if length > maximum {
            return Err(RegistryError::LimitExceeded(
                "restore evidence field budget".into(),
            ));
        }
        charge_evidence(bytes, length, limits)?;
    }
    Ok(())
}

fn machine_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

// Missing tables are unknown evidence, not an empty known history. Only exact
// v1 table definitions are interpreted; no unknown layouts are guessed.
fn evidence_table(
    connection: &Connection,
    expected: &Connection,
    table: &str,
    limits: &RegistryLimits,
) -> Result<bool> {
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM (SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1 LIMIT 2)",
        [table],
        |row| row.get(0),
    )?;
    if count != 1 {
        return Ok(false);
    }
    let expected_sql: String = expected.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",
        [table],
        |row| row.get(0),
    )?;
    let mut statement =
        connection.prepare("SELECT type,sql FROM sqlite_schema WHERE type='table' AND name=?1")?;
    let mut rows = statement.query([table])?;
    let Some(row) = rows.next()? else {
        return Ok(false);
    };
    let kind = row.get_ref(0)?;
    let definition = row.get_ref(1)?;
    let Ok(definition) = definition.as_str() else {
        return Ok(false);
    };
    if definition.len() > limits.max_snapshot_bytes {
        return Err(RegistryError::LimitExceeded(
            "restore schema definition budget".into(),
        ));
    }
    if kind.as_str().ok() != Some("table") || definition != expected_sql {
        return Err(RegistryError::RecoveryRequired(format!(
            "unsupported current {table} schema"
        )));
    }
    Ok(true)
}

// Recover independent facts, not selected rows chosen by a caller. Every safely
// decoded pin remains binding even when another row, table, namespace or counter
// is unavailable. Unknown facts require acknowledged loss and a fresh namespace.
pub(crate) fn inspect_restore_evidence(
    connection: &Connection,
    limits: &RegistryLimits,
) -> Result<RestoreEvidence> {
    limits.validate()?;
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(SQL)?;
    let mut evidence = RestoreEvidence {
        complete: true,
        ..RestoreEvidence::default()
    };
    let mut bytes = 0;

    // Inspect the version independently of namespace decoding or exact table
    // shape. A readable newer/unsupported version must never enter loss recovery.
    let metadata_exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='registry_metadata')", [], |row| row.get(0))?;
    let mut version_known = false;
    if metadata_exists {
        let mut columns = connection.prepare("PRAGMA table_info(registry_metadata)")?;
        let mut rows = columns.query([])?;
        let mut has_version = false;
        let mut count = 0;
        loop {
            let Some(row) = rows.next()? else { break };
            count += 1;
            if count > limits.max_rows {
                return Err(RegistryError::LimitExceeded(
                    "restore metadata column budget".into(),
                ));
            }
            if row.get_ref(1)?.as_str().ok() == Some("schema_version") {
                has_version = true;
            }
        }
        if has_version {
            let mut statement =
                connection.prepare("SELECT schema_version FROM registry_metadata LIMIT ?1")?;
            let mut rows = statement.query([limits.max_rows as i64 + 1])?;
            let mut count = 0;
            loop {
                let row = match rows.next() {
                    Ok(Some(row)) => row,
                    Ok(None) => break,
                    Err(error) if unreadable_evidence(&error) => {
                        evidence.complete = false;
                        break;
                    }
                    Err(error) => return Err(error.into()),
                };
                count += 1;
                if count > limits.max_rows {
                    return Err(RegistryError::LimitExceeded(
                        "restore metadata row budget".into(),
                    ));
                }
                bound_evidence_row(row, 1, &mut bytes, limits)?;
                if let rusqlite::types::ValueRef::Integer(version) = row.get_ref(0)? {
                    if supported_sql(version).is_err() {
                        return Err(RegistryError::RecoveryRequired(format!(
                            "unsupported current registry schema version {version}"
                        )));
                    }
                    version_known = true;
                } else {
                    evidence.complete = false;
                }
            }
            evidence.complete &= count == 1;
        }
    }
    evidence.complete &= version_known;
    if evidence_table(connection, &expected, "registry_metadata", limits)? {
        let mut statement = connection
            .prepare("SELECT singleton,identity_namespace FROM registry_metadata LIMIT ?1")?;
        let mut rows = statement.query([limits.max_rows as i64 + 1])?;
        let mut count = 0;
        loop {
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(error) if unreadable_evidence(&error) => {
                    evidence.complete = false;
                    break;
                }
                Err(error) => return Err(error.into()),
            };
            count += 1;
            if count > limits.max_rows {
                return Err(RegistryError::LimitExceeded(
                    "restore namespace row budget".into(),
                ));
            }
            bound_evidence_row(row, 2, &mut bytes, limits)?;
            let namespace = row
                .get_ref(1)?
                .as_blob()
                .ok()
                .and_then(|namespace| <[u8; 16]>::try_from(namespace).ok());
            if let (Ok(1), Some(namespace)) = (row.get_ref(0)?.as_i64(), namespace) {
                if evidence
                    .namespace
                    .is_some_and(|previous| previous != namespace)
                {
                    return Err(RegistryError::RecoveryRequired(
                        "ambiguous current registry namespace".into(),
                    ));
                }
                evidence.namespace = Some(namespace);
            } else {
                evidence.complete = false;
            }
        }
        evidence.complete &= count == 1;
    }
    evidence.complete &= evidence.namespace.is_some();

    let mut packages = std::collections::BTreeMap::new();
    if evidence_table(connection, &expected, "packages", limits)? {
        let mut statement =
            connection.prepare("SELECT id,namespace,name FROM packages NOT INDEXED LIMIT ?1")?;
        let mut rows = statement.query([limits.max_rows as i64 + 1])?;
        let mut count = 0;
        loop {
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(error) if unreadable_evidence(&error) => {
                    evidence.complete = false;
                    break;
                }
                Err(error) => return Err(error.into()),
            };
            count += 1;
            if count > limits.max_rows {
                return Err(RegistryError::LimitExceeded(
                    "restore package row budget".into(),
                ));
            }
            bound_evidence_row(row, 3, &mut bytes, limits)?;
            let id = row.get_ref(0)?.as_i64().ok().filter(|id| *id > 0);
            let namespace_value = row.get_ref(1)?;
            let namespace = match namespace_value {
                rusqlite::types::ValueRef::Null => Some(None),
                rusqlite::types::ValueRef::Text(value) => std::str::from_utf8(value)
                    .ok()
                    .filter(|value| machine_identifier(value))
                    .map(|value| Some(value.to_owned())),
                _ => None,
            };
            let name_value = row.get_ref(2)?;
            let name = name_value
                .as_str()
                .ok()
                .filter(|value| machine_identifier(value));
            if let (Some(id), Some(namespace), Some(name)) = (id, namespace, name) {
                packages.insert(id, (namespace, name.to_owned()));
            } else {
                evidence.complete = false;
            }
        }
    } else {
        evidence.complete = false;
    }

    if evidence_table(connection, &expected, "package_version_history", limits)? {
        let mut statement = connection.prepare("SELECT package_id,version,fingerprint_scheme,fingerprint FROM package_version_history NOT INDEXED LIMIT ?1")?;
        let mut rows = statement.query([limits.max_rows as i64 + 1])?;
        let mut count = 0;
        loop {
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(error) if unreadable_evidence(&error) => {
                    evidence.complete = false;
                    break;
                }
                Err(error) => return Err(error.into()),
            };
            count += 1;
            if count > limits.max_rows {
                return Err(RegistryError::LimitExceeded(
                    "restore history row budget".into(),
                ));
            }
            bound_evidence_row(row, 4, &mut bytes, limits)?;
            let package_id = row.get_ref(0)?.as_i64().ok();
            let package = package_id.and_then(|id| packages.get(&id));
            let version_value = row.get_ref(1)?;
            let version = version_value.as_str().ok().filter(|version| {
                version.len() <= crate::plugin_manifest::parse::MAX_MANIFEST_BYTES
                    && semver::Version::parse(version).is_ok()
            });
            let scheme_ok = row.get_ref(2)?.as_str().ok() == Some("writers-ide.file-set/1");
            let fingerprint = row
                .get_ref(3)?
                .as_blob()
                .ok()
                .and_then(|value| <[u8; 32]>::try_from(value).ok());
            if let (
                Some(package_id),
                Some((namespace, name)),
                Some(version),
                true,
                Some(fingerprint),
            ) = (package_id, package, version, scheme_ok, fingerprint)
            {
                charge_evidence(
                    &mut bytes,
                    namespace.as_ref().map_or(0, String::len) + name.len(),
                    limits,
                )?;
                evidence.pins.push(RestoreHistoryPin {
                    package_id,
                    namespace: namespace.clone(),
                    name: name.clone(),
                    version: version.to_owned(),
                    fingerprint,
                });
            } else {
                evidence.complete = false;
            }
        }
    } else {
        evidence.complete = false;
    }
    // A surviving accepted artifact can establish that a history row is
    // missing. It cannot supply the missing trusted fingerprint by itself.
    let known_pins: std::collections::BTreeSet<_> = evidence
        .pins
        .iter()
        .map(|pin| (pin.package_id, pin.version.as_str()))
        .collect();
    if evidence_table(connection, &expected, "accepted_artifacts", limits)? {
        let mut statement = connection
            .prepare("SELECT package_id,version FROM accepted_artifacts NOT INDEXED LIMIT ?1")?;
        let mut rows = statement.query([limits.max_rows as i64 + 1])?;
        let mut count = 0;
        loop {
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(error) if unreadable_evidence(&error) => {
                    evidence.complete = false;
                    break;
                }
                Err(error) => return Err(error.into()),
            };
            count += 1;
            if count > limits.max_rows {
                return Err(RegistryError::LimitExceeded(
                    "restore artifact evidence row budget".into(),
                ));
            }
            bound_evidence_row(row, 2, &mut bytes, limits)?;
            let package = row.get_ref(0)?.as_i64().ok();
            let version_value = row.get_ref(1)?;
            let version = version_value.as_str().ok();
            if let (Some(package), Some(version)) = (package, version) {
                evidence.complete &= known_pins.contains(&(package, version));
            } else {
                evidence.complete = false;
            }
        }
    } else {
        evidence.complete = false;
    }
    Ok(evidence)
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
