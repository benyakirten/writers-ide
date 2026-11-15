# Managed tasks

Private, source-exported Svelte 5 library. `index.ts` exports `WorkQueue`, `createTaskService`, and all task/queue contracts. `worker.ts` is an independent worker-only entry: it imports neither Svelte nor application/DOM runtime code. The library has **no singleton queue** and no editor or plugin-host dependencies.

## Use tasks in a plugin

The plugin host provides `context.tasks` automatically. No extra manifest capability or queue lease is needed. Use `forEach` for short main-thread units, `cooperative` for algorithms needing explicit checkpoints, `async` for asynchronous APIs, and `worker` for off-thread computation. Short synchronous commands remain ordinary functions; none of these helpers is mandatory.

```ts
activate(context) {
	context.contributions.command({
		id: 'example.analysis/scan',
		name: 'Scan paragraphs',
		execute() {
			context.tasks.forEach({
				key: 'scan',
				label: 'Scan paragraphs',
				items: paragraphTexts,
				run(text, index) {
					counts[index] = inspectOneShortUnit(text);
				},
			});
			return true;
		},
	});
}
```

This excerpt assumes the plugin supplies `paragraphTexts`, `counts`, and its analysis function; there is no public manuscript API in this library. Repeating the command replaces the previous `scan`. Unloading the plugin cancels its managed work. A presentation may receive `context.tasks` as an explicit prop and cancel an individual task on unmount if that task belongs only to that presentation. Failed tasks appear in host management errors without disabling the plugin. The host does not retain completed handles; keep the returned handle if your UI needs its status or outcome.

## Host integration

Create **one shared application queue**, including pagination, and one service per activation:

```ts
import { createTaskService, WorkQueue, type TaskService } from '@writers-ide/tasks';

const queue = new WorkQueue(); // application-owned; share this instance
const controller = new AbortController();
const tasks: TaskService = createTaskService({
	queue,
	ownerId: 'example.analysis',
	signal: controller.signal,
	onError: ({ ownerId, key, label, error }) => console.error(ownerId, key, label, error),
});

// On activation teardown, abort the owner's signal or call tasks.dispose().
controller.abort();
```

Services own queue leases for cooperative work; callers need not call `start()`. Queue handles expose their cancellation `signal` even before execution starts. Cancelling managed work through `queue.jobs` also settles the task and releases its lease; queue-level pause/resume is reflected by the managed handle. Async/worker tasks do not acquire scheduler leases. A raw `WorkQueue` consumer still uses `start()` and its returned idempotent release function. Releasing the final lease suspends raw work, without cancelling it. A service's `dispose()` is idempotent, cancels only its own active tasks, and revokes all four submission methods (subsequent calls throw). An already-aborted owner creates a revoked service.

Writer's IDE registers this private workspace dependency and supplies the same application-owned queue to pagination and its application plugin host. Standalone hosts can inject a queue; otherwise each standalone host owns an independent queue. No installation or external plugin loader is provided.

## Exact task API

```ts
createTaskService({ queue, ownerId, signal, onError? }): TaskService

tasks.forEach<T>({
  key, label, items: Iterable<T>,
  run: (item: T, index: number, context: { signal: AbortSignal }) => void,
  signal?, priority?: 'interactive' | 'background',
}): CooperativeTaskHandle<void>

tasks.cooperative<T>({
  key, label,
  create: (context: { signal: AbortSignal }) => Generator<WorkProgress | void, T, unknown>,
  signal?, priority?,
}): CooperativeTaskHandle<T>

tasks.async<T>({
  key, label,
  run: (context: { signal: AbortSignal }) => T | PromiseLike<T>,
  signal?,
}): TaskHandle<T>

tasks.worker<I, O>({
  key, label, createWorker: () => Worker, input: I,
  transfer?: Transferable[], signal?,
  apply?: (value: O, context: { signal: AbortSignal }) => void,
}): TaskHandle<O>

tasks.dispose(): void
```

`TaskHandle<T>` has readonly `key`, `label`, `status`, `progress`, `error`, `signal`, `result`, and `cancel()`. `CooperativeTaskHandle<T>` additionally has `pause()` and `resume()`. Retained terminal handles are safe to cancel/pause/resume; these calls become no-ops. Status, progress, and errors are Svelte-reactive. Status is `queued | running | paused | completed | cancelled | failed`; progress is `{ completed?: number; total?: number; message?: string }`. Array iteration reports a total; general iterables need not have one. Progress patches from generators are merged.

`result: Promise<TaskOutcome<T>>` **never rejects**:

```ts
type TaskOutcome<T> =
	| { status: 'completed'; value: T }
	| { status: 'cancelled' }
	| { status: 'failed'; error: unknown };
```

Errors are reported to `onError({ ownerId, key, label, error })`. Observer exceptions are contained. Generator cleanup errors are also attributed; a cancelled outcome remains cancelled, with cleanup failures retained on the handle. If cleanup fails after settlement (including cancellation inside an executing step), `handle.error` may update afterward. Multiple errors accumulate as `AggregateError` on the handle; failure outcomes carry the original failure. Terminal tasks are removed from the service's active ownership set.

## Convenient iteration

```ts
const scan = tasks.forEach({
	key: 'scan',
	label: 'Scan paragraphs',
	items: paragraphs,
	run(paragraph, index, { signal }) {
		// One short, synchronous unit. Never use an async callback here.
		counts[index] = paragraph.text.match(/\S+/g)?.length ?? 0;
	},
});

const outcome = await scan.result;
if (outcome.status === 'completed') {
	console.log('Scan complete');
}
```

