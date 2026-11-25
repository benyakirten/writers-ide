use super::*;

// The foundation uses a finite whole-registry payload budget in addition to
// per-table row bounds. This bounds startup and every owned snapshot without
// materializing an oversized persisted value first. It is not a production default.
const TABLES: &[(&str, &[&str])] = &[
    ("registry_metadata", &["identity_namespace"]),
    ("sqlite_sequence", &["name"]),
    (
        "host_settings",
        &["permission_mode", "repair_conflict_policy"],
    ),
    ("packages", &["namespace", "name"]),
    ("components", &["local_id"]),
    (
        "package_version_history",
        &["version", "fingerprint_scheme", "fingerprint"],
    ),
    (
        "project_registrations",
        &[
            "display_name",
            "path_encoding",
            "path_bytes",
            "directory_identity_scheme",
            "directory_identity_bytes",
        ],
    ),
    (
        "accepted_artifacts",
        &[
            "id",
            "version",
            "storage_layout",
            "display_name",
            "description",
        ],
    ),
    ("artifact_files", &["artifact_id", "path", "sha256"]),
    (
        "package_installation_state",
        &[
            "selected_artifact_id",
            "staged_artifact_id",
            "previous_artifact_id",
            "pending_repair_artifact_id",
        ],
    ),
    (
        "artifact_components",
        &[
            "artifact_id",
            "display_name",
            "description",
            "kind",
            "activation_scope",
        ],
    ),
    ("native_permissions", &["operation", "resource"]),
    (
        "artifact_package_permissions",
        &["artifact_id", "operation", "resource"],
    ),
    (
        "artifact_component_permissions",
        &["artifact_id", "operation", "resource"],
    ),
    (
        "permission_approvals",
        &["operation", "resource", "coverage_scope", "source"],
    ),
    (
        "permission_denials",
        &["operation", "resource", "coverage_scope"],
    ),
    (
        "recovered_permission_approvals",
        &["operation", "resource", "coverage_scope"],
    ),
    ("component_enablement_defaults", &[]),
    ("project_component_overrides", &[]),
    ("component_scope_state", &["last_reviewed_scope"]),
    (
        "component_scope_acknowledgements",
        &[
            "target_version",
            "review_kind",
            "previous_scope",
            "target_scope",
        ],
    ),
];
/// Scalar checks run before schema validation can collect persisted strings.
/// Missing/unknown table shapes are unsafe existing storage, never initialization.
pub(super) fn preflight(c: &Connection, limits: &RegistryLimits) -> Result<()> {
    // Schema structure is fixed independently of the host's per-table data-row
    // budget. Even an empty registry needs all indexes and ownership triggers.
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(include_str!("schema.sql"))?;
    let maximum_objects: i64 =
        expected.query_row("SELECT count(*) FROM sqlite_schema", [], |r| r.get(0))?;
    let objects: i64 = c.query_row(
        "SELECT count(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?1)",
        [maximum_objects + 1],
        |r| r.get(0),
    )?;
    if objects > maximum_objects {
        return Err(corrupt("unsupported schema object count"));
    }
    let oversized: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE length(CAST(name AS BLOB))>?1 OR length(CAST(sql AS BLOB))>?2)", params![limits.max_text_bytes as i64, limits.max_snapshot_bytes as i64], |r| r.get(0))?;
    if oversized {
        return Err(RegistryError::LimitExceeded(
            "schema definition bytes".into(),
        ));
    }
    let bytes: i64 = c.query_row("SELECT coalesce(sum(coalesce(length(CAST(name AS BLOB)),0)+coalesce(length(CAST(sql AS BLOB)),0)),0) FROM sqlite_schema", [], |r| r.get(0))?;
    if bytes > limits.max_snapshot_bytes as i64 {
        return Err(RegistryError::LimitExceeded("schema payload bytes".into()));
    }
    bounds(c, limits).map_err(|e| match e {
        RegistryError::Storage(_) => {
            corrupt("existing registry cannot pass bounded table preflight")
        }
        other => other,
    })
}
pub(super) fn bounds(c: &Connection, limits: &RegistryLimits) -> Result<()> {
    let mut total = 0_u64;
    for (table, columns) in TABLES {
        let count: i64 = c.query_row(
            &format!("SELECT count(*) FROM (SELECT 1 FROM {table} LIMIT ?1)"),
            [limits.max_rows as i64 + 1],
            |r| r.get(0),
        )?;
        if count > limits.max_rows as i64 {
            return Err(RegistryError::LimitExceeded(format!("{table} row budget")));
        }
        // Bound individual values before SUM or allocating strings/BLOBs.
        for column in *columns {
            let maximum = match (*table, *column) {
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
            let large: bool = c.query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM {table} WHERE length(CAST({column} AS BLOB))>?1)"
                ),
                [maximum as i64],
                |r| r.get(0),
            )?;
            if large {
                return Err(RegistryError::LimitExceeded(format!(
                    "{table}.{column} byte budget"
                )));
            }
            let bytes: i64 = c.query_row(&format!("SELECT coalesce(sum(coalesce(length(CAST({column} AS BLOB)),0)),0) FROM {table}"),[],|r| r.get(0))?;
            let bytes = u64::try_from(bytes).map_err(|_| corrupt("negative payload length"))?;
            total = total
                .checked_add(bytes)
                .ok_or_else(|| RegistryError::LimitExceeded("registry payload overflow".into()))?;
            if total > limits.max_snapshot_bytes as u64 {
                return Err(RegistryError::LimitExceeded(
                    "registry payload budget".into(),
                ));
            }
        }
    }
    Ok(())
}
pub(super) fn validate(c: &Connection, limits: &RegistryLimits) -> Result<()> {
    bounds(c, limits)?;
    // Read only the first failure. Running integrity_check still performs the
    // complete SQLite check when it succeeds; diagnostics cannot grow unbounded.
    let integrity: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err(corrupt("SQLite integrity check failed"));
    }
    let mut fk = c.prepare("PRAGMA foreign_key_check")?;
    if fk.query([])?.next()?.is_some() {
        return Err(corrupt("SQLite foreign-key check failed"));
    }
    read_settings(c)?;
    let mut q =
        c.prepare("SELECT id,namespace,name,installation_revision FROM packages ORDER BY id")?;
    let packages = q
        .query_map([], |r| {
            Ok((
                PackageId(r.get(0)?),
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (package, namespace, name, revision) in packages {
        if package.0 < 1 || revision < 1 {
            return Err(corrupt("package key or revision"));
        }
        machine(&name)?;
        if let Some(namespace) = namespace {
            machine(&namespace)?;
        }
        let current = installation(c, package)?;
        if let Some(p) = &current.pointers {
            transitions::validate_pointers(package, p, |id| artifact_facts(c, id))?;
        }
        let mut components = c.prepare("SELECT id,local_id FROM components WHERE package_id=?1")?;
        let ids = components
            .query_map([package.0], |r| {
                Ok((ComponentId(r.get(0)?), r.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (component, local_id) in ids {
            if component.0 < 1 {
                return Err(corrupt("component key"));
            }
            machine(&local_id)?;
            if baseline(c, component)?.is_some_and(|b| b.revision.0 < 1) {
                return Err(corrupt("scope revision"));
            }
            if let Some(a) = decisions::acknowledgement(c, component)? {
                canonical_version(&a.target_version)?;
                if decisions::baseline(c, component)? != a.baseline
                    || a.baseline
                        .as_ref()
                        .is_some_and(|b| b.scope == a.target_scope)
                {
                    return Err(corrupt("pending scope baseline mismatch"));
                }
                let p = current
                    .pointers
                    .as_ref()
                    .ok_or_else(|| corrupt("uninstalled pending scope acknowledgement"))?;
                let target = p
                    .staged
                    .or(p.selected)
                    .ok_or_else(|| corrupt("pending scope target absent"))?;
                let facts = artifact_facts(c, target)?;
                let scope: Option<String> = c.query_row("SELECT activation_scope FROM artifact_components WHERE artifact_id=?1 AND component_id=?2",params![target.0.as_slice(),component.0],|r| r.get(0)).optional()?;
                if facts.version != a.target_version
                    || scope.as_deref() != Some(scope_sql(a.target_scope))
                {
                    return Err(corrupt("pending scope target mismatch"));
                }
            }
        }
        for id in artifact_ids(c, package, limits)? {
            let details = artifact_details(c, id, limits)?;
            canonical_version(&details.facts.version)?;
            text(&details.display_name, limits.max_text_bytes.min(1024))?;
            text(&details.description, limits.max_text_bytes.min(4096))?;
            for component in details.components {
                text(&component.display_name, limits.max_text_bytes.min(1024))?;
                text(&component.description, limits.max_text_bytes.min(4096))?;
                if component.scope == ActivationScope::Application
                    && component
                        .requirements
                        .iter()
                        .any(|p| *p != NativePermission::ExternalOpen)
                {
                    return Err(corrupt(
                        "application component requires project native service",
                    ));
                }
                let owner: i64 = c.query_row(
                    "SELECT package_id FROM components WHERE id=?1",
                    [component.id.0],
                    |r| r.get(0),
                )?;
                if owner != package.0 {
                    return Err(corrupt("artifact component owner mismatch"));
                }
            }
        }
        decisions::package_decisions(c, package, limits)?;
    }
    let mut q = c.prepare("SELECT version,fingerprint_scheme FROM package_version_history")?;
    let rows = q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (version, scheme) = row?;
        canonical_version(&version)?;
        if scheme != FINGERPRINT_SCHEME {
            return Err(corrupt("unsupported retained history fingerprint scheme"));
        }
    }
    let mut q = c.prepare("SELECT id FROM project_registrations")?;
    let projects = q
        .query_map([], |r| Ok(ProjectId(r.get(0)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for project in projects {
        let details = project_details(c, project, limits)?;
        if project.0 < 1
            || details.revision.0 < 1
            || details.location.path_bytes.is_empty()
            || details.location.directory_identity_bytes.is_empty()
        {
            return Err(corrupt("project location or revision"));
        }
        label(&details.display_name, limits.max_text_bytes)?;
        label(&details.location.path_encoding, limits.max_text_bytes)?;
        label(
            &details.location.directory_identity_scheme,
            limits.max_text_bytes,
        )?;
        // Versioned binary schemes are intentionally opaque. Readiness does not
        // turn these bytes into native identity or recover native grants.
    }
    Ok(())
}
fn baseline(c: &Connection, id: ComponentId) -> Result<Option<ScopeBaseline>> {
    decisions::baseline(c, id)
}
fn text(value: &str, maximum: usize) -> Result<()> {
    check_text(value, maximum).map_err(|_| corrupt("invalid persisted display text"))
}
fn label(value: &str, maximum: usize) -> Result<()> {
    check_label(value, maximum).map_err(|_| corrupt("invalid persisted location label"))
}
fn machine(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 256
        || !value.split('-').all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
    {
        return Err(corrupt("invalid persisted manifest identifier"));
    }
    Ok(())
}
fn canonical_version(value: &str) -> Result<()> {
    let parsed = semver::Version::parse(value).map_err(|_| corrupt("invalid retained version"))?;
    if parsed.to_string() != value {
        return Err(corrupt("noncanonical retained version"));
    }
    Ok(())
}
