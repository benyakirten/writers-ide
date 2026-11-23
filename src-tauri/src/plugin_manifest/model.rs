use std::collections::BTreeSet;

use super::version::PackageVersionRequirement;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PackageManifest {
    pub package: PackageMetadata,
    pub components: Vec<Component>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PackageMetadata {
    pub namespace: Option<String>,
    pub name: String,
    pub display_name: String,
    pub version: semver::Version,
    pub description: String,
    pub permissions: Vec<Permission>,
}

impl PackageMetadata {
    pub fn canonical_id(&self) -> String {
        match &self.namespace {
            Some(namespace) => format!("@{namespace}/{}", self.name),
            None => self.name.clone(),
        }
    }
}

impl PackageManifest {
    /// Effective declarations only. This neither represents nor issues grants.
    pub fn effective_permissions(&self, component: &Component) -> Vec<Permission> {
        self.package
            .permissions
            .iter()
            .chain(&component.permissions)
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Component {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub kind: ComponentKind,
    pub entry: String,
    pub styles: Vec<String>,
    pub runtime_profile: String,
    pub activation_scope: ActivationScope,
    pub default_enabled: bool,
    pub capabilities: Vec<Capability>,
    pub provides: Vec<ApiContract>,
    pub commands: Vec<CommandDeclaration>,
    pub dependencies: Vec<Dependency>,
    pub permissions: Vec<Permission>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ComponentKind {
    Frontend,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ActivationScope {
    Project,
    Application,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Capability {
    Toolbar,
    View,
    Command,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ApiContract {
    pub id: String,
    pub major: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CommandDeclaration {
    pub id: String,
    pub contract: String,
    pub major: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Dependency {
    pub alias: String,
    pub package: String,
    pub component: String,
    pub version: Option<PackageVersionRequirement>,
    pub optional: bool,
    pub binding: DependencyBinding,
    pub apis: Vec<ApiContract>,
    pub commands: Vec<RequiredCommand>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum DependencyBinding {
    Instance,
    SelectedProject,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RequiredCommand {
    pub alias: String,
    pub id: String,
    pub contract: String,
    pub major: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Permission {
    pub operation: PermissionOperation,
    pub resource: PermissionResource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum PermissionOperation {
    ProjectFilesList,
    ProjectFilesRead,
    ExternalOpen,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum PermissionResource {
    Project,
    HttpHttps,
}
