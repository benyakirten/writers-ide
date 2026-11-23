use super::model::*;
use super::parse::{parse, parse_verified, validate_resources, ManifestError, MAX_MANIFEST_BYTES};
use crate::plugin_integrity::{create_record, verify_package, IntegrityLimits};

const PACKAGE: &str = r#"manifest_version = 1
[package]
name = "sample"
display_name = "Sample"
version = "1.2.3"
description = "A sample package."
"#;
const COMPONENT: &str = r#"
[[components]]
id = "main"
display_name = "Main"
description = "A sample component."
kind = "frontend"
entry = "dist/main.js"
runtime_profile = "writers-ide.frontend/1"
activation_scope = "project"
capabilities = []
"#;

fn source() -> String {
    format!("{PACKAGE}{COMPONENT}")
}

fn parsed(text: &str) -> PackageManifest {
    parse(text.as_bytes()).unwrap()
}

fn rejected(text: &str, field: &str) -> ManifestError {
    let error = parse(text.as_bytes()).unwrap_err();
    assert_eq!(error.field, field, "{error}");
    assert!(error.field.len() <= 512);
    assert!(error.message.len() <= 512);
    error
}

fn dependency(extra: &str) -> String {
    format!("\n[[components.dependencies]]\nalias = \"provider\"\npackage = \"@example/services\"\ncomponent = \"service\"\n{extra}\n")
}

#[test]
fn complete_documentation_manifests_parse() {
    let documentation = include_str!("../../../docs/plugins/package-api-proposal.md");
    let examples: Vec<_> = documentation
        .split("```toml\n")
        .skip(1)
        .map(|block| block.split("```").next().unwrap())
        .filter(|block| block.starts_with("manifest_version = 1\n"))
        .collect();
    assert_eq!(examples.len(), 2);
    let menu = parsed(examples[0]);
    assert_eq!(menu.package.canonical_id(), "@writers-ide/basic-menu");
    assert_eq!(menu.components[0].dependencies[0].alias, "editor");
    assert!(menu.components[0].dependencies[0].version.is_some());
    assert!(menu.components[0].default_enabled);
    let research = parsed(examples[1]);
    assert_eq!(research.package.canonical_id(), "@example/research");
    assert_eq!(
        research
            .effective_permissions(&research.components[0])
            .len(),
        3
    );
}

#[test]
fn absent_only_defaults_and_normalized_identity() {
    let manifest = parsed(&source());
    assert_eq!(manifest.package.canonical_id(), "sample");
    assert_eq!(manifest.package.version, semver::Version::new(1, 2, 3));
    let component = &manifest.components[0];
    assert_eq!(component.kind, ComponentKind::Frontend);
    assert!(!component.default_enabled);
    assert!(component.styles.is_empty());
    assert!(component.capabilities.is_empty());
    assert!(component.provides.is_empty());
    assert!(component.commands.is_empty());
    assert!(component.dependencies.is_empty());
    assert!(manifest.effective_permissions(component).is_empty());
    let manifest = parsed(&(source() + &dependency("")));
    let dependency = &manifest.components[0].dependencies[0];
    assert_eq!(dependency.binding, DependencyBinding::Instance);
    assert!(!dependency.optional);
    assert!(dependency.version.is_none());
    assert!(dependency.apis.is_empty());
    assert!(dependency.commands.is_empty());
    let unsupported = source().replace("writers-ide.frontend/1", "future.profile/999");
    assert_eq!(
        parsed(&unsupported).components[0].runtime_profile,
        "future.profile/999"
    );
}

#[test]
fn whole_input_budget_precedes_utf8_and_toml() {
    let mut exact = source().into_bytes();
    exact.resize(MAX_MANIFEST_BYTES, b' ');
    assert!(parse(&exact).is_ok());
    exact.push(0xff);
    assert!(parse(&exact).unwrap_err().message.contains("65536"));
    assert!(parse(&[0xff]).unwrap_err().message.contains("UTF-8"));
    rejected(&(source() + "id = \"duplicate\"\n"), "manifest");
}

#[test]
fn deeply_nested_invalid_values_are_rejected_without_recursing_through_the_schema() {
    let arrays = format!(
        "manifest_version = {}0{}",
        "[".repeat(2000),
        "]".repeat(2000)
    );
    rejected(&arrays, "manifest");
    let dotted = format!("{}value = 1", "nested.".repeat(1000));
    assert!(parse(dotted.as_bytes()).is_err());
}

