use super::{
    error::{RegistryError, Result},
    model::*,
    preparation::*,
    transitions::{self, InstallationAction, InstallationExpectation},
};
use crate::plugin_integrity::{IntegrityEntry, IntegrityRecord};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::{
    fs::{File, OpenOptions},
    path::Path,
};

#[path = "store_decisions.rs"]
mod decisions;
#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
#[path = "store_validation.rs"]
mod validation;

pub(crate) enum ArtifactTarget {
    Accepted(ArtifactId),
    Prepared(Box<(PreparedArtifact, PublicationReceipt)>),
}

/// Synchronous single-owner implementation for the worker and generation owner.
/// The connection never escapes this module; checked close returns the destination lock.
pub(crate) struct Store {
    connection: Connection,
    _ownership: File,
    limits: RegistryLimits,
    poisoned: bool,
    #[cfg(test)]
    fail_rollback: bool,
}
impl Store {
    pub(crate) fn create(path: &Path, limits: RegistryLimits) -> Result<Self> {
        limits.validate()?;
        // Claim the database non-overwriting, but lock a separate inode: on
        // some platforms File locking overlaps SQLite's byte-range locks.
        let claim = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)?;
        let ownership = destination_lock(path)?;
        drop(claim);
        let mut connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        configure(&connection)?;
        super::schema::initialize(&mut connection)?;
        let mut store = Self {
            connection,
            _ownership: ownership,
            limits,
            poisoned: false,
            #[cfg(test)]
            fail_rollback: false,
        };
        store.validate_ready()?;
        Ok(store)
    }
    pub(crate) fn open(path: &Path, limits: RegistryLimits) -> Result<Self> {
        limits.validate()?;
        // canonicalize fails for a missing database; only the sidecar may be created.
        let ownership = destination_lock(path)?;
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        // Identify existing storage before changing its journal configuration.
        validation::preflight(&connection, &limits)?;
        super::schema::validate_with_limits(&connection, &limits)?;
        configure(&connection)?;
        let mut store = Self {
            connection,
            _ownership: ownership,
            limits,
            poisoned: false,
            #[cfg(test)]
            fail_rollback: false,
        };
        store.validate_ready()?;
        Ok(store)
    }
    /// Consume the preparation store without losing ownership on a failed close.
    pub(super) fn seal(self) -> std::result::Result<File, (RegistryError, Box<Self>)> {
        if let Err(error) = self
            .ensure_available()
            .and_then(|()| super::generation::prepare(&self.connection, &self.limits))
        {
            return Err((error, Box::new(self)));
        }
        let Self {
            connection,
            _ownership,
            limits,
            poisoned,
            #[cfg(test)]
            fail_rollback,
        } = self;
        match connection.close() {
            Ok(()) => Ok(_ownership),
            Err((connection, error)) => Err((
                error.into(),
                Box::new(Self {
                    connection,
                    _ownership,
                    limits,
                    poisoned,
                    #[cfg(test)]
                    fail_rollback,
                }),
            )),
        }
    }

    #[cfg(test)]
    pub(super) fn test_connection(&self) -> &Connection {
        &self.connection
    }

    pub(crate) fn backup(&self, destination: &Path) -> Result<()> {
        self.ensure_available()?;
        super::recovery::backup_database(&self.connection, destination)
    }
    pub(crate) fn read_settings(&mut self) -> Result<HostSettings> {
        self.ensure_available()?;
        let tx = self.connection.transaction()?;
        let settings = read_settings(&tx)?;
        tx.commit()?;
        Ok(settings)
    }
    pub(crate) fn package_details(&mut self, package: PackageId) -> Result<PackageDetails> {
        self.ensure_available()?;
        let tx = self.connection.transaction()?;
        validation::bounds(&tx, &self.limits)?;
        let canonical_id = tx
            .query_row(
                "SELECT canonical_id FROM packages WHERE id=?1",
                [package.0],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| RegistryError::NotFound("package".into()))?;
        let installation = installation(&tx, package)?;
        let ids = artifact_ids(&tx, package, &self.limits)?;
        let mut artifacts = Vec::new();
        for id in ids {
            artifacts.push(artifact_details(&tx, id, &self.limits)?);
        }
        let decisions = decisions::package_decisions(&tx, package, &self.limits)?;
        tx.commit()?;
        Ok(PackageDetails {
            canonical_id,
            installation,
            artifacts,
            decisions,
        })
    }
    pub(crate) fn project_details(&mut self, project: ProjectId) -> Result<ProjectDetails> {
        self.ensure_available()?;
        let tx = self.connection.transaction()?;
        validation::bounds(&tx, &self.limits)?;
        let details = project_details(&tx, project, &self.limits)?;
        tx.commit()?;
        Ok(details)
    }
    pub(crate) fn accept_artifact(
        &mut self,
        prepared: PreparedArtifact,
        receipt: PublicationReceipt,
    ) -> Result<ArtifactFacts> {
        self.mutate(|tx, limits| {
            let facts = accept(tx, &prepared, &receipt, limits)?;
            validation::bounds(tx, limits)?;
            Ok(facts)
        })
    }
    pub(crate) fn change_installation(
        &mut self,
        expected: InstallationExpectation,
        action: InstallationAction,
        target: Option<ArtifactTarget>,
        prerequisites: Option<InstallationPrerequisites>,
    ) -> Result<InstallationSnapshot> {
        self.mutate(|tx, limits| {
        // Check the reviewed state before accepting anything. Rollback also protects
        // new package/history reservations when any later validation fails.
        let existing = match &expected {
            InstallationExpectation::Existing(expected) => {
                check_installation(tx, expected)?;
                Some(expected.clone())
            }
            InstallationExpectation::AbsentPackage(canonical) => {
                let exists: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM packages WHERE canonical_id=?1)",
                    [canonical],
                    |r| r.get(0),
                )?;
                if exists {
                    return Err(RegistryError::Conflict(
                        "package identity now exists".into(),
                    ));
                }
                if !matches!(target, Some(ArtifactTarget::Prepared(_)))
                    || !matches!(action, InstallationAction::Install { .. })
                {
                    return Err(RegistryError::InvalidInput(
                        "new identity requires prepared first install".into(),
                    ));
                }
                None
            }
        };
        let target_facts = match target.as_ref() {
            Some(ArtifactTarget::Accepted(id)) => Some(artifact_facts(tx, *id)?),
            Some(ArtifactTarget::Prepared(prepared)) => {
                Some(accept(tx, &prepared.0, &prepared.1, limits)?)
            }
            None => None,
        };
        let current = match existing {
            Some(current) => current,
            None => {
                let target = target_facts.as_ref().unwrap();
                let canonical: String = tx.query_row(
                    "SELECT canonical_id FROM packages WHERE id=?1",
                    [target.package.0],
                    |r| r.get(0),
                )?;
                if !matches!(&expected, InstallationExpectation::AbsentPackage(id) if id == &canonical)
                {
                    return Err(RegistryError::InvalidInput(
                        "prepared package does not match reviewed identity".into(),
                    ));
                }
                installation(tx, target.package)?
            }
        };
        let transition = transitions::calculate(&current, action, target_facts.as_ref(), |id| {
            artifact_facts(tx, id)
        })?;
        let mut required = Vec::new();
        let fresh = matches!(
            action,
            InstallationAction::Install { select_now: true } | InstallationAction::PromoteStage
        );
        if let Some(target) = &target_facts {
            required.push(target.id);
        }
        if action == InstallationAction::RestorePrevious {
            required.extend(current.pointers.as_ref().and_then(|p| p.previous));
        }
        if action == InstallationAction::PromoteStage {
            if let Some(p) = &current.pointers {
                required.extend(p.staged);
                required.extend(p.pending_repair);
            }
        }
        if fresh || !required.is_empty() {
            prerequisites
                .as_ref()
                .ok_or_else(|| {
                    RegistryError::Conflict("trusted installation prerequisites missing".into())
                })?
                .require(required, fresh)?;
        }
        if transition.pointers == current.pointers {
            // New acceptance may not hide inside a nominal pointer no-op.
            if matches!(target, Some(ArtifactTarget::Prepared(_))) {
                return Err(RegistryError::Conflict(
                    "prepared target did not change installation".into(),
                ));
            }
            return Ok(current);
        }
        let revision = current.revision.next()?;
        write_pointers(tx, current.package, transition.pointers.as_ref())?;
        tx.execute(
            "UPDATE packages SET installation_revision=?1 WHERE id=?2",
            params![revision.0, current.package.0],
        )?;
        if transition.uninstall_cleanup {
            decisions::uninstall_cleanup(tx, current.package)?;
        } else {
            let target = transition
                .pointers
                .as_ref()
                .and_then(|p| p.staged.or(p.selected));
            decisions::invalidate_acknowledgements(tx, current.package, target)?;
            if transition.selection_changed {
                let selected = transition
                    .pointers
                    .as_ref()
                    .and_then(|p| p.selected)
                    .unwrap();
                decisions::selection_cleanup(tx, current.package, selected)?;
                // Only an initial installation may apply manifest suggestions.
                // Existing stable choices are always retained. New update components start disabled.
                let initial = current.pointers.is_none()
                    || current
                        .pointers
                        .as_ref()
                        .is_some_and(|p| p.selected.is_none());
                tx.execute("INSERT INTO component_enablement_defaults(component_id,enabled)
                    SELECT component_id, CASE WHEN ?2 THEN default_enabled ELSE 0 END FROM artifact_components WHERE artifact_id=?1
                    ON CONFLICT(component_id) DO NOTHING", params![selected.0.as_slice(), initial])?;
                decisions::apply_acknowledgements(tx, current.package, selected, limits)?;
            }
        }
        validation::bounds(tx, limits)?;
        Ok(InstallationSnapshot {
            package: current.package,
            revision,
            pointers: transition.pointers,
        })
            })
    }
    pub(crate) fn set_host_settings(
        &mut self,
        expected: HostSettings,
        settings: HostSettings,
    ) -> Result<HostSettings> {
        self.mutate(|tx, limits| {
        if read_settings(tx)? != expected {
            return Err(RegistryError::Conflict("settings changed".into()));
        }
        if settings.permission_mode == PermissionMode::Secure {
            tx.execute(
                "DELETE FROM permission_approvals WHERE source='automatic'",
                [],
            )?;
        }
        tx.execute("UPDATE host_settings SET permission_mode=?1,repair_conflict_policy=?2 WHERE singleton=1", params![
            if settings.permission_mode == PermissionMode::Secure { "secure" } else { "trust" },
            if settings.repair_conflict_policy == RepairConflictPolicy::KeepUpdate { "keep-update" } else { "ask-before-replacing-update" }])?;
        validation::bounds(tx, limits)?;
        Ok(settings)
            })
    }
    pub(crate) fn save_permission_review(&mut self, review: PermissionReview) -> Result<()> {
        self.mutate(|tx, limits| {
            decisions::save_review(tx, review, limits)?;
            validation::bounds(tx, limits)?;
            Ok(())
        })
    }
    pub(crate) fn acknowledge_scope(&mut self, review: ScopeReview) -> Result<()> {
        self.mutate(|tx, limits| {
            decisions::acknowledge(tx, review, limits)?;
            validation::bounds(tx, limits)?;
            Ok(())
        })
    }
    pub(crate) fn set_enablement(&mut self, change: EnablementChange) -> Result<()> {
        self.mutate(|tx, limits| {
            decisions::set_enablement(tx, change)?;
            validation::bounds(tx, limits)?;
            Ok(())
        })
    }
    pub(crate) fn register_project(&mut self, prepared: PreparedProject) -> Result<ProjectId> {
        prepared.validate(&self.limits)?;
        self.mutate(|tx, limits| {
        let l = prepared.location();
        tx.execute("INSERT INTO project_registrations(display_name,path_encoding,path_bytes,directory_identity_scheme,directory_identity_bytes,location_revision) VALUES(?1,?2,?3,?4,?5,1)",
            params![prepared.name(), l.path_encoding,l.path_bytes,l.directory_identity_scheme,l.directory_identity_bytes])?;
        let id = ProjectId(tx.last_insert_rowid());
        validation::bounds(tx, limits)?;
        Ok(id)
            })
    }
    pub(crate) fn relink_project(
        &mut self,
        project: ProjectId,
        expected: Revision,
        prepared: PreparedProject,
        closed: RelinkPrerequisite,
    ) -> Result<Revision> {
        prepared.validate(&self.limits)?;
        closed.check(project, expected)?;
        self.mutate(|tx, limits| {
        check_project_revision(tx, project, expected)?;
        let next = expected.next()?;
        let l = prepared.location();
        tx.execute("UPDATE project_registrations SET display_name=?1,path_encoding=?2,path_bytes=?3,directory_identity_scheme=?4,directory_identity_bytes=?5,location_revision=?6 WHERE id=?7",
            params![prepared.name(),l.path_encoding,l.path_bytes,l.directory_identity_scheme,l.directory_identity_bytes,next.0,project.0])?;
        validation::bounds(tx, limits)?;
        Ok(next)
            })
    }
    /// Refresh requires the same native prepared-location contract as registration.
    pub(crate) fn refresh_project_name(
        &mut self,
        project: ProjectId,
        expected: Revision,
        prepared: PreparedProject,
    ) -> Result<()> {
        prepared.validate(&self.limits)?;
        self.mutate(|tx, limits| {
            check_project_revision(tx, project, expected)?;
            let current = project_details(tx, project, limits)?;
            if current.location != *prepared.location() {
                return Err(RegistryError::Conflict(
                    "validated opening is not current project location".into(),
                ));
            }
            tx.execute(
                "UPDATE project_registrations SET display_name=?1 WHERE id=?2",
                params![prepared.name(), project.0],
            )?;
            validation::bounds(tx, limits)?;
            Ok(())
        })
    }
    pub(crate) fn remove_unused_artifact(
        &mut self,
        artifact: ArtifactId,
        unused: ArtifactUnused,
    ) -> Result<()> {
        unused.check(artifact)?;
        self.mutate(|tx, _limits| {
        artifact_facts(tx, artifact)?;
        let referenced: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM package_installation_state WHERE selected_artifact_id=?1 OR staged_artifact_id=?1 OR previous_artifact_id=?1 OR pending_repair_artifact_id=?1)", [artifact.0.as_slice()], |r| r.get(0))?;
        if referenced {
            return Err(RegistryError::Conflict(
                "artifact remains referenced".into(),
            ));
        }
        for table in [
            "artifact_component_permissions",
            "artifact_package_permissions",
            "artifact_files",
            "artifact_components",
        ] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE artifact_id=?1"),
                [artifact.0.as_slice()],
            )?;
        }
        tx.execute(
            "DELETE FROM accepted_artifacts WHERE id=?1",
            [artifact.0.as_slice()],
        )?;
        Ok(())
            })
    }
    fn ensure_available(&self) -> Result<()> {
        if self.poisoned {
            return Err(RegistryError::Unavailable(
                "registry transaction outcome requires controlled reopening".into(),
            ));
        }
        Ok(())
    }
    fn mutate<T>(
        &mut self,
        operation: impl FnOnce(&Connection, &RegistryLimits) -> Result<T>,
    ) -> Result<T> {
        self.ensure_available()?;
        self.connection.execute_batch("BEGIN IMMEDIATE")?;
        match operation(&self.connection, &self.limits) {
            Ok(value) => {
                if let Err(error) = self.connection.execute_batch("COMMIT") {
                    self.poisoned = true;
                    let _ = self.connection.execute_batch("ROLLBACK");
                    return Err(RegistryError::OutcomeUnknown(format!(
                        "commit outcome could not be established: {error}"
                    )));
                }
                Ok(value)
            }
            Err(error) => {
                // SQLite may already have rolled back after an I/O or ROLLBACK
                // conflict error. Otherwise explicitly establish rollback before
                // preserving any ordinary failure category, including Storage.
                if !self.connection.is_autocommit() {
                    if let Err(rollback) = self.rollback() {
                        self.poisoned = true;
                        return Err(RegistryError::OutcomeUnknown(format!(
                            "operation failed ({error}); rollback not established: {rollback}"
                        )));
                    }
                }
                Err(error)
            }
        }
    }
    fn rollback(&self) -> rusqlite::Result<()> {
        #[cfg(test)]
        if self.fail_rollback {
            return Err(rusqlite::Error::InvalidQuery);
        }
        self.connection.execute_batch("ROLLBACK")
    }
    fn validate_ready(&mut self) -> Result<()> {
        let tx = self.connection.transaction()?;
        validate_snapshot(&tx, &self.limits)?;
        tx.commit()?;
        Ok(())
    }
}
/// Validate one caller-owned database snapshot without starting or ending a
/// transaction. Readiness and restore validation share the complete checks,
/// including integrity-record reconstruction and accepted fingerprint matching.
pub(super) fn validate_snapshot(connection: &Connection, limits: &RegistryLimits) -> Result<()> {
    limits.validate()?;
    validation::preflight(connection, limits)?;
    super::schema::validate_with_limits(connection, limits)?;
    validation::validate(connection, limits)
}
fn destination_lock(path: &Path) -> Result<File> {
    let canonical = path.canonicalize()?;
    let mut name = canonical.into_os_string();
    name.push(".registry-lock");
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(Path::new(&name))?;
    lock.try_lock()
        .map_err(|e| RegistryError::Unavailable(format!("registry ownership: {e}")))?;
    // Never unlink the sidecar: a replacement inode would permit another owner.
    Ok(lock)
}
fn configure(connection: &Connection) -> Result<()> {
    connection.busy_timeout(std::time::Duration::ZERO)?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    )?;
    let fk: i64 = connection.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    let journal: String = connection.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
    let sync: i64 = connection.query_row("PRAGMA synchronous", [], |r| r.get(0))?;
    if fk != 1 || journal != "wal" || sync != 2 {
        return Err(RegistryError::Unavailable(
            "required SQLite durability configuration unavailable".into(),
        ));
    }
    Ok(())
}

