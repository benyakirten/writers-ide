use super::model::*;
use super::resolve::*;
use super::version::PackageVersionRequirement;

const PROFILE: &str = "writers-ide.frontend/1";

fn component(id: &str) -> Component {
    Component {
        id: id.into(),
        display_name: id.into(),
        description: "Test component".into(),
        kind: ComponentKind::Frontend,
        entry: "index.js".into(),
        styles: vec![],
        runtime_profile: PROFILE.into(),
        activation_scope: ActivationScope::Project,
        default_enabled: false,
        capabilities: vec![],
        provides: vec![],
        commands: vec![],
        dependencies: vec![],
        permissions: vec![],
    }
}

fn package(name: &str, components: Vec<Component>) -> PackageManifest {
    PackageManifest {
        package: PackageMetadata {
            namespace: None,
            name: name.into(),
            display_name: name.into(),
            version: "1.2.3".parse().unwrap(),
            description: "Test package".into(),
            permissions: vec![],
        },
        components,
    }
}

fn dependency(alias: &str, package: &str, component: &str) -> Dependency {
    Dependency {
        alias: alias.into(),
        package: package.into(),
        component: component.into(),
        version: None,
        optional: false,
        binding: DependencyBinding::Instance,
        apis: vec![],
        commands: vec![],
    }
}

fn identity(package: &str, component: &str) -> ComponentIdentity {
    ComponentIdentity {
        package: package.into(),
        component: component.into(),
    }
}

fn find<'a>(result: &'a Resolution, package: &str, component: &str) -> &'a ResolvedComponent {
    result
        .components
        .iter()
        .find(|c| c.identity == identity(package, component))
        .unwrap()
}

fn analyze(catalog: &[PackageManifest]) -> Resolution {
    resolve(catalog, &[PROFILE]).unwrap()
}

#[test]
fn canonical_identity_and_order_are_independent_of_catalog_and_declaration_order() {
    let mut consumer = component("a-consumer");
    consumer.dependencies = vec![
        dependency("z-local", "consumer", "z-local"),
        dependency("a-other", "@example/provider", "provider"),
    ];
    let local = component("z-local");
    let mut provider = package("provider", vec![component("provider")]);
    provider.package.namespace = Some("example".into());
    let mut catalog = vec![package("consumer", vec![consumer, local]), provider];
    let first = analyze(&catalog);
    assert_eq!(
        first.required_order,
        vec![
            identity("@example/provider", "provider"),
            identity("consumer", "z-local"),
            identity("consumer", "a-consumer")
        ]
    );
    assert_eq!(
        find(&first, "consumer", "a-consumer").dependencies[0]
            .declaration
            .alias,
        "a-other"
    );
    catalog.reverse();
    for manifest in &mut catalog {
        manifest.components.reverse();
        for component in &mut manifest.components {
            component.dependencies.reverse();
            component.default_enabled = true;
        }
    }
    // Default enablement is deliberately not part of the static result.
    assert_eq!(first, analyze(&catalog));
}

#[test]
fn duplicate_catalogs_fail_without_choosing_a_version_or_registration() {
    let a = package("same", vec![component("x")]);
    let mut b = a.clone();
    b.package.version = "9.0.0".parse().unwrap();
    assert_eq!(
        resolve(&[a.clone(), b.clone()], &[PROFILE]),
        Err(CatalogError::Package("same".into()))
    );
    assert_eq!(
        resolve(&[b, a], &[PROFILE]),
        Err(CatalogError::Package("same".into()))
    );
    assert_eq!(
        resolve(
            &[package("same", vec![component("x"), component("x")])],
            &[PROFILE]
        ),
        Err(CatalogError::Component(identity("same", "x")))
    );
    let mut c = component("consumer");
    c.dependencies = vec![
        dependency("same", "p", "one"),
        dependency("same", "p", "two"),
    ];
    assert!(matches!(
        resolve(&[package("p", vec![c])], &[PROFILE]),
        Err(CatalogError::Alias { .. })
    ));
    // No reserved namespace or built-in package identity exists in resolution.
    let mut namespaced = package("same", vec![component("x")]);
    namespaced.package.namespace = Some("writers-ide".into());
    assert_eq!(
        analyze(&[package("same", vec![component("x")]), namespaced])
            .required_order
            .len(),
        2
    );
}