#[test]
fn syntax_diagnostics_include_location_without_echoing_source_values() {
    let input = "manifest_version = 1\nsecret = \"DO-NOT-ECHO\"\nsecret = 2\n";
    let error = rejected(input, "manifest");
    assert!(error.message.contains("line"));
    assert!(error.message.contains("column"));
    assert!(!error.to_string().contains("DO-NOT-ECHO"));
}

#[test]
fn strict_root_version_and_required_fields() {
    for value in ["0", "2", "-1", "\"1\"", "1.0", "true", "[]", "{}"] {
        rejected(
            &source().replace(
                "manifest_version = 1",
                &format!("manifest_version = {value}"),
            ),
            "manifest_version",
        );
    }
    rejected(
        &source().replace("manifest_version = 1\n", ""),
        "manifest_version",
    );
    rejected(&format!("manifest_version = 1\n{COMPONENT}"), "package");
    rejected(PACKAGE, "components");
    rejected(
        &PACKAGE.replacen(
            "manifest_version = 1",
            "manifest_version = 1\ncomponents = []",
            1,
        ),
        "components",
    );
    for (line, field) in [
        ("name = \"sample\"\n", "package.name"),
        ("display_name = \"Sample\"\n", "package.display_name"),
        (
            "description = \"A sample package.\"\n",
            "package.description",
        ),
        ("version = \"1.2.3\"\n", "package.version"),
        ("kind = \"frontend\"\n", "components[0].kind"),
        ("entry = \"dist/main.js\"\n", "components[0].entry"),
        ("display_name = \"Main\"\n", "components[0].display_name"),
        (
            "description = \"A sample component.\"\n",
            "components[0].description",
        ),
        (
            "runtime_profile = \"writers-ide.frontend/1\"\n",
            "components[0].runtime_profile",
        ),
        (
            "activation_scope = \"project\"\n",
            "components[0].activation_scope",
        ),
        ("capabilities = []\n", "components[0].capabilities"),
    ] {
        rejected(&source().replace(line, ""), field);
    }
    rejected(
        &source().replace("kind = \"frontend\"", "kind = \"backend\""),
        "components[0].kind",
    );
}

#[test]
fn unknown_fields_at_every_table_depth_are_bounded() {
    for (text, field) in [
        (format!("typo = true\n{}", source()), "typo"),
        (format!("{PACKAGE}typo = true\n{COMPONENT}"), "package.typo"),
        (source() + "typo = true\n", "components[0].typo"),
        (source() + "[[components.provides]]\nid = \"api\"\nmajor = 1\ntypo = true\n", "components[0].provides[0].typo"),
        (source() + "[[components.commands]]\nid = \"cmd\"\ncontract = \"contract\"\nmajor = 1\ntypo = true\n", "components[0].commands[0].typo"),
        (source() + &dependency("typo = true"), "components[0].dependencies[0].typo"),
        (source() + &dependency("") + "[[components.dependencies.apis]]\nid = \"api\"\nmajor = 1\ntypo = true\n", "components[0].dependencies[0].apis[0].typo"),
        (source() + &dependency("") + "[[components.dependencies.commands]]\nalias = \"cmd\"\nid = \"cmd\"\ncontract = \"contract\"\nmajor = 1\ntypo = true\n", "components[0].dependencies[0].commands[0].typo"),
        (source() + "[[components.permissions]]\noperation = \"external.open\"\nresource = \"http-https\"\ntypo = true\n", "components[0].permissions[0].typo"),
        (format!("{PACKAGE}[[package.permissions]]\noperation = \"external.open\"\nresource = \"http-https\"\ntypo = true\n{COMPONENT}"), "package.permissions[0].typo"),
    ] {
        assert_eq!(rejected(&text, field).message, "unsupported field");
    }
    let hostile_key = "z".repeat(8000);
    let error = parse(format!("\"{hostile_key}\" = true\n{}", source()).as_bytes()).unwrap_err();
    assert!(error.to_string().len() < 256);
    assert!(!error.to_string().contains(&hostile_key));
}