fn read_settings(c: &Connection) -> Result<HostSettings> {
    let (mode, policy): (String, String) = c.query_row(
        "SELECT permission_mode,repair_conflict_policy FROM host_settings WHERE singleton=1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(HostSettings {
        permission_mode: match mode.as_str() {
            "secure" => PermissionMode::Secure,
            "trust" => PermissionMode::Trust,
            _ => return Err(corrupt("permission mode")),
        },
        repair_conflict_policy: match policy.as_str() {
            "keep-update" => RepairConflictPolicy::KeepUpdate,
            "ask-before-replacing-update" => RepairConflictPolicy::AskBeforeReplacingUpdate,
            _ => return Err(corrupt("repair policy")),
        },
    })
}
fn corrupt(message: &str) -> RegistryError {
    RegistryError::RecoveryRequired(message.into())
}
fn blob_id(bytes: Vec<u8>) -> Result<ArtifactId> {
    bytes
        .try_into()
        .map(ArtifactId)
        .map_err(|_| corrupt("artifact ID length"))
}
fn digest(bytes: Vec<u8>) -> Result<[u8; 32]> {
    bytes.try_into().map_err(|_| corrupt("fingerprint length"))
}
fn installation(c: &Connection, package: PackageId) -> Result<InstallationSnapshot> {
    let revision = c
        .query_row(
            "SELECT installation_revision FROM packages WHERE id=?1",
            [package.0],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| RegistryError::NotFound("package".into()))?;
    let raw = c.query_row("SELECT selected_artifact_id,staged_artifact_id,previous_artifact_id,pending_repair_artifact_id FROM package_installation_state WHERE package_id=?1", [package.0], |r| Ok((r.get::<_,Option<Vec<u8>>>(0)?,r.get::<_,Option<Vec<u8>>>(1)?,r.get::<_,Option<Vec<u8>>>(2)?,r.get::<_,Option<Vec<u8>>>(3)?))).optional()?;
    let pointers = raw
        .map(|(s, t, p, r)| {
            Ok::<_, RegistryError>(InstallationPointers {
                selected: s.map(blob_id).transpose()?,
                staged: t.map(blob_id).transpose()?,
                previous: p.map(blob_id).transpose()?,
                pending_repair: r.map(blob_id).transpose()?,
            })
        })
        .transpose()?;
    Ok(InstallationSnapshot {
        package,
        revision: Revision(revision),
        pointers,
    })
}
fn check_installation(c: &Connection, expected: &InstallationSnapshot) -> Result<()> {
    if installation(c, expected.package)? != *expected {
        return Err(RegistryError::Conflict(
            "reviewed installation changed".into(),
        ));
    }
    Ok(())
}
fn write_pointers(
    c: &Connection,
    package: PackageId,
    p: Option<&InstallationPointers>,
) -> Result<()> {
    if let Some(p) = p {
        c.execute("INSERT INTO package_installation_state(package_id,selected_artifact_id,staged_artifact_id,previous_artifact_id,pending_repair_artifact_id) VALUES(?1,?2,?3,?4,?5)
            ON CONFLICT(package_id) DO UPDATE SET selected_artifact_id=excluded.selected_artifact_id,staged_artifact_id=excluded.staged_artifact_id,previous_artifact_id=excluded.previous_artifact_id,pending_repair_artifact_id=excluded.pending_repair_artifact_id",
            params![package.0,p.selected.map(|id| id.0.to_vec()),p.staged.map(|id| id.0.to_vec()),p.previous.map(|id| id.0.to_vec()),p.pending_repair.map(|id| id.0.to_vec())])?;
    } else {
        c.execute(
            "DELETE FROM package_installation_state WHERE package_id=?1",
            [package.0],
        )?;
    }
    Ok(())
}
fn artifact_facts(c: &Connection, id: ArtifactId) -> Result<ArtifactFacts> {
    let row = c.query_row("SELECT a.package_id,a.version,h.fingerprint_scheme,h.fingerprint FROM accepted_artifacts a JOIN package_version_history h ON h.package_id=a.package_id AND h.version=a.version WHERE a.id=?1", [id.0.as_slice()], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Vec<u8>>(3)?))).optional()?.ok_or_else(|| RegistryError::NotFound("accepted artifact".into()))?;
    if row.2 != FINGERPRINT_SCHEME {
        return Err(corrupt("unsupported fingerprint scheme"));
    }
    Ok(ArtifactFacts {
        id,
        package: PackageId(row.0),
        version: row.1,
        fingerprint: digest(row.3)?,
    })
}
fn accept(
    c: &Connection,
    prepared: &PreparedArtifact,
    receipt: &PublicationReceipt,
    limits: &RegistryLimits,
) -> Result<ArtifactFacts> {
    receipt.check(prepared)?;
    prepared.check_limits(limits)?;
    let manifest = prepared.manifest();
    let p = &manifest.package;
    let canonical = p.canonical_id();
    let version = p.version.to_string();
    c.execute(
        "INSERT INTO packages(namespace,name) VALUES(?1,?2) ON CONFLICT(canonical_id) DO NOTHING",
        params![p.namespace, p.name],
    )?;
    let package = PackageId(c.query_row(
        "SELECT id FROM packages WHERE canonical_id=?1",
        [&canonical],
        |r| r.get(0),
    )?);
    let fingerprint = prepared.integrity().fingerprint();
    let prior = c.query_row("SELECT fingerprint_scheme,fingerprint FROM package_version_history WHERE package_id=?1 AND version=?2", params![package.0,version], |r| Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?))).optional()?;
    if let Some((scheme, previous)) = prior {
        if scheme != FINGERPRINT_SCHEME {
            return Err(corrupt("unsupported fingerprint scheme"));
        }
        if digest(previous)? != fingerprint {
            return Err(RegistryError::VersionConflict(
                "package release already accepted with different contents".into(),
            ));
        }
    } else {
        c.execute("INSERT INTO package_version_history(package_id,version,fingerprint_scheme,fingerprint) VALUES(?1,?2,?3,?4)",params![package.0,version,FINGERPRINT_SCHEME,fingerprint.as_slice()])?;
    }
    let id = prepared.id();
    let exists: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM accepted_artifacts WHERE id=?1)",
        [id.0.as_slice()],
        |r| r.get(0),
    )?;
    if exists {
        return Err(RegistryError::Conflict(
            "artifact identity already accepted".into(),
        ));
    }
    c.execute("INSERT INTO accepted_artifacts(id,package_id,version,integrity_record_version,storage_layout,display_name,description) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![id.0.as_slice(),package.0,version,prepared.integrity().format_version(),STORAGE_LAYOUT,p.display_name,p.description])?;
    for entry in prepared.integrity().entries() {
        let size = i64::try_from(entry.byte_length).map_err(|_| {
            RegistryError::LimitExceeded("file length cannot fit SQLite integer".into())
        })?;
        c.execute(
            "INSERT INTO artifact_files(artifact_id,path,byte_length,sha256) VALUES(?1,?2,?3,?4)",
            params![id.0.as_slice(), entry.path, size, entry.sha256.as_slice()],
        )?;
    }
    for permission in &p.permissions {
        let (op, res) = permission_sql(permission);
        c.execute("INSERT INTO artifact_package_permissions(artifact_id,operation,resource) VALUES(?1,?2,?3)",params![id.0.as_slice(),op,res])?;
    }
    for component in &manifest.components {
        c.execute("INSERT INTO components(package_id,local_id) VALUES(?1,?2) ON CONFLICT(package_id,local_id) DO NOTHING",params![package.0,component.id])?;
        let component_id: i64 = c.query_row(
            "SELECT id FROM components WHERE package_id=?1 AND local_id=?2",
            params![package.0, component.id],
            |r| r.get(0),
        )?;
        c.execute("INSERT INTO artifact_components(artifact_id,component_id,display_name,description,kind,activation_scope,default_enabled) VALUES(?1,?2,?3,?4,'frontend',?5,?6)",params![id.0.as_slice(),component_id,component.display_name,component.description,scope_sql(component.activation_scope),component.default_enabled])?;
        for permission in &component.permissions {
            let (op, res) = permission_sql(permission);
            c.execute("INSERT INTO artifact_component_permissions(artifact_id,component_id,operation,resource) VALUES(?1,?2,?3,?4)",params![id.0.as_slice(),component_id,op,res])?;
        }
    }
    artifact_facts(c, id)
}
fn permission_sql(p: &crate::plugin_manifest::model::Permission) -> (&'static str, &'static str) {
    permission(p).sql()
}
fn artifact_ids(
    c: &Connection,
    package: PackageId,
    limits: &RegistryLimits,
) -> Result<Vec<ArtifactId>> {
    let mut query =
        c.prepare("SELECT id FROM accepted_artifacts WHERE package_id=?1 ORDER BY id LIMIT ?2")?;
    let values = query
        .query_map(params![package.0, limits.max_rows as i64 + 1], |r| {
            r.get::<_, Vec<u8>>(0)
        })?
        .map(|r| blob_id(r?))
        .collect::<Result<Vec<_>>>()?;
    if values.len() > limits.max_rows {
        return Err(RegistryError::LimitExceeded(
            "artifact snapshot rows".into(),
        ));
    }
    Ok(values)
}
fn requirements(
    c: &Connection,
    artifact: ArtifactId,
    component: ComponentId,
) -> Result<Vec<NativePermission>> {
    let mut query = c.prepare("SELECT operation,resource FROM artifact_package_permissions WHERE artifact_id=?1 UNION SELECT operation,resource FROM artifact_component_permissions WHERE artifact_id=?1 AND component_id=?2 ORDER BY operation,resource LIMIT 4")?;
    let values = query.query_map(params![artifact.0.as_slice(), component.0], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    values
        .map(|r| {
            let (op, res) = r?;
            NativePermission::parse(&op, &res)
        })
        .collect()
}
fn artifact_details(
    c: &Connection,
    id: ArtifactId,
    limits: &RegistryLimits,
) -> Result<ArtifactDetails> {
    let facts = artifact_facts(c, id)?;
    let (version,layout,display_name,description): (u32,String,String,String) = c.query_row("SELECT integrity_record_version,storage_layout,display_name,description FROM accepted_artifacts WHERE id=?1",[id.0.as_slice()],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    if layout != STORAGE_LAYOUT {
        return Err(corrupt("unsupported artifact storage layout"));
    }
    let mut query = c.prepare("SELECT path,byte_length,sha256 FROM artifact_files WHERE artifact_id=?1 ORDER BY path LIMIT ?2")?;
    let entries = query
        .query_map(
            params![
                id.0.as_slice(),
                limits.integrity.max_files.saturating_add(1) as i64
            ],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                ))
            },
        )?
        .map(|r| {
            let (path, byte_length, sha) = r?;
            Ok::<_, RegistryError>(IntegrityEntry {
                path,
                byte_length: u64::try_from(byte_length)
                    .map_err(|_| corrupt("negative stored file length"))?,
                sha256: digest(sha)?,
            })
        });
    let integrity = IntegrityRecord::from_entries(version, entries, &limits.integrity)
        .map_err(|e| corrupt(&format!("invalid stored integrity record: {e:?}")))?;
    if integrity.fingerprint() != facts.fingerprint {
        return Err(corrupt(
            "artifact file-set fingerprint does not match accepted release",
        ));
    }
    if !integrity.entries().any(|e| e.path == "manifest.toml") {
        return Err(corrupt("artifact has no manifest"));
    }
    let mut query = c.prepare("SELECT ac.component_id,c.local_id,ac.display_name,ac.description,ac.activation_scope,ac.default_enabled FROM artifact_components ac JOIN components c ON c.id=ac.component_id WHERE ac.artifact_id=?1 ORDER BY c.id LIMIT ?2")?;
    let mut rows = query.query(params![id.0.as_slice(), limits.max_rows as i64 + 1])?;
    let mut components = Vec::new();
    loop {
        let row = rows.next()?;
        let Some(r) = row else {
            break;
        };
        if components.len() == limits.max_rows {
            return Err(RegistryError::LimitExceeded(
                "component snapshot rows".into(),
            ));
        }
        let component = ComponentId(r.get(0)?);
        components.push(ComponentDeclaration {
            id: component,
            local_id: r.get(1)?,
            display_name: r.get(2)?,
            description: r.get(3)?,
            scope: parse_scope(&r.get::<_, String>(4)?)?,
            default_enabled: r.get(5)?,
            requirements: requirements(c, id, component)?,
            baseline: decisions::baseline(c, component)?,
            acknowledgement: decisions::acknowledgement(c, component)?,
            enabled: c
                .query_row(
                    "SELECT enabled FROM component_enablement_defaults WHERE component_id=?1",
                    [component.0],
                    |r| r.get(0),
                )
                .optional()?,
        });
    }
    if components.is_empty() {
        return Err(corrupt("artifact has no components"));
    }
    Ok(ArtifactDetails {
        facts,
        display_name,
        description,
        integrity,
        components,
    })
}
fn check_project_revision(c: &Connection, project: ProjectId, expected: Revision) -> Result<()> {
    let revision: i64 = c
        .query_row(
            "SELECT location_revision FROM project_registrations WHERE id=?1",
            [project.0],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| RegistryError::NotFound("project registration".into()))?;
    if revision != expected.0 {
        return Err(RegistryError::Conflict("project location changed".into()));
    }
    Ok(())
}
fn project_details(
    c: &Connection,
    project: ProjectId,
    limits: &RegistryLimits,
) -> Result<ProjectDetails> {
    let raw = c.query_row("SELECT display_name,path_encoding,path_bytes,directory_identity_scheme,directory_identity_bytes,location_revision FROM project_registrations WHERE id=?1",[project.0],|r| Ok((r.get(0)?,ProjectLocation { path_encoding:r.get(1)?,path_bytes:r.get(2)?,directory_identity_scheme:r.get(3)?,directory_identity_bytes:r.get(4)? },Revision(r.get(5)?)))).optional()?.ok_or_else(|| RegistryError::NotFound("project registration".into()))?;
    let mut query = c.prepare("SELECT component_id,enabled FROM project_component_overrides WHERE project_registration_id=?1 ORDER BY component_id LIMIT ?2")?;
    let overrides = query
        .query_map(params![project.0, limits.max_rows as i64 + 1], |r| {
            Ok((ComponentId(r.get(0)?), r.get(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if overrides.len() > limits.max_rows {
        return Err(RegistryError::LimitExceeded("project override rows".into()));
    }
    let namespace: Vec<u8> = c.query_row(
        "SELECT identity_namespace FROM registry_metadata WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    let namespace = namespace
        .try_into()
        .map_err(|_| corrupt("invalid logical namespace"))?;
    Ok(ProjectDetails {
        id: project,
        public_id: PublicProjectId::new(namespace, project),
        display_name: raw.0,
        location: raw.1,
        revision: raw.2,
        decisions: decisions::project_decisions(c, project, limits)?,
        overrides,
    })
}
