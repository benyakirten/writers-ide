# Word processing (Parts 3A–3B)

Private, source-exported `@writers-ide/word-processing` supplies a standalone live-editor service and connection-scoped provider facades. It imports no application singleton and does not create, intercept dispatch for, or destroy editors. Part 3B reconfigures existing editor states to install lifecycle-owned behaviors. The application supplies sources and owns the existing ProseMirror dispatch pipeline, schema, history and model-mutating pagination.

## Provider wiring

```ts
import {
	WORD_PROCESSING_PLUGIN_ID,
	wordProcessingApi,
	createWordProcessingService,
	createWordProcessingConnection,
} from '@writers-ide/word-processing';

// Application adapter: list registered views, resolve active view identity,
// and notify after editor updates/registration/closure. Reads may use Svelte runes.
const service = createWordProcessingService(sources);

// In the provider plugin, whose manifest ID is WORD_PROCESSING_PLUGIN_ID:
// provides: [{ id: wordProcessingApi.id, major: wordProcessingApi.major }]
context.apis.provide(wordProcessingApi, (connection) =>
	createWordProcessingConnection(service, connection),
);
context.own(() => service.dispose());
```

`WORD_PROCESSING_PLUGIN_ID` and the API ID are both `writers-ide.word-processing`; API major is `1`. A consumer declares:

```ts
const dependency = {
	provider: WORD_PROCESSING_PLUGIN_ID,
	api: wordProcessingApi.id,
	major: wordProcessingApi.major,
};
// Include dependency in the consumer manifest's dependencies.
const editor = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
```

This package does not register the provider or migrate formatting. Those are application integration responsibilities.

## Sources and observations

`WordProcessingSources` contains:

- `listViews(): readonly { viewId, documentId, name, view: EditorView }[]`
- `activeViewId(): string | null | undefined`
- `subscribe(listener: () => void): Dispose`
- Optional `reportBehaviorError({ ownerId, id, viewId?, phase, error }): void` for application-owned error reporting.

View IDs must be unique. Document identity is separate: two views may refer to the same document without synchronizing their states. Destroyed views are excluded. Closure/removal must be observable through the sources. A service cannot detect a removal and readdition that happens entirely between reads without any source notification.

`snapshot()` always reads live sources, even without subscribers and before a reactive flush. It returns frozen, data-only `{ activeViewId: string | null, views: readonly EditorSnapshot[] }`. Each view summary has `viewId`, `documentId`, `name`, `revision`, and `editable`. There is no document serialization or whole-document scan.

A revision changes when the service observes a different view, state (including selection-only state updates), document identity, name or editability. Tokens increase across all service instances in this module, including removed/readded views and provider restarts. Active-view changes update the enclosing snapshot, not unrelated per-view tokens. Unknown/missing active IDs become `null`.

`subscribe(listener)` delivers the live snapshot immediately and lazily shares one source subscription and a Svelte tracking effect. The last disposer releases both. Initial listener failure rolls back that subscription and propagates; later listener failures are logged and isolated. Each subscription is independent even with the same callback. Reentrant source changes are reread/drained, not lost when a listener calls `snapshot()`. Editing during notifications returns `busy`; inspection is allowed. Listeners should be short and must not continually mutate sources.

## Synchronous access and edits

Choose a particular view; no operation implicitly requires the active view:

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

`EditorTarget` is `{ viewId, documentId, revision }`; an `EditorSnapshot` is a valid target. `EditorContext` adds the live `state: EditorState` and `view: EditorView` to the summary. These are **trusted synchronous callback access**, not a sandbox or a retention-enforcing membrane. Keep callbacks short. Do not retain the view, state, mutable transaction, command dispatch callback or live selection for later application. Do not mutate the view or dispatch directly inside these callbacks; return the transaction to the provider instead. Ambient JS authority is not prevented.

