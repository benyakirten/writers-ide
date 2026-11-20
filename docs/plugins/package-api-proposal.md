# External plugin manifests and author APIs

**Status: proposal for review.** This document combines the approved Part 4 direction with proposed manifest fields and APIs. It does not authorize implementation of the new contracts. External installation, component loading and native services are not implemented. The internal Rust integrity module is implemented separately.

A plugin author builds JavaScript, CSS and assets, then distributes them in a ZIP. The application installs that package. When a component is enabled, the host imports its entry module and calls its exported `activate(context)` function. The host supplies services for that activation. Authors do not call `activate` themselves.

Read the [implementation plan](implementation-plan.md#part-4--external-packages-and-user-facing-trust) for approved scope. The [current author guide](../../packages-js/plugins/README.md) describes the bundled API that works today. Examples below target this proposal instead.

## 1. What is already approved?

- Packages install and update as a unit. Components activate independently.
- Components declare project or application scope. Application scope means one activation per window/host.
- Frontend components export synchronous `activate(context)` functions. Continuing work uses managed tasks.
- Metadata belongs in `manifest.toml`. Users install prebuilt ZIPs without running installation scripts.
- Dependencies identify components. API dependencies require an exact API major. Optional package-version ranges add a separate compatibility check.
- Native requirements combine package and component declarations. All effective requirements are mandatory before activation.
- Rust authorizes native requests using host-issued activation credentials. Frontend components remain trusted code, not sandboxed code.
- Initial native services read registered project files and open HTTP/HTTPS links. Native reads may cover the whole registered project directory within host-enforced limits. Directory-specific grants and native writes are deferred.
- Updates wait for restart. Recovery never automatically executes the previous version. Explicit recovery launch skips all packaged plugin imports.

The sections below propose how authors express these decisions. Field names, new TypeScript contracts and unresolved compatibility rules need approval.

## 2. A package containing Basic Menu

This is a complete proposed manifest for a frontend toolbar package. It belongs at the root of the distributed ZIP. Its entry module contributes the horizontal and vertical formatting controls through public APIs.

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
kind = "frontend"
entry = "dist/toolbar.js"
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

The package/component reference for the editor is a proposed public identity. It is not the current in-process provider ID, `writers-ide.word-processing`. This example does not require extracting the full editor into an independently installed package in Part 4. The host must explicitly register its existing editor provider under the approved public reference through the same dependency resolver. It must not invent a privileged formatting API.

`runtime_profile` names the host's supported shared-module environment. It does not name the package version or the provider API major. The proposed profile ID is `writers-ide.frontend/1`. Before implementation, the profile needs an exact tested module/export inventory from the repository's dependency versions. Its name alone does not establish compatibility.

Basic Menu needs no native permissions. It accesses live editing through its declared word-processing dependency. That still permits trusted frontend code to read content and make browser network requests. Omitting native permissions is not a privacy guarantee.

### Proposed field rules

| Field                         | Meaning                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `manifest_version`            | Required manifest format version. Initially `1`. Reject unsupported versions before imports.                      |
| `package.namespace`           | Optional namespace. Combined with `name` to derive `@namespace/name`.                                             |
| `package.name`                | Required stable machine name. Without a namespace, this is the canonical package ID.                              |
| `package.display_name`        | Required user-facing name. Renaming it does not change identity.                                                  |
| `package.version`             | Required semantic version. Separate from stable identity.                                                         |
| `package.description`         | Required short explanation for installation review.                                                               |
| `components`                  | Nonempty array of component records. Each local `id` must be unique.                                              |
| `components.display_name`     | Required user-facing component name for review and management.                                                    |
| `components.kind`             | Initially only `frontend` is executable. Other kinds fail compatibility checks; no backend execution is implied.  |
| `components.entry`            | Required portable package-relative JavaScript entry path. No URL, absolute path or parent traversal.              |
| `components.runtime_profile`  | Required supported host runtime profile. Checked before import.                                                   |
| `components.activation_scope` | Required `project` or `application`. No implicit default.                                                         |
| `components.default_enabled`  | Optional first-configuration selection. Defaults to `false`. Never bypasses consent.                              |
| `components.capabilities`     | Required array of supported contribution capabilities. An empty array is valid. These are not native permissions. |
| `components.dependencies`     | Optional declared component requirements and integrations. See below.                                             |
| `components.provides`         | Optional API identities this component must publish during activation.                                            |
| `permissions`                 | Optional package or component native requirements. Omission means none. See the native-service example.           |

**Approved strict parsing policy; not implemented:** reject unknown fields throughout the manifest, not only in permission declarations. Use an explicit manifest format version and reject unsupported versions before importing plugin code. Report validation errors clearly rather than silently ignoring declarations. Strict parsing applies to installation and update candidates.

**Remaining proposed validation:** reject duplicate fields, duplicate component IDs and unsupported capability values. Reject malformed declarations before running code. Use lowercase ASCII identifiers matching `[a-z0-9]+(?:-[a-z0-9]+)*` for namespaces, package names, component IDs and dependency aliases. Keep API IDs under the existing nonempty-string contract. Define concrete length/count limits before parser implementation and review them with extraction limits.

Strict parsing catches misspelled security declarations. Format changes use a new manifest version rather than silently changing the meaning of existing fields.

## 3. Dependencies and API publication

**Approved alias approach; not implemented:** dependencies use local aliases for both same-package and cross-package references. The manifest identifies the provider package and component. Runtime API lookup uses the consumer's alias and imported API contract, not a constructed activation ID.

The proposed fields are `alias`, canonical `package` ID and local `component` ID. Require all three even for components in the same package. Exact field schema and duplicate-target rules remain under review. Explicit references avoid guessing which component supplies an API.

- `optional` defaults to `false`.
- Omitted `version` imposes no package-version constraint.
- `apis` lists required API identities for this connection. It can be omitted for a lifecycle-only dependency.
- Every listed API must match its exact major. Package and API compatibility must both pass.
- Aliases are unique within the consumer component. Proposed initial rule: one declaration per target component. Combine its API requirements in that declaration.
- A required mismatch blocks activation and explains the reason. An optional mismatch leaves the whole declared integration unavailable.
- Optional dependencies never activate providers automatically.

A provider declares its APIs in its component record:

```toml
[[components.provides]]
id = "example.research-index"
major = 1
```

This fragment belongs below a provider's `[[components]]` record. The component's `activate` function must publish that declared API exactly once using `context.apis.provide(contract, factory)`. `contract` is created with the existing `definePluginApi` helper. The consumer and provider import the same contract definition from a library; importing that library does not activate the provider.

### Approved limited version ranges

**Approved policy; not implemented.** Use SemVer 2.0.0 package versions. Initially accept:

- One exact version, such as `1.3.0`.
- Space-separated comparisons using `>=`, `>`, `<=` and `<`, such as `>=1.3.0 <2.0.0`. All comparisons must pass.

Do not initially accept wildcards, caret/tilde shorthand or OR expressions. Authors can express bounds without learning implicit expansion rules. Build metadata does not affect precedence.

**Approved prerelease policy:** comparator ranges exclude prereleases. An exact prerelease version such as `1.3.0-beta.2` may match that version explicitly. This keeps normal consumers from accepting preview builds accidentally. A richer prerelease policy can be considered later.

These rules do not implement package discovery or multiple-version selection. They check the installed candidate before activation and when reviewing updates or restoration.

### Proposed consumer lookup

Keep `definePluginApi`, `provide` and the existing connection-owned facade rules. Change packaged consumers to look up a dependency by local alias rather than by an encoded provider-instance ID:

```ts
// Proposed signatures, not current SDK exports.
interface ComponentApis {
	provide<T extends object>(
		contract: PluginApi<T>,
		factory: (connection: PluginApiConnection) => T,
	): void;
	get<T extends object>(alias: string, contract: PluginApi<T>): T | null;
	subscribe<T extends object>(
		alias: string,
		contract: PluginApi<T>,
		listener: (api: T | null) => void,
	): Dispose;
}
```

The generic types `PluginApi`, `PluginApiConnection` and `Dispose` already exist in `@writers-ide/plugins`. `ComponentApis` is proposed. The host resolves each alias using manifest metadata and activation scope. It must reject lookups for undeclared APIs. A required connection is available at activation; optional lookups can return `null`. Subscriptions retain immediate delivery and activation-owned cleanup.

Keep provider connection cancellation, guarded callbacks and error attribution. Both endpoints revoke the connection when they stop. Package/component identity must remain separate from the project-bound activation identity. How the existing bundled host is adapted to these public references requires implementation planning; authors must not construct instance IDs themselves.

## 4. The activation context

Retain the current `signal`, `own`, `contributions` and `tasks` behavior. Add explicit identity, project context and narrow native services. Use the dependency-alias API above.

```ts
// Proposed data shape. It is not exported by the current SDK.
type FrontendContext<Presentation> = {
	readonly identity: {
		readonly packageId: string;
		readonly componentId: string;
		readonly activationId: string;
	};
	readonly project: ProjectReference | null;
	readonly signal: AbortSignal;
	readonly own: (dispose: Dispose) => Dispose;
	readonly contributions: PluginContributions<Presentation>;
	readonly tasks: TaskService;
	readonly apis: ComponentApis;
	readonly projects: ProjectConnections;
	readonly native: NativeServices;
};
```

`Dispose` and `PluginContributions` come from `@writers-ide/plugins`. `TaskService` comes from `@writers-ide/tasks`. The other named contracts are proposed below. Identity is read-only diagnostic data, not native authority. No token appears in this object.

For a project component, `project` identifies its fixed project. For an application component, it is `null`. Switching the selected project never changes this field. Contributions from project activations route to that project's workspace; they do not appear in an unrelated project's bars or command context.

The module exports `activate(context): void | Dispose`. The host calls it after checks and imports succeed. It must return synchronously. The host cancels managed tasks and releases owned contributions/connections on teardown. Short commands remain synchronous; task helpers are encouraged, not mandatory for every action.

Presentation types and Svelte helpers retain their existing roles. This proposal does not add a UI description language or require changes to the word-processing transaction, behavior or renderer contracts.

## 5. Native permissions and a research component

This package reads saved research files. It also opens HTTP/HTTPS links. Both operations require native authority. Its JavaScript entry is supplied by the author at `dist/research.js`.

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

**Approved permission declaration; not implemented:** use separate `operation` and `resource` fields. Initially accept only `project.files.list` with `project`, `project.files.read` with `project`, and `external.open` with `http-https`. Listing and reading require separate declarations; neither implies the other. Reject unknown operations, resources and unsupported combinations before activation. `project` means the activation's registered project location, not a path from the manifest. Whole-project read scope is approved: grants may cover that entire location within host-enforced limits. Directory-specific grants are deferred. `http-https` permits opening any validated HTTP/HTTPS URL; it does not grant shell execution or arbitrary protocol handling.

A common requirement can instead appear as `[[package.permissions]]`. Effective requirements are the union of package and component records. Reject identical duplicate requirements at one level; deduplicate identical requirements inherited across levels. Do not inherit sibling permissions.

Project components require per-project acknowledgement unless the user explicitly chooses application-wide approval. Application-wide approval lets matching future project activations reuse consent; it does not change what their project-bound handles target. Application components can request `external.open` with explicit application-wide approval. **Approved initial restriction; not implemented:** native `project.files.*` requirements belong only to project-scoped components. Reject those requirements on application components, including requirements inherited from the package. A global UI needing project-file work connects to a project-scoped component that declares it. Both components may belong to the same package. In a mixed-scope package, declare project-file permissions on the project components, not at package level. Application components may still declare `external.open`. Direct project-file handles for application components are a future candidate, not part of Part 4.

The installation screen must separately explain that trusted frontend code can read live content through editor APIs and make browser network calls. The native permissions above neither restrict nor grant browser `fetch`.

### Proposed service interfaces

```ts
// Proposed contracts. These services do not exist yet.
type NativeRequestOptions = { readonly signal?: AbortSignal };
type ProjectDirectoryEntry = {
	readonly path: string;
	readonly kind: 'file' | 'directory';
};
type DirectoryPage = {
	readonly entries: readonly ProjectDirectoryEntry[];
	readonly nextCursor: string | null;
};

interface ProjectFiles {
	list(
		path: string,
		options?: NativeRequestOptions & { readonly cursor?: string },
	): Promise<DirectoryPage>;
	read(path: string, options?: NativeRequestOptions): Promise<Uint8Array>;
}

interface ExternalLinks {
	open(url: string, options?: NativeRequestOptions): Promise<void>;
}

type NativeServices = {
	readonly projectFiles: ProjectFiles | null;
	readonly externalLinks: ExternalLinks | null;
};
```

Services are bound to the activation and its grants. Expose `projectFiles` only when at least one file operation is granted; each method still requires its specific operation. Expose `externalLinks` only with its grant. Missing declarations do not trigger permission prompts from arbitrary method calls. Requirements are reviewed before activation.

For example, this proposed entry module starts a cancellable read during activation. The host supplies `context`. The path is supplied by this example, not by the task library. A real feature could start the same action from a user command.

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

The `FrontendContext` import is a proposed future SDK export. The task usage follows the current managed-task model. Disabling the component aborts the task and revokes its native services. The host suppresses late native results where delivery is still under its control.

### Native failures and proposed resource rules

**Approved error-handling contract; not implemented:** asynchronous native services reject promises on failure. Use structured SDK errors with stable codes, not returned `Result` values. Provide an SDK helper that lets authors identify these errors in `catch` blocks. Authors must not parse human-readable messages. Preserve unexpected exceptions as failures rather than assuming every caught value is a native-service error. The SDK must normalize native IPC failures into this contract. Exact exported names and the complete code vocabulary remain proposed.

Authors can catch an expected failure locally. An uncaught rejection from a managed task's `run` function follows the existing task-failure reporting path. Task cancellation retains the managed task's cancellation semantics. The synchronous word-processing API keeps its existing result values; this decision does not change editor access.

- Proposed stable codes are: `revoked`, `cancelled`, `permission-denied`, `invalid-input`, `unavailable`, `not-found`, `limit-exceeded` or `io`. Do not expose native absolute paths or raw credentials in errors.
- **Approved initial listing policy; not implemented:** list one directory at a time in bounded pages, without recursively visiting descendants. The caller requests further pages using an opaque continuation cursor and requests subdirectories separately. Allow cancellation between requests. Listing is not a consistent filesystem snapshot; files can change between pages. Recursive listing in bounded batches is planned future work, not a first-version deliverable. Its traversal limits, partial-failure handling and change semantics need later design.
- Proposed listing details: use `.` for the project root and return normalized project-relative paths, not absolute paths. A cursor is bounded and tied to the same activation/project/directory. It grants no new authority. Exact field names, cursor lifetime and numerical limits remain open.
- **Approved link policy; not implemented:** native project-file services must not follow symbolic links or Windows junctions/reparse points, even when a target is inside the project. Reject reads or directory traversal through them. Enforce this during filesystem access, not only with an earlier path check. Safe support for internal links is a future candidate. How listing reports an encountered link remains open. This policy does not decide broader application import or project-storage behavior.
- Reject absolute paths and parent traversal. Use opened-handle containment checks rather than a string-prefix check.
- Enforce host-controlled per-read, per-page, total outstanding-work and concurrency limits. Callers cannot raise limits. Concrete budgets and cursor expiration need specification before service implementation. Reading files is not a substitute for a future large-file streaming API.
- Read saved bytes only. Use the word-processing API for current editor state and edits.
- Validate HTTP/HTTPS URLs in Rust. Recheck authority before handing the URL to the operating system. Cancellation cannot undo an already opened browser link.
- File operations check cancellation before queued work, at bounded processing checkpoints and before result delivery. Native cleanup does not require a second request using revoked credentials.

Future writes belong in host-assigned plugin storage, separated by project/application scope. They are not methods on this read-only service. Arbitrary project writes, exports and executable backend components need separate designs.

## 6. Global UI and selected-project connections

**Approved API approach; not implemented:** global features use explicit project connections. Authors subscribe to project selection, dispose the old connection and obtain a new connection when selection changes. Each handle remains bound to one project. Closing the project revokes it; ending the consumer activation cleans up its connections. Provider absence does not automatically enable the provider. Exact method signatures and declaration fields below remain proposed.

**Proposed declaration:** an application component may add `binding = "selected-project"` to an optional dependency on a project component. Require `optional = true`. This authorizes a declared integration, not automatic provider activation, native consent or a required dependency on an unspecified project. Ordinary dependencies omit `binding` and use the approved same-project/same-host rules.

```ts
// Proposed contracts. Project IDs are opaque host registration references.
type ProjectReference = { readonly id: string; readonly name: string };

interface ProjectApiConnection {
	readonly project: ProjectReference;
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
```

The host supplies `projects` on the activation context. Selection subscriptions deliver immediately. On selection change, the feature disposes its old connection and connects to the new project. Each connection remains fixed to that project and is owned by the consumer activation. Closing the project revokes it. Looking up an unavailable optional provider returns `null`; it does not enable that provider.

Accept only host-issued project references associated with a live project in this window. The reference identifies a project; it is not filesystem authority. Project connections expose only declared selected-project APIs, not a new native credential or a raw editor registry. Root `context.apis` cannot resolve selected-project aliases without a project connection.

**Approved provider authority policy; not implemented:** providers use their own credentials and grants for the feature operations they expose. Consumers need a declared API dependency, not duplicate native grants for the provider's underlying work. For example, a research index can expose `searchReferences(query)` and read files with its own approved project authority. Rust attributes those reads to the index's credential, not the search panel that called it.

Providers must validate inputs and preserve their project/resource boundaries. Supported APIs must not expose general native-command proxies or raw credentials. This is an author contract, not an enforced boundary against hostile code in the shared frontend. Permission review must explain that a provider can expose feature results to declared consumers. Revoking a consumer connection prevents further supported calls through it; it does not retract results already delivered or automatically revoke the provider's separate authority.

The explicit connection approach and lifetime behavior are approved. The exact discovery signatures and declaration syntax still need approval before implementation. An automatic selected-project API subscription may be considered later as a convenience helper over explicit connections.

## 7. Builds, assets and activation checks

The proposed package contains paths such as:

```text
manifest.toml
dist/toolbar.js
dist/toolbar.css
dist/assets/icon.svg
dist/workers/analyze.js
```

The build tool compiles Svelte and emits native ES modules. Shared imports resolve through the host runtime profile to the host's actual module instances. Private dependencies can be bundled or emitted as verified package-local modules. Each worker is a self-contained ES-module bundle with its own dependencies.

**Approved CSS ownership contract; not implemented:** frontend components declare their emitted stylesheets in the manifest. The proposed field is an optional `styles` array of package-relative CSS paths. The host loads verified styles before calling `activate` and releases its ownership on teardown or activation failure. Shared ownership prevents removing a stylesheet still used by another activation, including the same component in another project. Build tooling can emit the declarations. Components retain ordinary Svelte classes and dynamic inline styles. CSS is not sandboxed and may affect other UI; the frontend trust disclosure must not imply otherwise. Exact manifest syntax, detailed stylesheet ordering and asset URL behavior remain open; loading needs the platform prototype.

Workers and assets use package-relative URLs, including `new URL('./workers/analyze.js', import.meta.url)`. The actual Worker construction route must be proven in packaged Tauri runtimes. Do not assume the virtual module origin permits direct Worker creation. Any bootstrap must still consume verified bytes and preserve managed ownership/cancellation.

The host must complete checks before importing component code:

1. Validate staged ZIP extraction and the manifest. Show trust disclosures and installation identity.
2. Accept explicitly reviewed bytes into host-managed integrity records. Installation does not itself activate components.
3. Resolve requested component selections, dependencies, runtime profiles and required grants for the target project/window. Obtain any required enablement/cascade consent.
4. Verify accepted package contents and retain immutable resource bytes. Never reopen unchecked source paths for execution or assets.
5. Establish host-controlled activation identity and native services. Import the verified module, then call synchronous activation. Release all owned resources on failure.

This is a responsibility sequence, not an approved token issuance protocol. A hostile frontend must not be able to request another component's credential or authorize itself. Raw Tauri commands and alternate native routes need the same audit. Private TypeScript fields are not the Rust enforcement boundary.

Updates, restoration and recovery launch follow the [approved recovery policy](implementation-plan.md#installation-updates-versions-and-defaults). Platform URL behavior, import maps, styles and workers need packaged tests before external loading.

## 8. Review checklist

The proposal introduces these choices beyond the approved high-level direction:

1. **Manifest shape:** strict parsing of the entire manifest and explicit format-version checks are approved. Exact format-version field/value, component records, entry/profile fields, duplicate rules and identifier grammar remain proposed.
2. **Dependency syntax:** local aliases for same-package and cross-package references are approved. Exact manifest fields, multiple API requirements and duplicate-target rules remain proposed. The limited comparator grammar and exact-only prerelease matching are approved.
3. **Context and connections:** the explicit project-connection approach is approved. Alias-based lookup is approved. Diagnostic identity fields, exact discovery signatures and binding declarations remain proposed. Provider use of its own authority for exposed feature operations is approved; token issuance and enforcement details remain open.
4. **Native surface:** separate operation/resource fields and the three initial pairs are approved, as is whole-project read scope. Project-only native file declarations are also approved. Rejected promises with structured errors and an SDK identification helper are approved. Nonrecursive listing in bounded pages with continuation cursors is approved. Exact error names/codes, nullable service handles and listing response fields remain proposed. Numerical resource budgets remain to be specified.
5. **Assets:** host-managed per-component stylesheet declarations and shared activation ownership are approved. Exact stylesheet field syntax and the runtime-profile ID remain proposed. Exact shared exports/versions, stylesheet ordering, URL routes and worker mechanism need design and technical validation.

Whole-project file-read scope is approved. It determines how much saved content a granted component can read. Explicit selected-project connections are also approved. They let global UI reach project features without changing its own lifetime. Providers using their own authority for exposed feature operations is approved. Exact signatures and native enforcement mechanisms remain under review.

After review, update the implementation plan and current context with approved contracts. Keep unresolved proposals labeled. Split implementation into manifest/resolver tests, a packaged resource-delivery prototype, native authorization/services, installation/recovery management, and packaged feature integration. Do not treat approval of this document's goal as approval of every field or security rule.