#[test]
fn optional_values_do_not_coerce_or_default_when_present() {
    for field in [
        "styles",
        "provides",
        "commands",
        "dependencies",
        "permissions",
    ] {
        rejected(
            &(source() + &format!("{field} = false\n")),
            &format!("components[0].{field}"),
        );
    }
    rejected(
        &(source() + "default_enabled = \"false\"\n"),
        "components[0].default_enabled",
    );
    rejected(
        &format!("{PACKAGE}permissions = false\n{COMPONENT}"),
        "package.permissions",
    );
    rejected(
        &format!("{PACKAGE}namespace = false\n{COMPONENT}"),
        "package.namespace",
    );
    for (field, value) in [
        ("optional", "\"false\""),
        ("version", "1"),
        ("binding", "false"),
        ("apis", "{}"),
        ("commands", "\"none\""),
    ] {
        rejected(
            &(source() + &dependency(&format!("{field} = {value}"))),
            &format!("components[0].dependencies[0].{field}"),
        );
    }
    for (from, to, field) in [
        (
            "capabilities = []",
            "capabilities = false",
            "components[0].capabilities",
        ),
        (
            "capabilities = []",
            "capabilities = [1]",
            "components[0].capabilities[0]",
        ),
        ("id = \"main\"", "id = 1", "components[0].id"),
        (
            "activation_scope = \"project\"",
            "activation_scope = 1",
            "components[0].activation_scope",
        ),
    ] {
        rejected(&source().replace(from, to), field);
    }
    rejected(
        &(source() + "provides = [1]\n"),
        "components[0].provides[0]",
    );
}

#[test]
fn machine_identifiers_and_canonical_references_are_exact() {
    for invalid in ["", "A", "a_b", "é", "a--b", "-a", "a-", "a b", "a/b"] {
        rejected(
            &source().replace("name = \"sample\"", &format!("name = \"{invalid}\"")),
            "package.name",
        );
        rejected(
            &source().replace("id = \"main\"", &format!("id = \"{invalid}\"")),
            "components[0].id",
        );
        rejected(
            &(source()
                + &dependency("")
                    .replace("alias = \"provider\"", &format!("alias = \"{invalid}\""))),
            "components[0].dependencies[0].alias",
        );
    }
    for size in [256, 257] {
        let name = "a".repeat(size);
        let text = source().replace(
            "name = \"sample\"",
            &format!("namespace = \"{name}\"\nname = \"{name}\""),
        );
        if size == 256 {
            assert_eq!(parsed(&text).package.canonical_id().len(), 514);
            parsed(
                &(source()
                    + &dependency("").replace("@example/services", &format!("@{name}/{name}"))),
            );
        } else {
            let error = parse(text.as_bytes()).unwrap_err();
            assert!(!error.message.contains(&name));
        }
    }
    for invalid in [
        "@name",
        "@/name",
        "@ns/",
        "@ns/name/more",
        "ns/name",
        "@NS/name",
    ] {
        rejected(
            &(source() + &dependency("").replace("@example/services", invalid)),
            "components[0].dependencies[0].package",
        );
    }
    let lifecycle = source() + &dependency("").replace("@example/services", "sample");
    assert_eq!(
        parsed(&lifecycle).components[0].dependencies[0].package,
        "sample"
    );
}

#[test]
fn text_and_contract_limits_count_utf8_bytes_without_normalization() {
    for (needle, field, limit) in [
        ("Sample", "package.display_name", 1024),
        ("A sample package.", "package.description", 4096),
        ("Main", "components[0].display_name", 1024),
        ("A sample component.", "components[0].description", 4096),
    ] {
        let exact = "é".repeat(limit / 2);
        parsed(&source().replace(needle, &exact));
        rejected(&source().replace(needle, &(exact + "a")), field);
        rejected(
            &source().replace(needle, " \t ").replace('\t', "\\t"),
            field,
        );
    }
    for id in ["é".repeat(128), " Case/敏感 ".to_owned()] {
        let manifest =
            parsed(&(source() + &format!("provides = [{{ id = \"{id}\", major = 1 }}]\n")));
        assert_eq!(manifest.components[0].provides[0].id, id);
    }
    for id in ["é".repeat(128) + "x", " ".to_owned(), "".to_owned()] {
        rejected(
            &(source() + &format!("provides = [{{ id = \"{id}\", major = 1 }}]\n")),
            "components[0].provides[0].id",
        );
    }
    let exact = "é".repeat(128);
    let command =
        format!("commands = [{{ id = \"{exact}\", contract = \"{exact}\", major = 1 }}]\n");
    parsed(&(source() + &command));
    rejected(
        &(source() + &command.replace(&format!("id = \"{exact}\""), &format!("id = \"{exact}x\""))),
        "components[0].commands[0].id",
    );
    let required = format!("commands = [{{ alias = \"{exact}\", id = \"{exact}\", contract = \"{exact}\", major = 1 }}]");
    parsed(&(source() + &dependency(&required)));
    rejected(
        &(source()
            + &dependency(&required.replace(
                &format!("alias = \"{exact}\""),
                &format!("alias = \"{exact}x\""),
            ))),
        "components[0].dependencies[0].commands[0].alias",
    );
}

