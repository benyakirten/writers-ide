# Word processing (Part 3A)

Private, source-exported `@writers-ide/word-processing` supplies a standalone live-editor service and connection-scoped provider facades. It imports no application singleton and does not create, configure, intercept or destroy editors. The application supplies sources and owns the existing ProseMirror dispatch pipeline, schema, history and model-mutating pagination.

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

`WordProcessingSources` contains exactly:

- `listViews(): readonly { viewId, documentId, name, view: EditorView }[]`
- `activeViewId(): string | null | undefined`
- `subscribe(listener: () => void): Dispose`

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

Thrown callback/contract errors are not converted to task failures. `service.dispose()` revokes resources, clears listeners/commands, releases source/effect subscriptions and is idempotent; cleanup continues across errors and aggregates failures. Afterwards snapshots/command lists are empty, new registrations/subscriptions return harmless disposers, and editor operations return unavailable (or revoked for an aborted connection). The service never destroys source-owned views. No API reconfiguration, schema registration, task framework, security isolation, or application root registration is included.
