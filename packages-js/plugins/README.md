# Building a Writer's IDE plugin

A plugin adds a feature without taking over the workbench. It contributes UI or actions through platform extension points; the workbench owns placement and rendering, and the host owns activation and cleanup. Feature-specific behavior and dependencies belong to the feature, not to a growing universal plugin context.

**Current scope:** this private workspace package supports explicitly registered, trusted bundled plugins. It is an evolving API, not a stable published SDK. There is no external installation or sandbox. Capability checks govern host API calls; they do not contain in-process JavaScript.

## What can a plugin do today?

Declare the capabilities your plugin uses in its manifest:

| Goal                                 | Capability              | Context API                          |
| ------------------------------------ | ----------------------- | ------------------------------------ |
| Add a movable toolbar item           | `contributions.toolbar` | `context.contributions.toolbar(...)` |
| Register a central view presentation | `contributions.view`    | `context.contributions.view(...)`    |
| Register a named action              | `contributions.command` | `context.contributions.command(...)` |

These are the current `PluginCapability` values. Missing registration capabilities cause an error. Toolbar contributions provide horizontal and vertical presentations; view contributions register a view type, without instance metadata or a plugin-facing “open view” operation. Commands are host-invokable actions, not automatic keyboard bindings, menu items, or command-palette entries.

The activation context contains `contributions`, `signal`, `own(dispose)`, activation-owned `tasks`, and declared provider access through `apis`. It is not a bag of every feature's services. Providers define their own domain contracts; the generic platform still has no manuscript-editing, storage, history, or native-execution API. Trusted frontend code can use browser APIs, including network requests; these interfaces are not a sandbox.

## How the pieces fit together

- **The plugin** owns its feature, manifest, presentations, and explicitly supplied dependencies.
- **The generic host** owns capability checks, contribution registration, provider/dependency resolution, activation, rollback, and cleanup. Its options contain contribution registries and an optional shared work queue.
- **Application adapters** connect those registries to the workbench. Trusted application composition separately supplies any feature-owned dependencies to the particular plugin that needs them.

Platform contributions answer “what does this feature add to the workspace?” Feature-owned dependencies answer “what does this feature need to do its job?” Do not turn the latter into generic host capabilities merely because one plugin needs them. Injecting an in-process dependency is trusted composition, not an external permission grant or an approved sandbox interface.

The package exposes two entry points:

- [`@writers-ide/plugins`](index.ts): framework-independent lifecycle, manifest, contribution, registry, and management contracts, plus the `Dispose` cleanup type.
- [`@writers-ide/plugins/svelte`](svelte.ts): trusted Svelte presentation descriptors and `defineSveltePresentation(Component, props)`.

A ProseMirror `Plugin` extends an editor internally; it is not an application-plugin lifecycle or a security boundary.

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

The helper checks the component's typed props before producing a generic `{ component, props }` descriptor. The adapter renders those props; it does not automatically inject a `context` prop or legacy workspace/editor props. This example passes only `{ label }`. Its window listener illustrates `own()` cleanup in trusted bundled code, not a platform event API or permission guarantee.

Each orientation can use a different component and costs **1, 2, or 3 logical capacity units**. A bar holds at most three units; this is not a pixel-size guarantee. Use stable, preferably plugin-qualified contribution IDs. IDs are unique within each contribution kind across active plugins and are not automatically prefixed. Registration makes a toolbar available; it does not choose its initial placement.

Ordinary Svelte is supported by the current trusted rendering adapter and is the accepted frontend direction. For a real feature with an explicitly injected dependency, see the [built-in formatting plugin guide](../../src/lib/editor/prosemirror/menu/basic/README.md).

## Share a versioned API with another plugin

A provider is a plugin exposing a named contract. A consumer declares the exact **provider plugin ID + API ID + API major** it needs. This lets features cooperate without importing each other's implementations or sharing mutable application singletons. Importing a contract from a library shares its types and identity, not its runtime implementation.

