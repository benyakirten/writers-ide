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

The activation context contains only `contributions`, `signal`, and `own(dispose)`. It is not a bag of every feature's services. There is no generic services registry or public plugin API for manuscript text, arbitrary document edits, storage, history, network, filesystem, or native execution.

## How the pieces fit together

- **The plugin** owns its feature, manifest, presentations, and explicitly supplied dependencies.
- **The generic host** owns capability checks, contribution registration, activation, rollback, and cleanup. Its options contain contribution registries only.
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

Svelte is the current trusted rendering adapter, not a requirement selected for all future third-party UI. For a real feature with an explicitly injected dependency, see the [built-in formatting plugin guide](../../src/lib/editor/prosemirror/menu/basic/README.md).

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

Application integration imports bundled definitions explicitly; nothing scans directories or executes project-supplied code. [`createApplicationPluginHost()`](../../src/lib/plugins/application-plugin-host.ts) supplies toolbar, view, and command registry adapters to [`PluginHost`](../../src/lib/plugins/plugin-host.ts), not feature services. A different integration supplies its own `ContributionRegistry.register(ownerId, contribution)` adapters and their removal handles.

Host code calls `register(plugin)`, then `activate(plugin.manifest.id)`, and `deactivate(id)` on teardown or disabling. Check activation results: lifecycle failures appear in `errors`, while invalid registrations and lifecycle calls throw. `get(id)` and `list()` expose copied metadata, status, contribution IDs, and errors; retry or re-enable with `activate(id)` again. The [application bootstrap](../../src/routes/+page.svelte) demonstrates explicit composition and teardown.

The application can mount the host-owned [`PluginManager.svelte`](../../src/lib/plugins/PluginManager.svelte) with a `management` prop implementing `PluginManagementService`; `PluginHost` already implements it. The panel lists trusted bundled plugins and offers enable/disable/retry. Optional `requiredPluginIds` prevents disabling selected plugins in the panel only; it is not a manifest permission or host enforcement rule. The parent owns the launcher and dialog wrapper, so disabling a feature cannot remove the management shell.

Management subscriptions deliver immediate and subsequent frozen metadata snapshots, never executable contributions or contexts. Observer failures do not interrupt lifecycle cleanup. Registration/lifecycle calls inside notification callbacks throw; defer follow-up actions until the callback returns. Activation preferences are not persisted.

## Boundaries and next steps

The current host manages trusted in-process code only. Typed props, narrow injected dependencies, capability declarations, and local presentation-error boundaries are not isolation. External loading requires separately approved and implemented isolation, messaging, validation, and permission enforcement; current dependency injection does not settle those contracts.

- [Exact root contracts](index.ts) and [Svelte adapter](svelte.ts).
- [Formatting feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md): feature-local snapshots, commands, editor bridge, and lifecycle scoping.
- [Plugin architecture and stages](../../docs/plugins/context.md): broader direction and remaining decisions; consult current source for working-tree API changes.