#[test]
fn all_instance_scope_combinations_and_selected_project_bindings() {
    for consumer_scope in [ActivationScope::Project, ActivationScope::Application] {
        for provider_scope in [ActivationScope::Project, ActivationScope::Application] {
            for binding in [
                DependencyBinding::Instance,
                DependencyBinding::SelectedProject,
            ] {
                for optional in [false, true] {
                    let mut consumer = component("a-consumer");
                    consumer.activation_scope = consumer_scope;
                    let mut dep = dependency("provider", "p", "z-provider");
                    dep.binding = binding;
                    dep.optional = optional;
                    consumer.dependencies.push(dep);
                    let mut provider = component("z-provider");
                    provider.activation_scope = provider_scope;
                    let result = analyze(&[package("p", vec![consumer, provider])]);
                    let consumer = find(&result, "p", "a-consumer");
                    let dep = &consumer.dependencies[0];
                    let expected = match (binding, consumer_scope, provider_scope, optional) {
                        (
                            DependencyBinding::Instance,
                            ActivationScope::Project,
                            ActivationScope::Project,
                            _,
                        ) => Some(ResolvedBinding::SameProjectOpening),
                        (DependencyBinding::Instance, _, ActivationScope::Application, _) => {
                            Some(ResolvedBinding::SameWindow)
                        }
                        (
                            DependencyBinding::SelectedProject,
                            ActivationScope::Application,
                            ActivationScope::Project,
                            true,
                        ) => Some(ResolvedBinding::SelectedProjectLease),
                        _ => None,
                    };
                    assert_eq!(dep.binding, expected);
                    assert_eq!(
                        dep.issues.contains(&DependencyIssue::InvalidBinding),
                        expected.is_none()
                    );
                    assert_eq!(consumer.eligible(), optional || expected.is_some());
                    if optional {
                        // No optional edge imposes direct provider-first ordering.
                        assert_eq!(result.required_order[0], identity("p", "a-consumer"));
                    } else if expected.is_some() {
                        assert_eq!(result.required_order[0], identity("p", "z-provider"));
                    }
                }
            }
        }
    }
}

#[test]
fn every_api_major_and_command_triple_is_required_with_exact_case() {
    let api = |id: &str, major| ApiContract {
        id: id.into(),
        major,
    };
    let mut provider = component("provider");
    provider.provides = vec![api("api", 1), api("api", 2)];
    provider.commands = vec![
        CommandDeclaration {
            id: "run".into(),
            contract: "task".into(),
            major: 1,
        },
        CommandDeclaration {
            id: "stop".into(),
            contract: "task".into(),
            major: 2,
        },
    ];
    let mut consumer = component("consumer");
    let mut dep = dependency("provider", "p", "provider");
    dep.apis = vec![api("api", 1), api("api", 2)];
    dep.commands = vec![
        RequiredCommand {
            alias: "go".into(),
            id: "run".into(),
            contract: "task".into(),
            major: 1,
        },
        RequiredCommand {
            alias: "end".into(),
            id: "stop".into(),
            contract: "task".into(),
            major: 2,
        },
    ];
    consumer.dependencies.push(dep);
    assert!(find(
        &analyze(&[package("p", vec![consumer.clone(), provider.clone()])]),
        "p",
        "consumer"
    )
    .eligible());
    provider.provides.pop();
    provider.commands[0].id = "Run".into();
    provider.commands[1].contract = "Task".into();
    let result = analyze(&[package("p", vec![consumer.clone(), provider.clone()])]);
    let issues = &find(&result, "p", "consumer").dependencies[0].issues;
    assert_eq!(issues.len(), 3);
    assert!(issues.contains(&DependencyIssue::MissingApi(api("api", 2))));
    assert!(!find(&result, "p", "consumer").eligible());
    // Same id and contract, wrong major still fails.
    provider.commands[0].id = "run".into();
    provider.commands[0].major = 2;
    consumer.dependencies[0].optional = true;
    let result = analyze(&[package("p", vec![consumer, provider])]);
    let consumer = find(&result, "p", "consumer");
    assert!(consumer.eligible());
    assert!(consumer.dependencies[0]
        .issues
        .contains(&DependencyIssue::MissingCommand {
            id: "run".into(),
            contract: "task".into(),
            major: 1
        }));
}

