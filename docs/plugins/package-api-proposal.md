# External plugin package specification — review draft

**Status: consolidated draft for owner review.** The policy decisions identified as approved below are accepted direction. Schema and TypeScript contracts are recommendations unless explicitly marked approved. The [shared command shape](command-contract.md) is approved, but no new external-package APIs are implemented. Approval to prepare this draft is not approval to implement its unresolved contracts.

Writer's IDE currently supports trusted, explicitly registered bundled plugins. It does not install or load external packages. Its Rust integrity module can verify files and return immutable owned bytes. Its internal resource route and snapshot pool are exercised by a separate packaged fixture. Application resource registration, installation, native authorization and project-scoped component hosting remain unimplemented.

This draft describes the first external package format and the interfaces authors would use. Read [the implementation plan](implementation-plan.md#part-4--external-packages-and-user-facing-trust) for scope. Use [the current plugin guide](../../packages-js/plugins/README.md) for APIs available today. The [resource-loading investigation](resource-loading-investigation.md) records the implemented fixture and measured macOS behavior, with other supported runtimes still unverified.

## 1. What is already approved?

- A package installs and updates as a unit. Its components activate independently.
- A component is project-scoped or application-scoped. Application scope is per window/host, not a singleton across windows.
- A frontend entry module exports synchronous `activate(context)`. Managed tasks handle continuing work. Short actions do not require generators.
- Packages are prebuilt ZIPs with `manifest.toml` at the root. No installation scripts or source compilation run during installation.
- The entire manifest is parsed strictly. Unknown fields and unsupported format versions fail before plugin imports.
- Dependencies use consumer-local aliases for both same-package and cross-package components. API dependencies match exact API majors. Optional semantic package-version ranges add another check.
- Native permission requirements are additive across package and component declarations. Every effective requirement is mandatory for activation.
- Native declarations separate `operation` and `resource`. Initial pairs are `project.files.list`/`project`, `project.files.read`/`project` and `external.open`/`http-https`.
- Native project-file services belong to project components. Grants can cover the whole registered project directory. Reads return saved bytes, not live editor state.
- File discovery will use a SQLite-backed file/metadata index, without storing file contents. Directory views remain bounded and initially nonrecursive. Native services do not follow symbolic links or Windows junctions/reparse points.
- Asynchronous native services reject promises with structured SDK errors and stable codes. An SDK helper identifies these errors.
- Providers use their own grants for the feature operations they expose. Consumers need declared dependencies, not duplicate native grants.
- Global features use explicit project connections. Existing handles never silently change projects.
- The host loads declared CSS before activation and shares stylesheet ownership across activations. This is not CSS isolation.
- Updates wait for restart. Failed updates do not automatically execute older versions. Explicit recovery launch skips all packaged plugin imports, including official packages.
- Frontend code is trusted and shares the application JavaScript environment. Rust enforces native authority. Tokens identify whose credential was exercised, not hostile JavaScript provenance.

The remainder makes these policies concrete. Recommendations that introduce public contracts need the consolidated approval in [section 10](#10-consolidated-review-decisions).

## 2. A package containing Basic Menu

This complete proposed manifest belongs at the root of Basic Menu's ZIP. Its built entry contributes horizontal and vertical formatting controls through the public word-processing API.

```toml
manifest_version = 1

[package]
namespace = "writers-ide"
name = "basic-menu"
display_name = "Basic Menu"
version = "0.1.0"
description = "Text formatting controls for the document editor."

[[components]]
id = "toolbar"
display_name = "Formatting toolbar"
description = "Adds text formatting controls to the document editor."
kind = "frontend"
entry = "dist/toolbar.js"
styles = ["dist/toolbar.css"]
runtime_profile = "writers-ide.frontend/1"
activation_scope = "project"
default_enabled = true
capabilities = ["contributions.toolbar"]

[[components.dependencies]]
alias = "editor"
package = "@writers-ide/word-processing"
component = "editor"
version = ">=0.1.0 <1.0.0"
optional = false

[[components.dependencies.apis]]
id = "writers-ide.word-processing"
major = 1
```

The manifest names an installed provider component. It does not import an npm package. The proposed built-in provider reference is package `@writers-ide/word-processing`, component `editor`. The API remains `writers-ide.word-processing`, major `1`. These are distinct identities even though their names resemble one another.

**Recommended built-in registration:** the host registers its existing editor under that package/component reference with an explicit provider package version. Initially use `0.1.0`, matching the current root application version. Keep that descriptor explicit rather than reading the reusable library's version at runtime. Reject an external installation that collides with this registered package identity. This does not reserve every namespace or claim publisher authentication.

The descriptor also needs project-bound editor sources. The current `defaultWordProcessingSources` enumerates the global editor registry and global active tab. Registering that adapter once per project would not isolate its supported view list. Filter sources by the live project opening and resolve its active view locally before exposing a project provider. This is host adaptation work, not a new formatting API.

This descriptor uses the same dependency resolver as external components. It does not require extracting the whole editor into an independently installed package in Part 4. It must not supply privileged formatting hooks. Formatting commands stay in Basic Menu.

Basic Menu needs no native permissions. That is not a privacy guarantee: trusted frontend code can use editor APIs and ordinary browser network requests.

### Proposed field rules

**Approved format version:** require the top-level integer `manifest_version = 1`. Reject missing values, string values such as `"1"` and unsupported integers before importing code. There is no implicit default or coercion. This is separate from the package release version. Future format support requires an explicit parser.

**Approved component list:** require a nonempty `components` array. Each TOML `[[components]]` block adds a component record. Reject a missing or empty list. A component may provide APIs or background functionality without UI. This does not add component-free library or asset packages. Maximum counts and remaining component fields are not approved by this requirement.

**Approved frontend entry:** each frontend component requires `entry`, naming an exact package-root-relative `.js` or `.mjs` file. Require it in the verified snapshot. No extension guessing or directory-index search is allowed. Reject external URLs, host filesystem paths and traversal. Authors choose their build-output layout. The host imports the verified module after checks and calls its named synchronous `activate` export with the activation context.

**Approved component kind:** require `kind = "frontend"` on every component. Reject missing or unsupported values during whole-manifest validation, before importing any component. A mixed package with an unsupported kind is rejected rather than partially interpreted. Frontend components need not display UI. They may own workers and use verified WebAssembly through their JavaScript entry. Other kinds require an explicitly supported future runtime; declaring them grants no native execution authority.

**Approved frontend compatibility field:** every frontend component requires `runtime_profile`. It names the host-defined frontend environment the component was built for. No package-level inheritance or implicit default is allowed. Build tooling can emit the value. The host checks support before import; unsupported components cannot run. This is not a dependency download or permission grant. The example ID `writers-ide.frontend/1` and the profile's exact inventory remain draft. The initial release supports one frontend runtime profile per plugin-hosting window. Active components share its runtime modules. Do not silently substitute profiles or load private Svelte or ProseMirror copies to satisfy unsupported declarations. Preserve the approved installable-but-blocked policy below. This restriction does not limit plugin API majors. Multiple-profile coexistence is a possible future investigation, not a promised feature; support duration for older profiles is not decided.

**Approved compatibility handling:** an otherwise valid package may install or update with unsupported-profile components visibly blocked. Do not import or activate them. Block required dependents and treat optional integrations as unavailable; compatible components remain eligible. Show affected components and required profiles before acceptance. A package with no runnable components may still install if that limitation is clear. Normal enablement and native permissions remain mandatory. Unlike an unsupported kind, an unsupported profile on a known frontend declaration does not invalidate the whole manifest.

**Approved contribution capabilities:** every component requires a `capabilities` array. An empty array is valid for a component that does not register host contributions. Supported values are `contributions.toolbar`, `contributions.view` and `contributions.command`. Reject missing arrays, unknown values and duplicates before activation. Registering a contribution without its declared capability fails. Capabilities describe access to supported contribution APIs; they do not grant native permissions or restrict ordinary browser JavaScript. Numerical list limits remain unapproved.

**Approved stylesheet field:** frontend components may declare `styles`, an optional array defaulting to `[]`. Entries name exact package-relative `.css` files that must exist in the verified snapshot. External URLs and inline CSS text are not valid entries. This does not restrict ordinary dynamic inline styles in component UI. Host-managed loading, shared ownership and cleanup are already approved. Shared stylesheets use the [approved reuse-and-append ordering](#stylesheet-loading-and-ordering). Allow at most 16 stylesheet entries per component, as specified in the declaration-count limits below.

**Approved unknown-field handling:** reject unknown fields in every manifest table before importing plugin code. Report the field path and explain that the field is unsupported. For example, `components[0].default_enable` is an error, not an ignored setting. New fields require explicit host support. This does not change unsupported-profile handling: `runtime_profile` is a recognized field whose unsupported value blocks the affected component rather than invalidating an otherwise valid package.

**Approved value types:** require the correct types throughout the manifest. Reject invalid types before importing plugin code; do not convert values automatically. For example, `default_enabled = "false"` and `major = "1"` are errors, not a boolean and an integer. Report the field path and expected type. An optional field's default applies only when the field is absent, never when its value is invalid.

**Approved optional declaration lists:** package `permissions`; component `provides`, `commands`, `dependencies` and `permissions`; and each dependency's `apis` and `commands` are optional. An absent list means `[]`. Apply defaults only to absent fields; reject supplied values with invalid types. Omitted permissions grant nothing, and omitted publication or dependency lists declare none. A dependency with empty `apis` and `commands` remains lifecycle-only. This does not change required nonempty `components` or required component `capabilities`. Optional `styles` already defaults to `[]`.

Other field rules below remain proposed unless separately marked approved. Reject duplicate TOML keys. Return field paths and useful validation messages. Reject unsupported component kinds before importing code.

| Table                 | Required fields                                                                                             | Optional fields and defaults                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Root                  | `manifest_version`, nonempty `components` array                                                             | None                                                                                                                   |
| `package`             | `name`, `display_name`, `version`, `description`                                                            | `namespace`; `permissions = []`                                                                                        |
| Component             | `id`, `display_name`, `description`, `kind`, `entry`, `runtime_profile`, `activation_scope`, `capabilities` | `styles = []`, `default_enabled = false`, `provides = []`, `commands = []`, `dependencies = []`, `permissions = []`    |
| Dependency            | `alias`, `package`, `component`                                                                             | `version` absent means no package constraint; `optional = false`; `binding = "instance"`; `apis = []`; `commands = []` |
| Provided/required API | `id`, `major`                                                                                               | None                                                                                                                   |
| Declared command      | `id`, `contract`, `major`                                                                                   | None                                                                                                                   |
| Required command      | `alias`, `id`, `contract`, `major`                                                                          | None                                                                                                                   |
| Permission            | `operation`, `resource`                                                                                     | None                                                                                                                   |

The root also requires the `package` table. Arrays use TOML arrays of tables as shown in the examples. `kind` initially accepts only `frontend`. `activation_scope` accepts only `project` or `application`. Supported capabilities remain `contributions.toolbar`, `contributions.view` and `contributions.command`. An empty capability array is valid. Capabilities describe supported contribution APIs, not browser isolation or native grants.

**Approved identifier characters:** namespace, package machine name, component ID and dependency alias must match `[a-z0-9]+(?:-[a-z0-9]+)*`. Use lowercase ASCII letter/digit groups separated by single hyphens. Reject other forms rather than silently lowercasing or normalizing them. A canonical package reference is derived as `name` or `@namespace/name`, not a second editable field. This grammar does not apply to display names, portable filenames, API IDs or command IDs.

**Approved package display metadata:** `[package].display_name` and `[package].description` are required, nonempty plain text. They may use any language. The host reads them before activation for installation and management UI. They are not publisher authentication, identity or permission declarations. Text changes do not change package identity. Component display metadata has its own approval below.

**Approved component display metadata:** every component requires nonempty plain-text `display_name` and `description`. Both support any language and explain the independently managed feature before activation. This includes background and API-provider components. They do not replace native permission disclosures or establish identity. Changing the text does not change component identity. The approved display-text limits are specified below.

**Approved machine-identifier lengths; enforcement not implemented:** allow at most 256 ASCII bytes each for package `namespace` when present, package machine `name`, component `id` and dependency `alias`. Their ASCII-only grammar makes bytes and characters equivalent. Apply the limit separately to each field. The derived canonical package ID combines the validated namespace and name; it has no separate 256-byte limit. Reject oversized values before plugin code imports. Never truncate or change their spelling. Use bounded errors that identify the field and limit without echoing an entire oversized value. The owner chose 256 bytes for consistency with the API ID limit. This does not change the approved character grammar.

**Approved display-text limits; enforcement not implemented:** allow at most 1 KiB (1,024 UTF-8 bytes) per `display_name` and 4 KiB (4,096 UTF-8 bytes) per `description`. Apply each limit separately to package and component metadata. Both fields remain required, nonempty plain text supporting any language. Reject oversized values before plugin code imports; do not truncate stored metadata. Count UTF-8 bytes rather than JavaScript string length. The larger display-name allowance accommodates multibyte characters; these are engineering limits, not measured requirements. UI may wrap or visually shorten names while making the full text available. These field limits do not replace the 64 KiB whole-manifest limit.

**Approved component ID uniqueness:** component IDs must be unique within a package. Reject the whole manifest before importing any plugin code if two components have the same ID. Report the duplicate ID and the conflicting declarations. Neither declaration overrides the other. Different packages may use the same component ID; their package identities distinguish them.

**Approved dependency alias uniqueness:** aliases must be unique within the component declaring the dependencies. Reject the whole manifest before importing any plugin code if that component repeats an alias. Report the duplicate alias and conflicting declarations. Each alias identifies exactly one dependency; lookup does not disambiguate duplicate aliases using provider identity or API contract. Other components may reuse the same alias.

**Approved API ID rules; byte-limit enforcement not implemented:** require a nonempty string that is not whitespace-only, with a maximum length of 256 UTF-8 bytes. Apply the same rule to provided and requested API IDs in manifests and to public runtime contract definitions. Match IDs exactly, including case. Preserve the supplied string; do not trim, lowercase, normalize or truncate it. Recommend readable namespaced IDs such as `example.search`, but do not require a naming grammar. Reject oversized manifest IDs before importing plugin code. Use bounded errors that report the field path, actual byte count and limit without printing the full oversized value. Count UTF-8 bytes, not JavaScript string length. The separate whole-manifest size limit is specified below. Machine-identifier limits are specified above. Command identifier rules are specified below.

Majors are positive safe integers. Reject duplicate capabilities. Provided and required API-list uniqueness is approved below. One dependency declaration per target package/component/binding is approved as described below. Reject self-dependencies and required cycles.

Paths are literal portable package-relative filenames under the existing integrity rules, not pre-encoded URLs. Frontend entry paths end in `.js` or `.mjs`; style paths end in `.css`. Reject empty, absolute, URL and parent-traversal forms. URL-encode filename characters when constructing resource URLs. A filename's encoded percent or hash character is not a query or fragment. Resource queries are rejected; browser fragments are handled separately. Require every declared file in the accepted snapshot. Do not open a host filesystem path supplied by a component.

**Approved manifest size limit; enforcement not implemented:** `manifest.toml` may contain at most 64 KiB (65,536 bytes) of uncompressed UTF-8 file bytes, including comments and whitespace. Read at most the limit plus one byte to detect oversized input. Reject oversized manifests before TOML parsing or plugin code imports. Report the limit without printing the file's contents. This is a host-controlled engineering limit, not a measured requirement or a permission authors can raise. It applies only to the manifest, not the ZIP archive or complete package. Archive extraction and package-size limits remain separate.

**Approved declaration-count limits; enforcement not implemented:** allow at most 32 components per package, 64 dependencies per component, 32 provided API ID/major pairs per component, 32 requested API ID/major pairs per dependency, 32 provided commands per component, 32 requested commands per dependency and 16 stylesheets per component. Count different majors as separate API pairs. Exceeding any limit rejects the whole manifest before plugin code imports. These are host-owned engineering starting points, not measured requirements or values plugins can raise. The host may revise them later. Apply the count limits independently alongside the 64 KiB manifest limit and individual field limits. They do not limit rendered toolbar buttons or document nodes processed by a component. Command limits count entries in the component's `commands` list and each dependency's `commands` list. Internal handlers and individual provider API methods are not shared command declarations and do not count toward those command limits. Native permissions have only three supported pairs. Test interactions with the integrity module's file/path limits.

An unsupported backend kind is an installation compatibility error, not permission to load native code. Backend-only or mixed executable packages need a later format/runtime revision.

**Approved dependency target uniqueness:** allow one dependency declaration per target package, component and binding within each consumer component. Combine its required APIs and commands in that record. A second declaration for the same target and binding rejects the whole manifest before any plugin code is imported, even if its alias differs. Report the conflicting declarations. Different bindings remain distinct, and dependencies on different providers remain allowed. Independently optional API groups from one provider are a future candidate, not part of this initial format.

**Approved command identifier rules; enforcement not implemented:** command `id`, command `contract` ID and consumer command `alias` are each nonempty, non-whitespace-only strings of at most 256 UTF-8 bytes. Match strings exactly, including case, without trimming, lowercasing, normalization or truncation. No restricted character grammar is required. Apply the same rules to manifest declarations and corresponding public runtime contract definitions, registrations and lookups. Reject invalid manifest values before code imports. These rules do not change identity scopes: command IDs are local to the provider component, contract IDs identify shared contracts, and command aliases are local to the consumer's dependency. See the [command author guide](command-contract.md).

**Approved exact API versions:** a provider component may publish several major versions of the same API ID. Each ID/major pair must be unique within its `provides` list. A dependency may request several majors of the same API, with each ID/major pair unique within that dependency's `apis` list. Duplicate pairs reject the whole manifest before plugin code is imported. Report the duplicate pair and conflicting declarations. Repeating an ID with a different major is valid.

Every requested pair must be available for that dependency to be satisfied. Requesting majors 1 and 2 means both, not either. Consumers obtain each API using its exact typed contract. Providers implement and publish each declared major separately. The host does not choose between majors, fall back to another major or convert contracts. Automatic major-version negotiation is not part of the design or planned follow-up.

## 3. Dependencies and API publication

An alias is local to the consumer. It can target a component in its own package or another installed package. Always include the canonical package and component fields. Authors never construct project/activation identifiers to look up providers.

`binding = "instance"` uses these resolution rules:

| Consumer              | Provider              | Resolution                              |
| --------------------- | --------------------- | --------------------------------------- |
| Project component     | Project component     | Same live project opening               |
| Project component     | Application component | Same window/host                        |
| Application component | Application component | Same window/host                        |
| Application component | Project component     | Not permitted as an instance dependency |

An application component may instead declare an optional project integration with `binding = "selected-project"`. It must have `optional = true`. Resolve it only through an explicit project connection. It never starts a provider automatically. Arbitrary cross-project required bindings are outside the initial format.

A dependency with both `apis = []` and `commands = []` is lifecycle-only. The `commands` declaration and invocation shape is approved in the [command contract](command-contract.md). A nonempty list requires every listed API at its exact major. A required mismatch blocks activation with an explanation. An optional mismatch makes that declared integration unavailable. API factories remain synchronous; they must return plain method-only facades under the [existing provider rules](context.md#api-objects-and-connection-cleanup).

A provider declares publication under its component:

```toml
[[components.provides]]
id = "example.research-index"
major = 1
```

A provider can offer another major by adding a second `[[components.provides]]` block with the same `id` and a different `major`. A consumer that needs both declares both pairs under the same dependency's `apis` list. Each list entry is a requirement, not an alternative.

The provider's entry calls `context.apis.provide(contract, factory)` during activation for each declared ID/major pair. The host checks publication against that component's manifest. Undeclared, duplicate, missing or late publication fails activation. A shared contract library defines `contract` using the existing `definePluginApi`. Importing that library neither installs nor activates a provider.

### Approved optional package-version requirements

A dependency's `version` field is optional. When absent, the dependency imposes no package-release version constraint. The provider must still satisfy every requested API and command contract at its exact major. Authors may add a version requirement when they need a particular release's fix or behavior that a contract major alone does not identify.

The host checks the installed provider only. Omitting `version` does not download, update or select a package. A dependency with no requested APIs or commands may still require the provider component's activation; it is a lifecycle-only dependency. Package-version checks and contract-major checks are independent.

### Approved limited version ranges

Use SemVer 2.0.0 package versions. Accept an exact version, or whitespace-separated comparisons using `>`, `>=`, `<` and `<=`. All comparisons must pass. For example, `>=1.3.0 <2.0.0` requires at least `1.3.0` and less than `2.0.0`.

Comparison ranges exclude prereleases. An exact prerelease such as `1.3.0-beta.2` can be requested explicitly. Build metadata does not affect version precedence. Do not initially accept wildcards, caret/tilde shorthand or OR expressions. Resolution checks the installed candidate; it does not download packages or choose between multiple installed versions.

### Approved consumer lookup

A component's synchronous `activate(context)` obtains a declared API with `context.apis.get('editor', wordProcessingApi)`. The alias comes from its manifest. The contract comes from `@writers-ide/word-processing`. Required providers are ready before activation. Optional providers can be unavailable.

Undeclared aliases, wrong API identities and wrong binding routes are author errors: throw rather than returning `null`. `null` means a declared optional integration is unavailable. Subscriptions deliver immediately, then when availability changes. They are owned by the consumer lifetime and have idempotent release handles.

Do not confuse metadata validation with factory construction. A provider may be available but throw when constructing a particular consumer's facade. Preserve existing factory-error reporting rather than disguising the error as an optional provider's absence.

## 4. The activation context

**Approved identity metadata; not implemented:** `context.identity` is a read-only `ActivationIdentity` with `packageId`, `componentId`, `activationId` and `projectOpeningId`. Package ID is the canonical stable package reference; component ID is stable within that package. Activation ID identifies one enabled lifetime and changes on reactivation. Project-opening ID identifies the live opening for a project-scoped activation and is `null` for an application-scoped activation. Application identity does not retarget when project selection changes.

Treat activation and project-opening IDs as opaque temporary identifiers. Do not construct, parse or persist them as durable settings keys. Stable package/component identity remains separate from activation lifetime. These fields are host-supplied descriptive metadata, not native tokens, filesystem locations or proof of authority. Supplying an ID in another call does not authenticate its caller or grant access. The identity shape and author-facing `ComponentIdentity` and `ActivationIdentity` data types are approved. This does not approve the remainder of the context draft below.

**Approved project reference; not implemented:** export `ProjectReference` from `@writers-ide/plugins` with read-only `id`, `openingId` and `name` string fields. Supply `context.project: ProjectReference | null`: a host-issued reference for project-scoped activations, `null` for application-scoped activations. `id` identifies the host's registered local project and survives reopening of that registration. `openingId` identifies one live opening and changes on close/reopen. `name` is display text, not an identity or permission key. The activation remains bound to its opening rather than following selection changes; its identity's project-opening ID matches the reference's opening ID.

The reference supplies no filesystem path, manuscript data, file permission or native credential. Treat the opening ID as opaque and temporary. APIs accepting references validate host provenance and the live opening; copied or reconstructed matching fields are not substitutes for host-issued references. The application-scoped selected-project and connection API is approved below; project-scoped contexts use `projects: null`, as approved below.

**Approved application project-connection API; not implemented:** export `ProjectConnections` and `ProjectApiConnection` from `@writers-ide/plugins`. Application-scoped components receive `context.projects` with `subscribeSelected(listener): Dispose` and `connect(project): ProjectApiConnection`. The connection exposes read-only `project`, `signal` and `commands`, plus `get(alias, contract)`, `subscribe(alias, contract, listener)` and `dispose()`, with the signatures shown below. `commands` uses the shared application `CommandInvoker`, not the editor registry.

Selection subscriptions deliver immediately and on changes, including `null`, and belong to activation lifetime. Each `connect()` creates an independent lease for a valid host-issued live-opening reference, not another provider activation. Keep it project-bound. Use only declared project integrations; do not activate missing providers or grant native access. Dispose idempotently to revoke that lease's facades/subscriptions and abort its signal. Project closure or consumer teardown also ends it. Provider absence alone leaves the lease alive for later availability. Application-scoped contexts expose this service. Project-scoped contexts instead use `projects: null` and their fixed `project` reference. This preserves the initial same-project/instance binding model. A package can separate project-specific work from application coordination into different components. Project-to-other-project connections are future work requiring dependency-binding and lifetime design. No automatic-switching helper is added. These are supported API boundaries, not JavaScript or DOM isolation.

**Approved alias-based provider interface; not implemented:** export `ComponentApis` from `@writers-ide/plugins` and supply it as `context.apis`, using the `provide`, `get` and `subscribe` signatures below. `provide(contract, factory)` publishes a manifest-declared API during synchronous activation; the host calls its factory with `ComponentApiConnection` for a consumer. `get(alias, contract)` uses the consumer's declared dependency alias and exact API ID/major. A declared optional integration may be unavailable and return `null`. Undeclared aliases/contracts and incorrect binding routes are author errors, not normal absence.

`subscribe(alias, contract, listener)` delivers immediately and on availability changes, is activation-owned and returns an idempotent early-release `Dispose`. Releasing a subscription does not revoke connections still used elsewhere. Required providers resolve before consumer activation; these lookup methods do not activate providers on demand or discover global services. Selected-project integrations use explicit project connections instead of the direct route. Publication remains limited to activation setup.

**Approved connection endpoint metadata; not implemented:** export `ComponentApiConnection` from `@writers-ide/plugins`, extending the existing `PluginApiConnection` with read-only `consumer: ActivationIdentity` and `provider: ActivationIdentity`. External provider factories receive this extended connection. Retain `consumerId`, `signal`, `own`, `guard` and `reportError`. Each endpoint describes its actual activation scope: an application activation has `projectOpeningId: null`, even when connected to a project-scoped peer. Metadata supports diagnostics and connection-owned resource association; it does not retarget an activation, grant authority, authenticate arbitrary JavaScript or expose native credentials. Providers still validate operation inputs, and Rust authorizes native operations under the provider's credential.

The following is the **draft SDK contract**, not code exported today. Existing imported types keep their current meaning. `PluginCommand`, `CommandRegistration` and the command-invocation shape are approved future contracts described in the [command guide](command-contract.md), not current exports. Their exact generic declarations must preserve schema inference. `FrontendContext` would be exported by `@writers-ide/plugins`; the SDK entry-point split for native error helpers is part of the build implementation.

```ts
import type {
	CommandRegistration,
	Dispose,
	PluginCommand,
	PluginApi,
	PluginApiConnection,
	PluginContributions,
} from '@writers-ide/plugins';
import type { TaskService } from '@writers-ide/tasks';

type ComponentIdentity = {
	readonly packageId: string;
	readonly componentId: string;
};

type ActivationIdentity = ComponentIdentity & {
	readonly activationId: string;
	readonly projectOpeningId: string | null;
};

type ProjectReference = {
	readonly id: string;
	readonly openingId: string;
	readonly name: string;
};

interface ComponentApiConnection extends PluginApiConnection {
	readonly consumer: ActivationIdentity;
	readonly provider: ActivationIdentity;
}

interface ComponentApis {
	provide<T extends object>(
		contract: PluginApi<T>,
		factory: (connection: ComponentApiConnection) => T,
	): void;
	get<T extends object>(alias: string, contract: PluginApi<T>): T | null;
	subscribe<T extends object>(
		alias: string,
		contract: PluginApi<T>,
		listener: (api: T | null) => void,
	): Dispose;
}

interface CommandInvoker {
	execute<Args, Result>(
		dependencyAlias: string,
		commandAlias: string,
		contract: PluginCommand<Args, Result>,
		args: Args,
		options?: { readonly signal?: AbortSignal },
	): Promise<Result>;
}

interface FrontendContributions<Presentation> {
	toolbar: PluginContributions<Presentation>['toolbar'];
	view: PluginContributions<Presentation>['view'];
	command<Args, Result>(registration: CommandRegistration<Args, Result>): Dispose;
}

interface ProjectApiConnection {
	readonly project: ProjectReference;
	readonly commands: CommandInvoker;
	readonly signal: AbortSignal;
	get<T extends object>(alias: string, contract: PluginApi<T>): T | null;
	subscribe<T extends object>(
		alias: string,
		contract: PluginApi<T>,
		listener: (api: T | null) => void,
	): Dispose;
	dispose(): void;
}

interface ProjectConnections {
	subscribeSelected(listener: (project: ProjectReference | null) => void): Dispose;
	connect(project: ProjectReference): ProjectApiConnection;
}

type LocaleSnapshot = {
	readonly languageTag: string;
	readonly direction: 'ltr' | 'rtl';
};

interface PluginLocale {
	snapshot(): LocaleSnapshot;
	subscribe(listener: (locale: LocaleSnapshot) => void): Dispose;
}

type NativeRequestOptions = { readonly signal?: AbortSignal };

interface ProjectFiles {
	read(path: string, options?: NativeRequestOptions): Promise<Uint8Array>;
	// File-index query and change-subscription contracts still need review.
}

interface ExternalLinks {
	open(url: string, options?: NativeRequestOptions): Promise<void>;
}

type NativeServices = {
	readonly projectFiles: ProjectFiles | null;
	readonly externalLinks: ExternalLinks | null;
};

type FrontendContext<Presentation> = {
	readonly identity: ActivationIdentity;
	readonly signal: AbortSignal;
	readonly own: (dispose: Dispose) => Dispose;
	readonly contributions: FrontendContributions<Presentation>;
	readonly tasks: TaskService;
	readonly apis: ComponentApis;
	readonly commands: CommandInvoker;
	readonly locale: PluginLocale;
	readonly native: NativeServices;
} & (
	| {
			readonly project: ProjectReference;
			readonly projects: null;
	  }
	| {
			readonly project: null;
			readonly projects: ProjectConnections;
	  }
);

interface FrontendEntry<Presentation> {
	activate(context: FrontendContext<Presentation>): void | Dispose;
}
```

The host imports a verified entry module and calls its named `activate` export once per activation after compatibility, dependency and consent checks. A returned disposer must be synchronous. The owner reaffirmed that successful activation means synchronous setup is complete, not that background data is ready. Activation may start managed loads and retain or pass their task handles to feature state/UI. The handles keep settled outcomes available after `activate` returns; task keys identify replaceable work, not a result lookup store. A feature may instead load lazily when its UI needs the data. The host cancels managed work and releases owned resources on teardown or activation failure. Retained services remain revoked after re-enable; re-enable creates new services and identity.

`identity` is read-only diagnostic data, not a credential. No token appears in the public context. Existing `PluginApiConnection.consumerId` remains an opaque runtime owner key for provider diagnostics. Authors use the proposed `consumer`/`provider` metadata for readable identities and must not infer package or project identity by parsing that key.

`project` is fixed for a project component and `null` for an application component. A single imported module may serve several project activations. Keep activation state inside `activate`; module state is neither per-project nor guaranteed to reset on re-enable.

**Approved contribution scoping; not implemented:** contribution IDs are local to the contributing component. The host keys them by `(activationId, contributionKind, localId)`, routes project contributions only to their project's workspace, and stores placement using stable package/component/kind/local IDs plus project association. Temporary activation IDs are not saved placement identities. Registering the same local ID twice for one kind within one activation is an error. Two projects may use `formatting` without colliding. Workspace consumers must not rely on global string IDs to identify another plugin's contribution. This approved direction changes the current globally unique contribution registry contract. It does not change word-processing command, behavior or renderer registration IDs: those remain unique under the existing provider-service rules. Two connection leases do not authorize duplicate registrations in one editor provider.

A dependency alias and a contribution ID are separate names. Functional interaction uses the declared provider API, not a toolbar lookup or simulated click. Where a host API supports referring to another component's contribution, the reference must identify package, component, contribution kind and local ID, with explicit project resolution. Identity alone grants no right to mutate another plugin's UI. Exact cross-component contribution-reference APIs remain open. The illustrative formatting provider discussed during review does not approve a new Basic Menu API or component split.

**Approved application-command purpose:** `context.contributions.command` registers a named application action independently of a UI button. This is distinct from a ProseMirror/editor command and from a typed provider service. The current host can register, invoke and revoke these callbacks; the callback takes no arguments and returns a synchronous boolean. It receives no implicit editor target or native grants. Current application code has no user-facing command routing or plugin-facing command-invocation API. **Approved cross-plugin command policy; not implemented:** invocation requires a declared dependency identifying the provider package, component and local command ID, with a consumer-local alias. Resolve the correct project/window activation; never select an unqualified command by registration order. Different components may reuse a local ID such as `log-output`, and different consumers may reuse an alias. Component dependency aliases are unique within the consumer. Command aliases are unique within each dependency, and invocation supplies both aliases. Required command dependencies participate in activation and removal planning; optional dependencies can be unavailable and do not automatically enable providers. The concrete declaration, registration and invocation shape is approved in the [command contract](command-contract.md), including `definePluginCommand`, component `commands` records, nested dependency-command aliases and `context.commands.execute`. Optional availability reporting and publication-validation details still need specification. Selected-project command dependencies resolve only through the explicit project's `connection.commands`, not root `context.commands`. No command picker or keyboard system is approved.

**Approved command arguments; not implemented:** application commands may declare typed arguments. Invocation validates input against the command's declared contract before executing the action. Argument-free commands remain supported. Callers can specify a target such as a scene ID instead of first changing the provider's selection/private state. A UI or workflow must supply the arguments; registration does not generate an input form or shortcut configuration. Provider APIs remain available for richer services, queries and subscriptions. Standard Schema-compatible validators, inferred types and exact contract-major matching are approved in the command contract. No particular validator library is mandatory. Typed results and per-invocation cancellation are approved below. The current argument-free synchronous implementation is unchanged. Input validation is not frontend isolation or a native permission grant.

**Approved awaitable command completion; not implemented:** command implementations may finish synchronously or return a promise. The invocation API always returns a promise and resolves only when the command's defined action completes, not merely when it starts background work. Synchronous throws and asynchronous failures reject that promise. Short implementations need no asynchronous wrapper. Substantial main-thread work should use the existing cooperative, async or worker task helpers; a promise alone does not offload CPU work. This does not make activation, ProseMirror hooks or editor edit callbacks asynchronous. Compute asynchronously, then request a fresh validated synchronous editor operation. Per-invocation cancellation and shutdown follow the approved policy below.

**Approved typed command results; not implemented:** each command declares its result type as part of its shared contract. The invocation promise resolves with that result, validated against the declared contract before delivery. Commands producing no value declare `void`. Failures reject rather than using a universal handled/success boolean; a boolean may still be a command's explicitly declared result. Consumers can use a result in later workflow steps without reading provider-private state. Standard Schema-compatible result validation, copied data-only values and exact contract-major matching are approved. The extended structured-clone value list, schema-transform semantics and resource budgets still need specification. Raw functions and live service/editor/DOM handles are not command payloads. This does not change the current synchronous boolean-returning implementation.

**Approved command cancellation; not implemented:** each invocation receives its own `AbortSignal`. Abort it on explicit caller cancellation, caller activation end, provider activation end, command removal or closure/disposal of its project connection. Reject the caller's pending promise with a recognizable cancellation/revocation error when the host processes that event. Ignore late success results. Observe late failures without allowing an unhandled rejection after the invocation has settled.

Cancellation is cooperative, not preemption. It cannot interrupt an arbitrary synchronous loop, and a blocked frontend cannot process cancellation promptly. Authors must pass the signal to managed tasks/cancellable operations and check it before further effects. Rejecting the invocation does not prove every underlying operation has stopped. Completed edits/native effects are not automatically rolled back. Cancelling one invocation must not stop unrelated provider work, revoke the provider's other consumers or revoke its activation credential. Provider operations retain their own native authorization; invocation cancellation must be forwarded to applicable requests rather than revoking the whole provider. The registration callback's invocation context and the execution options carry `signal`, as in the approved command shape. Exact error codes and remaining validation details still need specification. The current command registry has none of this per-invocation machinery.

**Approved locale API; not implemented:** expose the `LocaleSnapshot` data type and `PluginLocale` interface from `@writers-ide/plugins`. Supply `context.locale: PluginLocale`. `snapshot()` returns the current application UI locale as `{ languageTag: string, direction: 'ltr' | 'rtl' }`, with read-only fields. `subscribe(listener)` immediately delivers the current snapshot, then delivers changes. The subscription belongs to the activation and stops when it ends. Its returned `Dispose` permits idempotent early unsubscribe. Isolate listener failures so other subscribers still receive updates.

This is the application UI locale, not the manuscript or selected text's language. Plugins own messages and fallback choices; the host does not supply private generated message functions. Official and third-party components use the same API. This approval does not select a translation library or resolve the current application's locale-source integration.

Owning translations does not require implementing translation tooling. Plugins may use supported shared libraries, bundled private dependencies or declared provider APIs. A shared translation helper could handle lookup, pluralization and fallback while each plugin supplies its messages. An optional shared translation provider service is a future candidate, not a Part 4 deliverable or activation prerequisite. Its operations, catalog ownership, lifecycle and fallback behavior need later design. No particular helper library or new catalog service is selected. See the [future-work list](implementation-plan.md#deferred-work-and-future-candidates). Author guidance should make existing reusable libraries and provider contracts discoverable. Private app-generated messages are not a supported plugin API.

## 5. Native permissions and a research component

This complete proposed manifest belongs to `@example/research`. Its project component reads saved research files and opens reference links. The author supplies the built entry at `dist/research.js`.

```toml
manifest_version = 1

[package]
namespace = "example"
name = "research"
display_name = "Research Reader"
version = "1.0.0"
description = "Reads saved project research and opens reference links."

[[components]]
id = "reader"
display_name = "Research reader"
description = "Provides approved project-file reads and opens reference links."
kind = "frontend"
entry = "dist/research.js"
runtime_profile = "writers-ide.frontend/1"
activation_scope = "project"
default_enabled = false
capabilities = []

[[components.permissions]]
operation = "project.files.list"
resource = "project"

[[components.permissions]]
operation = "project.files.read"
resource = "project"

[[components.permissions]]
operation = "external.open"
resource = "http-https"
```

The three operation/resource pairs are approved. Listing and reading are separate requirements; neither implies the other. Reject unknown values and unsupported combinations. `project` means this activation's registered project location, not a path chosen in the manifest. `http-https` permits opening validated HTTP/HTTPS links, not shell execution or other protocol handling.

Common requirements use `[[package.permissions]]`. Effective requirements are the union of package and component records.

**Approved permission duplicate handling:** each operation/resource pair must be unique within the package's `permissions` list and within each component's own `permissions` list. Duplicates within a list reject the whole manifest before plugin code is imported. Report the duplicate pair and conflicting declarations. Declaring the same pair once at package level and once at component level is valid; combine them into one effective requirement for that component. Different components may each declare the same pair. Components cannot subtract inherited requirements or gain sibling authority. This does not change consent rules.

Project-file requirements are only valid on project components, including inheritance. A mixed-scope package must put those requirements on its project components. Application components may require `external.open`. All effective grants are mandatory before activation. Application-wide acknowledgement can cover repeated project consent; it does not merge project activations or retarget handles.

**Approved service availability; not implemented:** unavailable native service groups are `null`. The host exposes `native.projectFiles` only if the activation has at least one file permission; otherwise it is `null`. Each method still checks its own operation. A list-only component receives the file service, but a read attempt rejects with `permission-denied`. `native.externalLinks` is non-null only with its grant. A component with no native requirements receives both groups as `null`. Missing grants do not produce implicit permission prompts from method calls. Rust authorizes every operation independently of frontend object availability.

**Approved saved-file read API; not implemented:** `ProjectFiles.read(path: string, options?: NativeRequestOptions): Promise<Uint8Array>` returns saved bytes. `NativeRequestOptions` is a shared author-facing data type with optional read-only `signal?: AbortSignal`. Authors decode text with `TextDecoder` or parse binary data themselves. Paths are relative to the activation's registered project, not arbitrary filesystem paths or URLs. The host attaches credentials and checks the specific read permission independently of service availability. This is not unsaved editor access, a write API or an unlimited-size read. Cancellation and host resource limits apply; failures reject under the native error model. File discovery uses the index direction below; its query/subscription signatures and numerical work budgets still need review.

**Approved file-index direction; not implemented:** use a project-scoped SQLite index of files and filesystem metadata, not file contents or an authoritative application-document catalog. The filesystem remains the source of truth. Plugins query bounded metadata pages through the host. Finish statements/read transactions before returning each page; retain no filesystem iterator, directory handle, SQLite statement or read transaction between pagination requests.

Use filesystem notifications and periodic reconciliation to maintain the index. Watchers are hints and can miss events. Reconciliation scheduling, freshness/readiness, schema/location, query/continuation and subscription contracts still need review. A manually requested refresh is proposed, not a selected API. Changes do not define project content storage or require the host-management database to hold the index. See the [file-index plan](file-index-plan.md).

Directory views retain project-relative paths, separate metadata/read authorization, no-follow unsupported-entry handling, explicit `'.'` root notation and the approved maximum of 256 entries per page without a caller-selected page size. These constraints do not finalize the new query/result types. Indexing does not guarantee a consistent multi-page filesystem snapshot. Saved-file reads must still validate actual targets and grants; cached metadata is not authority.

For example, this proposed entry starts one managed read during activation. The host supplies `context`; the example supplies the file path. A real feature could start the same task from a user command. `FrontendContext` is a proposed future export; managed `tasks.async` already exists.

```ts
import type { FrontendContext } from '@writers-ide/plugins';

export function activate(context: FrontendContext<unknown>) {
	const files = context.native.projectFiles;
	if (!files) {
		throw new Error('Research reader requires project file services');
	}

	context.tasks.async({
		key: 'read-reference',
		label: 'Read saved reference',
		run: async ({ signal }) => {
			const bytes = await files.read('research/reference.txt', { signal });
			signal.throwIfAborted();
			console.info(new TextDecoder().decode(bytes));
		},
	});
}
```

Permission review must separately explain browser trust. A frontend with content access and network access can disclose data. Native declarations do not restrict browser `fetch`. A provider may share feature results with declared consumers using its own grants. Rust attributes that native work to the provider's credential. Do not expose general native-command proxies or raw credentials through supported APIs. This is an author contract, not hostile-caller isolation.

### Future optional native HTTP service

An optional host-controlled Rust HTTP service is approved future-work direction, not part of this initial native permission set or an implemented API. Authors could choose it or ordinary browser `fetch()`. Managed async tasks do not select the transport or expand authority. The service would use separate native networking, without browser CORS enforcement, so its permissions, destinations, redirects, credential handling and resource limits need explicit design. No context property, HTTP method set, native permission pair or library is selected. See the [future-work plan](implementation-plan.md#future-native-http-service) for the review checklist.

### Native failures and proposed resource rules

Promise rejection and structured errors are approved. The following exact vocabulary and helper names are recommended:

```ts
type NativeErrorCode =
	| 'revoked'
	| 'cancelled'
	| 'permission-denied'
	| 'invalid-input'
	| 'unavailable'
	| 'not-found'
	| 'limit-exceeded'
	| 'unsupported-entry'
	| 'io';

type NativeServiceError = Error & { readonly code: NativeErrorCode };

// Proposed SDK export. It validates an error value; it grants no authority.
declare function isNativeServiceError(value: unknown): value is NativeServiceError;
```

The SDK converts native error envelopes to `Error` objects. Messages are human-readable and may change. Do not expose credentials or absolute paths. Unexpected exceptions remain exceptions, not automatically classified native errors. Uncaught rejections in a managed task follow existing task-failure reporting; cancellation retains task cancellation semantics. The synchronous editor result API is unchanged.

**Indexed directory-view requirements; query API not finalized:**

- **Approved root notation; not implemented:** `'.'` explicitly selects the activation's registered project root, not the process working directory. Reject empty or missing paths; there is no implicit default. Other directories use portable project-relative paths. Reject absolute paths and parent traversal. Returned paths remain project-relative and expose no absolute root location. This does not make the root readable as a file.
- **Approved page-entry maximum; not implemented:** return at most 256 entries per page, possibly fewer, with no caller `pageSize` option initially. The host owns this engineering starting limit; plugins cannot raise it. Smaller caller-requested pages remain a future candidate. Completion signaling, ordering and continuation behavior need indexed-query design. Bound query work and payloads independently of response count.
- **Approved unsupported-entry representation; not implemented:** entries identified as links, reparse points or special files use `kind = 'unsupported'`, alongside `file` and `directory`. Report the project-relative path but no target or contents, and never traverse them. Encountering an identified unsupported entry does not itself fail the directory listing. Attempts to read or traverse it fail. Failed inspection must remain visible as uncertainty/error under the index freshness policy, not silently become deletion or an unsupported classification.
- Query continuations must not own live native resources between requests. Validate each query's activation, live project opening and metadata permission. Continuation representation, retry behavior and consistency across index updates remain open.
- Bound active index scans, watchers, queries and database work. They still need native resource cleanup even though pagination retains no iterator. Timer cadence, notifications and optional manual refresh remain under review.

**Recommended read/work budgets:** at most 16 MiB returned per read, two concurrent saved-file reads per activation, four per window, and 32 MiB of reserved in-flight read payload per window. Reject excess work with `limit-exceeded` instead of accumulating an unbounded queue. Bound link opening separately to two outstanding requests per activation and eight per window; reject URLs over 8 KiB before OS handoff. These are proposed starting defaults for tests and measurement, not a guarantee about total process memory or IPC-copy overhead. Index query, scanning and watcher budgets need separate design. Callers cannot raise them. Streaming and recursive traversal are later work.

Rust must authorize before probing a path. Reject absolute paths and parent traversal. Do not follow symbolic links or junctions/reparse points, even for internal targets. Use opened-handle checks and no-follow access, not a string-prefix test. Prevent directory/link replacement from changing the approved root boundary. Concrete root registration and location validation belong to the native security design in R2.

Reads and metadata queries check cancellation before work, between bounded processing steps and before result delivery. Keep blocking filesystem/indexing work off the UI thread. The approved 256-entry page maximum does not set index-scanning or database work budgets. File reads use bounded chunks, with 64 KiB per step still a proposed value. An individual OS call may not be immediately interruptible. Cancelled queries close their statements/transactions; scans and watchers need their own lifetime cleanup. Suppress late data delivery to revoked activations where the host still controls it, while settling exposed promises with the appropriate error. Index readiness, stale data and reconciliation errors need explicit API handling.

Link opening checks cancellation before work and again with authority immediately before OS handoff. It validates HTTP/HTTPS in Rust. Cancellation cannot undo an already opened link.

Recommended failure mapping:

| Condition                                                     | Code                    |
| ------------------------------------------------------------- | ----------------------- |
| Activation credential revoked / caller signal aborted         | `revoked` / `cancelled` |
| Operation not granted                                         | `permission-denied`     |
| Malformed path or query input                                 | `invalid-input`         |
| Closed project or unavailable service after a valid request   | `unavailable`           |
| Missing requested path                                        | `not-found`             |
| Encountered prohibited link/special file on a read/traversal  | `unsupported-entry`     |
| Query/read/concurrency budget exceeded                        | `limit-exceeded`        |
| Metadata/read/enumeration OS failure not otherwise classified | `io`                    |

Check authorization before disclosing filesystem or indexed metadata. If authority is revoked before delivery, suppress the data while settling the request's promise. Unsupported-entry metadata is not a successful file read or permission to traverse a link. Incomplete or failed reconciliation must not look like confirmed deletion. Index-specific readiness/failure handling and query-continuation validation still need review.

Recursive directory-query behavior is future work. The host indexer's traversal and reconciliation policy need their own bounded design. Plugin-owned native writes, directory-specific grants and safe internal-link support remain deferred as described in the [future-work list](implementation-plan.md#deferred-work-and-future-candidates).

## 6. Global UI and selected-project connections

Explicit connections are approved. The exact validity and ownership rules below are recommendations needed to implement them safely.

An application component declares its project integration like this. This fragment belongs under that component's manifest record:

```toml
[[components.dependencies]]
alias = "research"
package = "@example/research"
component = "reader"
binding = "selected-project"
optional = true

[[components.dependencies.apis]]
id = "example.research-index"
major = 1
```

The provider must separately declare and publish that API. This fragment is an integration example, not a claim that the earlier native-reader example publishes an index.

During activation, global UI calls `context.projects.subscribeSelected`. It receives the current host-issued `ProjectReference` immediately, or `null`. On selection changes it disposes its old connection and calls `connect` for the new reference. It obtains the declared API through that connection's `get`/`subscribe` methods. No provider starts automatically.

**Approved project-reference lifetime; not implemented:** references identify one live project opening. Closing it permanently invalidates its references and connections. Reopening the same saved project creates a fresh opening identity and fresh references. Old references never regain validity. Persistent project registration remains separate for saved settings and permission associations; closing a project does not delete those records. Selection notifications supply the reference for the newly selected opening.

**Proposed reference representation and validation:** `id` identifies the local persistent registration, `openingId` identifies one live opening in this window, and `name` is display data. Host code validates reference objects against an internal issuance registry. Spreading or serializing a reference does not create a usable handle. Display-field equality grants nothing. Rename notifications may supply a new name snapshot for the same opening. Exact field names, object-copy rules and validation mechanics remain under review.

Only references issued by this window's host are accepted. Forged or foreign references throw `TypeError`; closed references and revoked consumer contexts throw an unavailable/revoked connection error. Exact host-error class names are routine SDK details; native errors keep their separate stable code contract. This registry prevents accidental misuse through supported APIs. It is not a DOM sandbox.

**Approved independent connection ownership; not implemented:** each `connect` creates an independent lease. Disposing it revokes every facade obtained through that lease, aborts its provider-connection signals and removes its subscriptions. It does not revoke another lease to the same project. It does not start another provider activation or duplicate the provider's shared feature state. The lease's own signal aborts on disposal, so caller work tied to that signal can stop. Cache facades by lease plus provider activation and contract. Provider absence leaves the lease alive for later availability; project closure ends it permanently.

Consumer teardown disposes all leases. Disposing a selection subscription only stops that subscription; it does not dispose separately created leases. Top-level guarded API calls are revoked, but returned values and arbitrary nested resources are not recursively wrapped. Providers must bind their asynchronous work to connection lifetime where appropriate. Do not cancel unrelated provider work.

When a selected project closes, first mark the opening unavailable and revoke connections, then notify selection listeners with the next selected reference or `null`. Isolate listener failures and deliver notifications serially. Defer lifecycle mutations until notification callbacks return, as in the current host. Application-owned tasks do not automatically end on project selection changes: pass the project connection's `signal` to tasks that belong to that connection.

This surface does not give application components native file handles. File work happens in project providers under the provider's authority. Removing a consumer connection prevents further supported calls through it; it neither retracts delivered results nor automatically revokes the provider's separate grants.

## 7. Builds, assets and activation checks

The proposed package uses ordinary files such as:

```text
manifest.toml
dist/toolbar.js
dist/toolbar.css
dist/assets/icon.svg
dist/workers/analyze.js
```

Frontend modules are native ES modules. The host installs its runtime profile's import map before any dependent module executes. Both the host and plugins must consume the same actual shared runtime artifacts. Building a second bundle that merely re-exports another copy does not establish identity.

### Stylesheet loading and ordering

**Approved direction; production loading is not implemented.** `styles` lists component entry stylesheets. The host loads verified CSS before calling the component's `activate` function. It shares stylesheet ownership by immutable snapshot/path within each window. Activation failure or teardown releases that activation's ownership. A stylesheet stays loaded until its last owner releases it.

The host processes each component's list in order. It appends a stylesheet only if it is not already loaded. It reuses existing links without moving them.

**The `styles` list does not guarantee CSS order when files are already shared.** For example, suppose another active component in the same package snapshot already loaded `shared.css`. Your component declares:

```toml
styles = ["toolbar.css", "shared.css"]
```

The existing `shared.css` stays in place. The host appends `toolbar.css` after it. The resulting order is `shared.css`, then `toolbar.css`, despite your list's order. If both files were unloaded, they would be appended in your declared order. The host does not resolve ordering conflicts or rearrange existing links for a new activation. There is no global cascade-order guarantee between activations.

Bundle CSS into one file when its internal order matters. Scope selectors to your UI and avoid relying on another plugin's private CSS. This policy manages shared resources; it does not isolate CSS or prevent it from affecting other UI. Relative font/image loading must use verified snapshot resources.

### Workers and verified resources

Each worker is one self-contained ES-module bundle with its own dependencies, including worker SDK helpers. It neither inherits the window import map nor shares runtime objects. For managed package workers, authors supply a package-relative URL from their frontend module, such as `new URL('./workers/analyze.js', import.meta.url)`, to the managed task API. The approved host path obtains verified bytes and always creates a Blob worker. Task cleanup terminates the worker and revokes the Blob URL, including startup failure and cancellation. Inside the worker, `import.meta.url` is the Blob URL, not the frontend module's package URL. Relative worker imports and package-relative assets are unsupported. Pass needed data through messages or transfers. Main-thread selection through `module: URL` is approved below; production integration remains unimplemented.

The internal [resource route](../../src-tauri/src/plugin_resources/route.rs) now implements the policies below and is used by the standalone fixture. It is a native-only helper, not a frontend SDK or a registered application protocol. Application loading and native authorization remain unimplemented.

The approved resource path shape is `/snapshots/<snapshot-id>/<package-relative-path>`. Snapshot identity comes from the complete verified record's SHA-256 fingerprint. The host supplies entry URLs; authors treat the generated prefix as opaque. Package names, namespaces and versions stay in installation metadata rather than route segments.

Portable filenames, including spaces and non-English characters, are approved. Construct resource URLs by encoding each filename segment. Decode and validate requested segments exactly once before exact snapshot lookup. Reject malformed escapes, encoded separators and traversal; do not change filename case or normalization. Existing nonportable-path restrictions remain.

Resource URLs with query components are rejected; parameters do not select versions or transform files. Build tools must resolve source-level `?raw` and `?worker` conventions before distribution. Browser fragments are not sent to the native handler and are not blocked by query rejection.

Resource responses will initially use `Cache-Control: no-store`. The Rust pool still retains verified bytes; imported modules remain subject to the separate browser module cache. Browser-response caching is deferred until WebView association checks can be shown to remain effective. Packaged verification is required; the header is not proof of enforcement. The host will assign MIME types to supported formats, including JavaScript, CSS, JSON, images, fonts and WebAssembly. Unfamiliar extensions remain fetchable as bytes with `Content-Type: application/octet-stream`. Send `X-Content-Type-Options: nosniff` and do not infer types from file contents. This adds neither author-defined MIME overrides nor approval for plugin HTML application pages.

The resource route supports `GET` and `HEAD` with the same WebView association checks, path validation and verified-file lookup. `HEAD` returns the corresponding metadata, including file length, without the body. Unassociated WebViews cannot inspect it. Other methods are rejected; the route never modifies files. This is separate from ordinary external POST requests and supported native service operations.

Cross-origin reads of package resources are limited to the application's plugin-hosting origin. No wildcard allow-origin or blind reflection of request origins is approved. A configured development-server origin may be allowed in development builds only. Packaged builds must not inherit it. Rust still checks the actual WebView association; CORS is neither plugin isolation nor native authorization. This does not determine which external APIs a plugin may call.

Package resources will use a dedicated host-controlled origin separate from the application's page and built-in assets. The exact scheme/hostname spelling is host-owned, opaque to authors and potentially platform-dependent. The approved snapshot paths and CORS rules apply there. A separate resource origin does not isolate imported modules; they execute in the importing page's environment.

The supported JavaScript loading path permits host code and verified package modules. Direct remote JavaScript imports and script loads are unsupported. Authors must bundle executable dependencies or emit package-local modules. Remote data requests remain a separate policy. Production CSP must reflect this source restriction. This does not add frontend isolation or change the approved Blob-worker path.

JavaScript string evaluation is blocked. Production CSP must not enable `unsafe-eval`; `eval` and `new Function` are unsupported. Ordinary functions, commands, ProseMirror hooks and precompiled Svelte components remain supported. Authors must use compatible libraries or generate code at build time. This applies to the hosting WebView, not an isolated plugin.

Frontend plugins may compile and run WebAssembly bundled in verified package files. Validate CSP's selective `wasm-unsafe-eval` allowance without enabling JavaScript `unsafe-eval`. Never relax the JavaScript restriction as a compatibility fallback. Report unsupported runtime behavior. Heavy computation should use managed workers; main-thread WebAssembly can still freeze the UI. This adds no native authority, backend components, native libraries, WASI host services or shared-memory threading support.

The packaged macOS fixture passed 27 normal and seven recovery checks. It exercises the shared route's encoded paths, GET/HEAD metadata, binary MIME and headers. Verified WebAssembly runs in the main WebView and a Blob worker while JavaScript evaluation remains blocked. Remote script loading and a direct remote import from the actual bootstrap graph produce enforced CSP violations. External module entry tags have no nonce; the import map alone uses one.

The route's extension map is implemented in the shared source. Exact application origins and CSP integration remain planned. The helper selects no development origins automatically. The future owner must select development-only configuration without leaking it into packaged builds. Other supported platforms and macOS 13.3 still need packaged validation; production application loading remains unwired.

Blob loading is approved for managed workers, but production integration and broader platform validation are outstanding. The [resource-loading prototype](resource-loading-investigation.md#packaged-observations) passed its normal and recovery checks on macOS 27.0.1. Direct custom-resource workers failed; self-contained verified-byte Blob workers worked, but changed the module base and did not support relative worker assets. Other supported runtimes and production integration still need validation. Do not enable external loading to conduct those experiments.

### Candidate runtime profile inventory

The recommended profile name is `writers-ide.frontend/1`. Its inventory must become a generated, tested release artifact, not a promise inferred from a package version range. Repository inspection found these exact installed versions:

| Shared runtime          | Current version |
| ----------------------- | --------------- |
| Svelte compiler/runtime | `5.57.3`        |
| `prosemirror-model`     | `1.25.13`       |
| `prosemirror-state`     | `1.4.4`         |
| `prosemirror-view`      | `1.42.9`        |
| `prosemirror-transform` | `1.12.5`        |

**Approved author SDK boundary; export audit and implementation outstanding:** expose an explicit, reviewed list of plugin-author exports through the runtime profile. Do not automatically expose every current workspace-package export as a supported external-plugin API. Keep application setup APIs separate from the author-facing surface. This does not ban constructors: expose them when they serve a supported plugin use case. It does not narrow approved editor extensions or shared Svelte/ProseMirror access, grant native authority or provide frontend isolation.

Recommended window specifiers include the five plugin-facing entries: `@writers-ide/plugins`, `@writers-ide/plugins/svelte`, `@writers-ide/word-processing`, `@writers-ide/word-processing/svelte` and `@writers-ide/components`. Also review author-facing exports for `@writers-ide/tasks`. Current root exports include host/service construction helpers such as `createWordProcessingService`, `createWordProcessingConnection` and `createTaskService`. Audit their consumers and intended use before approving the exact external export list. Application setup code must retain the construction APIs it needs. Separate entry-point names, including any `/host` paths, remain undecided; examples discussed during review did not approve those names. Exact exports and entry points require review before implementation. The [SDK export review](sdk-export-review.md) now inventories current symbols, consumer evidence and proposed author/setup boundaries. Its first approved author group is `definePluginApi`, `PluginApi<T>`, `PluginApiIdentity`, `Dispose` and `PluginApiConnection` from `@writers-ide/plugins`. The approved Svelte UI group is `defineSveltePresentation`, `SveltePresentation`, `SvelteToolbarContribution` and `SvelteViewContribution` from `@writers-ide/plugins/svelte`. The helper creates typed component/props descriptors; contribution registration leaves placement and rendering with the host and does not itself open a view tab. Activation-context types, other proposed exports and application setup entry points remain under review.

**Approved word-processing consumer export group:** expose `wordProcessingApi`, `WordProcessingApi`, `EditorTarget`, `EditorSnapshot`, `WordProcessingSnapshot`, `EditorContext`, `EditorReadOptions`, `EditorEditOptions`, `EditorResult` and `EditorFailureReason` from `@writers-ide/word-processing`. These support observations, validated targets and synchronous inspection/transaction building with trusted ProseMirror objects. Do not retain callback editor objects or unfinished transactions across asynchronous boundaries. This does not finalize other editor registration export groups, service constructors or application wiring. Another editing engine may expose a different typed provider API; the generic host does not require ProseMirror. Editor replacement and cross-engine document interoperability need separate design. Production profile integration remains outstanding.

**Approved editor-command export group:** expose `EditorCommandRegistration` and `EditorCommandSnapshot` from `@writers-ide/word-processing` and retain its synchronous editor command registry. Keep it distinct from typed shared application commands. The [author guide](command-contract.md#choose-an-editor-command-or-an-application-command) explains when to use direct editor execution, named editor registrations, shared feature actions or provider APIs. This does not add upstream `prosemirror-commands` to the profile or decide project-owned command implementations. Production profile integration remains outstanding.

**Approved behavior-extension export group:** expose `EditorBehaviorContext`, `EditorBehaviorRegistration` and `EditorBehaviorSnapshot` from `@writers-ide/word-processing`. Use `registerBehavior()` to install supported ProseMirror plugins with per-view creation and connection-owned cleanup, rather than direct editor reconfiguration. Immediate-result hooks remain synchronous. Maintain bounded or incremental work for large documents. This decision excludes schema changes and does not approve the remaining renderer export groups. Production profile integration remains outstanding.

**Approved renderer export group:** expose `EditorRendererContext`, `EditorNodeViewRegistration` and `EditorMarkViewRegistration` from `@writers-ide/word-processing`. Expose `defineSvelteNodeView`, `defineSvelteMarkView`, `SvelteContentDOM`, `SvelteNodeViewProps`, `SvelteMarkViewProps` and `SvelteViewOptions` from `@writers-ide/word-processing/svelte`. These support existing schema types through managed registration, with optional Svelte UI and a stable ProseMirror-owned editable subtree. Preserve registration conflict, removal and failure handling. This does not add schema types, redesign pagination or guarantee arbitrary custom layout compatibility. Production profile integration remains outstanding.

**Approved managed-task export group:** expose `TaskService`, `TaskOutcome`, `TaskHandle`, `CooperativeTaskHandle`, `TaskContext`, `TaskOptions`, `CooperativeTaskOptions`, `ForEachTaskOptions`, `AsyncTaskOptions`, `WorkPriority`, `WorkProgress` and `WorkStatus` from `@writers-ide/tasks`. The host supplies the activation-owned service and shared cooperative queue. Callbacks remain short; promise-based execution does not offload CPU work. Service disposal affects its owned tasks, not the shared queue. Advanced scheduler construction and external worker selection have separate approvals below. Production profile integration remains outstanding.

**Approved advanced scheduling exports:** also expose `WorkQueue`, `WorkOptions`, `WorkHandle`, `createTaskService`, `TaskServiceOptions` and `TaskFailure` from `@writers-ide/tasks`. These are advanced construction tools alongside `context.tasks`, not a replacement for it. Recommend the host-managed service for ordinary plugin work. An independent queue has its own scheduling budget and requires explicit lifetime, cancellation and error handling; it does not offload main-thread work. See the [advanced-use guide](../../packages-js/tasks/README.md#advanced-use-create-an-independent-queue). Production profile integration remains outstanding.

**Approved tooltip presentation context; production integration outstanding:** registered Svelte toolbar and workspace-view presentations receive host-supplied tooltip context through the shared components runtime. The host owns the manager, renderer, overlay placement/stacking, docking suppression and lifetime. Ordinary plugin controls supply labels and content without creating a manager. Preserve this context during presentation mounting. Independent UI trees may use explicitly owned local scopes through the advanced exports approved below. Arbitrary Svelte roots do not inherit context by DOM placement, and separately mounted editor renderers are not covered by this presentation guarantee. Ordinary and advanced UI exports are approved below.

**Approved ordinary UI exports:** expose optional `IconButton`, `Tooltip` and `TooltipData` from `@writers-ide/components`. Tooltips support rich Svelte snippets and author components. The current wrapper separates trigger children from the named tooltip-content snippet; use explicit target association where needed. `IconButton` includes its tooltip and falls back to its accessible label. Interactive popovers need separate focus/dismissal design. This approval does not rename props or add parent inference. Advanced tooltip exports are approved separately below. Selects, comboboxes and virtual lists are future shared-library work, with APIs and behavior still to design; they are not current profile exports or Part 4 prerequisites.

**Approved advanced tooltip exports:** expose `TooltipProvider`, `TooltipState`, `Pointer`, `getTooltipManager` and `provideTooltipManager` from `@writers-ide/components`, including the current reachable manager state, debouncer, fields and calibration methods. Use host context for normal contributions and explicit local ownership for independent scopes. Context helpers do not transfer manager ownership; a supplied manager stays caller-owned. Keep one renderer per scope and do not attach a disposable renderer to the host manager. See the [advanced guide](../../packages-js/components/README.md#advanced-tooltip-composition). Production profile integration remains outstanding.

**Approved advanced word-processing construction exports:** expose `createWordProcessingService`, `createWordProcessingConnection`, `WordProcessingSources`, `WordProcessingService` and `EditorBehaviorFailure` from `@writers-ide/word-processing`. Authors supply and own editor views and source notifications, own service disposal, and publish connection-scoped facades through the same provider API. Ordinary consumers use their declared editor dependency. The helpers do not create/destroy views, supply a schema or expose application singleton wiring. Do not use another service to bypass the existing editor lifecycle or invariants. See the [provider guide](../../packages-js/word-processing/README.md#provider-wiring). Production profile integration remains outstanding.

**Approved ProseMirror inventory and project-owned editing direction; not implemented:** the initial shared ProseMirror inventory consists of `prosemirror-model`, `prosemirror-state`, `prosemirror-view` and `prosemirror-transform`. Support their public root ESM namespaces; exact versions and release artifacts still require verification. Writer's IDE will own its keybindings, schema definitions, history, editing commands and input-rule facility. Do not include upstream `prosemirror-keymap`, `prosemirror-schema-basic`, `prosemirror-history`, `prosemirror-commands` or `prosemirror-inputrules` as supported shared imports in this initial profile.

Plan project-specific replacements for the functionality needed from `prosemirror-commands`. Formatting rules remain feature-owned, not part of the generic plugin architecture. Design a project-owned input-rule facility for typing-triggered transformations. Its registration, precedence/conflict handling and undo behavior require separate approval. These directions do not approve exact replacement APIs, remove existing upstream usage or make every replacement a Part 4 prerequisite. Scope and sequencing must be reviewed separately. Existing smart-punctuation proofs still use upstream input rules. Excluding a package from shared imports is not a blanket ban on compatible privately bundled libraries.

Duplicate instances of the four shared ProseMirror packages can break existing `instanceof` checks. Keep their transitive identity-sensitive dependencies consistent too. The root packages' export lists and transitive graph must be captured in the generated profile manifest.

**Approved public Svelte runtime inventory; production integration outstanding:** support `svelte`, `svelte/store`, `svelte/reactivity`, `svelte/reactivity/window`, `svelte/transition`, `svelte/motion`, `svelte/easing`, `svelte/attachments`, `svelte/events` and `svelte/legacy`. Resolve these imports to the host's supported shared Svelte runtime. Verify the paths and exports against the selected version before finalizing the profile. The compiler is build-time tooling, not a host-provided plugin import; authors distribute precompiled components.

Compiler-generated internal imports are a separate compatibility requirement, not a public author API. Generate the required specifier list from actual compiled fixtures and test it; do not expose arbitrary internals through a prefix wildcard. The source investigation observed `svelte/internal/client`, `svelte/internal/disclose-version` and `svelte/internal/flags/legacy` in relevant production output; that is not proof of a complete profile. Type-only `svelte/action` and `svelte/elements` need declarations, not import-map entries.

**Approved initial async compilation policy; profile integration not implemented:** the initial profile does not support Svelte's experimental async compilation mode. Recommended builds must leave `experimental.async` disabled. Ordinary async functions, standard `{#await}` blocks, managed tasks and workers remain supported. This is a compiler-output compatibility policy, not source-syntax policing or a security guarantee for arbitrary trusted JavaScript.

Add async compilation support as future work once Svelte makes it non-experimental. Before enabling it, verify the selected compiler/runtime combination, generated imports, shared-runtime scheduling/effect behavior, pending/error boundaries, plugin disable/remount cleanup, synchronous editable-content mounting and pagination/layout invalidation. Stability alone does not automatically enable support in an existing profile. See the [future-work list](implementation-plan.md#deferred-work-and-future-candidates).

**Remaining proposed compiler settings:** use production client compilation with tracing features off initially. Tracing policy, browser/client resolution and the exact supported compiler/runtime combination still need review or verification. The async-mode decision does not approve those other settings.

**Approved worker-side exports:** expose `defineTaskWorker` and `TaskWorkerScope` from `@writers-ide/tasks/worker`. The helper connects one supplied calculation to the managed task message protocol, returning a result or serialized error, with optional transferable results. Use fresh workers and terminate them on cancellation. The main-thread selection contract is approved below; the current construction callback is not the external loading API. Production verified-byte worker loading remains outstanding.

**Approved main-thread package-worker selection; not implemented:** call `context.tasks.worker()` with `module: URL`, constructed relative to the calling frontend module using `new URL('./worker.js', import.meta.url)`, plus task identity and input. Build tooling must preserve or rewrite the reference to the emitted worker file. The host accepts only allowed files in that activation's verified package snapshot, obtains verified bytes and creates a fresh Blob worker. Reject remote, arbitrary filesystem and foreign-snapshot URLs without fallback. Return the existing task handle and terminate/revoke on completion, failure or cancellation, including loading/startup failures. External selection replaces a caller-supplied `createWorker()` factory; it does not remove current standalone library/test construction support or choose setup entry-point names.

`@writers-ide/tasks/worker` is bundled into workers. The existing public root exports and supporting types of `@writers-ide/layout` are approved advanced shared imports for independent layouts. They do not expose the application workbench or replace contribution APIs. Drag-peer module/context integration and stylesheet delivery remain outstanding; transitive dependencies are not automatically direct author imports. Tauri invocation APIs and opener are not supported author imports in this profile. Private dependencies such as icon libraries can be bundled. A missing import-map entry is a compatibility error, not native access control against trusted same-realm code.

### Recommended activation sequence

1. Choose normal or recovery startup before importing packaged modules. Recovery loads only app-owned management code.
2. Parse and validate package candidates in bounded staging. Obtain explicit installation/trust acceptance and store accepted digests outside package files. Installation does not automatically activate components.
3. Resolve reviewed component selections, dependencies, profiles and mandatory grants for the window/project opening. Recheck impact plans before execution.
4. Verify accepted bytes and retain immutable resources. No filesystem fallback or HTML fallback may serve missing package modules/assets.
5. Have Rust authorize an activation record and credentials through the approved control protocol. Load styles and the module, then run synchronous activation. Revoke credentials and release resources on failure.

The sequence is not a token issuance protocol. The native authority design below remains a gate. Existing editor transactions, behaviors, renderers and pagination remain unchanged.

## 8. Native bootstrap, persistence and recovery

**Approved native activation gate; not implemented:** authorize a pending activation only after checking installed identity, scope and grants. Native service calls made during synchronous setup return pending promises but must not perform native operations. After `activate` returns successfully, the host confirms setup and Rust permits native execution. Setup failure or revocation invalidates the pending activation and rejects its waiting calls. Confirmation failure must not release the gate. Bound pending requests and release their resources on failure. The authorization/attachment flow below is approved. Exact wire commands, limits, deadlines and host-disconnection handling still need specification and tests.

Current task callbacks run immediately; the gate belongs to protected native service delivery, not task scheduling. Authors may start managed initial loads during activation but cannot use their native results to complete synchronous setup. The gate does not contain browser/JavaScript effects, make native operations transactional or roll back effects after successful activation.

The separate management/recovery WebView responsibility boundary is approved. The Rust-authorized one-use attachment flow below is approved; its wire format and failure/recovery details remain to be specified. The current app exposes `greet` and opener commands, with `core:default`, `opener:default` and `csp: null`. Opener includes native routes outside the proposed credential service. A manifest declaration does not fix those routes. Audit and restrict them before external loading.

**Approved control boundary; not implemented:** Rust owns accepted installations, grants, project registrations and activation records. An app-owned management/recovery WebView runs without plugin imports and submits reviewed plans. Tauri must validate the real invoking WebView identity and route capabilities, not a caller-supplied window label. Plugin-host WebViews must not issue grants, create management WebViews, navigate them or call a generic credential-issuance endpoint.

**Approved activation attachment flow; not implemented:**

1. Rust resolves an exact activation plan: accepted package snapshot, component, project opening where applicable, target host/window/WebView, dependencies and effective grants. Frontend identity/grant arguments are not authoritative.
2. New authority or dependency enablement receives required review through the plugin-free management WebView. Normal startup with unchanged approved requirements does not require another prompt.
3. Rust creates a pending activation and an opaque one-use attachment ticket bound to that authorization and target WebView. The ticket cannot select another component or expand authority.
4. The intended frontend host redeems the ticket. Rust checks the actual invoking WebView, ticket validity and current authorization, consumes the ticket once and supplies an activation-specific credential to private service adapters. Reject reuse and foreign-WebView redemption. Reject stale authorizations if the accepted snapshot, grants or project opening changed; do not silently retarget them.
5. The host supplies the context, runs synchronous setup and confirms success. Only then does Rust allow protected native execution. Setup failure, project closure or revocation invalidates pending authority and waiting calls.

Tickets and activation credentials are temporary, not persisted in SQLite. Rust owns their state and cleanup. Exact IPC envelopes, confirmation authentication, expiry, redelivery/response-loss behavior and abuse tests still need specification. A ticket authenticates an authorized attachment and target WebView, not the originating JavaScript in a shared frontend. Using a separate manager does not make credentials there immune to hostile interference.

This separates permission management from plugin execution, at the cost of another app-owned WebView and lifecycle coordination. It does not isolate plugins from one another in the editor or prove which JavaScript used an activation credential. The ticket-based authorization/attachment model is approved. Its exact control commands, credential delivery mechanics and persistence/recovery protocol still require design and security review. Do not introduce an issuance shortcut while these contracts are unresolved.

**Approved registry storage; not implemented:** use SQLite for host-managed package records, component selections, project registrations, permission acknowledgements and staged-update/recovery associations. Keep immutable package files in separate installation directories. Accepted integrity metadata belongs in host-managed records outside package-controlled files. Activation credentials remain temporary and are not persisted. This choice does not select the project document format or future plugin-owned data storage.

SQLite transactions keep related registry changes consistent, but do not make filesystem changes transactional. The acceptance ordering below is approved. Exact schema/migrations, Rust bindings, durability settings and platform-specific file/database operations still need implementation design and validation. No SQLite dependency is added by this decision.

Immutable accepted package records, staged replacements, component selections, project registrations and acknowledged authority live in host-managed storage, not shared project files. Root paths are validated and associated locally. Persist the accepted authority and enough artifact identity to detect requests for additional authority on update. Grant acknowledgement and execution scope remain separate. Exact serialized formats and crash-recovery mechanics need an implementation design; project location matching needs native platform evidence.

**Approved installation acceptance point; not implemented:** extract into bounded staging, validate the candidate and obtain required installation consent. Finish durably publishing that exact candidate into a new immutable installation directory without overwriting the accepted/running version. Only then commit the artifact location, accepted integrity association and installation state together in SQLite. That transaction's commit is the acceptance point; directory presence alone never permits loading. Installation consent is not a substitute for mandatory native grant review.

A crash before acceptance leaves incomplete staging or an unreferenced artifact, neither executable. Cleanup must first confirm no valid references remain. After acceptance, the record points to a completed artifact, but contents still require verification before use. Missing/changed files block loading rather than triggering rehashing or automatic fallback. Updates remain staged until restart. Exact durability primitives, orphan/reference handling and crash tests need platform-specific implementation and validation.

Never silently regenerate accepted hashes after a mismatch or treat a portable project ID as permission. Reopen a validated location with unchanged grants; a copy needs new local acknowledgement unless an application-wide grant covers it. Relinking a moved project is explicit and reviewed.

Stage package updates for restart without replacing current-session resources. Retain one previous accepted artifact as the recommended initial recovery budget. If a new component fails, leave it disabled and keep unrelated healthy components active subject to dependencies. Do not automatically execute the prior version. User-confirmed restoration is package-wide and restart-required. Explain that older code may not understand data changed by the newer version.

Recovery launch must be available before plugin imports, including official packages. Recommend a native launch flag plus a documented desktop recovery entry where supported. It must expose app-owned controls for disabling components, reading recorded failures and staging restoration. Preserve saved choices unless explicitly edited. It cannot recover unsaved work from a frozen process. Automatic interrupted-startup suggestions remain deferred.

**Approved unsafe-registry recovery; not implemented:** if the registry is corrupted, has an unsupported schema version or otherwise cannot be read safely, enter plugin-free recovery before importing packaged code. Preserve the database and package files. Do not use uncertain grants, silently replace the registry, or regenerate accepted hashes from files on disk. Reset or restoration requires explicit user action through app-owned management. **Approved backup authority policy:** validated installation metadata and component choices may be recovered, but recovered native approvals remain inactive pending explicit renewed acknowledgement. Restoring configuration alone must not restore authority or silently undo later revocations. Preserve project-specific versus application-wide scope in the review. A recovery plan may collect acknowledgements together; it must not treat a generic restore confirmation as permission consent. Verify package bytes against recovered accepted integrity records before use. Tickets and activation credentials are never recovered. Exact backup validation, restore transactions and crash recovery still need design. Normal first-launch initialization is separate; temporary database locks are retryable access failures, not evidence of corruption. This detected-registry-failure policy is distinct from deferred automatic suggestions after an interrupted startup.

The precise persisted transaction/recovery protocol and management flow need review under R2. No backend execution or logging subsystem is included.

## 9. Basic Menu extraction and implementation slices

Basic Menu already uses the public editor provider. It still imports app-owned formatting helpers, pagination-aware peer-selection/grouping code, generated translations, utility functions and an icon. A directory move alone would not make it independent.

**Approved initial extraction boundary; not implemented:** move formatting rules into the menu package. Extract only the continuation-aware selection/grouping helpers that those rules need into a reusable, explicitly imported library boundary. Preserve current model-mutating pagination and continuation semantics. Do not copy the whole paginator into the package or expose every app action as a generic plugin API. Keep the helpers read-only over supplied ProseMirror state, without DOM measurements, transaction dispatch or application singletons. Basic Menu and alternative formatting plugins can import them; formatting rules remain feature-owned. Returned nodes/positions belong to the supplied state and must not be retained across an asynchronous boundary or state change. Audit the exact helper dependency graph before approving that library's exports.

Provider-supplied structure queries are a future candidate, not a Part 4 requirement. They could let consumers ask the connected editor for selected block groups without choosing a model-specific helper library. The provider may reuse the same library internally. Exact methods, result shapes and compatibility across document models need later design. The illustrative `groupSelectedBlocks` and `structure.selectedBlockGroups` names are not approved exports.

Use the approved `context.locale` API for UI language selection and direction, with package-owned messages. Official and third-party components receive the same locale API. Its `LocaleSnapshot`/`PluginLocale` shape and subscription behavior are approved; implementation and the continuation helper surface still need review under R4. Reusable translation tooling remains optional. Small package-local utility/icon moves can then be routine implementation work.

Preserve horizontal toolbar cost `2`, vertical cost `1`, caret mark behavior, superscript/subscript exclusion, continuation-aware alignment/indentation, stale-target checks, focus behavior and undo. No new schema types, undo-tree plumbing or independently replaceable pagination are included.

Implement in reviewable slices:

1. **Manifest/resolver contracts:** parser, schema budgets, aliases, dependency scopes, version matching and pure validation tests. No external imports.
2. **Fixture-only loading prototype:** immutable verified routes, shared runtime identity, Svelte mount/unmount, CSS/assets, workers, candidate CSP and packaged-platform evidence. No installer or permission issuance.
3. **Native control and services:** approved issuance/grants/storage protocol, no-follow project registration, cancellation, paged reads and denial tests. Remove alternate native bypasses.
4. **Installation and recovery management:** reviewed plans, durable staging, consent, project registration/relink and recovery entry. Exercise crash/failure paths before enabling packages.
5. **Packaged features:** Basic Menu and the existing UI, behavior, worker and renderer examples through the same supported loader and APIs.

Each slice updates current context and the same in-progress changelog entry. Do not enable arbitrary external packages until authorization, safe extraction/delivery and packaged-runtime enforcement pass.

## 10. Consolidated review decisions

These groups organize the remaining decisions. They are reference material for reviewing one question at a time. Mark individual policies approved as decisions are made; do not treat a whole group as approved because one item was accepted.

| Decision                                       | Recommendation and implication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1 — Manifest and author contract**          | Finalize sections 2–6: remaining manifest/SDK details, structured errors and the indexed metadata query/subscription contract. File discovery uses the SQLite file-index direction; pagination retains no native enumeration or database resources between requests. Nullable native-service groups with per-operation checks and explicit `unsupported` listing entries are approved. Live-opening reference shapes and lifetimes are approved; native validation integration remains outstanding. Independent project-connection lifetimes are approved. Local contribution IDs with host-managed runtime and saved identity are approved. The shared command contract shape is approved. Remaining non-command contracts and command edge semantics still need review. | Needs owner approval.                                                                                                                                                        |
| **R2 — Native control and durable management** | Use Rust-authoritative plans and a plugin-free management/recovery WebView. Reject all alternate authority paths. The responsibility boundary is approved; draft exact issuance, persisted transaction and recovery protocols next. This adds native lifecycle work and another app-owned UI boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Management/recovery WebView, SQLite registry, activation gate and one-use attachment flow approved; exact wire protocol, schema and crash recovery still need specification. |
| **R3 — Runtime profile and delivery**          | Use the candidate shared inventory in section 7. Use the fixture-only packaged prototype to measure origins, CSP, shared instances, CSS and workers across supported runtimes. Finalize routes and profile artifacts from evidence, not assumptions. No external loader is enabled by the prototype.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Candidate contract; limited macOS fixture evidence recorded. Production integration and other supported runtimes remain unverified.                                          |
| **R4 — Basic Menu dependencies**               | Keep formatting rules in the feature package, extract a minimal continuation-aware helper boundary, and expose host locale state rather than app-generated messages. This preserves behavior without private application imports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Locale API shape/exports and imported continuation-helper approach approved; locale integration and exact helper exports remain outstanding.                                 |

Routine choices such as internal filenames, generated import-map ordering and tuning measured limits within the agreed bounded model do not need separate questions. Changes to authority, lifetime, public contracts or compatibility do.

### Validation required before implementation is called complete

- Parse both complete TOML examples; reject unknown/duplicate fields and invalid scope/permission combinations.
- Test version precedence, prerelease exclusion, aliases, lifecycle-only/multiple-API dependencies, optional arrival and reviewed enable/disable plans.
- Test multiple projects, close/reopen, foreign/stale/copied references, independent leases, provider failures, ownership IDs, retained services and cancellation.
- Test indexed query/continuation validation, changes between pages, watcher loss/reconciliation, partial-scan failures and resource bounds. Verify actual reads reject special files and link/root swaps on native platforms.
- Verify no missing/revoked/forged credentials or alternate command routes can bypass native checks. Test a real packaged application, not only mocked IPC.
- Prove shared Svelte/ProseMirror identity, stylesheet lifecycle, verified relative assets and worker cancellation on the [prototype matrix](resource-loading-investigation.md#runtime-origin-questions-and-platform-matrix).
- Regress typing, selection, formatting, undo, toolbar placement/capacity and pagination with packaged Basic Menu.

This document is a review draft. It does not claim those tests passed or that the proposed SDK types are exported today.