- `inspect(target, read, options?)` returns the synchronous value, including on readonly views. Options are `signal` and `requireActive`.
- `edit(target, build, options?)` builds a transaction from the callback's current state. Return `null` for no edit (`ok: true, value: false`). A non-null transaction is dispatched through the **actual** `view.dispatch`; no editor pipeline is intercepted. A dispatched transaction returns `true`, even when the application pipeline filters it.
- Editing options are `signal?: AbortSignal`, `requireActive?: boolean`, `focus?: boolean`. Defaults do not require active state or focus. Focus occurs only after successful handling while the same view/document remains live, editable, uncancelled and, when requested, active.
- Callback errors propagate. Thenable returns throw `TypeError`; native Promise rejections are consumed to avoid an additional unhandled rejection. An async body already started cannot be rolled back or stopped by this check. Build/read/command callbacks must not be async.
- Nested inspection is allowed, including inside edit/command callbacks and subscriber delivery. Nested edits return `busy` until the outermost callback returns; editing during subscriber delivery also returns `busy`.

The service checks target freshness, lifecycle, cancellation, editability and the optional active requirement before callbacks, after callbacks, and immediately before dispatch. State identity is strict: even a selection-only update or automatic pagination transaction invalidates the captured target, even if authored text is unchanged. Editor-state revisions are distinct from layout-validity revisions. Transactions must have `tr.before === current.state.doc`.

**Transaction-origin limitation:** ProseMirror transactions do not retain their originating `EditorState`. An old transaction created from the identical document but a different selection cannot be reliably identified from `tr.before`. The strict target rejects old revisions, but passing a retained old transaction with a freshly acquired target violates the callback contract and may pass the document check. Always build from the state supplied to this callback. This API deliberately does not patch ProseMirror or invent transaction provenance.

## Commands and ownership

```ts
import { toggleMark } from 'prosemirror-commands';

const target = editor.snapshot().views[0];
if (target) {
	editor.inspect(target, ({ state }) => {
		// Capability probe only; no dispatch means no edit.
		const mark = state.schema.marks.bold ?? state.schema.marks.strong;
		return mark ? toggleMark(mark)(state) : false;
	});

	editor.runCommand(target, (state, dispatch, view) => {
		const mark = state.schema.marks.bold ?? state.schema.marks.strong;
		return mark ? toggleMark(mark)(state, dispatch, view) : false;
	});
}

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
// Optional early release; connection revocation also removes it.
release();
```

Commands use standard ProseMirror `(state, dispatch, view) => boolean`. The provider captures **at most one transaction**, closes the dispatch callback when the synchronous invocation ends, rechecks freshness, then dispatches only if the command returned `true`. Returning `false` drops any captured transaction. A throwing/thenable/multi-dispatch command never partially dispatches through this API. `true` without a transaction is handled success. Direct `view.dispatch` by trusted callback code cannot be intercepted or rolled back.

`commands()` returns copied `{ id, name, ownerId }` metadata without callbacks. IDs are global **within this service**, duplicates throw, and connection registrations use `consumerId` as owner. Standalone registrations use `writers-ide.word-processing`. Each registration has an idempotent disposer; an old disposer cannot remove a later registration with the same ID. A command whose different owner releases/revokes it during execution is treated as unhandled without dispatch.

Connections return plain method-only facades suitable for `context.apis.provide`. Subscriptions and registrations use `connection.own`; callbacks use `guard` and synchronous signal checks. Both caller cancellation and connection cancellation are checked without `AbortSignal.any`. Retained nested dispatch callbacks cannot apply after the invocation ends. The host revokes top-level methods; these checks additionally handle deactivation **inside** a callback and returned disposers/callbacks, which the host does not recursively wrap.

## Async, worker and cooperative results