API majors are positive safe integers and match exactly; plugin package `version` and host `apiVersion` are separate concepts. A provider may publish several contracts or parallel majors. There is no version-range negotiation, provider discovery, installation, or permission grant.

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

Register both plugins in either order before activating `example.welcome`. The host checks the entire required graph first, then activates registered providers before their consumers. Missing/incompatible declarations and required cycles fail with dependency errors before running that graph. A provider must publish every declared API during synchronous activation. Publication is activation-owned, cannot be withdrawn separately, and needs no new contribution capability. If a downstream plugin fails, successfully enabled providers remain active rather than being silently disabled.

### Optional integrations and availability

Set `optional: true` on a dependency to keep the consumer usable without its provider. Optional declarations never auto-activate providers and may form cycles. `get(providerId, contract)` returns `null` when the declared integration is unavailable. `subscribe(providerId, contract, listener)` delivers the current API or `null` immediately, then on provider arrival/removal/reactivation; its idempotent disposer is consumer-activation-owned. Duplicate subscriptions are independent. A factory failure is an error, not normal absence; failed resolution can be retried on a later lookup or availability activity, not an automatic retry loop.

Only declared dependencies can be read/subscribed. Availability listeners cannot register plugins or change lifecycle synchronously; schedule such follow-up work after notification returns. There is no universal event bus. Domain events and owned registrations are methods of the provider's contract.

### Connection lifetimes and subscriptions

Each provider factory receives an authenticated `consumerId`, a connection `signal`, `own(dispose)`, and `guard(callback)`. A connection is cached per consumer activation and provider API activation. Factories return a plain or null-prototype **method-only object**: no mutable fields, accessors, symbol methods, class instances, `then` methods, or asynchronous factories. Methods can return snapshots or promises; the facade factory itself is synchronous.

The host wraps top-level methods. Retained methods reject after either endpoint stops and never revive on reactivation. Already-running synchronous calls may finish; async continuations must honor the connection signal. Returned objects/functions are **not recursively wrapped or revoked**, so provider authors must avoid leaking unscoped live authority.

For a subscription method, wrap its callback with `connection.guard(listener)` and register its disposer with `connection.own(dispose)`. The guard suppresses late callbacks after revocation and returns `undefined` then; it does not catch listener exceptions or cancel already-running work. Ownership handles remain idempotently callable after revocation and automatically release when either endpoint stops. Register cleanup before delivering an initial event, releasing it if initial delivery throws. Factory failure also rolls back connection-owned resources. Cleanup failures are reported without preventing remaining cleanup.

Factory/subscription/cleanup failure reporting is not a security boundary: arbitrary trusted frontend code can still import private code or modify shared objects outside these supported contracts.

## Run managed work without managing a scheduler

`context.tasks` provides convenient cooperative iteration (`forEach`), advanced generator work (`cooperative`), lifecycle-managed promises (`async`), and one-shot bundled workers (`worker`). Helpers supply cancellation, replacement by plugin-local key, reactive status/progress, and nonrejecting outcome promises. Task failures are attributed in management errors; a task failure does not disable its plugin. No new manifest capability is required, and short synchronous actions do not need a helper.

The application shares one cooperative scheduler with pagination. Helpers manage leases and cancel on unload or activation rollback. They cannot interrupt an expensive synchronous callback; promises do not move CPU work off-thread. Use a worker for suitable computation and short cooperative units for DOM-dependent work. The [task-author guide](../tasks/README.md) includes ordinary iteration, advanced generators, cancellation, and a bundled worker example.

## Activation, cleanup, and moving UI

Registration is not activation. The host calls `activate()` when enabling the plugin; it may return a synchronous cleanup function.

- Contribution registrations return activation-owned cleanup handles.
- Use `context.own(dispose)` for other resources, such as timers and listeners. Its idempotent returned handle supports early release; late ownership disposes immediately.
- Use `context.signal` to cancel work when activation ends. It does not offload CPU work or make asynchronous activation supported.
- Feature dependencies must arrange their own activation scoping, using `own` and `signal` where needed. The generic host cannot automatically discover their subscriptions.
- Component-bound subscriptions also need unmount cleanup, for example by returning the disposer from a Svelte effect. Moving a toolbar can unmount its presentation without disabling its plugin.

