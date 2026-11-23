use std::collections::BTreeMap;
use std::fmt;

use toml::Value;

use super::model::*;
use super::version::PackageVersionRequirement;
use crate::plugin_integrity::{validate_path, IntegrityLimits, VerifiedPackage};

pub(crate) const MAX_MANIFEST_BYTES: usize = 65_536;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Diagnostics contain bounded field paths and host-controlled messages, never
/// TOML parser diagnostics or complete untrusted values.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ManifestError {
    pub field: String,
    pub message: String,
}

impl ManifestError {
    fn new(field: &str, message: impl Into<String>) -> Self {
        Self {
            field: field.chars().take(512).collect(),
            message: message.into().chars().take(512).collect(),
        }
    }
}

impl fmt::Display for ManifestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.field, self.message)
    }
}

impl std::error::Error for ManifestError {}

type Result<T> = std::result::Result<T, ManifestError>;

/// Parse declarations only, with default portable integrity path budgets.
/// Resource existence and runtime-profile support are separate checks.
pub(crate) fn parse(bytes: &[u8]) -> Result<PackageManifest> {
    parse_with_limits(bytes, &IntegrityLimits::default())
}

pub(crate) fn parse_verified(
    snapshot: &VerifiedPackage,
    limits: &IntegrityLimits,
) -> Result<PackageManifest> {
    let bytes = snapshot
        .file("manifest.toml")
        .ok_or_else(|| ManifestError::new("manifest.toml", "missing from verified snapshot"))?;
    let manifest = parse_with_limits(bytes, limits)?;
    validate_resources(&manifest, |path| snapshot.file(path).is_some())?;
    Ok(manifest)
}

/// Checks literal resource membership only. The predicate conveys no integrity
/// or permission authority; production callers must use a verified snapshot.
pub(crate) fn validate_resources(
    manifest: &PackageManifest,
    contains: impl Fn(&str) -> bool,
) -> Result<()> {
    for (index, component) in manifest.components.iter().enumerate() {
        if !contains(&component.entry) {
            return Err(ManifestError::new(
                &format!("components[{index}].entry"),
                "declared file is missing from snapshot",
            ));
        }
        for (style_index, style) in component.styles.iter().enumerate() {
            if !contains(style) {
                return Err(ManifestError::new(
                    &format!("components[{index}].styles[{style_index}]"),
                    "declared file is missing from snapshot",
                ));
            }
        }
    }
    Ok(())
}

fn parse_with_limits(bytes: &[u8], limits: &IntegrityLimits) -> Result<PackageManifest> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(ManifestError::new("manifest", "exceeds 65536-byte limit"));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| ManifestError::new("manifest", "expected UTF-8 bytes"))?;
    let value: Value = toml::from_str(text).map_err(|error: toml::de::Error| {
        let offset = error.span().map_or(0, |span| span.start).min(bytes.len());
        let prefix = &bytes[..offset];
        let line = prefix.iter().filter(|&&byte| byte == b'\n').count() + 1;
        let column = prefix
            .iter()
            .rposition(|&byte| byte == b'\n')
            .map_or(offset + 1, |last| offset - last);
        ManifestError::new(
            "manifest",
            format!(
                "invalid TOML at line {line}, byte column {column} (duplicate keys are forbidden)"
            ),
        )
    })?;
    let root = Table::new(&value, "", &["manifest_version", "package", "components"])?;
    if root.required("manifest_version")?.as_integer() != Some(1) {
        return Err(root.error("manifest_version", "expected integer manifest version 1"));
    }
    let package = package(root.required("package")?)?;
    let values = root.list("components", true, 32)?;
    if values.is_empty() {
        return Err(root.error("components", "expected 1..32 components"));
    }
    let mut components = Vec::with_capacity(values.len());
    let mut ids = BTreeMap::new();
    for (index, value) in values.iter().enumerate() {
        let path = format!("components[{index}]");
        let component = component(value, &path, limits)?;
        unique(&mut ids, component.id.clone(), index, &format!("{path}.id"))?;
        components.push(component);
    }
    let manifest = PackageManifest {
        package,
        components,
    };
    let package_id = manifest.package.canonical_id();
    for (index, component) in manifest.components.iter().enumerate() {
        if component.activation_scope == ActivationScope::Application
            && manifest
                .effective_permissions(component)
                .iter()
                .any(|permission| permission.resource == PermissionResource::Project)
        {
            return Err(ManifestError::new(
                &format!("components[{index}].permissions"),
                "application components cannot require project-file permissions, including inherited declarations",
            ));
        }
        for (dependency_index, dependency) in component.dependencies.iter().enumerate() {
            let path = format!("components[{index}].dependencies[{dependency_index}]");
            if dependency.package == package_id && dependency.component == component.id {
                return Err(ManifestError::new(&path, "self-dependency is forbidden"));
            }
            if dependency.binding == DependencyBinding::SelectedProject
                && (!dependency.optional
                    || component.activation_scope != ActivationScope::Application)
            {
                return Err(ManifestError::new(
                    &format!("{path}.binding"),
                    "selected-project requires an application consumer and optional = true",
                ));
            }
        }
    }
    Ok(manifest)
}

