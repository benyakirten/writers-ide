# Tauri + SvelteKit + TypeScript

This template should help get you started developing with Tauri, SvelteKit and TypeScript in Vite.

## Cooperative editor work

`src/lib/editor/state/work-queue.svelte.ts` exports `workQueue` and `WorkQueue`.
The editor shell starts the shared scheduler on mount. Standalone consumers can
acquire a scheduler lease with `const stop = workQueue.start()` and release it on teardown.

```ts
const job = workQueue.enqueue({
	key: `my-plugin:scan:${viewId}`,
	documentId,
	viewId,
	label: 'Scanning document',
	priority: 'background',
	create: function* ({ signal }) {
		try {
			for (let index = 0; index < blocks.length; index++) {
				if (signal.aborted) return;
				scanBlock(blocks[index]);
				yield { completed: index + 1, total: blocks.length };
			}
		} finally {
			// Release any resources owned by this job.
		}
	},
});

job.pause();
job.resume();
job.cancel();
```

Jobs are **synchronous generators**, not promises or async generators. Each step
must be short: cancellation and the approximately 8ms frame budget cannot interrupt
a running `next()` call. The scheduler yields to the browser between animation frames,
round-robins jobs, and gives background work a turn after three interactive turns.
Reusing a key cancels/replaces its previous job. Cancellation aborts the signal and
closes the iterator; terminal handles retain status/progress/errors, but leave
`workQueue.jobs`. Failed jobs do not stop other work. Closing a view cancels all jobs
with that `viewId`. Use a namespaced key to avoid collisions with other plugins.

Never retain an unmapped ProseMirror transaction or position across yields: edits
may occur between steps. A job owns its invalidation/restart policy. Plugin jobs do
not automatically trigger a modal. CPU work that can leave the main thread should
usually use a Web Worker; DOM-dependent work cannot.

Pagination tracks a valid prefix independently for each view and works through the
furthest visible page plus one. Its delayed catch-up dialog is dismissible. Page DOM
elements expose `data-index`, a current **zero-based positional index**, including
pages whose layout is not finalized. It is not a stable ID or a layout-validity flag.
View IDs are separate from document IDs; synchronizing edits between simultaneous
views of one document is not implemented yet.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
