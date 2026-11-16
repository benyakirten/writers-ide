# Building a Writer's IDE plugin

`@writers-ide/plugins` lets you add a feature to Writer's IDE without building your own activation or cleanup system. You can add a toolbar, register an action, or share an API with another feature. The workbench places and renders your UI. The plugin host enables your feature and releases its resources when it stops.

This guide is for authors of trusted plugins bundled with the application. The package is private to this workspace, and its API is still evolving. External installation is not implemented. The [safety section](#boundaries-and-next-steps) explains what the current host does and does not protect.

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
- Commands register actions the host can invoke. They do not automatically create keyboard bindings, menu items, or command-palette entries.

When your plugin starts, it receives a context with `contributions`, a cancellation `signal`, `own(dispose)` for cleanup, `tasks` for managed work, and `apis` for declared connections to other plugins. Editor access comes from the separate [word-processing provider](../word-processing/README.md). The common context has no built-in storage, history, or native-execution API.

## How the pieces fit together

- **The plugin** owns its feature, manifest, presentations, and explicitly supplied dependencies.
- **The generic host** owns capability checks, contribution registration, provider/dependency resolution, activation, rollback, and cleanup. Its options contain contribution registries and an optional shared work queue.
- **Application adapters** connect contribution registries to the workbench. Application setup supplies any feature-specific dependencies directly to the plugin that needs them.

Keep feature-specific services out of the common context. A feature can receive an explicit dependency from application setup, or use a declared provider API as shown below. Passing a dependency to trusted code is not a security permission grant.

The package exposes two entry points:

- [`@writers-ide/plugins`](index.ts): framework-independent lifecycle, manifest, contribution, registry, and management contracts, plus the `Dispose` cleanup type.
- [`@writers-ide/plugins/svelte`](svelte.ts): trusted Svelte presentation descriptors and `defineSveltePresentation(Component, props)`.

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

## Boundaries and next steps

Official and third-party features must use the same public extension APIs. There is no approved privileged path for built-in features to bypass them.

The current host runs trusted, bundled frontend code in the application's JavaScript environment. Typed props, capability checks, cleanup ownership, and presentation-error boundaries are not a sandbox. DOM isolation is deferred. Browser APIs, including network requests, remain accessible. A plugin with document and network access can send manuscript data elsewhere.

External loading is not implemented. It still requires an approved installation/trust design and verified native restrictions. Frontend trust does not grant unrestricted Tauri IPC, filesystem, shell/process, or native-library access. Those future native APIs and their enforcement must be designed separately.

- [Exact root contracts](index.ts) and [Svelte adapter](svelte.ts).
- [Formatting feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md): feature-local snapshots, commands, editor bridge, and lifecycle scoping.
- [Plugin architecture and stages](../../docs/plugins/context.md): broader direction and remaining decisions; consult current source for working-tree API changes.
