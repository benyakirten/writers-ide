# Internal manifest parsing and static resolution

The Rust `plugin_manifest` module validates external package declarations and analyzes their dependencies without executing plugin code. This is an internal implementation guide, not an author API. For package fields and complete TOML examples, read the [package specification](package-api-proposal.md#manifest-field-rules). For remaining integration work, read the [execution checklist](implementation-plan.md#foundation-slice-and-remaining-execution-checklist).

The module is declared in `src-tauri/src/lib.rs` with `#[allow(dead_code)]`. There are no application commands or runtime callers. Parsing and resolution do not install packages, import modules, enable components, issue credentials, grant permissions or activate anything.

## Inputs and normalized declarations

A future host caller supplies manifest bytes or an existing verified package snapshot. Tests call these functions directly today. All entry points below are crate-internal Rust functions:

| Entry point                                                            | Caller supplies                                                              | Result                                                                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `parse(bytes: &[u8])`                                                  | Already acquired manifest bytes                                              | A normalized `PackageManifest`, or `ManifestError`. Uses default integrity path limits. Does not check resource existence.      |
| `parse_verified(snapshot: &VerifiedPackage, limits: &IntegrityLimits)` | An existing integrity-verified snapshot and host path limits                 | Parses its exact `manifest.toml` bytes and checks every entry/style filename against that snapshot. Never reopens source files. |
| `validate_resources(manifest, contains)`                               | A normalized manifest and a literal filename-membership predicate            | Checks entry/style membership only. The callback conveys no integrity or permission authority.                                  |
| `resolve(catalog: &[PackageManifest], supported_profiles: &[&str])`    | Normalized manifests for installed candidates and host-supported profile IDs | `Resolution`, or a duplicate-catalog `CatalogError`. Does not obtain packages or choose versions.                               |

`model.rs` represents package metadata, components, APIs, commands, dependencies and permissions. Canonical package IDs are derived as `name` or `@namespace/name`. Component IDs remain package-local. API and command contract strings retain their exact spelling and case. Versions and dependency requirements have parsed representations.

Absent optional lists become empty lists. Other absent defaults include `default_enabled = false`, dependency `optional = false` and `binding = "instance"`. An absent dependency version adds no package-release constraint. Invalid supplied values never trigger a default.

`effective_permissions(component)` returns a sorted, deduplicated union of package and component declarations. Duplicate operation/resource pairs within either list are errors. A pair declared once at each level is valid. This union is a set of requirements, not grants. Application components cannot declare or inherit project-file requirements.

## Strict parser boundary

The parser rejects a byte slice larger than 65,536 bytes before UTF-8 decoding or TOML parsing. Comments and whitespace count. It has no filesystem reader. Future byte acquisition must still enforce bounded reads, inspecting at most the limit plus one byte to detect oversized files. Rejecting an already allocated slice does not bound the caller's acquisition memory or work.

The parser requires integer `manifest_version = 1`, a package table and 1–32 components. It rejects unknown fields at every table, incorrect types, duplicate TOML keys and unsupported component kinds. Only `frontend` is accepted. A nonempty but unsupported runtime-profile string remains a valid declaration; support is analyzed separately.

Implemented limits include:

- Machine identifiers: the approved lowercase ASCII letter/digit and single-hyphen grammar, with at most 256 bytes per namespace, package name, component ID or dependency alias.
- API IDs, command IDs, command contract IDs and consumer command aliases: nonempty, non-whitespace-only exact strings of at most 256 UTF-8 bytes. No trimming, normalization or truncation.
- Package and component display names: at most 1,024 UTF-8 bytes. Descriptions: at most 4,096 bytes. Both must contain non-whitespace text.
- API and command majors: integers from 1 through 9,007,199,254,740,991.
- Per component: at most 64 dependencies, 32 provided API pairs, 32 commands and 16 stylesheets. Per dependency: at most 32 requested API pairs and 32 requested commands.
- Capabilities and permissions: only the three approved values or operation/resource pairs, with no duplicates in each list.

The parser rejects duplicate component IDs, dependency aliases, target package/component/binding tuples, API ID/major pairs, provider-local command IDs and dependency-local command aliases. It also rejects self-dependencies. Selected-project declarations require an application consumer and `optional = true`; provider scope is checked during resolution.

Entry and style paths reuse the integrity module's portable relative-path and depth checks. Extensions must be exact lowercase `.js`/`.mjs` for entries and `.css` for styles. They are literal filenames, not pre-encoded URLs. `parse_verified` requires exact snapshot membership. It does not inspect exports, load CSS or prove that an entry has an `activate` function.

The TOML library's own recursion guard remains enabled. A malformed deeply nested input has regression coverage; the manifest byte limit is not a replacement for that guard.

## Errors and diagnostics

`ManifestError` contains `field` and `message`. Each is bounded to 512 characters. Unknown field names are escaped and shortened before entering a field path. Messages are host-controlled and do not echo source values or raw TOML diagnostics.

Syntax errors report a one-based line and byte column. Byte columns are not Unicode character columns. Duplicate declarations identify the field and conflicting list indices, rather than copying the duplicate value into the message. Oversized-field messages report byte counts and limits.

`CatalogError` is separate. Duplicate installed canonical package identities, component identities or consumer dependency aliases prevent unambiguous resolution. The resolver fails instead of choosing whichever registration appears first. Callers must supply normalized parser output; direct construction of model structs is not a substitute for manifest validation.

## Package version matching

`version.rs` uses `semver` for complete SemVer versions and precedence. Requirements are either one exact version or whitespace-separated `>`, `>=`, `<` and `<=` comparisons. Every comparison must pass. Operators attach directly to full versions: `>=1.3.0 <2.0.0` is valid; `>= 1.3.0` is not.

Comparison candidates never include prereleases. An exact prerelease can be requested explicitly. `cmp_precedence` ignores build metadata, including for exact requirements. Caret, tilde, wildcard, partial-version and OR syntax are not accepted. Package-version requirements are independent of exact API/command majors.

## Static resolution outputs

`Resolution.components` is sorted by canonical package/component identity. Each component has blockers and dependencies sorted by consumer-local alias. Every dependency retains its declaration, provider identity, possible binding and issues. An empty issue list means statically compatible, not active or authorized.

The resolver requires every requested API ID/major pair and every requested command ID/contract/major tuple to match the provider's declarations. Dependencies requesting neither APIs nor commands still participate as lifecycle-only dependencies.

Binding output describes how a future host must route a connection:

| Output                 | Meaning                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SameProjectOpening`   | A project consumer uses a project provider in its own live opening.                                                    |
| `SameWindow`           | A project or application consumer uses an application provider in the same window.                                     |
| `SelectedProjectLease` | An optional application-to-project integration requires an explicit live-project lease. It is not direct availability. |

Resolution receives no live project registry and selects no project. A profile outside `supported_profiles` blocks that component. Missing packages/components, version mismatches, incompatible scopes and missing contracts block consumers only when the dependency is required. Blocked providers propagate through required edges. Optional integrations report issues without blocking their consumers. Healthy unrelated siblings remain eligible.

`required_cycles` stores deterministic groups of mutually reachable components in required-dependency cycles. Each group is stored once; component blockers refer to its index. These are strongly connected groups, not invented linear cycle paths. `required_order` contains eligible components only, with required providers before consumers. Optional edges impose no ordering.

For example, a test or future host can parse separate provider and consumer manifests and supply both in `catalog`. If the consumer requires an API major absent from that provider, the consumer is blocked. An unrelated component remains eligible. Changing the dependency to optional reports the mismatch without blocking the consumer. None of these outcomes enables a component or verifies runtime publication.

## Integration and resource limits still required

Graph traversal, cycle grouping and ordering use iterative heap-backed structures rather than recursive calls. Graph storage is O(V + E), plus declarations and diagnostics. Ordered maps and sets add logarithmic lookup costs; contract checks scan provider declarations. Per-manifest limits do not bound an entire catalog. No aggregate catalog numerical defaults have been selected. Resolution is synchronous. Future host callers must budget aggregate work or run it away from latency-sensitive threads.

The remaining host/runtime work includes:

- Bounded manifest acquisition and installer staging/publication into accepted immutable artifacts.
- Runtime API/command publication checks and alias-bound lookup/invocation.
- User enablement and dependency-impact review. The resolver does not honor `default_enabled` or saved selections.
- Grant review, native registry/authorization, credentials and activation gates.
- Live project leases, component lifetimes and contribution routing.
- Generated runtime-profile artifacts, production import gates, verified module/worker delivery and stylesheet ownership.

These gates remain prerequisites for external loading. Static eligibility cannot replace any of them.

## Source and tests

Implementation starts in [`mod.rs`](../../src-tauri/src/plugin_manifest/mod.rs), [`model.rs`](../../src-tauri/src/plugin_manifest/model.rs), [`parse.rs`](../../src-tauri/src/plugin_manifest/parse.rs), [`version.rs`](../../src-tauri/src/plugin_manifest/version.rs) and [`resolve.rs`](../../src-tauri/src/plugin_manifest/resolve.rs).

[`parse_tests.rs`](../../src-tauri/src/plugin_manifest/parse_tests.rs) covers both complete specification examples, exact/over byte and count boundaries, UTF-8, strict types/fields, malformed nesting, permissions and literal/verified file membership. [`resolve_tests.rs`](../../src-tauri/src/plugin_manifest/resolve_tests.rs) covers API majors, commands, scopes, optional absence, cycles, healthy siblings, determinism and 12,000-node chains/cycles. `version.rs` contains focused range tests. Verified results belong to the [cumulative changelog](change-log.md), not a claim that the application now uses this module.