struct Table<'a> {
    values: &'a toml::Table,
    path: String,
}

impl<'a> Table<'a> {
    fn new(value: &'a Value, path: &str, allowed: &[&str]) -> Result<Self> {
        let values = value
            .as_table()
            .ok_or_else(|| ManifestError::new(path, "expected table"))?;
        let table = Self {
            values,
            path: path.to_owned(),
        };
        for key in values.keys() {
            if !allowed.contains(&key.as_str()) {
                // Bound and escape arbitrary keys before inserting them in paths.
                let key: String = key
                    .chars()
                    .take(64)
                    .flat_map(char::escape_default)
                    .take(128)
                    .collect();
                return Err(table.error(&key, "unsupported field"));
            }
        }
        Ok(table)
    }

    fn field(&self, name: &str) -> String {
        if self.path.is_empty() {
            name.to_owned()
        } else {
            format!("{}.{name}", self.path)
        }
    }

    fn error(&self, name: &str, message: impl Into<String>) -> ManifestError {
        ManifestError::new(&self.field(name), message)
    }

    fn required(&self, name: &str) -> Result<&'a Value> {
        self.values
            .get(name)
            .ok_or_else(|| self.error(name, "required field is missing"))
    }

    fn string(&self, name: &str) -> Result<String> {
        self.required(name)?
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| self.error(name, "expected string"))
    }

    fn optional_string(&self, name: &str) -> Result<Option<String>> {
        if self.values.contains_key(name) {
            Ok(Some(self.string(name)?))
        } else {
            Ok(None)
        }
    }

    fn boolean(&self, name: &str, default: bool) -> Result<bool> {
        match self.values.get(name) {
            Some(value) => value
                .as_bool()
                .ok_or_else(|| self.error(name, "expected boolean")),
            None => Ok(default),
        }
    }

    fn list(&self, name: &str, required: bool, max: usize) -> Result<&'a [Value]> {
        let Some(value) = self.values.get(name) else {
            if required {
                return Err(self.error(name, "required array is missing"));
            }
            return Ok(&[]);
        };
        let values = value
            .as_array()
            .ok_or_else(|| self.error(name, "expected array"))?;
        if values.len() > max {
            return Err(self.error(name, format!("exceeds {max}-entry limit")));
        }
        Ok(values)
    }

    fn text(&self, name: &str, max: usize) -> Result<String> {
        let value = self.string(name)?;
        nonwhite(&value, &self.field(name), max)?;
        Ok(value)
    }

    fn machine(&self, name: &str) -> Result<String> {
        let value = self.string(name)?;
        machine(&value, &self.field(name))?;
        Ok(value)
    }

    fn major(&self) -> Result<u64> {
        let value = self
            .required("major")?
            .as_integer()
            .ok_or_else(|| self.error("major", "expected positive safe integer"))?;
        if !(1..=MAX_SAFE_INTEGER).contains(&value) {
            return Err(self.error("major", "expected positive safe integer"));
        }
        Ok(value as u64)
    }
}

fn nonwhite(value: &str, path: &str, max: usize) -> Result<()> {
    if value.len() > max {
        return Err(ManifestError::new(
            path,
            format!("{} UTF-8 bytes exceeds {max}-byte limit", value.len()),
        ));
    }
    if value.trim().is_empty() {
        return Err(ManifestError::new(
            path,
            "expected nonempty, non-whitespace string",
        ));
    }
    Ok(())
}

fn machine(value: &str, path: &str) -> Result<()> {
    nonwhite(value, path, 256)?;
    if !value.split('-').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    }) {
        return Err(ManifestError::new(
            path,
            "expected lowercase ASCII letter/digit groups separated by single hyphens",
        ));
    }
    Ok(())
}

fn package_reference(value: &str, path: &str) -> Result<()> {
    if let Some(scoped) = value.strip_prefix('@') {
        let (namespace, name) = scoped.split_once('/').ok_or_else(|| {
            ManifestError::new(path, "expected canonical @namespace/name or unscoped name")
        })?;
        machine(namespace, path)?;
        machine(name, path)
    } else {
        machine(value, path)
    }
}

