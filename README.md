# Writer's IDE

A local-first, extensible word processor with an IDE-like workspace for writers, built with Tauri, Svelte 5, ProseMirror, and Rust. Fiction writing is the initial focus; the broader goal is a flexible environment for organizing, editing, and publishing many kinds of writing.

The project is under development. The current app is an editor workbench with configurable bars and lazy pagination, not yet a complete writing application: durable project save/load, import/export, collaboration, and an isolated third-party plugin platform are still planned.

## Cooperation and creativity

The application and official features will always be free, with no paid tiers or official paid-plugin marketplace. Essential workflows are intended to work offline, without accounts, with projects stored locally. Future collaboration should favor peer-to-peer operation rather than dependence on a central authority.

This project is about cooperation and creativity, not revenue. Forks, extensions, and redistribution remain welcome under the existing MIT licensing terms, including commercial reuse. We strongly encourage sharing improvements and contributing upstream; this is a community principle, not an additional license restriction.

## Project context and development

- [CONTRIBUTING.md](CONTRIBUTING.md): code conventions and validation commands.
- [docs/project-context.md](docs/project-context.md): product direction, current architecture, decisions, planned features, and open questions.
- [docs/pagination/context.md](docs/pagination/context.md): current pagination mechanics, constraints, tests, and future direction.
- [GitHub issues](https://github.com/benyakirten/writers-ide/issues): feature discussions and requests, including unsupported layout/format examples. Use minimal, non-sensitive reproductions rather than publishing private manuscripts.

Use `pnpm dev` for the browser frontend and `pnpm dev:tauri` for the desktop application. See `package.json` and the contributor guide for checks and other workflows.

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
				if (signal.aborted) {
					return;
				}
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
