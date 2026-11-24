# Project references and independent connections

An application-scoped component can keep running while a project opens, closes or changes selection. It uses an explicit project connection to reach a project's declared provider APIs and commands. A project-scoped component instead stays bound to its own project opening.

The internal component harness implements these contracts. It is not wired to the application's project UI, persistent registrations, filesystem or external loader. The exported author interfaces are in [`frontend.ts`](../../packages-js/plugins/frontend.ts).

## Project references

`ProjectReference` is frozen metadata with three fields:

- `id`: the stable project identifier supplied by the host. Reopening that project can use the same ID.
- `openingId`: an opaque identifier generated for one live opening. Closing and reopening produces a different value.
- `name`: display text, not a lookup key or permission.

A reference contains no filesystem path, file access, manuscript contents or native credentials. Reference-consuming methods check the actual host-issued object and whether its opening is still live. Copying its fields, wrapping it in a proxy or reconstructing an identical object does not produce a valid reference. References issued by another host are also rejected.

### Internal host controls

The harness supplies these control methods for tests and future application adapters:

| Method                           | Behavior                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `openProject(id, name)`          | Creates an in-memory opening and returns its reference. Rejects a duplicate live project ID. Does not select it or activate components.       |
| `selectProject(referenceOrNull)` | Sets the explicit selection and notifies subscribers. Does not enable providers or retarget existing connections.                             |
| `closeProject(reference)`        | Invalidates the opening, ends its component activations and connections, and clears selection if needed. Application components stay running. |

These are not public SDK exports or persistent project-registration operations. They do not open a directory dialog, inspect files or grant permissions. [`component-project-registry.ts`](../../packages-js/plugins/component-project-registry.ts) owns reference identity and selection notifications. The host guards mutations during lifecycle and notification callbacks.

A project component descriptor must identify a live opening in this host. Registration and activation reject unknown or closed openings. A closed descriptor cannot silently switch to a reopened project; application assembly must register the appropriate new opening. The host rejects duplicate package/component/opening registrations rather than choosing one by registration order.

## Context scope

The internal activation context preserves the approved scope distinction:

| Activation         | `context.project`                        | `context.projects`   |
| ------------------ | ---------------------------------------- | -------------------- |
| Project-scoped     | Its fixed host-issued `ProjectReference` | `null`               |
| Application-scoped | `null`                                   | `ProjectConnections` |

The project reference's opening ID matches `context.identity.projectOpeningId`. An application activation keeps that identity field `null`, including while it uses a project connection. Selection does not change either activation's identity.

## Independent leases

`context.projects.connect(reference)` creates a `ProjectApiConnection`. Here, a **lease** means a connection with its own lifetime and cleanup. It exposes:

- `project`: the fixed reference passed to `connect`.
- `signal`: ends when this lease is disposed, its project closes or its consumer activation stops.
- `get(alias, contract)` and `subscribe(alias, contract, listener)`: access to declared project provider APIs.
- `commands`: the shared command invoker for declared project command aliases.
- `dispose()`: idempotent early release.

Every `connect()` call is independent, even for the same consumer and project. Each lease has separate API facades, subscriptions, factory resources and pending command lifetimes. Disposing one does not stop another lease, the provider activation or unrelated root-context services. Cached provider state can still be shared inside the provider; a lease is not another provider activation.

Factories receive the actual application consumer identity and project provider identity. Command reservations and diagnostics use the actual consumer activation ID, not a fabricated activation for the lease. Calls across several leases therefore share that consumer's capacity limits.

Provider absence does not end a lease. Optional API subscriptions can receive `null` and later receive a facade when a compatible provider becomes active. Command availability behaves similarly. Connection and lookup operations never enable missing providers.

A lease remains bound to its opening when selection changes. Plugin code may retain several live leases or dispose the previous one when selection changes. There is no automatic-switching helper. The reference passed to `connect` must be live and host-issued; it need not be the current selection.

## Declared routes

The harness checks these supported dependency routes:

- A project component can directly use an application provider or a project provider in the same opening.
- An application component can directly use an application provider.
- An optional application-to-project integration uses the explicit project connection route.

Direct application-to-project access and project-to-other-project access are rejected. A selected-project alias cannot be used through root `context.apis` or `context.commands`. A direct-instance alias cannot be used through a project lease.

Selected-project dependencies identify an exact provider package/component and requested API/command versions. Lookup combines that identity with the lease's fixed opening. It does not use the currently selected project or a global unqualified command name. The harness's private normalized descriptor uses `binding: 'selected-project'`; manifest-to-runtime assembly remains separate. See the [static binding outputs](manifest-resolution.md#static-resolution-outputs).

## Selection subscriptions

`context.projects.subscribeSelected(listener)` immediately supplies the selected reference or `null`, then delivers changes. The subscription belongs to the application activation and supports early disposal. Listener failures are isolated, including rejected promises. Synchronous lifecycle changes from selection callbacks must be deferred. Disposing or creating a connection in the callback is supported.

The following is an application component's synchronous activation callback. The host calls it when enabling the component. Its parameter lists only the context properties this example uses. It explicitly releases the old lease instead of expecting selection to retarget it:

```ts
import type { FrontendContext, ProjectApiConnection } from '@writers-ide/plugins';

export function activate(context: Pick<FrontendContext<unknown>, 'projects' | 'own'>) {
	const projects = context.projects;
	if (!projects) {
		return;
	}

	let lease: ProjectApiConnection | undefined;
	context.own(() => lease?.dispose());
	projects.subscribeSelected((project) => {
		lease?.dispose();
		lease = project ? projects.connect(project) : undefined;
	});
}
```

A feature's own UI handlers can use the retained lease's `get`, `subscribe` or `commands` methods with the aliases and contracts declared by that feature. This example creates no UI and requests no native service. It works with the internal harness's matching context properties; the current bundled host does not supply `context.projects`.

## Teardown and cancellation

Project closure first invalidates the reference. It marks all affected activations and leases revoked before dispatching abort events or author cleanup. Selection subscribers are notified afterward. Other application components and leases to other projects remain live.

Pending command outcomes are fixed during the revocation mark phase. Abort callbacks cannot turn a sibling's already-marked revocation into a later cancellation. Already-processed cancellation remains cancelled. Signal flags and events still change sequentially; this is not atomic browser-event delivery.

Running implementations retain command reservations until they settle and cleanup finishes. A lease does not stop arbitrary asynchronous code or undo completed effects. Pass the lease or provider-connection signal to tasks and check cancellation before later effects. Do not dispose the application component's entire task service when only one lease ends.

[`component-project-connections.ts`](../../packages-js/plugins/component-project-connections.ts) owns independent scopes. [`component-project-routing.ts`](../../packages-js/plugins/component-project-routing.ts) validates routes and exact instance identity. The existing API manager and command dispatcher execute the calls; leases do not duplicate those implementations.

## Validation boundary

`packages-js/plugins/component-project-*.test.ts` covers registry provenance, scope combinations, independent caches, provider arrival, selection delivery, pending commands, teardown ordering, callback guards and close/reopen behavior. The [cumulative changelog](change-log.md) records verified checks.

These are internal JavaScript lifecycle tests. They do not verify native project registration, SQLite persistence, filesystem permissions, external package loading or packaged Tauri behavior.