#[test]
fn package_versions_use_parent_requirement_semantics_independently_of_contracts() {
    for (version, requirement, compatible) in [
        ("1.2.3", None, true),
        ("1.2.3-beta.2", None, true),
        ("1.2.3-beta.2", Some("1.2.3-beta.2"), true),
        ("1.2.3-beta.2", Some(">=1.0.0 <2.0.0"), false),
        ("1.2.3", Some(">=1.0.0 <2.0.0"), true),
        ("2.0.0", Some(">=1.0.0 <2.0.0"), false),
        ("1.2.3+installed", Some("1.2.3+requested"), true),
    ] {
        let mut consumer = component("consumer");
        let mut dep = dependency("provider", "provider", "provider");
        dep.version = requirement.map(|r| PackageVersionRequirement::parse(r).unwrap());
        consumer.dependencies.push(dep);
        let mut provider = package("provider", vec![component("provider")]);
        provider.package.version = version.parse().unwrap();
        let result = analyze(&[provider, package("consumer", vec![consumer])]);
        let consumer = find(&result, "consumer", "consumer");
        assert_eq!(consumer.eligible(), compatible, "{version} {requirement:?}");
        assert_eq!(
            consumer.dependencies[0]
                .issues
                .contains(&DependencyIssue::VersionMismatch),
            !compatible
        );
    }
}

#[test]
fn missing_and_unsupported_providers_propagate_only_through_required_edges() {
    let mut unsupported = component("unsupported");
    unsupported.runtime_profile = "future/9".into();
    let mut required = component("required");
    required
        .dependencies
        .push(dependency("unsupported", "p", "unsupported"));
    let mut transitive = component("transitive");
    transitive
        .dependencies
        .push(dependency("required", "p", "required"));
    let mut optional = component("optional");
    optional.dependencies = vec![
        dependency("blocked", "p", "required"),
        dependency("absent-package", "missing", "x"),
        dependency("absent-component", "p", "x"),
    ];
    for dep in &mut optional.dependencies {
        dep.optional = true;
    }
    let mut missing = component("missing");
    missing
        .dependencies
        .push(dependency("missing", "absent", "provider"));
    let mut missing_dependent = component("missing-dependent");
    missing_dependent
        .dependencies
        .push(dependency("missing", "p", "missing"));
    let result = analyze(&[package(
        "p",
        vec![
            unsupported,
            required,
            transitive,
            optional,
            missing,
            missing_dependent,
            component("healthy"),
        ],
    )]);
    for name in [
        "unsupported",
        "required",
        "transitive",
        "missing",
        "missing-dependent",
    ] {
        assert!(!find(&result, "p", name).eligible(), "{name}");
    }
    assert_eq!(
        result.required_order,
        vec![identity("p", "healthy"), identity("p", "optional")]
    );
    let optional = find(&result, "p", "optional");
    assert_eq!(
        optional.dependencies[0].issues,
        vec![DependencyIssue::MissingComponent]
    );
    assert_eq!(
        optional.dependencies[1].issues,
        vec![DependencyIssue::MissingPackage]
    );
    assert_eq!(
        optional.dependencies[2].issues,
        vec![DependencyIssue::ProviderBlocked]
    );
    // Host support is supplied, not hardcoded to the initial runtime profile.
    let mut future = component("future");
    future.runtime_profile = "future/9".into();
    assert!(resolve(&[package("p", vec![future])], &["future/9"])
        .unwrap()
        .components[0]
        .eligible());
}

