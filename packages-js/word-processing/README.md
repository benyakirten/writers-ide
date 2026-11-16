# Word processing (Parts 3A–3B)

`@writers-ide/word-processing` lets a feature work with an open editor without depending on the default formatting toolbar. You can read a selection, insert text, run a ProseMirror command, or add editor behavior such as input rules and highlights. The provider checks that an edit still belongs to the view and state you chose.

This is a private workspace package with an evolving API. The application still owns editor creation, the document schema, history, dispatch, and pagination. A **schema** defines the document's allowed nodes and marks. Current extensions use that existing schema; they cannot register new content types.

A **feature plugin** is a Writer's IDE feature with a manifest and activation function. A **ProseMirror `Plugin`** is an editor extension for state, events, or transaction hooks. A feature plugin can register several ProseMirror plugins through this API. Official and third-party features use the same extension API.

## Connect your feature

The application registers the word-processing provider. In your feature's manifest, declare this required dependency:

```ts
import { WORD_PROCESSING_PLUGIN_ID, wordProcessingApi } from '@writers-ide/word-processing';

const dependency = {
	provider: WORD_PROCESSING_PLUGIN_ID,
	api: wordProcessingApi.id,
	major: wordProcessingApi.major,
};
// Include dependency in the consumer manifest's dependencies.
```

Then resolve the API inside your synchronous `activate(context)` function:

```ts
const editor = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi);
if (!editor) {
	throw new Error('Word-processing provider unavailable');
}
```