Capture an exact target plus only the data your computation needs. Compute outside editor callbacks. Apply through a new synchronous callback:

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
				// If stale, discard or explicitly recompute; never silently retarget.
				if (!outcome.ok && outcome.reason === 'stale') {
					console.info('Selection changed; result discarded');
				}
			},
		});
	}
}
```

The worker URL above represents your own bundled worker module (for example built with `@writers-ide/tasks/worker`), not a module supplied by this package. `applyResult(target, result, apply, options?)` is simply strict target validation plus synchronous transaction construction/dispatch. It does not map positions, retain transactions, start tasks, group undo, track progress or implement partial-edit recovery. Cooperatively yielded work uses the same capture/apply pattern. Task progress/cancellation belongs to the task service; closure makes result application unavailable, and edits make it stale. Cancelling a task does not cancel peer editor operations.

## Results and disposal

Operations return `{ ok: true, value }` or `{ ok: false, reason }`:

| Reason            | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `unavailable`     | View missing/destroyed or service disposed.                            |
| `stale`           | Revision/document mismatch or required active view changed.            |
| `readonly`        | Fresh target exists but is not editable. Inspection remains available. |
| `cancelled`       | Caller signal aborted.                                                 |
| `revoked`         | Connection signal aborted.                                             |
| `unknown-command` | No live registration for the requested ID.                             |
| `busy`            | Nested editing or editing during notification.                         |

Thrown callback/contract errors are not converted to task failures. `service.dispose()` revokes resources, clears listeners/commands, releases source/effect subscriptions and is idempotent; cleanup continues across errors and aggregates failures. Afterwards snapshots/command lists are empty, new registrations/subscriptions return harmless disposers, and editor operations return unavailable (or revoked for an aborted connection). The service never destroys source-owned views. No schema registration, task framework, security isolation, or application root registration is included.

## Part 3B: lifecycle-owned editor behaviors

A consumer can wrap an actual upstream ProseMirror `Plugin` through the same connection API used for commands:

```ts
import { Plugin } from 'prosemirror-state';

const remove = editor.registerBehavior({
	id: 'my-plugin.typing',
	name: 'Typing assistance',
	priority: 10,
	// Optional explicit view-ID allowlist; omitted means all live views.
	// views: ['manuscript-view'],
	create({ viewId, documentId, name, state, view, signal }) {
		// Called once per matching live view identity, not per transaction.
		// Return an actual upstream Plugin or a readonly Plugin array.
		return new Plugin({
			props: {
				handleKeyDown(view, event) {
					return false;
				},
			},
		});
	},
});