fn unique<K: Ord>(seen: &mut BTreeMap<K, usize>, key: K, index: usize, path: &str) -> Result<()> {
    if let Some(previous) = seen.get(&key) {
        return Err(ManifestError::new(
            path,
            format!(
                "duplicate declaration; conflicts with list entry [{previous}] (current [{index}])"
            ),
        ));
    }
    seen.insert(key, index);
    Ok(())
}

fn package(value: &Value) -> Result<PackageMetadata> {
    let table = Table::new(
        value,
        "package",
        &[
            "namespace",
            "name",
            "display_name",
            "version",
            "description",
            "permissions",
        ],
    )?;
    let namespace = table.optional_string("namespace")?;
    if let Some(namespace) = &namespace {
        machine(namespace, "package.namespace")?;
    }
    let version = semver::Version::parse(&table.string("version")?)
        .map_err(|_| table.error("version", "expected SemVer 2.0.0 release version"))?;
    Ok(PackageMetadata {
        namespace,
        name: table.machine("name")?,
        display_name: table.text("display_name", 1024)?,
        version,
        description: table.text("description", 4096)?,
        permissions: permissions(&table)?,
    })
}

fn component(value: &Value, path: &str, limits: &IntegrityLimits) -> Result<Component> {
    let table = Table::new(
        value,
        path,
        &[
            "id",
            "display_name",
            "description",
            "kind",
            "entry",
            "styles",
            "runtime_profile",
            "activation_scope",
            "default_enabled",
            "capabilities",
            "provides",
            "commands",
            "dependencies",
            "permissions",
        ],
    )?;
    let kind = match table.string("kind")?.as_str() {
        "frontend" => ComponentKind::Frontend,
        _ => return Err(table.error("kind", "expected frontend")),
    };
    let activation_scope = match table.string("activation_scope")?.as_str() {
        "project" => ActivationScope::Project,
        "application" => ActivationScope::Application,
        _ => return Err(table.error("activation_scope", "expected project or application")),
    };
    let entry = table.string("entry")?;
    resource_path(&entry, &table.field("entry"), &[".js", ".mjs"], limits)?;
    let mut styles = Vec::new();
    for (index, value) in table.list("styles", false, 16)?.iter().enumerate() {
        let path = format!("{path}.styles[{index}]");
        let style = value
            .as_str()
            .ok_or_else(|| ManifestError::new(&path, "expected string"))?;
        resource_path(style, &path, &[".css"], limits)?;
        styles.push(style.to_owned());
    }
    let mut capabilities = Vec::new();
    let mut seen = BTreeMap::new();
    for (index, value) in table.list("capabilities", true, 3)?.iter().enumerate() {
        let path = format!("{path}.capabilities[{index}]");
        let capability = match value.as_str() {
            Some("contributions.toolbar") => Capability::Toolbar,
            Some("contributions.view") => Capability::View,
            Some("contributions.command") => Capability::Command,
            Some(_) => {
                return Err(ManifestError::new(
                    &path,
                    "unsupported contribution capability",
                ))
            }
            None => return Err(ManifestError::new(&path, "expected string")),
        };
        unique(&mut seen, capability, index, &path)?;
        capabilities.push(capability);
    }
    let mut commands = Vec::new();
    let mut seen = BTreeMap::new();
    for (index, value) in table.list("commands", false, 32)?.iter().enumerate() {
        let path = format!("{path}.commands[{index}]");
        let command = Table::new(value, &path, &["id", "contract", "major"])?;
        let id = command.text("id", 256)?;
        unique(&mut seen, id.clone(), index, &command.field("id"))?;
        commands.push(CommandDeclaration {
            id,
            contract: command.text("contract", 256)?,
            major: command.major()?,
        });
    }
    let mut dependencies = Vec::new();
    let mut aliases = BTreeMap::new();
    let mut targets = BTreeMap::new();
    for (index, value) in table.list("dependencies", false, 64)?.iter().enumerate() {
        let path = format!("{path}.dependencies[{index}]");
        let dependency = dependency(value, &path)?;
        unique(
            &mut aliases,
            dependency.alias.clone(),
            index,
            &format!("{path}.alias"),
        )?;
        unique(
            &mut targets,
            (
                dependency.package.clone(),
                dependency.component.clone(),
                dependency.binding,
            ),
            index,
            &path,
        )?;
        dependencies.push(dependency);
    }
    Ok(Component {
        id: table.machine("id")?,
        display_name: table.text("display_name", 1024)?,
        description: table.text("description", 4096)?,
        kind,
        entry,
        styles,
        // Unknown profiles remain valid declarations for compatibility analysis.
        runtime_profile: table.text("runtime_profile", MAX_MANIFEST_BYTES)?,
        activation_scope,
        default_enabled: table.boolean("default_enabled", false)?,
        capabilities,
        provides: apis(&table, "provides")?,
        commands,
        dependencies,
        permissions: permissions(&table)?,
    })
}