The examples below use this `editor` API object and activation `context`. Both the provider ID and API ID are `writers-ide.word-processing`; the API major is `1`. Dependencies match the exact provider ID, API ID, and major, not a package-version range. Required dependencies activate their registered providers first. An optional dependency uses `optional: true`, never auto-activates its provider, and must handle absence. See the [plugin guide](../plugins/README.md#share-a-versioned-api-with-another-plugin) for availability subscriptions and connection rules.

## Choose an editor

An editor **view** is one live ProseMirror editor instance. A document can have several views, but this service does not synchronize their states.

`editor.snapshot()` returns a frozen, data-only summary of the open views and active view ID. It does not serialize or scan the manuscript. Each view summary contains `viewId`, `documentId`, `name`, `revision`, and `editable`.

A **target** identifies the exact editor state you intend to use: `{ viewId, documentId, revision }`. A view summary is a valid target. The **revision** is a freshness token, not a saved document version. It changes when the service observes a different state, even if only the selection changed. View replacement, document identity, name, and editability changes also invalidate it.

To act on the active view:

```ts
const snapshot = editor.snapshot();
const target = snapshot.views.find((view) => view.viewId === snapshot.activeViewId);
if (target) {
	editor.edit(target, ({ state }) => state.tr.insertText('Hello'), { requireActive: true });
}
```

No operation implicitly requires the active view. You choose the target; `requireActive: true` adds that requirement. Use `subscribe(listener)` to receive a snapshot immediately and then on changes. Its returned cleanup function releases the subscription. Keep listeners short; edits during notification return `busy`, while inspection is allowed.

## Synchronous access and edits

Use `inspect` to copy out information, and `edit` to build a transaction. A **transaction** is ProseMirror's description of a state change. Build it from the state supplied to the callback:

```ts
const target = editor.snapshot().views[0];
if (target) {
	const inspected = editor.inspect(target, ({ state }) => ({
		from: state.selection.from,
		to: state.selection.to,
	}));

	const edited = editor.edit(target, ({ state }) => state.tr.insertText('Hello'), {
		requireActive: true,
		focus: true,
	});
}
```

`inspected` and `edited` are result objects. Check their `ok` field before using `value`; [Results and disposal](#results-and-disposal) lists failure reasons.

### Read and edit options

- `inspect(target, read, options?)` returns the callback's synchronous value. It also works on readonly views. Options are `signal?: AbortSignal` and `requireActive?: boolean`.
- `edit(target, build, options?)` accepts a transaction or `null`. Returning `null` means no edit and produces `{ ok: true, value: false }`.
- Edit options add `focus?: boolean`. By default, an edit neither requires the active view nor moves focus.
- A non-null transaction goes through the actual `view.dispatch`, including the application's normal pipeline. The result is `true` once dispatched, even if that pipeline filters the transaction out.
- Requested focus happens only after successful handling. The same view and document must still be live, editable, uncancelled, and active when required.

### Keep live access synchronous

The callback receives an `EditorContext`: the view summary plus live `state: EditorState` and `view: EditorView`. These are trusted live objects, not sandboxed copies.

- Keep callbacks short and synchronous. Do not use `async` callbacks.
- Do not retain the view, state, mutable transaction, live selection, or command dispatch callback for later use.
- Do not mutate the view or dispatch directly. Return a transaction for the provider to dispatch.
- Nested inspection is allowed, including during edits, commands, and notifications. Nested editing returns `busy` until the outermost callback returns. Editing during subscriber delivery also returns `busy`.

Callback errors are thrown to the caller. A **thenable** is a promise or another object with a callable `then` method. Returning one throws `TypeError` because these callbacks must finish synchronously.

If the return value is a native Promise, the service handles its rejection to avoid an additional unhandled-rejection error. This check cannot stop or undo an async body that has already started.

### Freshness and transaction origin

The service checks the target, view lifetime, cancellation, editability, and optional active-view requirement before and after callbacks, and immediately before dispatch. State identity is strict: a selection-only update or an automatic pagination transaction makes the old target stale. These revisions are separate from pagination's layout-validity revisions.

A returned transaction must have `tr.before === current.state.doc`. This proves which document it starts from, not which `EditorState` created it. ProseMirror transactions do not retain their originating state. An old transaction from the same document but a different selection can therefore pass this document check if you supply a fresh target. Doing so violates the callback contract. Always build from the callback's state. The API cannot verify transaction provenance.

## Commands and ownership

Use `runCommand` for a standard ProseMirror command. A command has the signature `(state, dispatch, view) => boolean`. Without a dispatch callback, commands can probe whether an action is available:

```ts
import { toggleMark } from 'prosemirror-commands';

const target = editor.snapshot().views[0];
if (target) {
	editor.inspect(target, ({ state }) => {
		// Probe only: no dispatch means no edit.
		const mark = state.schema.marks.bold ?? state.schema.marks.strong;
		return mark ? toggleMark(mark)(state) : false;
	});

	editor.runCommand(target, (state, dispatch, view) => {
		const mark = state.schema.marks.bold ?? state.schema.marks.strong;
		return mark ? toggleMark(mark)(state, dispatch, view) : false;
	});
}
```

To make a command available by ID, register it on the connection:

```ts
const release = editor.registerCommand({
	id: 'my-plugin.insert-greeting',
	name: 'Insert greeting',
	command(state, dispatch) {
		dispatch?.(state.tr.insertText('Hello'));
		return true;
	},
});
const currentTarget = editor.snapshot().views[0];
if (currentTarget) {
	editor.executeCommand(currentTarget, 'my-plugin.insert-greeting', { focus: true });
}
// Optional early release; stopping the connection also removes it.
release();
```

### Command dispatch rules

The provider captures at most one transaction during the synchronous command call. It then closes the dispatch callback, checks freshness again, and dispatches only if the command returned `true`.

- `false` discards any captured transaction.
- `true` without a transaction means the command handled the action successfully.
- Throwing, returning a thenable, or dispatching more than once never partially dispatches through this API.
- Calling `view.dispatch` directly bypasses these protections. Trusted callback code must not do so; the provider cannot intercept or undo it.

### Registration lifetime

`commands()` returns copied `{ id, name, ownerId }` metadata, not callbacks. Command IDs are unique within the service; duplicates throw. Connection registrations use the consumer's plugin ID as owner. Standalone service registrations use `writers-ide.word-processing`.

Each registration returns a cleanup function that is safe to call repeatedly. An old cleanup function cannot remove a newer registration with the same ID. If a command's different owner removes it or loses its connection during execution, the command is treated as unhandled and nothing is dispatched.

**Revocation** makes an existing connection handle unusable when either the provider or consumer stops. Connections own their subscriptions and registrations through `connection.own`.

The connection API object suppresses late callbacks and checks both caller and connection cancellation. It does not require `AbortSignal.any`. These checks also cover deactivation inside a callback. The host wraps only top-level API methods, not returned cleanup functions or nested callbacks. A retained command dispatch callback cannot apply after its invocation ends.

## Async, worker and cooperative results

For a rewrite or analysis, copy only the needed data and keep its exact target. Compute outside editor callbacks. When the result is ready, use a new synchronous callback to build the transaction.

This example rewrites selected text using your own bundled worker module. Create `rewrite.worker.ts` with the [task worker protocol](../tasks/README.md) before using this code; that file is not supplied by this package.

```ts
const target = editor.snapshot().views[0];
if (target) {
	const captured = editor.inspect(target, ({ state }) => ({
		from: state.selection.from,
		to: state.selection.to,
		// Copy only the selected text, not the whole manuscript.
		text: state.doc.textBetween(state.selection.from, state.selection.to),
	}));
	if (captured.ok) {
		context.tasks.worker({
			key: 'rewrite-selection',
			label: 'Rewrite selection',
			createWorker: () =>
				new Worker(new URL('./rewrite.worker.ts', import.meta.url), { type: 'module' }),
			input: captured.value.text,
			apply(replacement: string, { signal }) {
				const outcome = editor.applyResult(
					target,
					replacement,
					(text, { state }) => state.tr.insertText(text, captured.value.from, captured.value.to),
					{ signal },
				);
				if (!outcome.ok && outcome.reason === 'stale') {
					console.info('Editor changed; result discarded');
				}
			},
		});
	}
}
```

`applyResult(target, result, apply, options?)` checks the exact target, then constructs and dispatches a transaction synchronously. It does not map old positions to a new document or silently retarget the result. Discard stale results or explicitly recompute them.

**Cooperative work** runs in short main-thread units and yields between them so the UI can respond. It uses the same capture/compute/apply pattern. Promises alone do not move CPU work off the main thread. A **bounded worker analysis** also limits the amount of input copied and processed, rather than scanning an entire manuscript by default. The [behavior examples](../../src/lib/editor/prosemirror/behaviors/README.md) include a real worker analysis limited to 32,768 selection positions and 1,024 text-node chunks. Tokens do not match across chunks, including mark boundaries; repeated complete tokens across chunks count together.

The task service owns progress and cancellation. Closing a view makes result application unavailable; edits make its captured target stale. Cancelling one task does not cancel peer editor operations. `applyResult` does not start tasks, retain transactions, group undo, or recover partial edits. See the [task guide](../tasks/README.md) for worker modules and cancellation.

## Results and disposal

Editor operations return `{ ok: true, value }` or `{ ok: false, reason }`:

| Reason            | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `unavailable`     | The view is missing/destroyed, or the service was disposed.           |
| `stale`           | The revision/document differs, or the required active view changed.   |
| `readonly`        | The target is fresh but not editable. Inspection is still available.  |
| `cancelled`       | The caller's signal was aborted.                                      |
| `revoked`         | The connection's signal was aborted.                                  |
| `unknown-command` | No live registration has the requested ID.                            |
| `busy`            | An edit was attempted inside another callback or during notification. |

Thrown callback and contract errors are not converted to task failures. A retained top-level API method throws after host revocation; the `revoked` result also covers connection cancellation detected during an operation.

The host integration calls `service.dispose()` when the provider ends. Disposal is safe to repeat. It clears listeners and commands and releases owned resources, including source subscriptions and reactive effects. If cleanup functions throw, the service attempts the remaining cleanup and reports the failures together. After disposal:

- Snapshots and command lists are empty.
- New registrations and subscriptions return harmless cleanup functions.
- Editor operations return `unavailable`, or `revoked` for an aborted connection.

The service never destroys the application's editor views. It does not provide schema registration, a task framework, security isolation, or application root registration.

## Part 3B: lifecycle-owned editor behaviors

Use `registerBehavior` when your feature needs a ProseMirror plugin rather than a single command. For example, an editor plugin can handle a key, decorate text without changing it, or maintain state across transactions. The word-processing provider installs it and owns its lifetime.

A **hook** is a callback ProseMirror invokes at a particular point, such as filtering a transaction or updating a plugin's state. An append hook can return another transaction after the initial, or **root**, transaction. Append hooks run synchronously.

```ts
import { Plugin } from 'prosemirror-state';

const remove = editor.registerBehavior({
	id: 'my-plugin.typing',
	name: 'Typing assistance',
	priority: 10,
	// Optional view-ID allowlist; omit it to include all live views.
	// views: ['manuscript-view'],
	create({ viewId, documentId, name, state, view, signal }) {
		// Called once per matching live view/document identity, not per transaction.
		return new Plugin({
			props: {
				handleKeyDown(view, event) {
					// Returning false leaves the key for other handlers.
					return false;
				},
			},
		});
	},
});

const stopObserving = editor.subscribeBehaviors((registrations) => {
	// Immediate frozen metadata, then registration/failure changes, not every edit.
	// { id, name, ownerId, priority, views?, status: 'active' | 'failed', error? }
});
const diagnostics = editor.behaviors();
// Optional early cleanup; the connection also owns both resources.
stopObserving();
remove();
```

This minimal handler deliberately leaves every key unchanged. For useful integrations, see the [input-rule, mapped-decoration, and worker examples](../../src/lib/editor/prosemirror/behaviors/README.md). Those examples are opt-in and are not enabled on the default app route.

### Factories, ordering, and compatibility

The `create` function is a **factory**: it creates an actual upstream `Plugin` or a readonly array of plugins for each matching live view/document identity. It must return synchronously. `views` filters by view ID, not document ID.

Each instance receives its own abort signal. That signal aborts when the view closes, detaches, or is replaced. It also aborts when the registration is removed or fails, the connection is revoked, or the service is disposed.

Registration IDs are unique within the service; duplicates throw. Priority defaults to zero. Higher priorities run first, and ties preserve registration order. Array order from each factory is retained.

The **baseline** means the existing host plugins: plugins installed outside this service. Managed plugins run before them, so managed key handlers can override existing handlers. The existing plugins keep their identities and relative order. This also applies to plugins added outside the service after a behavior is registered.

A **plugin key** identifies a ProseMirror plugin in an editor state. Duplicate keys fail the new registration rather than replacing an existing plugin. This includes duplicates within one factory result, against another behavior, or against existing host plugins. Key validation follows registration order, independently of priority.

Part 3B uses the existing schema only. `nodeViews` and `markViews` are rejected. Custom content, schema lifecycle, and Svelte node/mark views remain separately gated Part 3C work. Compatibility also depends on each upstream package's assumptions; this API does not make every ProseMirror package compatible.

### What reconfiguration preserves

**Keyed plugin state** is state associated with a plugin's stable key. **Stored marks** are the formatting marks ProseMirror will apply to newly typed text.

Installation uses `EditorState.reconfigure` with the same schema instance. It preserves the document, selection, stored marks, history, and keyed state of plugins that remain installed. It does not recreate the editor view, dispatch a transaction, or add an undo entry. It does change the service revision, so captured targets become stale.

The service wraps plugin callbacks to check lifetime and handle failures. These wrappers inherit from the original upstream Plugin instead of constructing a new Plugin. Generated keys, `instanceof Plugin`, `originalPlugin.getState(state)`, and `transaction.setMeta(originalPlugin, value)` keep working. This includes plugins created without an explicit `PluginKey`, such as upstream input rules.

A **plugin-view resource** is the object returned by a ProseMirror plugin's `view()` function. Callback receivers (`this`) remain the expected original plugin, state field, or plugin-view resource.

A surviving behavior keeps its factory instance, wrapped Plugin identity, signal, and keyed state when other registrations change. ProseMirror may still destroy and recreate its plugin-view resource when the plugin list changes. Do not rely on that resource retaining its identity.

### Source changes and safe installation

The **source adapter** connects the service to the application's live views and change notifications. While behaviors exist, the service keeps a dedicated source subscription and a Svelte effect that tracks reactive changes. It does so even without ordinary snapshot subscribers. The adapter must notify the service when views arrive, close, or are replaced.

Source-driven reconciliation means making installed plugins match the current views and registrations. It runs in a **microtask**: work queued after the current JavaScript call stack returns. This prevents a source notification raised inside a ProseMirror hook from reconfiguring the view while that hook is still executing. Reactive-only changes also use this path. Reading the service sees live state but does not force pending reconfiguration to run. No document scan, copy, or view recreation is needed.

Before installation, the service prepares candidate editor states for all matching current views. This is **staging**: validating factories, keys, and state initialization before installing those states.

That preparation can itself trigger changes. If a factory, state initializer, or plugin-view setup changes source identity, lifecycle, or another view's input state, the service discards and rebuilds the candidates. Dispatches during plugin-view setup or update are retained rather than overwritten by an older candidate state.

One attempt to bring registrations and views into agreement is capped at **16 passes**. If changes keep preventing agreement, the service disables all still-active registrations and leaves failed diagnostics. It disables them all because it cannot reliably identify which trusted callback caused the source changes.

This bound applies only to reconciliation. It does not interrupt callback code or an infinite ProseMirror append-transaction loop.

### Behavior failures and fallback values

**Quarantine** means disabling a failed registration across all its views. The service aborts its instance signals and leaves a `failed` diagnostic that you can remove with the registration's cleanup function.

Callback errors, invalid return values for supported hooks, and thenables trigger quarantine immediately. Disabling callbacks is immediate; removing the plugins from editor states waits until the executing hook has returned.

Until removal, wrappers supply fallback values:

- A transaction filter decides whether a transaction may proceed. On its first error, it rejects that transaction. This is **failing closed**: refusing the operation when the check fails. Once the registration is disabled, the filter's guard allows later transactions through until removal.
- Append hooks return `null`. State `apply` keeps its previous value.
- Decorations and `createSelectionBetween` return `null`. Event handlers and `dragCopies` return `false`.
- String and slice transforms return their unchanged input.
- `editable` returns `true`, and attributes return an empty object.
- Clipboard text serialization returns plain text. Other optional callbacks return `undefined`, leaving ProseMirror's default path.

The service validates known hook return types. Plugin state itself can contain arbitrary values. If a plugin-view resource's update or destroy callback fails, the error is handled and remaining managed cleanup is still attempted. See the [behavior implementation](src/behaviors.svelte.ts) for exact hook validation and fallbacks.

### Failure reporting

Failures reach two independent reporters when available:

- The consumer connection's `reportError` receives the behavior ID, phase, optional view ID, and a meaningful description of the thrown value. The host ties reports to the exact consumer activation and ignores reports after connection revocation.
- Optional `sources.reportBehaviorError` receives owner ID, registration ID, optional view ID, phase, and the original error. It can still receive cleanup errors after the connection ends.

The service catches errors from each reporter separately. If one throws, the other still receives the failure. A standalone service with neither reporter logs failures to `console.error`. Diagnostic observers are listeners registered through `subscribeBehaviors`. Their errors are also logged without stopping other observers.

### Registration and removal timing

Do not register behaviors inside synchronous editor callbacks, behavior hooks, or notifications. Registration throws there; schedule it after execution returns. Public diagnostic notifications also prohibit synchronous subscription, registration, or removal lifecycle changes. Observer errors do not stop other observers.

Removal and revocation disable callbacks immediately. Removing plugins from editor states can happen later:

- Signal-driven removal always waits for a microtask, including cancellation from existing host hooks.
- Explicit removal waits while managed hooks or service operations execute.
- Outside callbacks, explicit registration and removal are synchronous.

Registration signal listeners are detached on removal and service disposal, even if every source view has already been destroyed.

### Safety limits

These APIs integrate trusted frontend code; they do not isolate it. They cannot preempt a CPU loop or an unbounded append-transaction cycle. They cannot undo a started async body, raw dispatch, or arbitrary external effects from factories, state initialization, or plugin-view DOM work. Discarding a staged state does not roll back those effects.

Use the supported API rather than mutating source-owned editor internals. Frontend code shares the application's DOM and browser authority, including network access. A plugin with manuscript access can send that data elsewhere. DOM isolation is deferred. External loading and restrictive native access remain future work; frontend trust does not authorize unrestricted Tauri IPC, filesystem, shell/process, or native-library access. See the [plugin safety guide](../plugins/README.md#boundaries-and-next-steps).

## Provider wiring

This section is for host integrations, not ordinary feature consumers. The package supplies a standalone service and connection-scoped API objects. It imports no application singleton and does not register the provider, create editors, intercept their dispatch, or destroy them. The application integrates the provider and its consumers, including formatting.

A **source adapter** implements `WordProcessingSources` to connect the service to the application's existing views and notifications. With that adapter available as `sources`, setup inside the provider's activation function looks like this:

```ts
import {
	wordProcessingApi,
	createWordProcessingService,
	createWordProcessingConnection,
} from '@writers-ide/word-processing';

const service = createWordProcessingService(sources);

// The provider manifest ID must be WORD_PROCESSING_PLUGIN_ID and declare:
// provides: [{ id: wordProcessingApi.id, major: wordProcessingApi.major }]
context.apis.provide(wordProcessingApi, (connection) =>
	createWordProcessingConnection(service, connection),
);
context.own(() => service.dispose());
```

The returned API object has only methods, as required by `context.apis.provide`. For exact signatures, see [`WordProcessingApi`, `WordProcessingService`, and related types](src/contracts.ts). The [application adapter](../../src/lib/editor/prosemirror/word-processing.svelte.ts) is a concrete integration example.

## Sources and observations

`WordProcessingSources` requires:

- `listViews(): readonly { viewId, documentId, name, view: EditorView }[]`
- `activeViewId(): string | null | undefined`
- `subscribe(listener: () => void): Dispose`

It also accepts:

- `reportBehaviorError({ ownerId, id, viewId?, phase, error }): void` for application-owned error reporting.
- `prepareTransaction(transaction: Transaction): Transaction` to prepare managed appended transactions synchronously, as described below.

View IDs must be unique. Document identity is separate from view identity. Destroyed views are excluded. Closure and removal must be observable through sources. The service cannot detect removal and readdition entirely between reads without a source notification. Adapter reads may use Svelte runes.

### Live snapshots and subscriptions

`snapshot()` always reads live sources, even without subscribers or before a reactive flush. It returns frozen `{ activeViewId: string | null, views: readonly EditorSnapshot[] }` data. Unknown or missing active IDs become `null`.

Revision tokens increase across all service instances in this module, including removed/readded views and provider restarts. Active-view changes update the enclosing snapshot, not unrelated views' revision tokens.

`subscribe(listener)` immediately delivers the live snapshot. Subscriptions lazily share one source subscription and Svelte tracking effect; the last cleanup releases both. Each subscription is independent, even with the same callback. If initial delivery throws, setup is rolled back and the error propagates. Later listener failures are logged and isolated.

Source changes raised during notification are reread and drained. They are not lost when a listener calls `snapshot()`. Listeners must not continually mutate sources.

### Appended transactions and host invariants

A ProseMirror plugin can append transactions after the root transaction. The application adapter must account for each accepted transaction in its invalidation pipeline. This package does not replace that pipeline or redesign model-mutating pagination.

Optional `sources.prepareTransaction(transaction)` prepares managed appended transactions before ProseMirror applies them. The hook is synchronous. Its returned transaction must still start from the current state document supplied to the append hook. Malformed or thenable results quarantine the behavior.

This hook maintains host document rules; it is not a plugin permission. The app adapter uses it to normalize page indexes and preserve incoming stored marks, just as it does for root transactions. This keeps appended transactions from bypassing those invariants.

The app dispatch pipeline uses `applyTransaction`. It emits pre-DOM invalidation for every accepted root and appended transaction before updating the view. A filtered root causes neither invalidation nor a DOM update. See the [current transaction and layout flow](../../docs/pagination/context.md#current-transaction-and-layout-flow) and [plugin context](../../docs/plugins/context.md#lifecycle-owned-behaviors-part-3b-implemented--unmerged) for integration details.
