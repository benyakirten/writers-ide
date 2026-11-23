# Building a Writer's IDE plugin

`@writers-ide/plugins` lets you add a feature to Writer's IDE without building your own activation or cleanup system. You can add a toolbar, register an action, or share an API with another feature. The workbench places and renders your UI. The plugin host enables your feature and releases its resources when it stops.

This guide is for authors of trusted plugins bundled with the application. The package is private to this workspace, and its API is still evolving. External installation is not implemented. The planned external SDK will expose a reviewed set of author-facing exports, not automatically every export in these workspace packages. Application setup APIs will remain separate. The [author SDK assembly](../../docs/plugins/sdk-export-review.md#approved-sdk-assembly) approves root frontend/command contracts, `/svelte` presentation and context/entry types, and `/native` service contracts. Host construction remains internal. These author types and helpers are now source-exported alongside legacy bundled types. The current host and bundled imports shown below are unchanged: it does not supply `FrontendContext` or implement its locale, native, project or typed command-invocation services. The curated external profile is not shipped. See the [runtime profile proposal](../../docs/plugins/package-api-proposal.md#runtime-profile-inventory). The [safety section](#boundaries-and-next-steps) explains what the current host does and does not protect.

## What can a plugin do today?

Declare the capabilities your plugin uses in its manifest:

| Goal                                 | Capability              | Context API                          |
| ------------------------------------ | ----------------------- | ------------------------------------ |
| Add a movable toolbar item           | `contributions.toolbar` | `context.contributions.toolbar(...)` |
| Register a central view presentation | `contributions.view`    | `context.contributions.view(...)`    |
| Register a named action              | `contributions.command` | `context.contributions.command(...)` |

A **contribution** is something your feature adds to the workspace. A **capability** declares which contribution kind it uses. These three strings are the current `PluginCapability` values. Registering a contribution without its capability throws an error.

- Toolbars supply presentations for horizontal and vertical bars.
- View contributions register a view type. They do not supply instance metadata or an “open view” operation for plugins.
- Commands register actions the host can invoke. They do not automatically create keyboard bindings, menu items, or command-palette entries. Application commands are separate from synchronous ProseMirror commands in the word-processing provider. See [which command API to use](../../docs/plugins/command-contract.md#choose-an-editor-command-or-an-application-command) for examples and the distinction between current editor commands and planned typed shared application commands.

When your plugin starts, it receives a context with `contributions`, a cancellation `signal`, `own(dispose)` for cleanup, `tasks` for managed work, and `apis` for declared connections to other plugins. Editor access comes from the separate [word-processing provider](../word-processing/README.md). The common context has no built-in storage, history, or native-execution API.

## How the pieces fit together

- **The plugin** owns its feature, manifest, presentations, and explicitly supplied dependencies.
- **The generic host** owns capability checks, contribution registration, provider/dependency resolution, activation, rollback, and cleanup. Its options contain contribution registries and an optional shared work queue.
- **Application adapters** connect contribution registries to the workbench. Application setup supplies any feature-specific dependencies directly to the plugin that needs them.

Keep feature-specific services out of the common context. A feature can receive an explicit dependency from application setup, or use a declared provider API as shown below. Passing a dependency to trusted code is not a security permission grant.

The package exposes three entry points:

- [`@writers-ide/plugins`](index.ts): framework-independent lifecycle, manifest, contribution, registry, and management contracts, plus the `Dispose` cleanup type.
- [`@writers-ide/plugins/svelte`](svelte.ts): trusted Svelte presentation descriptors, `defineSveltePresentation(Component, props)`, `SvelteFrontendContext` and `SvelteFrontendEntry`.
- [`@writers-ide/plugins/native`](native.ts): approved native service/data/error types and `isNativeServiceError`. It supplies no service instances or authority.

There are two meanings of “plugin” in editor code. A **feature plugin** is a Writer's IDE feature with a manifest and activation function. A **ProseMirror `Plugin`** adds editor behavior, such as input rules or decorations. One feature plugin can register several ProseMirror plugins through the word-processing API.

## Add a toolbar

A bundled definition has a manifest and synchronous `activate(context)` function. Only `apiVersion: 1` is currently supported. For example, pair this definition with a `CounterToolbar.svelte` component:

```ts
import { defineSveltePresentation, type SveltePlugin } from '@writers-ide/plugins/svelte';
import CounterToolbar from './CounterToolbar.svelte';

export const plugin: SveltePlugin = {
	manifest: {
		id: 'example.counter',
		version: '0.1.0',
		apiVersion: 1,
		name: 'Counter',
		description: 'A small local counter toolbar.',
		capabilities: ['contributions.toolbar'],
	},
	activate(context) {
		const presentation = defineSveltePresentation(CounterToolbar, { label: 'Count' });
		context.contributions.toolbar({
			id: 'example.counter/toolbar',
			name: 'Counter',
			horizontal: { presentation, size: 1 },
			vertical: { presentation, size: 1 },
		});
		const onReset = () => console.info('Counter plugin reset requested');
		window.addEventListener('example-counter-reset', onReset);
		context.own(() => window.removeEventListener('example-counter-reset', onReset));
	},
};
```

```svelte
<script lang="ts">
	let { label }: { label: string } = $props();
	let count = $state(0);
</script>

<button onclick={() => count++}>{label}: {count}</button>
```

`defineSveltePresentation` checks the component's typed props and returns a `{ component, props }` descriptor for the renderer. The component receives the props you pass: `{ label }` here. Supply any additional dependencies explicitly as typed props.

The window listener shows how to clean up a browser resource with `own()`. It is ordinary trusted browser code, not a platform event API.

Each orientation can use a different component. Its `size` uses **1, 2, or 3 capacity units**, and a bar holds at most three units. These are layout limits, not pixel sizes. Registration makes the toolbar available but does not choose its initial placement.

Use stable contribution IDs, preferably starting with your plugin ID. IDs must be unique within each contribution kind across active plugins. The host does not add a prefix for you.

Ordinary Svelte is supported by the current trusted rendering adapter and is the accepted frontend direction. For a feature that consumes a declared provider API, see the [built-in formatting plugin guide](../../src/lib/editor/prosemirror/menu/basic/README.md).

## Share a versioned API with another plugin

A **provider** is a plugin that exposes an API. A **consumer** is a plugin that uses it. For example, a greeting provider can supply text to a separate welcome feature. They share a contract containing the API's types and identity, without importing each other's implementation.

A consumer declares the exact **provider plugin ID + API ID + API major** it needs. The major is a positive safe integer and must match exactly. It is separate from the plugin's package `version` and the host's `apiVersion`. A provider can publish several APIs or several majors of one API. The host does not negotiate version ranges, discover or install providers, or grant permissions through a dependency declaration.

For example, a shared contract and two bundled definitions could look like this:

```ts
import { definePluginApi, type BundledPlugin } from '@writers-ide/plugins';

interface GreetingApi {
	greet(name: string): string;
}

export const greetingApi = definePluginApi<GreetingApi>({
	id: 'example.greetings',
	major: 1,
});

export const greeter: BundledPlugin<unknown> = {
	manifest: {
		id: 'example.greeter',
		version: '1.0.0',
		apiVersion: 1,
		name: 'Greeter',
		description: 'Provides personalized greetings.',
		capabilities: [],
		provides: [greetingApi],
	},
	activate(context) {
		context.apis.provide(greetingApi, (connection) => ({
			greet(name) {
				return `Hello ${name}, from ${connection.consumerId}!`;
			},
		}));
	},
};

export const welcome: BundledPlugin<unknown> = {
	manifest: {
		id: 'example.welcome',
		version: '1.0.0',
		apiVersion: 1,
		name: 'Welcome',
		description: 'Shows a greeting.',
		capabilities: ['contributions.command'],
		dependencies: [{ provider: 'example.greeter', api: greetingApi.id, major: 1 }],
	},
	activate(context) {
		const greeting = context.apis.get('example.greeter', greetingApi);
		if (!greeting) {
			throw new Error('Greeting provider unavailable');
		}
		context.contributions.command({
			id: 'example.welcome/greet',
			name: 'Show greeting',
			execute() {
				console.info(greeting.greet('Writer'));
				return true;
			},
		});
	},
};
```

Register both plugins in either order before activating `example.welcome`. A dependency is required unless marked optional. The host checks all required dependencies before activating any plugin in that dependency graph. Missing or incompatible declarations, and cycles of required dependencies, produce dependency errors. Providers activate before their consumers.

A provider must publish every declared API once during synchronous activation. It publishes a **factory**: a function that creates an API object for a connected consumer. It cannot withdraw an API separately from deactivation. Publication needs no contribution capability.

If a consumer fails to activate, providers that successfully started remain active.

Self-dependencies and duplicate dependencies are rejected. Only declared dependencies can be read or subscribed to.

### Optional integrations and availability

Set `optional: true` on a dependency when your feature can work without it. Unlike required dependencies, optional dependencies **never auto-activate providers**. Optional dependencies between distinct plugins may form cycles.

- `get(providerId, contract)` returns `null` when the declared integration is unavailable.
- `subscribe(providerId, contract, listener)` immediately delivers the current API object or `null`. It then notifies on provider arrival, removal, or reactivation.
- The returned cleanup function can be called more than once safely. The host also calls it when the consumer stops. Duplicate subscriptions are independent.
- Releasing a subscription stops notifications. It does not make a shared cached API connection unusable.

A provider factory failure is an error, not normal absence. A later lookup or availability change can retry resolution; there is no automatic retry loop.

Availability listeners cannot register plugins or change plugin lifecycle synchronously. Schedule follow-up work after the notification returns. Feature-specific events belong in provider contracts; there is no universal event bus.

### Connection lifetimes and subscriptions

The host calls a provider's factory when a consumer first needs the API. It reuses that connection while the same consumer activation and provider API activation remain live. The factory receives `consumerId`, `signal`, `own(dispose)`, `guard(callback)`, and `reportError(error)`. The host supplies the consumer identity; the provider does not choose it.

#### Return a method-only API object

The factory must be synchronous. Return a plain object with `Object.prototype` or a null prototype. It must contain only its own string-named methods. Do not return data fields, getters or setters, symbol properties, class instances, inherited methods, or a `then` method.

API methods may return data snapshots or promises even though the factory cannot be async. The host freezes the wrapped API object.

#### When a connection ends

**Revocation** means an existing handle becomes unusable. When either the provider or consumer stops, retained top-level API methods throw and never become usable again. Reactivation creates a new connection. A synchronous call already in progress may finish. Async continuations must check the connection signal.

The host does not recursively wrap returned objects, functions, or promises. Provider authors must scope any live access they return to the connection themselves.

#### Own subscriptions and cleanup

For a subscription method:

1. Wrap the listener with `connection.guard(listener)`. After revocation, the guard skips calls and returns `undefined`. While live, it preserves the receiver and arguments. It does not catch listener errors or stop work already running.
2. Register cleanup with `connection.own(dispose)` before delivering an initial event.
3. Release that resource if initial delivery throws.

Owned cleanup runs in reverse order when either the provider or consumer stops. The handle returned by `connection.own` supports early release. It remains safe to call repeatedly after revocation. If you call `own` after the connection ends, it runs the supplied cleanup immediately.

Factory failure also releases connection-owned resources. A cleanup failure is reported but does not stop the remaining cleanup.

#### Report a consumer failure

Call `connection.reportError(error)` when provider-managed work fails on behalf of the connected consumer. The host records the error with `phase: 'provider'` without disabling the consumer. Reports are tied to that exact connection and activation. After either endpoint stops, old reporting functions do nothing, even if the consumer restarts.

Factory and connection-cleanup errors are attributed to the provider. Subscription listener and resolution errors are attributed to the consumer. Availability metadata does not guarantee that a particular consumer's factory will succeed.

## Inspect and edit a document through the word-processing provider

Declare a required dependency on `WORD_PROCESSING_PLUGIN_ID` and `wordProcessingApi`, exported by `@writers-ide/word-processing`, then resolve it with `context.apis.get`. Both the default formatting plugin and independent consumers use this same contract.

Use `snapshot()` or `subscribe()` to choose an editor view. A **snapshot** is a data-only summary, not a copy of the manuscript. It includes a **revision**, a token that changes when the observed editor state or metadata changes. Pass the summary back as a **target** to identify the exact view, document, and revision you intend to use.

You can inspect the selection with `inspect`, return a transaction from `edit`, or run an upstream ProseMirror command with `runCommand`. Editor commands can also be registered and listed independently of a toolbar. For background work, `applyResult` checks the captured target before applying a result; it rejects stale results rather than moving them to a newer selection.

Use `registerBehavior` to install ProseMirror plugins for input rules, decorations, state, or synchronous editor hooks. The provider owns their lifetime and removes them when the connection ends. `behaviors` and `subscribeBehaviors` expose registration status. The editor keeps its existing schema, document, selection, history, and surviving plugin state. See the [input-rule, decoration, and worker examples](../../src/lib/editor/prosemirror/behaviors/README.md).

The [word-processing guide](../word-processing/README.md) explains signatures, failure results, lifecycle and limitations. The [Quick Format example](../../src/lib/editor/prosemirror/menu/quick-format/menu.ts) uses only this provider and an upstream command, without the default formatting plugin. It is an opt-in example, not registered or placed by the application route.

Live callback objects are trusted access, not a sandbox. Do not retain mutable transactions across `await` or cooperative yields, or directly dispatch through a retained view. Behavior registration reconfigures the existing editor state, not the schema or editor instance. For existing schema types, use dedicated `registerNodeView` and `registerMarkView` APIs. Ordinary behaviors still forbid renderer maps. The optional Svelte adapter supports ordinary components with ProseMirror-owned editable content. See [renderer contracts and complete examples](../word-processing/README.md#part-3c-renderers-for-existing-content). New content-type registration and dynamic schemas remain separately gated. This does not redesign pagination or provide a security sandbox.

## Run managed work without managing a scheduler

Use `context.tasks` for work that should stop when your plugin stops:

- `forEach` processes short units and yields between them. This is **cooperative** work: the callback must return control so the UI can respond.
- `cooperative` supports advanced generator-based work with explicit yield points.
- `async` manages work based on promises, such as network requests.
- `worker` runs a bundled worker module off the main thread for one job.

The helpers provide cancellation, replacement by plugin-local key, reactive status/progress, and outcome promises that do not reject. A task failure appears in management errors but does not disable its plugin. No extra manifest capability is needed. Short synchronous actions do not need a task helper.

The application shares one cooperative scheduler with pagination. The helpers manage scheduler ownership and cancel work on unload or activation rollback. They cannot interrupt a running synchronous callback, and promises do not move CPU work off-thread. Use short units for DOM-dependent work and workers for suitable computation. See the [task-author guide](../tasks/README.md) for complete examples.

## Activation, cleanup, and moving UI

Registration is not activation. The host calls `activate()` when enabling the plugin; it may return a synchronous cleanup function.

- Contribution registrations return activation-owned cleanup handles.
- Use `context.own(dispose)` for other resources, such as timers and listeners. Call its returned cleanup handle for early release; repeated calls are safe. Calling `own` after activation ends runs the supplied cleanup immediately.
- Use `context.signal` to cancel work when activation ends. It does not offload CPU work or make asynchronous activation supported.
- Feature-specific dependencies must release resources when activation ends. Use `own` and `signal` where needed. The generic host cannot automatically discover their subscriptions.
- Component-bound subscriptions also need unmount cleanup, for example by returning the disposer from a Svelte effect. Moving a toolbar can unmount its presentation without disabling its plugin.

Keep meaningful state outside component-local presentation state if it must survive relocation. The counter deliberately resets on remount; there is no general plugin-state persistence API.

Deactivation makes the context unusable and aborts its signal before running cleanup in reverse order. Activation failure also releases owned resources. Cleanup handles are safe to call repeatedly. A failing cleanup function does not stop other cleanup, and old command handles do not work after reactivation. Registration adapters must undo partial work if they throw before returning a cleanup handle.

Disabling a toolbar removes its presentation while retaining in-memory placement and capacity costs. This does not provide durable layout storage or project recovery.

## Connecting and managing plugins

Application integration imports bundled definitions explicitly; nothing scans directories or executes project-supplied code. [`createApplicationPluginHost()`](../../src/lib/plugins/application-plugin-host.ts) supplies the application's shared queue and toolbar, view, and command registry adapters to [`PluginHost`](../../src/lib/plugins/plugin-host.ts), not feature services. A different integration supplies its own `ContributionRegistry.register(ownerId, contribution)` adapters and their removal handles.

### Register and enable

Host code calls `register(plugin)`, then `activate(plugin.manifest.id)`. Check the result's `errors`: activation and dependency failures are reported there. Invalid registrations and lifecycle calls throw. Call `activate(id)` again to retry or re-enable. The [application bootstrap](../../src/routes/+page.svelte) shows setup and teardown.

`get(id)` and `list()` return frozen metadata, including published API identities, contribution IDs, and errors. Dependency availability means:

- `missing`: the provider is not registered.
- `incompatible`: the exact API ID and major are not declared by that provider.
- `inactive`: the provider is compatible but not active.
- `available`: the provider API is active. Its per-consumer factory can still fail.

### Disable providers and dependents

A **required dependent** is a plugin that needs the target provider, directly or through another required dependency. `planDeactivation(id)` lists these plugins in the order they must stop, ending with the target.

`deactivate(id)` refuses to stop affected dependents without consent. Use `deactivate(id, { cascade: true })` to stop them before their provider. This is a **cascade**: disabling a provider together with the plugins that require it. Optional consumers stay enabled and receive `null`.

The host-owned [`PluginManager.svelte`](../../src/lib/plugins/PluginManager.svelte) accepts a `management` prop implementing `PluginManagementService`; `PluginHost` implements it. The panel shows the affected list and asks for confirmation. It rechecks the plan before acting and asks again if it changed. Optional `requiredPluginIds` blocks panel cascades whose plans include protected plugins. This also protects providers needed by those plugins. It is UI policy, not a manifest permission or a host enforcement rule.

The parent owns the launcher and dialog wrapper, so disabling a feature cannot remove the management shell. Activation preferences are not persisted.

### Observe and tear down the host

Management subscriptions immediately deliver frozen metadata snapshots, then subsequent changes. They never expose executable contributions or contexts. Observer errors do not stop lifecycle cleanup. Registration and lifecycle calls inside notification callbacks throw; defer them until the callback returns.

Task and provider errors do not independently disable plugins. Activation, dependency, and host-cleanup failures affect lifecycle status. Connections become unusable before an endpoint's own cleanup runs. Teardown must use owned cleanup handles rather than call through an old API object. For bulk teardown, use a deactivation plan and cascade; registration order need not match dependency order.

## Exported author contracts and helpers

The root exports `FrontendContext`, `FrontendEntry`, `FrontendContributions`, `ComponentApis`, `ComponentApiConnection`, identity/project/locale types, `CommandInvoker`, `PluginCommand`, `CommandRegistration`, `definePluginCommand` and command error types/guard. `PluginCommand` and `CommandRegistration` preserve four schema roles: argument input/output and result input/output.

`definePluginCommand` checks a non-whitespace-only contract ID of at most 256 UTF-8 bytes and a positive safe-integer major. It freezes the descriptor without registering an implementation, executing a command or validating payloads. `CommandInvocationError` is an exported class extending `Error`, with required read-only `code` and `diagnosticId` fields. Its constructor takes `(code, message, diagnosticId)`. The diagnostic ID is an opaque correlation string, not a credential. `isCommandInvocationError` checks the Error representation, known code and string diagnostic ID; `/native`'s `isNativeServiceError` checks the native Error representation and known code. Both are nonthrowing and support other JavaScript realms, but authenticate neither origin nor authority.

These SDK exports implement contracts and helpers, not the planned host services. Internal payload/copy and reservation primitives are under development without public package entry points or host callers. Typed-array payloads use [binary-only semantics](../../docs/plugins/command-contract.md#typed-array-binary-semantics-and-inspection-limits): custom properties are not inspected or copied. Authors should put metadata in a surrounding plain record. General reflection and responsiveness limitations remain. Separately, the internal Rust [manifest parser and static resolver](../../docs/plugins/manifest-resolution.md) now validate external declarations, snapshot membership and dependency eligibility. They are not SDK exports and have no application runtime callers. Static eligibility does not establish enablement, published implementations or grants. The examples in the planned-service sections below describe future host behavior. They cannot run against today's bundled `PluginContext`.

## Planned alias-based provider API

**Exported contract; runtime integration not implemented:** `ComponentApis` is exported from `@writers-ide/plugins` for the future `FrontendContext.apis`. It keeps three operations: `provide(contract, factory)`, `get(alias, contract)` and `subscribe(alias, contract, listener)`.

A provider calls `provide()` during its synchronous activation to publish a manifest-declared contract. The host calls its factory with a consumer-scoped `ComponentApiConnection`. The factory returns the actual implementation. Provider and consumer import the contract from a shared library; the identity contains no implementation.

A consumer uses its manifest dependency alias, not a constructed activation ID or global service name. This differs from the current bundled examples above, which use an exact provider plugin ID. The imported contract selects an exact API ID and major. Declared optional integrations can return `null`; undeclared aliases/contracts and incorrect binding routes are author errors.

`subscribe()` delivers immediately, then when availability changes. It belongs to activation lifetime and returns an idempotent early-release handle. Releasing it stops those notifications without revoking connections still used elsewhere. Required providers resolve before activation; lookup does not activate providers on demand. Selected-project integrations must use an explicit project connection. See the [exact interface](../../docs/plugins/package-api-proposal.md#4-the-activation-context).

## Planned application project connections

**Exported contracts; services not implemented:** future application-scoped components receive `context.projects`. The `ProjectConnections` interface has `subscribeSelected(listener): Dispose` and `connect(project): ProjectApiConnection`. Both interfaces are exported from `@writers-ide/plugins`.

The host calls the selection listener immediately, then on changes, with a host-issued project reference or `null`. The subscription is activation-owned. A connection remains fixed to its project opening; selection changes do not retarget it.

For example, import the exported `ProjectApiConnection` type at module scope and place this code inside the application-scoped component's `activate(context)` function, which the host calls when enabling it. It follows selection by explicitly releasing the previous lease. It does not read a document or enable a provider:

```ts
let connection: ProjectApiConnection | undefined;

context.projects.subscribeSelected((project) => {
	connection?.dispose();
	connection = undefined;

	if (project) {
		connection = context.projects.connect(project);
		console.info('Connected to:', connection.project.name);
	}
});

context.own(() => connection?.dispose());
```

The connection supplies `project`, `signal`, shared application `commands`, provider `get()`/`subscribe()` methods and idempotent `dispose()`. Feature calls must match declared project integrations. Connecting does not activate missing providers or grant native access. Each call creates an independent lease, not another provider activation.

Disposal revokes that lease's facades and subscriptions and aborts its signal. Project closure and consumer teardown do the same. Provider absence alone leaves the connection available for later provider arrival. The explicit switching above is author code, not a built-in switching helper. Project-scoped components receive `context.projects = null` and use their fixed `context.project` plus ordinary declared dependencies. Application components receive `context.project = null` and this connection service. Project-to-other-project connections are future work, not an implicit consequence of this API. See the [context contract](../../docs/plugins/package-api-proposal.md#4-the-activation-context).

## Planned project context

The approved external context keeps scope explicit:

| Activation scope | `context.project`           | `context.projects`                                            |
| ---------------- | --------------------------- | ------------------------------------------------------------- |
| Project          | Its fixed project reference | `null`                                                        |
| Application      | `null`                      | Selected-project subscription and explicit connection service |

**Exported type; host integration not implemented:** future project-scoped activations receive `context.project` as a host-issued `ProjectReference`. Application-scoped activations receive `null`. The type is an author export from `@writers-ide/plugins` with read-only string fields:

- `id`: the host's registered local project identity, retained when that registration reopens.
- `openingId`: an opaque identifier for this live opening, replaced on close/reopen.
- `name`: a human-facing label, not an identity or permission key.

The reference stays bound to the activation's project opening. Selecting another project does not retarget it. Its opening ID matches `context.identity.projectOpeningId`. It exposes no filesystem path and grants no file or manuscript access. Use declared provider APIs or approved native services for those operations.

Do not reconstruct references from saved fields. APIs accepting project references validate the host-issued object and live opening; matching strings alone do not grant access. Application components use the approved project-connection API described above rather than treating `context.project` as the currently selected project.

## Planned connection endpoint metadata

**Exported contract; host integration not implemented:** future provider API factories will receive `ComponentApiConnection`, an extension of the current `PluginApiConnection`. It keeps the current `consumerId`, `signal`, `own`, `guard` and `reportError` operations and adds read-only `consumer` and `provider` activation identities.

Each identity contains stable `packageId`/`componentId`, temporary `activationId` and `projectOpeningId`. The latter is `null` for an application-scoped endpoint, even when its peer belongs to a project. The `ComponentIdentity` and `ActivationIdentity` data types are also author exports from `@writers-ide/plugins`.

Providers can use these identities for diagnostics and connection-owned resource association. Activation/opening IDs are opaque, temporary and unsuitable as durable settings keys. Endpoint metadata is not a native credential, permission grant or proof of which JavaScript initiated a call. Validate feature inputs and use approved native services; Rust checks those operations under the provider's actual authority. See the [context contract](../../docs/plugins/package-api-proposal.md#4-the-activation-context).

## Planned native project-file reads

**Approved contract; not implemented:** `context.native.projectFiles.read(path, options?)` will return a `Promise<Uint8Array>` of saved file bytes. The shared `NativeRequestOptions` type accepts an optional read-only cancellation signal. It does not select file encoding or return unsaved editor state.

This example belongs inside a project-scoped component's synchronous `activate(context)` function. The component must declare the `project.files.read` operation with resource `project` and receive user approval before activation. The host supplies `context`; the author supplies the project-relative path:

```ts
const files = context.native.projectFiles;
if (!files) {
	throw new Error('This feature requires project-file access');
}

const task = context.tasks.async({
	key: 'read-reference',
	label: 'Read saved reference',
	run: async ({ signal }) => {
		const bytes = await files.read('research/reference.txt', { signal });
		return new TextDecoder().decode(bytes);
	},
});
```

The task result can later supply the decoded text to the feature's state or UI. Native work started during activation waits for successful setup confirmation; activation itself stays synchronous. For binary files, use the bytes directly instead of decoding them.

The host attaches native credentials and checks each operation. A non-null service can also belong to a list-only component; that does not authorize reading. Arbitrary filesystem paths and URLs are not accepted. Native failures reject, cancellation and host resource limits apply, and no write operation or unlimited-size read is provided. Metadata discovery follows the file-index direction below. Its indexed query API and numerical budgets remain under review; the subscription signature is approved below. See the [native service proposal](../../docs/plugins/package-api-proposal.md#5-native-permissions-and-a-research-component).

## Planned native directory listing

**Approved file-index direction; not implemented:** the host will maintain a project-scoped SQLite index of files and filesystem metadata. It stores no file contents and is not an authoritative catalog of application documents. Plugins will query bounded metadata pages instead of each maintaining a native directory enumeration. Each query must finish its database statement/transaction before returning; pagination retains no native directory iterator or database statement between requests.

Git ignore rules will not automatically hide files or directories from the index. Discovery is separate from version-control tracking. Containment, unsupported-entry handling and host resource limits still apply. Explicit host-configurable indexing exclusions are future work.

The index follows native filesystem notifications and periodic reconciliation. Notifications may be missed, so reconciliation repairs observations. If the watcher cannot start or stops, the host keeps usable records available and continues periodic reconciliation. It reports watcher failure, retries setup with increasing delay and reconciles after restoration. A successful scan does not mean the watcher recovered; unresolved watcher failure remains visible. A later watcher failure does not undo successful initialization. Subscriptions will send coalesced invalidation notices after index updates commit. A notice means to refresh relevant visible/dependent queries, not reload every record or process a per-file operation log. Several updates may share one notice. The host owns subscription cleanup on activation end, access revocation and project closure. The async subscription signature is approved below. The query/page and live-keyset contracts are approved below. Queries will return available cached or partial records while checking continues, with explicit readiness/freshness information and the revision used. An incomplete empty result must not be shown as proof that a directory is empty. Failed/partial scans are not confirmed deletions. Ready means required initialization completed, not that all filesystem changes are already observed. Separate pages are not automatically one snapshot.

Readiness transitions will also invalidate subscriptions even when file entries do not change, after the new state is query-visible. Known-path saved-file reads do not depend on index readiness. The approved `FileIndexStatus` data contains an opaque `revision`, `initialized`, `reconciling`, `needsReconciliation`, `lastReconciledAt` and `lastError`. Initialization applies to this opening; cached records do not establish it. The last successful full-reconciliation time is Unix-epoch milliseconds or null and may be known from a previous opening. A display-only background error can coexist with usable records. Successful reconciliation clears resolved scan errors, but does not hide an unresolved watcher failure. Do not parse its text or treat `needsReconciliation: false` as proof of perfect freshness. Query failures still reject. See the [exact status type and meanings](../../docs/plugins/file-index-plan.md#approved-status-shape). Initial delivery follows the async subscription contract below. Reconciliation is host-controlled initially. Querying again reads current indexed data; it does not request a filesystem scan. There is no initial plugin scan-request API. Plugin-requested reconciliation is future work. Reconciliation cadence and any host-owned user refresh action still need design.

`project.files.list` with resource `project` covers indexed metadata queries, index-status reads and coalesced invalidation subscriptions. Saved contents still need `project.files.read`. Neither implies the other. A read-only component can read a known permitted path but cannot enumerate metadata or observe index status/changes. A metadata-only component cannot read file contents. Each method remains permission-checked even when the file-service object is available. This grouping adds no raw filesystem-event API or manual-rescan authority.

Directory-view requirements remain: project-relative paths, explicit `'.'` for the registered root, no empty/missing-path default, nonrecursive views initially and at most 256 entries per page without a caller-selected page size. Unsupported entries expose no link targets or contents and must not be traversed. The new API must preserve authorization and resource bounds. Entry/status types and the keyset strategy are approved below. The query/page shape below is approved; production integration remains outstanding.

The approved external SDK entry point for native contracts is `@writers-ide/plugins/native`. It will expose request options, file-index data types, project-file/external-link service contracts and native error types/helper. See the [exact planned exports](../../docs/plugins/sdk-export-review.md#native-service-contracts). This entry point is not implemented yet. Imports grant no permissions and supply no service instances, credentials or raw `invoke` wrapper. Authorized services come from the plugin's activation context.

Saved-file reads still access the filesystem and check actual targets and read grants. An indexed path may disappear, change or become prohibited before a read; the record itself grants no access. The host keeps a separate, rebuildable index database in application-managed local storage outside the project folder. Each computer maintains its own index; the project does not need to carry or synchronize it. The index is separate from host settings, installation records and permission grants. If the index is corrupt or incompatible, the host rebuilds it automatically. Recovery reports status and diagnostics instead of serving unusable records. Available partial replacement results remain uninitialized until initialization succeeds. Rebuild failures remain visible, and retries are bounded. Recovery leaves project files, permission grants and host settings untouched. This does not select project content storage. See the [file-index plan](../../docs/plugins/file-index-plan.md) for accepted direction, open questions and validation requirements.

### Indexed entry metadata

**Approved data shape; not implemented:** query entries will use:

```ts
type FileIndexEntry = {
	readonly path: string;
	readonly kind: 'file' | 'directory' | 'unsupported';
	readonly sizeBytes: number | null;
	readonly modifiedAt: number | null;
};
```

Paths are project-relative. Size is the observed file byte count, or null for directories, unsupported entries or unavailable metadata. Modification time is observed file/directory mtime in Unix-epoch milliseconds, or null when unavailable/unsupported. Display unknown values as unknown, not zero. Inspection failures remain visible through index uncertainty/error reporting.

These are cached observations. Mtime does not prove unchanged contents, and reads still check the actual target and permission. Entries contain no file contents, link targets, checksums or stable document IDs. A path may change on rename. The entry type is approved. The query/page and opaque reusable keyset contracts below are also approved.

### Planned indexed queries

**Approved shape; not implemented:** the project-file service will expose `queryIndex(directory, options?)`. `FileIndexQueryOptions` extends native cancellation options with `after?: string`. `FileIndexPage` contains read-only `entries: readonly FileIndexEntry[]`, `status: FileIndexStatus` and `nextToken: string | null`.

Inside a managed async task or async UI handler, with the authorized host-supplied `files` service and cancellation `signal`:

```ts
const page = await files.queryIndex('research', { signal });

if (page.nextToken !== null) {
	const nextPage = await files.queryIndex('research', {
		signal,
		after: page.nextToken,
	});
	console.info(nextPage.entries);
}
```

The method accepts the directory separately from its options, matching `read(path, options)`. Use `'.'` for the project root. Return immediate children in deterministic path order, up to 256 entries. `after` takes the returned opaque token, not a path or offset. No page-size option, custom sorting or arbitrary SQL is included.

Each page's status describes the indexed state used for its entries. A null next token means no further indexed entries after that position at query time. It does not prove a directory is completely observed or that another page would share the same revision. See the [query contract](../../docs/plugins/file-index-plan.md#query-api).

### Planned index pagination

**Approved strategy; not implemented:** initial index pages use deterministic, non-locale-aware path ordering and opaque keyset continuation tokens. A token describes the last ordering key. It owns no native iterator, directory handle or database transaction. Deleting the last returned entry does not prevent continuation.

Treat tokens as opaque data, not permission credentials. The host validates their live project-opening and directory/query binding and checks current metadata authority on every request. Tokens can be reused while that scope is valid; each use queries the current index. No resource-reclamation timeout or single-use bookkeeping is needed.

Each page includes its own status/revision. Multiple pages are not a historical snapshot. Insertions before the continuation point may appear only after refresh, and renames can change membership or repeat a file under a new path. Use invalidation notices to refresh relevant queries. Do not assume duplicate-free traversal of a changing index.

Direct page-number jumps and configurable ordering are not initial features. Directory-first/metadata sorting and random-access navigation are future candidates, not a requirement to load and sort the entire index in a plugin. The query/page/completion fields above are approved. See the [pagination plan](../../docs/plugins/file-index-plan.md#query-pagination).

### Planned async index subscriptions

**Approved contract; not implemented:** the project-file service will expose:

```ts
subscribeIndex(
	listener: (status: FileIndexStatus) => void,
	options?: NativeRequestOptions,
): Promise<Dispose>;
```

A component needs `project.files.list` authority. Inside a managed async task or asynchronous UI handler, with the host-supplied `files` service and a caller-owned cancellation signal, an author can write:

```ts
const stop = await files.subscribeIndex(
	(status) => {
		console.info('Index state:', status);
	},
	{ signal },
);
```

Native setup/authorization failures reject. The host establishes the subscription and delivers initial status before resolving to `stop`, an idempotent early-unsubscribe function. Subsequent callbacks receive coalesced `FileIndexStatus` updates, not every revision. Listener failures are isolated and reported through plugin diagnostics.

The host also owns the subscription for the activation lifetime. Cancellation, access revocation or project closure stops it even if the author drops `stop`. Cancellation while setup is pending must not leak a late-created subscription. Native setup started during activation waits behind the activation gate. Do not make `activate()` async or await this directly there; use managed async work. See the [subscription plan](../../docs/plugins/file-index-plan.md#approved-asynchronous-subscription).

## Planned UI locale API

**Exported contracts; locale service not implemented:** the future external host will supply `context.locale` with `snapshot()` and `subscribe(listener)`. The `LocaleSnapshot` type contains read-only `languageTag: string` and `direction: 'ltr' | 'rtl'`. The `PluginLocale` interface describes the service. Both types are exported from `@writers-ide/plugins`.

This is the application UI locale, not the language of a document or selection. Plugins own their translations and fallback choices. They may use their own catalogs, `Intl`, supported libraries or declared provider services. The host does not expose its private generated message functions.

For example, during activation an author can pass the service to their own `LocaleInfo.svelte` presentation with `defineSveltePresentation(LocaleInfo, { locale: context.locale })`. The host later renders that component. Its component code could be:

```svelte
<script lang="ts">
	import type { PluginLocale } from '@writers-ide/plugins';

	let { locale }: { locale: PluginLocale } = $props();
	let current = $state(locale.snapshot());

	$effect(() =>
		locale.subscribe((next) => {
			current = next;
		}),
	);
</script>

<div lang={current.languageTag} dir={current.direction}>
	UI language: {current.languageTag}
</div>
```

`subscribe()` delivers the current snapshot immediately, then on changes. Its cleanup function is safe to repeat. Returning it from the Svelte effect releases the subscription when that effect ends. The host also stops activation-owned subscriptions when the plugin stops. One listener's failure does not prevent others from receiving updates. This example shows observation, not a translation catalog.

## Planned Svelte build compatibility

The initial external runtime profile will not support Svelte's experimental async compilation mode. Recommended builds will leave `experimental.async` disabled. Authors can still use ordinary async functions and `{#await promise}` blocks, including for data loaded through managed tasks or workers. Direct template `await`, top-level component `await` and `$derived(await ...)` under that experimental mode are outside the initial supported build configuration.

This is a compatibility policy, not a security mechanism that inspects or prevents author syntax. External loading is not implemented. Support for the async compilation mode is [future work](../../docs/plugins/implementation-plan.md#deferred-work-and-future-candidates) once it is non-experimental and passes shared-runtime, lifecycle and editor-layout compatibility tests. A Svelte dependency upgrade alone will not automatically enable profile support.

## Planned external package stylesheets

External package loading is not implemented. The approved design lets each frontend component declare a `styles` array in `manifest.toml`. The host will load those CSS files before calling the component's `activate` function. Omitting `styles` means `[]`.

**Do not rely on that list to guarantee CSS order.** The host will append unloaded stylesheets in list order, but it will reuse already loaded links without moving them. If another component already uses `shared.css`, declaring `["toolbar.css", "shared.css"]` will leave `shared.css` before the newly appended `toolbar.css`.

Bundle order-sensitive CSS into one file. Scope selectors to your UI. Shared stylesheets are not isolated from application or other plugin UI. See the [stylesheet loading and ordering specification](../../docs/plugins/package-api-proposal.md#stylesheet-loading-and-ordering) for ownership and cleanup rules.

## Boundaries and next steps

Official and third-party features must use the same public extension APIs. There is no approved privileged path for built-in features to bypass them.

The current host runs trusted, bundled frontend code in the application's JavaScript environment. Typed props, capability checks, cleanup ownership, and presentation-error boundaries are not a sandbox. DOM isolation is deferred. Browser APIs, including network requests, remain accessible. A plugin with document and network access can send manuscript data elsewhere.

External loading is not implemented. It still requires an approved installation/trust design and verified native restrictions. Frontend trust does not grant unrestricted Tauri IPC, filesystem, shell/process, or native-library access. Those future native APIs and their enforcement must be designed separately.

- [Exact root contracts](index.ts) and [Svelte adapter](svelte.ts).
- [Formatting feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md): feature-local snapshots, commands, editor bridge, and lifecycle scoping.
- [Plugin architecture and stages](../../docs/plugins/context.md): broader direction and remaining decisions; consult current source for working-tree API changes.
