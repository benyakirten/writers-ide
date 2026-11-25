//! Preparation is synchronous host work outside the database queue. None of the
//! private proof values below is a plugin credential or an implemented publisher.
use super::{
    error::{RegistryError, Result},
    model::*,
};
use crate::plugin_integrity::{IntegrityRecord, VerifiedPackage};
use crate::plugin_manifest::{
    model::{PackageManifest, PermissionOperation},
    parse::parse_verified,
};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

pub(crate) const STORAGE_LAYOUT: &str = "writers-ide.artifact-store/1";
pub(crate) const FINGERPRINT_SCHEME: &str = "writers-ide.file-set/1";

#[derive(Debug)]
pub(crate) struct PreparedArtifact {
    id: ArtifactId,
    destination: PathBuf,
    manifest: PackageManifest,
    integrity: IntegrityRecord,
}
impl PreparedArtifact {
    pub(crate) fn from_verified(
        snapshot: &VerifiedPackage,
        artifact_store: &Path,
        limits: &RegistryLimits,
    ) -> Result<Self> {
        limits.validate()?;
        let manifest = parse_verified(snapshot, &limits.integrity)
            .map_err(|e| RegistryError::InvalidInput(e.to_string()))?;
        let integrity = snapshot
            .integrity_record(&limits.integrity)
            .map_err(|e| RegistryError::InvalidInput(e.to_string()))?;
        let mut id = [0; 16];
        getrandom::fill(&mut id)
            .map_err(|e| RegistryError::Unavailable(format!("artifact randomness: {e}")))?;
        let id = ArtifactId(id);
        let destination = artifact_store.join("v1").join(hex_id(id));
        let prepared = Self {
            id,
            destination,
            manifest,
            integrity,
        };
        prepared.check_limits(limits)?;
        Ok(prepared)
    }
    pub(crate) fn id(&self) -> ArtifactId {
        self.id
    }
    pub(crate) fn destination(&self) -> &Path {
        &self.destination
    }
    pub(super) fn manifest(&self) -> &PackageManifest {
        &self.manifest
    }
    pub(super) fn integrity(&self) -> &IntegrityRecord {
        &self.integrity
    }
    pub(super) fn check_limits(&self, limits: &RegistryLimits) -> Result<()> {
        if self.manifest.components.len() > limits.max_rows {
            return Err(RegistryError::LimitExceeded("component count".into()));
        }
        let p = &self.manifest.package;
        for text in [
            &p.name,
            &p.display_name,
            &p.description,
            &p.version.to_string(),
        ] {
            check_text(text, limits.max_text_bytes)?;
        }
        if let Some(ns) = &p.namespace {
            check_text(ns, limits.max_text_bytes)?;
        }
        for c in &self.manifest.components {
            for text in [&c.id, &c.display_name, &c.description] {
                check_text(text, limits.max_text_bytes)?;
            }
        }
        // Revalidate against the committing host's limits, which may differ from preparation.
        IntegrityRecord::from_entries(
            self.integrity.format_version(),
            self.integrity
                .entries()
                .map(Ok::<_, std::convert::Infallible>),
            &limits.integrity,
        )
        .map_err(|e| RegistryError::InvalidInput(format!("integrity: {e:?}")))?;
        Ok(())
    }
}
fn hex_id(id: ArtifactId) -> String {
    id.0.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug)]
pub(crate) struct PublicationReceipt {
    artifact: ArtifactId,
    fingerprint: [u8; 32],
    destination: PathBuf,
}
impl PublicationReceipt {
    pub(super) fn check(&self, prepared: &PreparedArtifact) -> Result<()> {
        if self.artifact != prepared.id
            || self.fingerprint != prepared.integrity.fingerprint()
            || self.destination != prepared.destination
        {
            return Err(RegistryError::InvalidInput(
                "publication receipt does not match prepared artifact and destination".into(),
            ));
        }
        Ok(())
    }
    // A production constructor must live with the future durable publisher. Do
    // not expose a boolean-based substitute for filesystem publication.
    #[cfg(test)]
    pub(crate) fn for_test(prepared: &PreparedArtifact) -> Self {
        Self {
            artifact: prepared.id,
            fingerprint: prepared.integrity.fingerprint(),
            destination: prepared.destination.clone(),
        }
    }
}