#[test]
fn required_cross_package_cycles_block_dependents_but_preserve_healthy_siblings() {
    let mut a = component("a");
    a.dependencies.push(dependency("b", "b", "b"));
    let mut b = component("b");
    b.dependencies.push(dependency("a", "a", "a"));
    let mut dependent = component("dependent");
    dependent.dependencies.push(dependency("a", "a", "a"));
    let mut optional = component("optional");
    let mut dep = dependency("a", "a", "a");
    dep.optional = true;
    optional.dependencies.push(dep);
    let mut catalog = vec![
        package("b", vec![b, component("healthy")]),
        package("a", vec![a, dependent, optional]),
    ];
    let result = analyze(&catalog);
    assert_eq!(
        result.required_cycles,
        vec![vec![identity("a", "a"), identity("b", "b")]]
    );
    assert_eq!(
        result.required_order,
        vec![identity("a", "optional"), identity("b", "healthy")]
    );
    assert!(find(&result, "a", "a")
        .blockers
        .contains(&ComponentBlocker::RequiredCycle(0)));
    assert!(!find(&result, "a", "dependent").eligible());
    assert_eq!(
        find(&result, "a", "optional").dependencies[0].issues,
        vec![DependencyIssue::ProviderBlocked]
    );
    catalog.reverse();
    assert_eq!(result, analyze(&catalog));
}

#[test]
fn multiple_sccs_and_optional_blocked_provider_metadata_are_deterministic() {
    let mut a = component("a");
    a.dependencies = vec![dependency("b", "b", "b"), dependency("c", "c", "c")];
    let mut b = component("b");
    b.dependencies.push(dependency("a", "a", "a"));
    let mut c = component("c");
    c.dependencies.push(dependency("d", "d", "d"));
    let mut d = component("d");
    d.dependencies.push(dependency("c", "c", "c"));

    let mut optional = component("optional");
    let mut blocked_a = dependency("blocked-a", "a", "a");
    blocked_a.optional = true;
    blocked_a.apis.push(ApiContract {
        id: "missing".into(),
        major: 1,
    });
    let mut blocked_c = dependency("blocked-c", "c", "c");
    blocked_c.optional = true;
    optional.dependencies = vec![blocked_c, blocked_a];
    let mut selected = component("selected");
    selected.activation_scope = ActivationScope::Application;
    let mut integration = dependency("selected-a", "a", "a");
    integration.optional = true;
    integration.binding = DependencyBinding::SelectedProject;
    selected.dependencies.push(integration);
    let mut dependent = component("dependent");
    dependent
        .dependencies
        .push(dependency("optional", "a", "optional"));
    let mut catalog = vec![
        package("d", vec![d]),
        package("b", vec![b]),
        package("a", vec![selected, a, optional, dependent]),
        package("c", vec![c]),
    ];
    let expected = analyze(&catalog);
    assert_eq!(
        expected.required_cycles,
        vec![
            vec![identity("a", "a"), identity("b", "b")],
            vec![identity("c", "c"), identity("d", "d")],
        ]
    );
    for (package, component, index) in [("a", "a", 0), ("b", "b", 0), ("c", "c", 1), ("d", "d", 1)]
    {
        assert!(find(&expected, package, component)
            .blockers
            .contains(&ComponentBlocker::RequiredCycle(index)));
    }
    let optional = find(&expected, "a", "optional");
    assert!(optional.eligible());
    assert_eq!(
        optional.dependencies[0].issues,
        vec![
            DependencyIssue::MissingApi(ApiContract {
                id: "missing".into(),
                major: 1
            }),
            DependencyIssue::ProviderBlocked,
        ]
    );
    assert_eq!(
        optional.dependencies[1].issues,
        vec![DependencyIssue::ProviderBlocked]
    );
    let selected = find(&expected, "a", "selected");
    assert!(selected.eligible());
    assert_eq!(
        selected.dependencies[0].binding,
        Some(ResolvedBinding::SelectedProjectLease)
    );
    assert_eq!(
        selected.dependencies[0].issues,
        vec![DependencyIssue::ProviderBlocked]
    );
    assert_eq!(
        expected.required_order,
        vec![
            identity("a", "optional"),
            identity("a", "dependent"),
            identity("a", "selected")
        ]
    );

    for _ in 0..8 {
        catalog.rotate_left(1);
        for manifest in &mut catalog {
            manifest.components.reverse();
            for component in &mut manifest.components {
                component.dependencies.reverse();
            }
        }
        assert_eq!(expected, analyze(&catalog));
    }
}

