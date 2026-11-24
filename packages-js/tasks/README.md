# Managed tasks

`@writers-ide/tasks` manages work that can continue after the function that started it returns. It tracks progress, cancellation, results, and errors. Use it for a paragraph scan, a network request, or computation in a Web Worker.

Choose how the work runs:

- `forEach` splits iteration into short, synchronous main-thread units.
- `cooperative` uses a generator: a function that can pause at `yield` and continue later. Here, **cooperative** means that your code returns control regularly so the browser can do other work. It does not mean a separate thread.
- `async` manages an asynchronous API, such as `fetch`.
- `worker` runs computation in a separate Web Worker over copied or transferred data.

Use ordinary synchronous functions for short actions. Use managed tasks when work needs cancellation, progress tracking or time to run across multiple steps.

This is a private Svelte 5 workspace library that exports source files, not a compiled distribution. Use a Svelte-aware bundler. [`index.ts`](index.ts) exports `WorkQueue`, `createTaskService`, and the task/queue contracts. [`worker.ts`](worker.ts) is a separate worker-only entry. It imports neither Svelte nor application or DOM runtime code. The library has no singleton queue and no editor or plugin-host dependencies. A feature plugin can use the library; the library is not itself a feature plugin.

## Use tasks in a plugin

For the default bundled host, a plugin is an object with a manifest and an `activate(context)` method. The **plugin host** is the application service that registers, enables and disables plugins. Application setup registers the object with `host.register(plugin)`. When setup or the Plugins manager enables it, the host calls its `activate` method synchronously. Plugin authors do not call that method themselves.

The host supplies the `context` argument. Its `tasks` API starts managed work owned by that activation. The host cancels that work when the plugin is disabled or activation fails. Enabling the plugin again creates a new activation and context.