`items` is consumed lazily, without copying or materializing it. Generators/iterators close on cancellation after iteration has started. The helper yields between individual units; it does not make an expensive callback interruptible.

## Advanced cooperative work

```ts
const scan = tasks.cooperative({
	key: 'scan',
	label: 'Incremental scan',
	priority: 'background',
	create: function* ({ signal }) {
		let completed = 0;
		for (const paragraph of paragraphs) {
			if (signal.aborted) {
				return completed;
			}
			inspectOneShortUnit(paragraph);
			completed++;
			yield { completed, total: paragraphs.length };
		}
		return completed;
	},
});
scan.pause();
scan.resume();
```

Each scheduler frame retains the original 8 ms soft budget, 1,000-step cap, round-robin order, and 3:1 interactive/background fairness. The queue cannot interrupt a running step. Cooperative generators and iteration callbacks must be synchronous and bounded. DOM measurement stays on the main thread.

## Async work

```ts
const download = tasks.async({
	key: 'download',
	label: 'Download metadata',
	run: async ({ signal }) => {
		const response = await fetch(url, { signal });
		return response.json();
	},
});
```

`run` starts immediately, can return a plain value or a promise, and may throw synchronously. A promise does not offload CPU work. Cancellation settles the managed task immediately and aborts its signal; the underlying operation must honor that signal. Late resolution/rejection is consumed and ignored. Do not perform unguarded side effects after `await` inside `run`; the service cannot undo them.

## Bundled one-shot workers

Use a dedicated, fresh worker per invocation, not an already-running/shared worker:

```ts
const count = tasks.worker<string[], number>({
	key: 'count',
	label: 'Count words',
	input: paragraphTexts,
	createWorker: () => new Worker(new URL('./count.worker.ts', import.meta.url), { type: 'module' }),
	apply(value, { signal }) {
		wordCount = value; // synchronous; validate current application targets here
	},
});
```

[`examples/count.worker.ts`](examples/count.worker.ts) is a complete worker module. Author its handler using the separate entry:

```ts
import { defineTaskWorker } from '@writers-ide/tasks/worker';

defineTaskWorker<string[], number>(self, (paragraphs) => {
	return paragraphs.reduce((sum, text) => sum + (text.match(/\S+/g)?.length ?? 0), 0);
});
```

`defineTaskWorker<I, O>(scope, run, { transfer?: (output: O) => Transferable[] }?)` accepts a structural `TaskWorkerScope`, handles one request, catches synchronous/asynchronous failures and result-clone failures, and returns an idempotent uninstaller. Worker builds should use their normal WebWorker TypeScript environment; no DOM runtime import is required. Input messages are `{ type: 'tasks:run', input }`; responses are `{ type: 'tasks:result', value }` or `{ type: 'tasks:error', error: { name, message, stack? } }`. Malformed requests/responses fail the task: request/result envelopes must include their `input`/`value` field (explicit `undefined` is allowed), and error envelopes require string `name`/`message` and an optional string `stack`. Disposing the worker helper before its deferred callback starts skips `run`. Error messages are plain cloneable data.

The service detaches listeners and terminates the worker on success, failure, cancellation, replacement, and owner teardown. It handles factory/postMessage exceptions, worker `error`/`messageerror`, remote failures, and synchronous `apply` failures. Late callbacks cannot apply cancelled results. A response is claimed before `apply`, preventing reentrant delivery from applying it twice. Every listener removal and termination is attempted independently; cleanup failures are attributed and retained without changing an already-settled outcome. Input transfer lists are forwarded to `postMessage`; transfer moves ownership and may detach buffers in the caller. Output transfers are selected by the worker helper. A broken transport that cannot send even the plain error envelope cannot report through this protocol; owner cancellation remains available. No pooling, progress protocol, timeout, or function serialization is implemented.

## Replacement, cancellation, and result application

- Keys are local to one service. Submitting the same key replaces work **across all modes**. Internal queue keys include a unique service activation identity, so different owners and reactivations do not collide.
- Caller cancellation affects only its task. Owner cancellation/disposal affects every active task in that service, not pagination or another service. Pre-aborted per-task signals skip all user work.
- Cancellation aborts the handle signal before generator cleanup; cleanup during `next()` is deferred until the step returns. Reentrant cleanup can submit a newer same-key replacement, which wins.
- `apply` is synchronous and called once only while the worker task is active. Awaiting a result and separately applying it is the caller's responsibility; do not duplicate application already done by `apply`.
- Capture cloneable input, compute, then validate the current target before applying. Never send live DOM/editor objects to a worker or retain mutable transactions across `await`/yield. This library has no editor freshness, mapping, undo, or application transaction abstractions.
- These are lifecycle/convenience contracts, not a sandbox. Trusted frontend code retains ambient authority and can still block the main thread or perform its own side effects.

## Tests

Run from the repository root:

```sh
pnpm test:unit:ci src/lib/testing/tasks-library src/lib/editor/state/work-queue.svelte.test.ts src/lib/components/pagination/queue.svelte.test.ts
```

Existing queue tests remain at their original path and exercise the compatibility export. Unit worker tests use mock transports. Run `pnpm test:tasks` for the dedicated production-built browser fixture in Chromium/WebKit: emitted module workers, real buffer transfers, cancellation, failure/recovery, and shared queue ownership. These tests do not establish packaged Tauri behavior or a performance target.
