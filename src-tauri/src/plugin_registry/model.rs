use crate::plugin_integrity::{IntegrityLimits, IntegrityRecord};
pub(crate) use crate::plugin_manifest::model::ActivationScope;

use super::error::{RegistryError, Result};

/// All budgets are supplied by the host. There are deliberately no release defaults.
#[derive(Clone, Debug)]
pub(crate) struct RegistryLimits {
    pub integrity: IntegrityLimits,
    pub max_rows: usize,
    pub max_snapshot_bytes: usize,
    pub max_text_bytes: usize,
    pub max_location_bytes: usize,
    pub max_review_items: usize,
}
impl RegistryLimits {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.max_rows == 0
            || self.max_rows >= i64::MAX as usize
            || self.max_snapshot_bytes == 0
            || self.max_snapshot_bytes > i64::MAX as usize
            || self.max_text_bytes > i64::MAX as usize
            || self.max_location_bytes > i64::MAX as usize
            || self.integrity.max_files >= i64::MAX as usize
            || self.max_text_bytes == 0
            || self.max_location_bytes == 0
            || self.max_review_items == 0
            || self.integrity.max_files == 0
            || self.integrity.max_file_bytes > i64::MAX as u64
            || self.integrity.max_total_bytes > i64::MAX as u64
        {
            return Err(RegistryError::InvalidInput(
                "invalid registry budgets".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PackageId(pub i64);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ComponentId(pub i64);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ProjectId(pub i64);
/// Opaque logical identity. No author-facing text or native-path encoding is defined.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicProjectId {
    namespace: [u8; 16],
    registration: ProjectId,
}
impl PublicProjectId {
    pub(super) fn new(namespace: [u8; 16], registration: ProjectId) -> Self {
        Self {
            namespace,
            registration,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ArtifactId(pub [u8; 16]);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Revision(pub i64);
impl Revision {
    pub(crate) fn next(self) -> Result<Self> {
        if self.0 < 1 {
            return Err(RegistryError::RecoveryRequired("invalid revision".into()));
        }
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or_else(|| RegistryError::LimitExceeded("revision exhausted".into()))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct InstallationPointers {
    pub selected: Option<ArtifactId>,
    pub staged: Option<ArtifactId>,
    pub previous: Option<ArtifactId>,
    pub pending_repair: Option<ArtifactId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InstallationSnapshot {
    pub package: PackageId,
    pub revision: Revision,
    pub pointers: Option<InstallationPointers>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ArtifactFacts {
    pub id: ArtifactId,
    pub package: PackageId,
    pub version: String,
    pub fingerprint: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PermissionMode {
    Secure,
    Trust,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RepairConflictPolicy {
    KeepUpdate,
    AskBeforeReplacingUpdate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HostSettings {
    pub permission_mode: PermissionMode,
    pub repair_conflict_policy: RepairConflictPolicy,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum NativePermission {
    ProjectFilesList,
    ProjectFilesRead,
    ExternalOpen,
}
impl NativePermission {
    pub(crate) fn sql(self) -> (&'static str, &'static str) {
        match self {
            Self::ProjectFilesList => ("project.files.list", "project"),
            Self::ProjectFilesRead => ("project.files.read", "project"),
            Self::ExternalOpen => ("external.open", "http-https"),
        }
    }
    pub(crate) fn parse(operation: &str, resource: &str) -> Result<Self> {
        match (operation, resource) {
            ("project.files.list", "project") => Ok(Self::ProjectFilesList),
            ("project.files.read", "project") => Ok(Self::ProjectFilesRead),
            ("external.open", "http-https") => Ok(Self::ExternalOpen),
            _ => Err(RegistryError::RecoveryRequired(
                "unrecognized native permission".into(),
            )),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Coverage {
    Application,
    Project(ProjectId),
}
impl Coverage {
    pub(crate) fn sql(self) -> (&'static str, Option<i64>) {
        match self {
            Self::Application => ("application", None),
            Self::Project(id) => ("project", Some(id.0)),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ApprovalSource {
    Explicit,
    Automatic,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DecisionKey {
    pub component: ComponentId,
    pub permission: NativePermission,
    pub coverage: Coverage,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PermissionDecision {
    pub key: DecisionKey,
    pub approval: Option<ApprovalSource>,
    pub denied: bool,
    pub recovered: Option<(bool, bool)>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PermissionEffect {
    ApproveExplicit,
    /// Approval and separately confirmed denial clearing commit together.
    ApproveExplicitAndClearDenial,
    ApproveAutomatic,
    Deny,
    ClearApproval,
    ClearDenial,
}
#[derive(Clone, Debug)]
pub(crate) struct PermissionReviewItem {
    pub key: DecisionKey,
    pub expected: PermissionDecision,
    pub effect: PermissionEffect,
    /// This is deliberate review, not a side effect of automatic Trust processing.
    pub consume_recovered: bool,
}
#[derive(Clone, Debug)]
pub(crate) struct PermissionReview {
    pub installation: InstallationSnapshot,
    /// Approvals require a selected or staged declaration. Retained denial and
    /// clearing operations need no artifact after uninstall and cleanup.
    pub target: Option<ArtifactId>,
    pub expected_settings: HostSettings,
    pub items: Vec<PermissionReviewItem>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScopeBaseline {
    pub scope: ActivationScope,
    pub revision: Revision,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScopeAcknowledgement {
    pub component: ComponentId,
    pub target_version: String,
    pub baseline: Option<ScopeBaseline>,
    pub target_scope: ActivationScope,
}
#[derive(Clone, Debug)]
pub(crate) struct ScopeReview {
    pub installation: InstallationSnapshot,
    pub target: ArtifactId,
    pub acknowledgement: ScopeAcknowledgement,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ScopeBlocker {
    InitialReview,
    ScopeChange,
}
pub(crate) fn scope_blocker(
    scope: ActivationScope,
    baseline: Option<&ScopeBaseline>,
) -> Option<ScopeBlocker> {
    match baseline {
        None => Some(ScopeBlocker::InitialReview),
        Some(baseline) if baseline.scope != scope => Some(ScopeBlocker::ScopeChange),
        Some(_) => None,
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ComponentDeclaration {
    pub id: ComponentId,
    pub local_id: String,
    pub display_name: String,
    pub description: String,
    pub scope: ActivationScope,
    pub default_enabled: bool,
    pub requirements: Vec<NativePermission>,
    pub baseline: Option<ScopeBaseline>,
    pub acknowledgement: Option<ScopeAcknowledgement>,
    pub enabled: Option<bool>,
}
#[derive(Clone, Debug)]
pub(crate) struct ArtifactDetails {
    pub facts: ArtifactFacts,
    pub display_name: String,
    pub description: String,
    pub integrity: IntegrityRecord,
    pub components: Vec<ComponentDeclaration>,
}
#[derive(Clone, Debug)]
pub(crate) struct PackageDetails {
    pub canonical_id: String,
    pub installation: InstallationSnapshot,
    pub artifacts: Vec<ArtifactDetails>,
    pub decisions: Vec<PermissionDecision>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectLocation {
    pub path_encoding: String,
    pub path_bytes: Vec<u8>,
    pub directory_identity_scheme: String,
    pub directory_identity_bytes: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectDetails {
    pub id: ProjectId,
    pub public_id: PublicProjectId,
    pub display_name: String,
    pub location: ProjectLocation,
    pub revision: Revision,
    pub decisions: Vec<PermissionDecision>,
    pub overrides: Vec<(ComponentId, bool)>,
}
#[derive(Clone, Debug)]
pub(crate) struct EnablementChange {
    pub installation: InstallationSnapshot,
    pub target: ArtifactId,
    pub component: ComponentId,
    pub project: Option<ProjectId>,
    pub expected: Option<bool>,
    /// None means Inherit for a project override. Application choices cannot be removed.
    pub enabled: Option<bool>,
}

pub(crate) fn scope_sql(scope: ActivationScope) -> &'static str {
    match scope {
        ActivationScope::Project => "project",
        ActivationScope::Application => "application",
    }
}
pub(crate) fn parse_scope(value: &str) -> Result<ActivationScope> {
    match value {
        "project" => Ok(ActivationScope::Project),
        "application" => Ok(ActivationScope::Application),
        _ => Err(RegistryError::RecoveryRequired(
            "unrecognized activation scope".into(),
        )),
    }
}
/// Coverage only. This function does not establish activation or native authority.
pub(crate) fn permission_covered(
    mode: PermissionMode,
    component: ComponentId,
    permission: NativePermission,
    project: Option<ProjectId>,
    decisions: &[PermissionDecision],
) -> bool {
    let applies = |d: &&PermissionDecision| {
        d.key.component == component
            && d.key.permission == permission
            && (d.key.coverage == Coverage::Application
                || project.is_some_and(|p| d.key.coverage == Coverage::Project(p)))
    };
    if decisions.iter().filter(applies).any(|d| d.denied) {
        return false;
    }
    decisions.iter().filter(applies).any(|d| {
        d.approval == Some(ApprovalSource::Explicit)
            || (mode == PermissionMode::Trust && d.approval == Some(ApprovalSource::Automatic))
    })
}