See [Add a toolbar](../plugins/README.md#add-a-toolbar) for the plugin definition format and [Register and enable](../plugins/README.md#register-and-enable) for application setup. These explain how a bundled definition becomes an active feature. To use this library without a plugin host, skip to [Host integration](#host-integration).

For example, put this definition in a TypeScript module in your bundled plugin. Application setup imports its `plugin` export, registers it, and enables `example.analysis`. The task starts during activation and logs the character count of each sample paragraph. The sample text is supplied here; it is not read from an open document.

```ts
import type { BundledPlugin } from '@writers-ide/plugins';

export const plugin: BundledPlugin<unknown> = {
	manifest: {
		id: 'example.analysis',
		version: '0.1.0',
		apiVersion: 1,
		name: 'Paragraph analysis',
		description: 'Counts characters in sample paragraphs.',
		capabilities: [],
	},
	activate(context) {
		const paragraphTexts = ['The story begins.', 'Another paragraph follows.'];
		context.tasks.forEach({
			key: 'scan',
			label: 'Scan paragraphs',
			items: paragraphTexts,
			run(text, index) {
				console.info(`Paragraph ${index + 1}: ${text.length} characters`);
			},
		});
	},
};
```

The task service calls `run` once per item, yielding to the browser between units as needed. It manages the queue's running lifetime. Tasks require no extra manifest capability.

Submitting another task with key `scan` during the same activation replaces this task. Task failures appear in the host's management errors. They do not disable the plugin. For real document input, use the [word-processing guide](../word-processing/README.md#async-worker-and-cooperative-results) to capture editor data and validate results.

A presentation can receive `context.tasks` as an explicit prop. If a task belongs only to that presentation, cancel it when the presentation unmounts. Keep the returned handle if your UI needs its status or outcome. The host does not retain completed handles.

## Advanced use: create an independent queue

**Use `context.tasks` for ordinary plugin work.** It already shares scheduling with pagination and other plugins and owns activation cleanup. `WorkQueue`, `WorkOptions`, `WorkHandle`, `createTaskService`, `AdvancedTaskService`, `WorkerFactoryTaskOptions`, `TaskServiceOptions` and `TaskFailure` are advanced exports for authors intentionally constructing their own queue or task service. The curated SDK exports these contracts. Production external loading is not implemented.

An independent queue can be useful for an embedded tool that also runs in a standalone application or test harness. It does not share the host queue's scheduling decisions or frame budget. It does not run cooperative callbacks on another thread. Authors must wire cancellation, disposal and error reporting themselves.

Import the constructors at the top of the plugin module:

```ts
import { WorkQueue, createTaskService } from '@writers-ide/tasks';
```

Place the following inside the bundled plugin's `activate(context)` callback described above. The host supplies that context. This example owns a private queue and uses sample text rather than reading an editor:

```ts
const queue = new WorkQueue();
const independentTasks = createTaskService({
	queue,
	ownerId: 'example.embedded-tool',
	signal: context.signal,
	onError: ({ error }) => console.error('Independent task failed', error),
});

context.own(() => independentTasks.dispose());

independentTasks.forEach({
	key: 'paragraph-lengths',
	label: 'Measure sample paragraph lengths',
	items: ['The story begins.', 'Another paragraph follows.'],
	run(text) {
		console.info(text.length);
	},
});
```

The service acquires and releases scheduling leases for its cooperative work; this example does not need `queue.start()`. Aborting the activation signal or disposing the service cancels its tasks. Supplying an `ownerId` labels this service's work; it does not grant native authority. Its error callback is explicit rather than automatically connected to the plugin manager.

If you use `queue.enqueue()` directly instead, you own the raw job handles and must cancel them during teardown. Acquire a scheduling lease with `queue.start()` and release it when done. Releasing the final lease suspends queued work; it does not cancel jobs. Do not treat lease release as task cleanup.

## Host integration

If you are building a host, create one shared application queue. Include pagination in that queue so tasks share its main-thread budget. Create one task service per activation:

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

`createTaskService()` returns `AdvancedTaskService`. It accepts module requests when the host configures `loadWorkerModule(module, context): Uint8Array | PromiseLike<Uint8Array>`. The callback receives a copied URL and the task's cancellation signal. It must obtain trusted bytes and enforce its host's URL ownership policy. Without a loader, a module request resolves to a failed outcome. There is no `fetch` fallback.

The optional `isLive(): boolean` callback lets a host mark a lifetime dead before delivering its AbortSignal events. Active tasks recheck it before later work and settlement. A dead lifetime cancels pending outcomes and suppresses later error reports. Cleanup errors remain available through `handle.error`. Already-completed outcomes do not change. The internal component host maps this callback to its private activation phase.

### Queue leases

A lease keeps the queue running until its release function is called. Managed services acquire and release these leases for cooperative work. Plugin task callers do not call `start()`. Async and worker tasks do not acquire scheduler leases.

Code using a raw `WorkQueue` calls `start()` itself. The returned release function is idempotent: calling it twice is safe. Releasing the final lease suspends raw queued work. It does not cancel that work.

Queue handles expose their cancellation `signal` before execution starts. Cancelling managed work through `queue.jobs` also settles the task and releases its lease. Queue-level pause and resume changes appear on the managed handle.

### Service lifetime

`dispose()` cancels only that service's active tasks. It is safe to call more than once. It also revokes the service: all four submission methods stop accepting work and throw on later calls. Creating a service with an already-aborted owner signal creates a service that is already revoked.

Writer's IDE supplies the same application-owned queue to pagination and its plugin host. A standalone plugin host can receive a queue explicitly. Otherwise, each standalone host creates an independent queue. This library does not install or load external plugins.

## Exact task API

```ts
createTaskService({ queue, ownerId, signal, onError?, isLive?, loadWorkerModule? }): AdvancedTaskService

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
  key, label, module: URL, input: I,
  transfer?: Transferable[], signal?,
  apply?: (value: O, context: { signal: AbortSignal }) => void,
}): TaskHandle<O>

tasks.dispose(): void
```

### Handles and progress

`TaskHandle<T>` exposes readonly `key`, `label`, `status`, `progress`, `error`, `signal`, `result`, and `cancel()`. `CooperativeTaskHandle<T>` also provides `pause()` and `resume()`. After a task completes, fails, or is cancelled, these control methods do nothing. Retaining and calling an old handle is safe.

Status, progress, and errors are Svelte-reactive, so Svelte can track their changes. Status is `queued | running | paused | completed | cancelled | failed`. Progress is `{ completed?: number; total?: number; message?: string }`. Array iteration reports a total. A general iterable need not have one.

Generators can yield partial progress records. Each record updates only the fields it supplies rather than replacing the entire progress record.

`result: Promise<TaskOutcome<T>>` **never rejects**. It resolves to one of the following outcomes, including when the task fails. Check `outcome.status` rather than relying on a promise rejection:

```ts
type TaskOutcome<T> =
	| { status: 'completed'; value: T }
	| { status: 'cancelled' }
	| { status: 'failed'; error: unknown };
```

### Errors and cleanup

Errors go to `onError({ ownerId, key, label, error })`. If that error observer throws, the exception does not escape into the task caller. Generator cleanup errors are also reported with the same owner, key, and label.

A cleanup failure does not change a cancelled outcome into a failed one. The handle retains the cleanup error instead.

Cleanup can finish after the result promise has resolved. This can happen when cancellation occurs inside a step that is still executing. In that case, `handle.error` can update later.

If there are multiple errors, the handle stores them in an `AggregateError`, which groups errors together. A failed outcome still carries the original failure. The service stops tracking a task as active once it completes, is cancelled, or fails.

## Convenient iteration

In this example, `tasks` is a live task service, `paragraphs` is an array of objects with a `text` string, and `counts` is a writable number array. Run it in an async function or a module that supports top-level `await`.

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

`items` is consumed as needed. The helper does not copy it or first build an array. After iteration starts, cancellation closes the generator or iterator. The helper yields between units, but cannot interrupt an expensive callback. Keep each callback short and synchronous.

## Advanced cooperative work

Use a generator when the algorithm needs explicit checkpoints or a final return value. This example uses the same live `tasks` service and a `paragraphs` array. The host supplies a short, synchronous `inspectOneShortUnit` function.

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

The scheduler chooses which queued work runs next. It has an 8 ms **soft** budget per frame and a 1,000-step cap. It takes turns among jobs in round-robin order. It balances interactive and background work at a 3:1 ratio.

The budget is soft because the queue cannot interrupt a running step. Each generator step and iteration callback must be synchronous and bounded. A single long step can exceed the frame budget. DOM measurements must stay on the main thread.

## Async work

Use this mode for an API that already supports asynchronous work. Here, `tasks` is a live service and `url` is the metadata endpoint supplied by your application.

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

`run` starts immediately. It can return a plain value or a promise, and it may throw synchronously. It still runs on the main thread. Use a worker for suitable CPU-heavy computation.

The example's `fetch()` uses browser networking. This wrapper does not bypass browser connection scheduling or CORS rules and does not route the request through Rust. An [optional native HTTP service](../../docs/plugins/implementation-plan.md#future-native-http-service) is future work. Its transport would be explicitly chosen and subject to native permission checks; no such API is implemented yet.

Cancellation immediately resolves the managed task's result with a cancelled outcome and aborts its signal. The underlying operation must honor that signal to stop. If it later resolves or rejects, the service handles that result but ignores it.

The service cannot undo side effects inside `run`. After an `await`, check cancellation and the current application target before changing state.

## Bundled one-shot workers

The ordinary `TaskService` in `FrontendContext` accepts `WorkerTaskOptions<I, O>`: `{ module: URL, input, key, label, transfer?, signal?, apply? }`. It does not accept `createWorker`, in either types or the internal component host's runtime wrapper. A trusted host binds the activation to its package files and verified byte reader. Module selection and the browser fixture are implemented; production native resource integration is not.

Put this named export in a frontend plugin's entry module. The internal host calls `activate(context)` synchronously when enabling the component and supplies `FrontendContext`. Activation starts the task and installs result handling; it does not wait for computation. The input below is sample text, not manuscript data. The host must bind this component to a snapshot containing the emitted `count.worker.js` file:

```ts
import type { FrontendContext } from '@writers-ide/plugins';

export function activate(context: FrontendContext<unknown>) {
	const workerFile = './count.worker.js';
	const count = context.tasks.worker<string[], number>({
		key: 'count',
		label: 'Count words',
		module: new URL(workerFile, import.meta.url),
		input: ['The story begins.', 'Another paragraph follows.'],
	});
	void count.result.then((outcome) => {
		if (outcome.status === 'completed' && !context.signal.aborted) {
			console.info('Sample word count:', outcome.value);
		}
	});
}
```

Build the worker source separately into one self-contained ES module at that relative output path. Preserve or rewrite the frontend URL to match the emitted file. `new URL()` alone does not compile a worker. See the [portable sample's build](../../examples/plugins/portable-sdk/README.md#managed-worker) for a complete independent example.

The service copies the module URL once before asynchronous loading. Later mutation of the caller's URL does not retarget the task. It reads input and transfer data when posting to the worker, not as a deep snapshot at submission. Mutable input objects and transfer arrays can therefore change during byte loading. Transfers occur only when `postMessage` runs. Cancellation before posting does not detach a buffer.

The task library creates a fresh module Worker from a Blob containing the returned bytes. Worker `import.meta.url` names that Blob. Package-relative imports and assets inside the worker are unsupported. Send required data through messages or transfers. Workers do not inherit the window import map.

### Advanced worker factories

An explicitly constructed `AdvancedTaskService` also accepts `WorkerFactoryTaskOptions<I, O>`, with a synchronous `createWorker(): Worker` instead of `module`. Supply exactly one of these options. This supports independent browser tools and tests; it is not the ordinary `FrontendContext` worker API.

For example, after constructing `independentTasks` in [advanced use](#advanced-use-create-an-independent-queue), browser code built with module-worker support can submit:

```ts
independentTasks.worker<string[], number>({
	key: 'count',
	label: 'Count words',
	input: ['The story begins.'],
	createWorker: () => new Worker(new URL('./count.worker.ts', import.meta.url), { type: 'module' }),
});
```

Return a fresh dedicated worker, never an already-running or shared one. The service owns listener removal and termination. The factory owns any resources it creates outside that worker, including its own object URLs. Explicit construction does not inherit the component host's snapshot binding or private batch-stop liveness. Wire lifetime and error handling as described above. The default bundled host still exposes `AdvancedTaskService` through its legacy `PluginContext`; it has not migrated to `FrontendContext`.

[`examples/count.worker.ts`](examples/count.worker.ts) is a complete worker module. When the worker build has the matching helper JavaScript available, author its handler using the separate entry:

```ts
import { defineTaskWorker } from '@writers-ide/tasks/worker';

defineTaskWorker<string[], number>(self, (paragraphs) => {
	return paragraphs.reduce((sum, text) => sum + (text.match(/\S+/g)?.length ?? 0), 0);
});
```

### Worker helper and messages

`defineTaskWorker<I, O>(scope, run, { transfer?: (output: O) => Transferable[] }?)` handles one request. Its `scope` must supply the properties and methods described by `TaskWorkerScope`; it need not inherit from a particular class.

The helper catches synchronous failures, asynchronous failures, and failures to copy the result into a message. It returns an uninstaller that is safe to call more than once. The request callback runs later rather than during message receipt. If you uninstall before that callback starts, `run` is skipped.

Compile the worker in the normal WebWorker TypeScript environment. It needs no DOM runtime import. The generated portable SDK supplies declarations only, not helper JavaScript. Either supply and bundle the matching `defineTaskWorker` implementation separately, or implement the protocol directly with a type-only `TaskWorkerScope` import, as the [standalone sample](../../examples/plugins/portable-sdk/src/calculate.worker.ts) does. There is no window mapping for `@writers-ide/tasks/worker`.

The transport is the message connection between the caller and the worker. It uses these message shapes:

- Request: `{ type: 'tasks:run', input }`.
- Result: `{ type: 'tasks:result', value }`.
- Error: `{ type: 'tasks:error', error: { name, message, stack? } }`.

Requests or responses with an invalid shape fail the task. Requests must include `input`. Results must include `value`. Either field may explicitly contain `undefined`.

Error records must have string `name` and `message` fields. If present, `stack` must also be a string. Errors are sent as plain data that worker messaging can copy.

### Worker lifetime and failures

The service removes listeners and terminates the worker after success, failure, cancellation, replacement, or owner teardown. For module requests it also revokes its Blob URL.

It handles module loading, Blob URL allocation, Worker construction, listener registration and `postMessage` failures. Advanced factory exceptions are handled too. It also handles worker `error` events and `messageerror` events, which indicate that a message could not be deserialized. Failures reported by the worker and synchronous failures in `apply` are handled too.

Cancellation and replacement are rechecked after option getters and before later side effects. Late byte completion cannot create a worker for an inactive task. Late callbacks cannot apply cancelled results. Before calling `apply`, the service records that a response has been accepted. If another response arrives during that call, it cannot apply the result twice.

Each listener removal and termination is attempted independently. One cleanup error does not prevent the remaining cleanup. Cleanup errors are reported and retained on the handle. They do not change an outcome that has already settled.

### Copies, transfers, and transport limits

Worker messages normally use structured cloning: the browser copies supported data into the receiving environment. Inputs and outputs must support that copy operation or a transfer.

A transfer moves ownership instead of copying. It may detach a buffer, making it unavailable to the caller. Input transfer lists are forwarded to `postMessage`. The worker helper selects output transfers through its `transfer` option.

If the transport cannot send even the plain error message, this protocol cannot report that failure. Owner cancellation remains available.

Each task uses a dedicated bundled worker module. Worker pooling, worker progress messages and timeouts are not supported.

## Replacement, cancellation, and result application

### Replacement keys

Keys belong to one service. Submitting the same key replaces the earlier task across all four modes. For example, a worker task with key `scan` replaces a cooperative task with that key in the same service.

Internal queue keys include a unique service activation identity. Separate services, different owners, and later activations do not collide.

### Cancellation boundaries

Caller cancellation affects only that task. Owner cancellation or service disposal affects every active task in that service. It does not cancel pagination or another service's work. A per-task signal that is already aborted skips all user work.

Cancellation aborts the handle signal before generator cleanup. If `next()` is executing, cleanup waits until the step returns. Cleanup can itself submit another same-key replacement. That newer submission wins.

### Applying results safely

A worker's `apply` callback is synchronous. It is called at most once, and only while the task is active. If you also await the result, do not accidentally apply the same value a second time. If you choose to apply an awaited result yourself, you own its validation and lifetime checks.

Capture cloneable data, compute, then validate the current target before applying. Never send live DOM objects, ProseMirror views, states, or transactions to a worker. Do not retain mutable transactions across `await` or a cooperative yield.

This library does not check whether an editor result still matches the current state. It also does not map positions through edits, define undo behavior, or create application transactions.

Use the [word-processing API](../word-processing/README.md) for its strict editor-result contract. That API discards stale results. It does not adjust their positions through later edits or apply them to a different target.

These helpers manage lifetime and convenience, not security isolation. Trusted frontend code can still access its environment, block the main thread, or perform its own side effects.

## Tests

Run from the repository root:

```sh
pnpm test:unit:ci src/lib/testing/tasks-library src/lib/editor/state/work-queue.svelte.test.ts src/lib/components/pagination/queue.svelte.test.ts
```

[`package-worker-tasks.svelte.test.ts`](../../src/lib/testing/package-worker-tasks.svelte.test.ts) covers module loading, option-getter reentry, liveness, posting and cleanup. Internal component tests cover exact URL binding and guarded byte adapters. Run `pnpm test:plugin-profile` for ordinary module-worker browser coverage in both the rich plugin and portable sample. These are separate from the advanced factory fixture below.

Existing queue tests remain at their original path and exercise the compatibility export. Unit worker tests use mock transports. Run `pnpm test:tasks` for the dedicated production-built browser fixture in Chromium/WebKit: emitted module workers, real buffer transfers, cancellation, failure/recovery, and shared queue ownership. These tests do not establish packaged Tauri behavior or a performance target.