fn resource_path(
    value: &str,
    path: &str,
    extensions: &[&str],
    limits: &IntegrityLimits,
) -> Result<()> {
    validate_path(value, limits).map_err(|_| {
        ManifestError::new(
            path,
            "expected portable package-relative path within integrity path/depth limits",
        )
    })?;
    if !extensions
        .iter()
        .any(|extension| value.ends_with(extension))
    {
        return Err(ManifestError::new(
            path,
            format!(
                "expected exact lowercase {} extension",
                extensions.join(" or ")
            ),
        ));
    }
    Ok(())
}

fn apis(table: &Table<'_>, name: &str) -> Result<Vec<ApiContract>> {
    let mut apis = Vec::new();
    let mut seen = BTreeMap::new();
    for (index, value) in table.list(name, false, 32)?.iter().enumerate() {
        let path = format!("{}[{index}]", table.field(name));
        let api = Table::new(value, &path, &["id", "major"])?;
        let api = ApiContract {
            id: api.text("id", 256)?,
            major: api.major()?,
        };
        unique(&mut seen, api.clone(), index, &path)?;
        apis.push(api);
    }
    Ok(apis)
}

fn dependency(value: &Value, path: &str) -> Result<Dependency> {
    let table = Table::new(
        value,
        path,
        &[
            "alias",
            "package",
            "component",
            "version",
            "optional",
            "binding",
            "apis",
            "commands",
        ],
    )?;
    let package = table.string("package")?;
    package_reference(&package, &table.field("package"))?;
    let binding = match table
        .optional_string("binding")?
        .as_deref()
        .unwrap_or("instance")
    {
        "instance" => DependencyBinding::Instance,
        "selected-project" => DependencyBinding::SelectedProject,
        _ => return Err(table.error("binding", "expected instance or selected-project")),
    };
    let version = table
        .optional_string("version")?
        .map(|version| {
            PackageVersionRequirement::parse(&version).map_err(|_| {
                table.error(
                    "version",
                    "expected exact SemVer or whitespace-separated comparison range",
                )
            })
        })
        .transpose()?;
    let mut commands = Vec::new();
    let mut seen = BTreeMap::new();
    for (index, value) in table.list("commands", false, 32)?.iter().enumerate() {
        let path = format!("{path}.commands[{index}]");
        let command = Table::new(value, &path, &["alias", "id", "contract", "major"])?;
        let alias = command.text("alias", 256)?;
        unique(&mut seen, alias.clone(), index, &command.field("alias"))?;
        commands.push(RequiredCommand {
            alias,
            id: command.text("id", 256)?,
            contract: command.text("contract", 256)?,
            major: command.major()?,
        });
    }
    Ok(Dependency {
        alias: table.machine("alias")?,
        package,
        component: table.machine("component")?,
        version,
        optional: table.boolean("optional", false)?,
        binding,
        apis: apis(&table, "apis")?,
        commands,
    })
}

fn permissions(table: &Table<'_>) -> Result<Vec<Permission>> {
    let mut permissions = Vec::new();
    let mut seen = BTreeMap::new();
    for (index, value) in table.list("permissions", false, 3)?.iter().enumerate() {
        let path = format!("{}.permissions[{index}]", table.path);
        let permission = Table::new(value, &path, &["operation", "resource"])?;
        let operation = match permission.string("operation")?.as_str() {
            "project.files.list" => PermissionOperation::ProjectFilesList,
            "project.files.read" => PermissionOperation::ProjectFilesRead,
            "external.open" => PermissionOperation::ExternalOpen,
            _ => return Err(permission.error("operation", "unsupported permission operation")),
        };
        let resource = match permission.string("resource")?.as_str() {
            "project" => PermissionResource::Project,
            "http-https" => PermissionResource::HttpHttps,
            _ => return Err(permission.error("resource", "unsupported permission resource")),
        };
        if !matches!(
            (operation, resource),
            (
                PermissionOperation::ProjectFilesList | PermissionOperation::ProjectFilesRead,
                PermissionResource::Project
            ) | (
                PermissionOperation::ExternalOpen,
                PermissionResource::HttpHttps
            )
        ) {
            return Err(ManifestError::new(
                &path,
                "unsupported operation/resource pair",
            ));
        }
        let permission = Permission {
            operation,
            resource,
        };
        unique(&mut seen, permission.clone(), index, &path)?;
        permissions.push(permission);
    }
    Ok(permissions)
}