Keep meaningful state outside component-local presentation state if it must survive relocation. The counter deliberately resets on remount; there is no general plugin-state persistence API.

Deactivation revokes the context and aborts its signal before reverse-order cleanup. Activation failure rolls back owned resources. Cleanup handles are idempotent; a failing disposer does not stop other cleanup, and old command handles do not regain authority after reactivation. External registration adapters must undo partial work if they throw before returning a cleanup handle.

Disabling a toolbar removes its presentation while retaining in-memory placement and capacity costs. This does not provide durable layout storage or project recovery.

## Connecting and managing plugins

Application integration imports bundled definitions explicitly; nothing scans directories or executes project-supplied code. [`createApplicationPluginHost()`](../../src/lib/plugins/application-plugin-host.ts) supplies the application's shared queue and toolbar, view, and command registry adapters to [`PluginHost`](../../src/lib/plugins/plugin-host.ts), not feature services. A different integration supplies its own `ContributionRegistry.register(ownerId, contribution)` adapters and their removal handles.

Host code calls `register(plugin)`, then `activate(plugin.manifest.id)`. Check activation results: lifecycle/dependency failures appear in `errors`, while invalid registrations and lifecycle calls throw. `get(id)` and `list()` expose frozen metadata, provider APIs, dependency availability (`available`, `missing`, `incompatible`, `inactive`), contribution IDs, and errors; retry or re-enable with `activate(id)` again. The [application bootstrap](../../src/routes/+page.svelte) demonstrates explicit composition and teardown.

The application can mount the host-owned [`PluginManager.svelte`](../../src/lib/plugins/PluginManager.svelte) with a `management` prop implementing `PluginManagementService`; `PluginHost` already implements it. The panel lists trusted bundled plugins, APIs/dependency availability, and enable/disable/retry actions. `planDeactivation(id)` previews required dependents in teardown order, ending with the target. Plain `deactivate(id)` rejects a cascade without consent; `deactivate(id, { cascade: true })` stops required dependents before their provider. Optional consumers remain enabled and receive `null`. The panel shows the affected list and requires confirmation, rechecks it before acting, and asks again if it changes. Optional `requiredPluginIds` protects selected plugins and transitive dependents from panel cascades; it remains UI policy, not a manifest permission or host enforcement rule. The parent owns the launcher and dialog wrapper, so disabling a feature cannot remove the management shell.

Management subscriptions deliver immediate and subsequent frozen metadata snapshots, never executable contributions or contexts. Observer failures do not interrupt lifecycle cleanup. Registration/lifecycle calls inside notification callbacks throw; defer follow-up actions until the callback returns. Activation preferences are not persisted. Task/provider errors are reported without independently disabling plugins; activation/dependency/host-cleanup failures affect lifecycle status. Stopping an endpoint revokes its connections before its own cleanup, so teardown code must use owned cleanup handles rather than call through a revoked facade. For bulk host teardown, use the deactivation plan/cascade rather than assuming registration order matches dependency order.

## Boundaries and next steps

The current host manages trusted in-process code only. Typed props, narrow injected dependencies, capability declarations, and local presentation-error boundaries are not isolation. External loading requires separately approved package/trust UX, validation, and restrictive native enforcement. Frontend DOM isolation is deferred; document access plus network access permits exfiltration. Current dependency injection and task ownership do not establish a security sandbox.

- [Exact root contracts](index.ts) and [Svelte adapter](svelte.ts).
- [Formatting feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md): feature-local snapshots, commands, editor bridge, and lifecycle scoping.
- [Plugin architecture and stages](../../docs/plugins/context.md): broader direction and remaining decisions; consult current source for working-tree API changes.