/// The future host must bind successful package-fatal verification and import
/// tracking to these exact artifacts. Component profile support is deliberately
/// not a package-level prerequisite.
#[derive(Debug)]
pub(crate) struct InstallationPrerequisites {
    verified: BTreeSet<ArtifactId>,
    no_prior_import: bool,
}
impl InstallationPrerequisites {
    pub(super) fn require(
        &self,
        artifacts: impl IntoIterator<Item = ArtifactId>,
        fresh: bool,
    ) -> Result<()> {
        if (fresh && !self.no_prior_import)
            || artifacts.into_iter().any(|id| !self.verified.contains(&id))
        {
            return Err(RegistryError::Conflict(
                "missing exact verification or process eligibility prerequisite".into(),
            ));
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn for_test(
        verified: impl IntoIterator<Item = ArtifactId>,
        no_prior_import: bool,
    ) -> Self {
        Self {
            verified: verified.into_iter().collect(),
            no_prior_import,
        }
    }
}

/// Complete encoded location supplied by future trusted native preparation.
/// Construction remains gated until native encodings and alias checks exist.
#[derive(Debug)]
pub(crate) struct PreparedProject {
    name: String,
    location: ProjectLocation,
}
impl PreparedProject {
    pub(super) fn name(&self) -> &str {
        &self.name
    }
    pub(super) fn location(&self) -> &ProjectLocation {
        &self.location
    }
    pub(super) fn validate(&self, limits: &RegistryLimits) -> Result<()> {
        check_label(&self.name, limits.max_text_bytes)?;
        check_label(&self.location.path_encoding, limits.max_text_bytes)?;
        check_label(
            &self.location.directory_identity_scheme,
            limits.max_text_bytes,
        )?;
        for bytes in [
            &self.location.path_bytes,
            &self.location.directory_identity_bytes,
        ] {
            if bytes.is_empty() || bytes.len() > limits.max_location_bytes {
                return Err(RegistryError::InvalidInput(
                    "invalid encoded project location length".into(),
                ));
            }
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn for_test(name: String, location: ProjectLocation) -> Self {
        Self { name, location }
    }
}
#[derive(Debug)]
pub(crate) struct RelinkPrerequisite {
    project: ProjectId,
    revision: Revision,
}
impl RelinkPrerequisite {
    pub(super) fn check(&self, project: ProjectId, revision: Revision) -> Result<()> {
        if self.project != project || self.revision != revision {
            return Err(RegistryError::Conflict(
                "closed-project prerequisite mismatch".into(),
            ));
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn for_test(project: ProjectId, revision: Revision) -> Self {
        Self { project, revision }
    }
}
#[derive(Debug)]
pub(crate) struct ArtifactUnused {
    artifact: ArtifactId,
}
impl ArtifactUnused {
    pub(super) fn check(&self, artifact: ArtifactId) -> Result<()> {
        if self.artifact != artifact {
            return Err(RegistryError::Conflict(
                "artifact runtime-use prerequisite mismatch".into(),
            ));
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn for_test(artifact: ArtifactId) -> Self {
        Self { artifact }
    }
}
/// Match manifest display metadata: non-whitespace content and a UTF-8 byte bound.
pub(super) fn check_text(text: &str, maximum: usize) -> Result<()> {
    if text.trim().is_empty() || text.len() > maximum {
        return Err(RegistryError::InvalidInput(
            "invalid nonwhite text or byte bound".into(),
        ));
    }
    Ok(())
}
/// Prepared native-location labels retain their separate single-line contract.
pub(super) fn check_label(text: &str, maximum: usize) -> Result<()> {
    check_text(text, maximum)?;
    if text.chars().any(char::is_control) {
        return Err(RegistryError::InvalidInput(
            "invalid control character in location label".into(),
        ));
    }
    Ok(())
}
pub(super) fn permission(p: &crate::plugin_manifest::model::Permission) -> NativePermission {
    match p.operation {
        PermissionOperation::ProjectFilesList => NativePermission::ProjectFilesList,
        PermissionOperation::ProjectFilesRead => NativePermission::ProjectFilesRead,
        PermissionOperation::ExternalOpen => NativePermission::ExternalOpen,
    }
}