#[test]
fn api_pairs_allow_multiple_majors_and_reject_duplicates_and_unsafe_majors() {
    let pairs = "[{ id = \"Case sensitive\", major = 1 }, { id = \"Case sensitive\", major = 2 }]";
    let text =
        source() + &format!("provides = {pairs}\n") + &dependency(&format!("apis = {pairs}"));
    let manifest = parsed(&text);
    assert_eq!(manifest.components[0].provides.len(), 2);
    assert_eq!(manifest.components[0].dependencies[0].apis.len(), 2);
    let error = rejected(
        &text.replace("major = 2", "major = 1"),
        "components[0].dependencies[0].apis[1]",
    );
    assert!(error.message.contains("[0]"));
    rejected(
        &(source() + &format!("provides = {}\n", pairs.replace("major = 2", "major = 1"))),
        "components[0].provides[1]",
    );
    for major in ["0", "-1", "9007199254740992", "\"1\"", "1.0", "true"] {
        rejected(
            &(source() + &format!("provides = [{{id = \"api\", major = {major}}}]\n")),
            "components[0].provides[0].major",
        );
    }
    parsed(&(source() + "provides = [{id = \"api\", major = 9007199254740991}]\n"));
}

#[test]
fn component_dependency_and_command_uniqueness() {
    rejected(&(source() + COMPONENT), "components[1].id");
    rejected(
        &(source() + &dependency("") + &dependency("")),
        "components[0].dependencies[1].alias",
    );
    rejected(
        &(source() + &dependency("") + &dependency("").replace("provider", "other")),
        "components[0].dependencies[1]",
    );
    let command = "{id = \"cmd\", contract = \"one\", major = 1}";
    rejected(
        &(source()
            + &format!(
                "commands = [{command}, {}]\n",
                command.replace("one", "two")
            )),
        "components[0].commands[1].id",
    );
    let command = "{alias = \"cmd\", id = \"id\", contract = \"one\", major = 1}";
    rejected(
        &(source()
            + &dependency(&format!(
                "commands = [{command}, {}]",
                command.replace("one", "two")
            ))),
        "components[0].dependencies[0].commands[1].alias",
    );
    let self_dependency = source()
        + &dependency("")
            .replace("@example/services", "sample")
            .replace("component = \"service\"", "component = \"main\"");
    rejected(&self_dependency, "components[0].dependencies[0]");
    // Same-package missing targets are left to resolution, not invented here.
    parsed(&(source() + &dependency("").replace("@example/services", "sample")));
}

#[test]
fn binding_rules_are_local_only() {
    let selected = dependency("binding = \"selected-project\"\noptional = true");
    rejected(
        &(source() + &selected),
        "components[0].dependencies[0].binding",
    );
    let application = source().replace(
        "activation_scope = \"project\"",
        "activation_scope = \"application\"",
    );
    parsed(&(application.clone() + &selected));
    rejected(
        &(application.clone() + &selected.replace("optional = true", "optional = false")),
        "components[0].dependencies[0].binding",
    );
    rejected(
        &(application.clone() + &selected.replace("selected-project", "any-project")),
        "components[0].dependencies[0].binding",
    );
    // The same target with distinct bindings is valid syntax.
    parsed(
        &(application
            + &dependency("")
            + &selected.replace("alias = \"provider\"", "alias = \"selected\"")),
    );
}