#[test]
fn optional_cycles_are_compatible_but_even_optional_self_dependencies_are_rejected() {
    let mut a = component("a");
    let mut b = component("b");
    let mut ab = dependency("b", "p", "b");
    ab.optional = true;
    let mut ba = dependency("a", "p", "a");
    ba.optional = true;
    a.dependencies.push(ab);
    b.dependencies.push(ba);
    let result = analyze(&[package("p", vec![a, b])]);
    assert_eq!(
        result.required_order,
        vec![identity("p", "a"), identity("p", "b")]
    );
    assert!(result.required_cycles.is_empty());
    assert!(result
        .components
        .iter()
        .all(|c| c.dependencies[0].issues.is_empty()));
    for optional in [true, false] {
        let mut a = component("a");
        let mut dep = dependency("self", "p", "a");
        dep.optional = optional;
        a.dependencies.push(dep);
        let result = analyze(&[package("p", vec![a, component("healthy")])]);
        assert!(!find(&result, "p", "a").eligible());
        assert!(find(&result, "p", "a").dependencies[0]
            .issues
            .contains(&DependencyIssue::SelfDependency));
        assert_eq!(result.required_order, vec![identity("p", "healthy")]);
    }
}

#[test]
fn deep_chains_and_large_cycles_use_iterative_walks_and_shared_cycle_diagnostics() {
    // A test stress size, not a production catalog limit. Separate packages
    // preserve the parser's per-manifest component-count invariant.
    let count = 12_000;
    let mut catalog = Vec::with_capacity(count);
    for index in 0..count {
        let mut c = component("c");
        if index > 0 {
            c.dependencies
                .push(dependency("previous", &format!("p-{:05}", index - 1), "c"));
        }
        catalog.push(package(&format!("p-{index:05}"), vec![c]));
    }
    catalog.reverse();
    let result = analyze(&catalog);
    assert_eq!(result.required_order.len(), count);
    assert_eq!(result.required_order[0], identity("p-00000", "c"));
    assert_eq!(result.required_order[count - 1], identity("p-11999", "c"));
    let mut first = catalog.pop().unwrap();
    first.components[0]
        .dependencies
        .push(dependency("last", "p-11999", "c"));
    catalog.push(first);
    let cycle = analyze(&catalog);
    assert!(cycle.required_order.is_empty());
    assert_eq!(cycle.required_cycles.len(), 1);
    assert_eq!(cycle.required_cycles[0].len(), count);
    assert!(cycle.components.iter().all(|c| c
        .blockers
        .iter()
        .filter(|b| matches!(b, ComponentBlocker::RequiredCycle(0)))
        .count()
        == 1));
}

#[test]
fn empty_catalog_is_a_valid_empty_analysis() {
    assert_eq!(
        resolve(&[], &[]).unwrap(),
        Resolution {
            components: vec![],
            required_order: vec![],
            required_cycles: vec![]
        }
    );
}
