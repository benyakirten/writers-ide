//! Static installed-candidate analysis only. Eligibility is neither enablement,
//! live availability nor authorization. No project opening is selected here.
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::model::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ComponentIdentity {
    pub package: String,
    pub component: String,
}

/// Duplicate catalog entries that prevent unambiguous static resolution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CatalogError {
    Package(String),
    Component(ComponentIdentity),
    Alias {
        consumer: ComponentIdentity,
        alias: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResolvedBinding {
    SameProjectOpening,
    SameWindow,
    /// Requires a caller-supplied live project and explicit connection lease.
    /// This is a possible integration, never direct availability.
    SelectedProjectLease,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum DependencyIssue {
    MissingPackage,
    MissingComponent,
    SelfDependency,
    VersionMismatch,
    InvalidBinding,
    MissingApi(ApiContract),
    MissingCommand {
        id: String,
        contract: String,
        major: u64,
    },
    ProviderBlocked,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedDependency {
    pub declaration: Dependency,
    pub provider: ComponentIdentity,
    pub binding: Option<ResolvedBinding>,
    /// Empty means statically compatible, not active or authorized. In
    /// particular, SelectedProjectLease still needs a live project connection.
    pub issues: Vec<DependencyIssue>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ComponentBlocker {
    UnsupportedProfile(String),
    SelfDependency(String),
    RequiredDependency(String),
    /// Index into Resolution::required_cycles, shared to avoid quadratic output.
    RequiredCycle(usize),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedComponent {
    pub identity: ComponentIdentity,
    pub blockers: Vec<ComponentBlocker>,
    pub dependencies: Vec<ResolvedDependency>,
}

impl ResolvedComponent {
    pub(crate) fn eligible(&self) -> bool {
        self.blockers.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Resolution {
    /// Canonical identity order; dependencies are sorted by local alias.
    pub components: Vec<ResolvedComponent>,
    /// Eligible components only. Required providers precede their consumers.
    /// Optional edges, including selected-project integrations, impose no order.
    pub required_order: Vec<ComponentIdentity>,
    /// Strongly connected required groups, with members and groups sorted by
    /// identity. A group describes a cycle, not an invented linear cycle path.
    pub required_cycles: Vec<Vec<ComponentIdentity>>,
}

/// Analyze one installed candidate per canonical package identity. Inputs must
/// be normalized manifests from the parser. Duplicate catalog identities are
/// rejected, never resolved by input/registration order.
///
/// This synchronous function uses heap-backed iterative graph walks. Graph
/// storage is O(V + E), plus declarations and diagnostics. Ordered maps/sets add
/// logarithmic lookup costs; contract checks scan each provider's declarations.
/// Callers must budget aggregate catalog work or move it off a latency-sensitive
/// thread. Per-manifest parser limits are not an aggregate graph limit; this
/// function does not invent a production catalog size cap.
pub(crate) fn resolve(
    catalog: &[PackageManifest],
    supported_profiles: &[&str],
) -> Result<Resolution, CatalogError> {
    let mut packages = BTreeMap::new();
    let mut duplicates = BTreeSet::new();
    for manifest in catalog {
        let id = manifest.package.canonical_id();
        let previous_manifest = packages.insert(id.clone(), manifest);
        if previous_manifest.is_some() {
            duplicates.insert(id);
        }
    }
    let duplicate_package = duplicates.into_iter().next();
    if let Some(id) = duplicate_package {
        return Err(CatalogError::Package(id));
    }
    let mut nodes = BTreeMap::new();
    let mut duplicate_components = BTreeSet::new();
    for (package, manifest) in &packages {
        for component in &manifest.components {
            let identity = ComponentIdentity {
                package: package.clone(),
                component: component.id.clone(),
            };
            let previous_component = nodes.insert(identity.clone(), (*manifest, component));
            if previous_component.is_some() {
                duplicate_components.insert(identity);
            }
        }
    }
    let duplicate_component = duplicate_components.into_iter().next();
    if let Some(identity) = duplicate_component {
        return Err(CatalogError::Component(identity));
    }
    let identities: Vec<_> = nodes.keys().cloned().collect();
    let indices: BTreeMap<_, _> = identities
        .iter()
        .cloned()
        .enumerate()
        .map(|(i, id)| (id, i))
        .collect();
    let sources: Vec<_> = nodes.values().copied().collect();
    let count = sources.len();
    let mut components = Vec::with_capacity(count);
    let mut graph = vec![Vec::new(); count];
    let mut reverse = vec![Vec::new(); count];
    for (index, (_, component)) in sources.iter().enumerate() {
        let mut blockers = Vec::new();
        if !supported_profiles.contains(&component.runtime_profile.as_str()) {
            blockers.push(ComponentBlocker::UnsupportedProfile(
                component.runtime_profile.clone(),
            ));
        }
        let mut declarations: Vec<_> = component.dependencies.iter().collect();
        declarations.sort_by(|a, b| a.alias.cmp(&b.alias));
        let mut dependencies = Vec::new();
        let mut previous_alias: Option<&str> = None;
        for dependency in declarations {
            if previous_alias == Some(dependency.alias.as_str()) {
                return Err(CatalogError::Alias {
                    consumer: identities[index].clone(),
                    alias: dependency.alias.clone(),
                });
            }
            previous_alias = Some(&dependency.alias);
            let provider = ComponentIdentity {
                package: dependency.package.clone(),
                component: dependency.component.clone(),
            };
            let mut issues = Vec::new();
            let mut binding = None;
            if provider == identities[index] {
                issues.push(DependencyIssue::SelfDependency);
                blockers.push(ComponentBlocker::SelfDependency(dependency.alias.clone()));
            }
            if let Some(&target) = indices.get(&provider) {
                let (provider_package, provider_component) = sources[target];
                binding = resolve_binding(
                    component.activation_scope,
                    provider_component.activation_scope,
                    dependency,
                );
                if binding.is_none() {
                    issues.push(DependencyIssue::InvalidBinding);
                }
                if let Some(requirement) = &dependency.version {
                    if !requirement.matches(&provider_package.package.version) {
                        issues.push(DependencyIssue::VersionMismatch);
                    }
                }
                for api in &dependency.apis {
                    if !provider_component.provides.contains(api) {
                        issues.push(DependencyIssue::MissingApi(api.clone()));
                    }
                }
                for command in &dependency.commands {
                    if !provider_component.commands.iter().any(|provided| {
                        provided.id == command.id
                            && provided.contract == command.contract
                            && provided.major == command.major
                    }) {
                        issues.push(DependencyIssue::MissingCommand {
                            id: command.id.clone(),
                            contract: command.contract.clone(),
                            major: command.major,
                        });
                    }
                }
                if !dependency.optional {
                    graph[index].push(target);
                    reverse[target].push(index);
                }
            } else if packages.contains_key(&provider.package) {
                issues.push(DependencyIssue::MissingComponent);
            } else {
                issues.push(DependencyIssue::MissingPackage);
            }
            issues.sort();
            issues.dedup();
            if !dependency.optional && !issues.is_empty() {
                blockers.push(ComponentBlocker::RequiredDependency(
                    dependency.alias.clone(),
                ));
            }
            dependencies.push(ResolvedDependency {
                declaration: dependency.clone(),
                provider,
                binding,
                issues,
            });
        }
        graph[index].sort_unstable();
        graph[index].dedup();
        components.push(ResolvedComponent {
            identity: identities[index].clone(),
            blockers,
            dependencies,
        });
    }
    // Multiple aliases can point at one provider in direct model inputs.
    for consumers in &mut reverse {
        consumers.sort_unstable();
        consumers.dedup();
    }
    let groups = required_cycle_groups(&graph, &reverse);
    let mut required_cycles = Vec::new();
    for group in groups {
        let cycle_index = required_cycles.len();
        for &member in &group {
            components[member]
                .blockers
                .push(ComponentBlocker::RequiredCycle(cycle_index));
        }
        required_cycles.push(group.iter().map(|&i| identities[i].clone()).collect());
    }
    let mut blocked: Vec<_> = components.iter().map(|c| !c.eligible()).collect();
    let mut queue: VecDeque<_> = blocked
        .iter()
        .enumerate()
        .filter_map(|(i, &b)| b.then_some(i))
        .collect();
    while !queue.is_empty() {
        let provider = queue.pop_front().expect("nonempty queue");
        for &consumer in &reverse[provider] {
            if !blocked[consumer] {
                blocked[consumer] = true;
                queue.push_back(consumer);
            }
        }
    }
    for component in &mut components {
        for dependency in &mut component.dependencies {
            if let Some(&target) = indices.get(&dependency.provider) {
                if blocked[target] {
                    dependency.issues.push(DependencyIssue::ProviderBlocked);
                    if !dependency.declaration.optional {
                        let reason = ComponentBlocker::RequiredDependency(
                            dependency.declaration.alias.clone(),
                        );
                        if !component.blockers.contains(&reason) {
                            component.blockers.push(reason);
                        }
                    }
                }
            }
        }
    }
    let mut remaining: Vec<_> = graph.iter().map(Vec::len).collect();
    let mut ready: BTreeSet<_> = (0..count)
        .filter(|&i| !blocked[i] && remaining[i] == 0)
        .collect();
    let mut required_order = Vec::new();
    while !ready.is_empty() {
        let provider = ready.pop_first().expect("nonempty ready set");
        required_order.push(identities[provider].clone());
        for &consumer in &reverse[provider] {
            remaining[consumer] -= 1;
            if !blocked[consumer] && remaining[consumer] == 0 {
                ready.insert(consumer);
            }
        }
    }
    Ok(Resolution {
        components,
        required_order,
        required_cycles,
    })
}

fn resolve_binding(
    consumer: ActivationScope,
    provider: ActivationScope,
    dependency: &Dependency,
) -> Option<ResolvedBinding> {
    match (dependency.binding, consumer, provider) {
        (
            DependencyBinding::SelectedProject,
            ActivationScope::Application,
            ActivationScope::Project,
        ) if dependency.optional => Some(ResolvedBinding::SelectedProjectLease),
        (DependencyBinding::Instance, ActivationScope::Project, ActivationScope::Project) => {
            Some(ResolvedBinding::SameProjectOpening)
        }
        (DependencyBinding::Instance, _, ActivationScope::Application) => {
            Some(ResolvedBinding::SameWindow)
        }
        _ => None,
    }
}

// Iterative Kosaraju traversal. Store each cyclic SCC once, rather than copying
// a long cycle path into every component's diagnostics.
fn required_cycle_groups(graph: &[Vec<usize>], reverse: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut seen = vec![false; graph.len()];
    let mut finish = Vec::with_capacity(graph.len());
    for root in 0..graph.len() {
        if seen[root] {
            continue;
        }
        seen[root] = true;
        let mut stack = vec![(root, 0)];
        while !stack.is_empty() {
            let (node, edge) = *stack.last().expect("nonempty traversal");
            if edge < graph[node].len() {
                stack.last_mut().expect("nonempty traversal").1 += 1;
                let target = graph[node][edge];
                if !seen[target] {
                    seen[target] = true;
                    stack.push((target, 0));
                }
            } else {
                stack.pop();
                finish.push(node);
            }
        }
    }
    seen.fill(false);
    let mut groups = Vec::new();
    for root in finish.into_iter().rev() {
        if seen[root] {
            continue;
        }
        seen[root] = true;
        let mut stack = vec![root];
        let mut group = Vec::new();
        // Repository rules keep mutations, including stack.pop(), out of conditions.
        #[allow(clippy::manual_while_let_some)]
        while !stack.is_empty() {
            let node = stack.pop().expect("nonempty traversal");
            group.push(node);
            for &target in &reverse[node] {
                if !seen[target] {
                    seen[target] = true;
                    stack.push(target);
                }
            }
        }
        if group.len() > 1 || graph[root].contains(&root) {
            group.sort_unstable();
            groups.push(group);
        }
    }
    groups.sort();
    groups
}