#[test]
fn permissions_are_exact_pairs_with_inheritance_but_no_sibling_authority() {
    let external = "{operation = \"external.open\", resource = \"http-https\"}";
    let list = "{operation = \"project.files.list\", resource = \"project\"}";
    let read = "{operation = \"project.files.read\", resource = \"project\"}";
    let text = format!("{PACKAGE}permissions = [{external}]\n{COMPONENT}permissions = [{external}, {list}, {read}]\n{}", COMPONENT.replace("id = \"main\"", "id = \"sibling\""));
    let manifest = parsed(&text);
    assert_eq!(
        manifest
            .effective_permissions(&manifest.components[0])
            .len(),
        3
    );
    assert_eq!(
        manifest
            .effective_permissions(&manifest.components[1])
            .len(),
        1
    );
    rejected(
        &(source() + &format!("permissions = [{external}, {external}]\n")),
        "components[0].permissions[1]",
    );
    rejected(
        &format!("{PACKAGE}permissions = [{external}, {external}]\n{COMPONENT}"),
        "package.permissions[1]",
    );
    for invalid in [
        external.replace("http-https", "project"),
        list.replace("project.files.list", "project.files.write"),
        read.replace("project\"", "http-https\""),
    ] {
        assert!(parse((source() + &format!("permissions = [{invalid}]\n")).as_bytes()).is_err());
    }
    let app = COMPONENT.replace(
        "activation_scope = \"project\"",
        "activation_scope = \"application\"",
    );
    parsed(&format!("{PACKAGE}permissions = [{external}]\n{app}"));
    rejected(
        &format!("{PACKAGE}permissions = [{list}]\n{app}"),
        "components[0].permissions",
    );
    rejected(
        &format!("{PACKAGE}{app}permissions = [{read}]\n"),
        "components[0].permissions",
    );
}

#[test]
fn capabilities_are_known_distinct_and_required() {
    parsed(&source().replace("capabilities = []", "capabilities = [\"contributions.toolbar\", \"contributions.view\", \"contributions.command\"]"));
    rejected(
        &source().replace(
            "capabilities = []",
            "capabilities = [\"contributions.view\", \"contributions.view\"]",
        ),
        "components[0].capabilities[1]",
    );
    rejected(
        &source().replace(
            "capabilities = []",
            "capabilities = [\"contributions.unknown\"]",
        ),
        "components[0].capabilities[0]",
    );
}

#[test]
fn declaration_count_boundaries() {
    for count in [32, 33] {
        let components: String = (0..count)
            .map(|index| COMPONENT.replace("id = \"main\"", &format!("id = \"c{index}\"")))
            .collect();
        let text = format!("{PACKAGE}{components}");
        if count == 32 {
            parsed(&text);
        } else {
            rejected(&text, "components");
        }
    }
    for (field, max, item, in_dependency) in [
        ("provides", 32, "{id = \"aINDEX\", major = 1}", false),
        (
            "commands",
            32,
            "{id = \"cINDEX\", contract = \"contract\", major = 1}",
            false,
        ),
        ("apis", 32, "{id = \"aINDEX\", major = 1}", true),
        (
            "commands",
            32,
            "{alias = \"cINDEX\", id = \"cmd\", contract = \"contract\", major = 1}",
            true,
        ),
        ("styles", 16, "\"dist/sINDEX.css\"", false),
        (
            "dependencies",
            64,
            "{alias = \"dINDEX\", package = \"provider\", component = \"cINDEX\"}",
            false,
        ),
    ] {
        for count in [max, max + 1] {
            let entries = (0..count)
                .map(|index| item.replace("INDEX", &index.to_string()))
                .collect::<Vec<_>>()
                .join(",");
            let declaration = format!("{field} = [{entries}]\n");
            let text = if in_dependency {
                source() + &dependency(&declaration)
            } else {
                source() + &declaration
            };
            if count == max {
                parsed(&text);
            } else {
                let prefix = if in_dependency {
                    "components[0].dependencies[0]"
                } else {
                    "components[0]"
                };
                rejected(&text, &format!("{prefix}.{field}"));
            }
        }
    }
}