const stopObserving = editor.subscribeBehaviors((registrations) => {
	// Immediate frozen metadata, then registry/failure updates (not editor edits).
	// { id, name, ownerId, priority, views?, status: 'active' | 'failed', error? }
});
const diagnostics = editor.behaviors();
// Optional early cleanup; connection revocation also owns both resources.
stopObserving();
remove();
```

Registration IDs are service-global; duplicates throw. Priority defaults to zero, sorts descending, and ties preserve registration order. Managed plugins run **before** the actual current baseline plugins, allowing key handlers to override baseline handlers. Baseline identities/order are preserved, including foreign plugins added after registration. Duplicate plugin keys (within a factory result, against another behavior, or against the baseline) fail the newcomer rather than replace existing keys. `nodeViews`/`markViews` are rejected: custom content and schema lifecycle remain Part 3C.

Factories are synchronous and per live view/document identity. Each receives a separate abort signal tied to view closure/detach/replacement, registration removal/failure, connection revocation, and service disposal. Sources remain observed through a dedicated source subscription and Svelte tracking effect while registrations exist, even without ordinary snapshot subscribers. Notifications must make closures/replacements observable. Source-driven reconciliation (including reactive-only changes) is deferred to a microtask, so notifications raised inside baseline or managed ProseMirror hooks cannot reconfigure a view on that hook's stack. Service reads observe live state but do not flush pending reconfiguration. No document scan/copy or view recreation is used.

Installation uses `EditorState.reconfigure` with the **existing schema instance**. Document, selection, stored marks, history, and surviving keyed plugin state remain intact. Reconfiguration changes the service revision, but dispatches no transaction and creates no undo entry. ProseMirror can destroy/recreate plugin-view resources when the plugin list changes; a surviving behavior's factory, wrapped Plugin identity, signal and keyed state remain stable, but its plugin-view `view()` resource is not promised to survive such changes.

Wrappers inherit from the actual Plugin, not a newly constructed Plugin: generated keys, `instanceof Plugin`, original `getState(state)` and `transaction.setMeta(originalPlugin, value)` identity work even for an **unkeyed** upstream plugin (such as input rules). Callback receivers preserve the upstream Plugin/state-field/plugin-view resource semantics. Package compatibility still depends on the existing document schema and the upstream package's assumptions; this is not universal compatibility.

Factory/key/state-init validation is staged across all current matching views before installing candidate states. Stages are discarded and rebuilt if factories, state initialization, or plugin-view setup change source identity, lifecycle, or another view's input state. Dispatches from plugin-view setup/update are retained rather than overwritten by an older stage. A reconciliation drain is capped at 16 passes; failure to stabilize quarantines all still-active registrations rather than hanging the editor. This conservative fallback cannot identify which trusted callback caused arbitrary source mutations. Failures leave a removable `failed` diagnostic and abort all instances of that registration. Runtime callback errors or thenables quarantine the whole registration immediately; physical removal is deferred out of executing hooks. A failing filter rejects that transaction, append returns null, decorations return null, event handlers return false, and state apply preserves its previous value until removal. Plugin-view update/destroy failures are attributed and contained, and remaining managed cleanup is still attempted. Failures are reported through the owning consumer's connection `reportError`, with behavior ID, phase, optional view ID, and a meaningful thrown-value description. The generic host authenticates the connection's exact consumer activation and ignores reports after revocation; cleanup can still notify the optional source observer. Optional `sources.reportBehaviorError` independently receives owner/registration/view/phase attribution. Each reporter is independently caught, so one failing reporter does not suppress the other. Standalone services with neither reporter log failures to `console.error` instead of silently dropping them; diagnostic observer errors are also isolated. String/slice transforms fall back to their unchanged input, editable to true, attributes to an empty object, clipboard text serialization to plain text, and nullable handlers to their ProseMirror default/no-op path. Invalid known hook return types and thenables also quarantine the behavior; arbitrary plugin state values remain allowed.

Do not register inside synchronous editor callbacks, behavior hooks or notifications: lifecycle registration throws; explicitly defer it until after execution returns. Removal/revocation immediately disables callbacks. Signal-driven revocation always defers physical removal, including cancellation from baseline hooks; explicit removal defers while managed hooks or service operations are executing. Registration signal listeners are detached on removal and service disposal, even when every source view has already been destroyed. Public diagnostic notifications disallow synchronous subscription/registration/removal lifecycle mutation; observer exceptions are logged without stopping peers. Explicit registration/removal outside callbacks is synchronous.

**Limits:** trusted same-environment integration is not security isolation. The manager cannot preempt arbitrary callback code or an infinite append-transaction loop, undo side effects of an already-started async body, or roll back arbitrary factory/plugin-view DOM effects. Staged state-init rollback does not undo arbitrary external effects of init callbacks. Do not dispatch raw views or mutate source-owned editor internals behind the API. The application adapter must account for appended transactions in its own transaction invalidation pipeline; this standalone package neither replaces that pipeline nor redesigns pagination.

An optional source-level `prepareTransaction(transaction)` hook prepares managed appended transactions synchronously before ProseMirror applies them. This is host model-invariant plumbing, not a plugin permission: the app adapter uses it to normalize page indexes and preserve incoming stored marks just as it does for root transactions. The returned transaction must still start from the supplied current state's document; malformed/thenable results quarantine the behavior. The app dispatch pipeline uses `applyTransaction` and emits pre-DOM invalidation for every accepted root/appended transaction, none for a filtered root.