#[test]
fn literal_paths_reuse_portable_integrity_rules() {
    for valid in [
        "main.js",
        "dist/main.mjs",
        "dist/é.js",
        "dist/%2e%2e.js",
        "dist/hash#percent%.js",
    ] {
        let manifest = parsed(&source().replace("dist/main.js", valid));
        assert_eq!(manifest.components[0].entry, valid);
    }
    for invalid in [
        "",
        "https://example/main.js",
        "/main.js",
        "../main.js",
        "dist/../main.js",
        "dist//main.js",
        "./main.js",
        "dist\\main.js",
        "C:/main.js",
        "CON.js",
        "dist/NUL/main.js",
        "dist/COM¹.js",
        "dist./main.js",
        "dist /main.js",
        "dist/main.JS",
        "dist/main.js?query",
        "dist/main.js#fragment",
        "dist/index",
        "dist/main.css",
    ] {
        // Escape backslashes for TOML without changing the parsed path.
        rejected(
            &source().replace("dist/main.js", &invalid.replace('\\', "\\\\")),
            "components[0].entry",
        );
    }
    rejected(
        &(source() + "styles = [\"dist/main.js\"]\n"),
        "components[0].styles[0]",
    );
    rejected(
        &(source() + "styles = [false]\n"),
        "components[0].styles[0]",
    );
    let exact_depth = format!("{}main.js", "d/".repeat(15));
    parsed(&source().replace("dist/main.js", &exact_depth));
    rejected(
        &source().replace("dist/main.js", &format!("d/{exact_depth}")),
        "components[0].entry",
    );
    let exact_bytes = format!("{}.js", "a".repeat(1021));
    parsed(&source().replace("dist/main.js", &exact_bytes));
    rejected(
        &source().replace("dist/main.js", &format!("a{exact_bytes}")),
        "components[0].entry",
    );
}

#[test]
fn pure_resource_membership_is_exact_without_url_decoding() {
    let manifest = parsed(
        &(source().replace("dist/main.js", "dist/%2e%2e.js") + "styles = [\"dist/main.css\"]\n"),
    );
    let error = validate_resources(&manifest, |path| path == "dist/...js").unwrap_err();
    assert_eq!(error.field, "components[0].entry");
    let error = validate_resources(&manifest, |path| path == "dist/%2e%2e.js").unwrap_err();
    assert_eq!(error.field, "components[0].styles[0]");
    validate_resources(&manifest, |path| {
        ["dist/%2e%2e.js", "dist/main.css"].contains(&path)
    })
    .unwrap();
}

#[test]
fn verified_parser_consumes_snapshot_bytes_not_reopened_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::create_dir(root.join("dist")).unwrap();
    std::fs::write(
        root.join("manifest.toml"),
        source() + "styles = [\"dist/main.css\"]\n",
    )
    .unwrap();
    std::fs::write(root.join("dist/main.js"), "export function activate() {}\n").unwrap();
    std::fs::write(root.join("dist/main.css"), "body {}\n").unwrap();
    let limits = IntegrityLimits::default();
    let record = create_record(root, &limits).unwrap();
    let snapshot = verify_package(root, &record, &limits).unwrap();
    std::fs::write(root.join("manifest.toml"), "invalid replacement").unwrap();
    std::fs::remove_file(root.join("dist/main.js")).unwrap();
    assert_eq!(
        parse_verified(&snapshot, &limits).unwrap().package.name,
        "sample"
    );
    let tight = IntegrityLimits {
        max_depth: 1,
        ..limits.clone()
    };
    assert_eq!(
        parse_verified(&snapshot, &tight).unwrap_err().field,
        "components[0].entry"
    );
    std::fs::write(root.join("manifest.toml"), source()).unwrap();
    let record = create_record(root, &limits).unwrap();
    let missing_entry = verify_package(root, &record, &limits).unwrap();
    assert_eq!(
        parse_verified(&missing_entry, &limits).unwrap_err().field,
        "components[0].entry"
    );
    std::fs::remove_file(root.join("manifest.toml")).unwrap();
    let record = create_record(root, &limits).unwrap();
    let missing_manifest = verify_package(root, &record, &limits).unwrap();
    assert_eq!(
        parse_verified(&missing_manifest, &limits)
            .unwrap_err()
            .field,
        "manifest.toml"
    );
}
