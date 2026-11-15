# Pagination PR change log

See [current context](context.md) for today's contracts and limitations. Start one consolidated PR entry under `In progress` when work begins and update it with every commit, keeping cumulative changes, rationale, outcomes, verified validation, and follow-ups complete before merge. Mark it **In progress / unmerged** and link the PR or use its branch name; never invent merge metadata or append a commit/session diary.

After confirmed merge, move the completed entry into `Merged PRs` in chronological merge order and finalize status/date/link metadata. Dates use GitHub's UTC `merged_at`, not local commit dates. Existing historical entries retain their authoritative API evidence.

## In progress

### `bh/phase-2-plugin-transition` — Stage 2 baseline readiness, formatting boundary and shared tasks

**Status: In progress / unmerged.** Branch: `bh/phase-2-plugin-transition`. PR identity is not yet known; no merge date is assigned.

- Makes the first page visible and waits for fitting content before capturing the initial split in formatting/reflow/undo range tests. A smoke trace showed an unpaginated offscreen first page with all 4,340 characters being recorded as the baseline, then compared with the correctly paginated 1,792-character split after undo. No assertions, selection helpers, or production pagination algorithms are weakened or changed.
- Moves formatting contracts and the ProseMirror bridge into `src/lib/editor/prosemirror/menu/basic/`, with feature-local `scope-formatting-service.ts` owning cloned data/requests, subscriptions through `context.own`, and revocation through `context.signal`. The route injects the trusted singleton only into `createFormattingPlugin(service)`; the general plugin host no longer requires formatting. Stale active-view/revision checks, safe peer traversal, lazy bridge resources, cleanup/error isolation, and the full bridge regression suite are preserved at their new feature-local paths. This owner correction changes responsibility boundaries, not production pagination, geometry, history, selection helpers, or word-processor ownership. No generic service bus or external permission model is introduced.
- Implements owner-authorized task Part 1: private `@writers-ide/tasks` now owns generic `WorkQueue` mechanics and managed iteration/generator/async/bundled-worker helpers, without a library singleton or editor dependency. The app facade retains compatibility exports and the same singleton; `createApplicationPluginHost` shares it by default, while generic standalone hosts accept optional `workQueue` and otherwise create independent queues. Pagination invalidation, revision tracking, catch-up UI, budget/fairness and model-mutating algorithms remain unchanged.
- Adds activation-owned `context.tasks` without new capabilities. Services namespace replacement keys, manage cooperative queue leases, expose reactive handles/progress/errors and nonrejecting outcomes, and cancel only owned work on unload. Async/worker tasks acquire no scheduler lease. Task-phase manager errors do not disable plugins or fail otherwise successful deactivation; activation/host cleanup failures still do. Short commands/hooks remain immediate; the soft budget cannot preempt a step. Editor results require synchronous current-state validation/application after yields. Parts 2–4 remain proposed; no editor migration or pagination redesign is authorized. See the [plugin entry](../plugins/change-log.md) and [task guide](../../packages-js/tasks/README.md).
- Retains queue regressions at the compatibility path and adds library/host task coverage. A separate production-built browser fixture (`e2e/tasks.test.ts`, `e2e/fixtures/tasks/`, `playwright.tasks.config.ts`) checks real emitted module workers, transfers, started-worker cancellation, errors/recovery and shared queue ownership. `pnpm test:tasks` runs independently of app smoke/e2e; Browser Smoke CI adds a task step per selected engine. The worker-only helper imports no Svelte or app/DOM runtime code.
- Current Part 1 validation: 909 unit tests in 43 files passed; the exact `CI=true pnpm test:smoke` command passed, followed by 16 pagination/stylesheet cases and 8 dedicated task cases across Chromium/WebKit, including production builds. Smoke covers the caret and forward/reverse reflow/undo regressions; the earlier readiness fix also passed three repeated smoke runs (60 cases). No broader elimination of selection timing issues is claimed. After correcting the fixture worker-global type, `pnpm check` reports only the existing Modal type error and five old DnD warnings, with no changed-file diagnostics. Lint, local Markdown target checks and whitespace checks passed; no native checks were run for Part 1. See the [plugin entry](../plugins/change-log.md) for cumulative Stage 2 validation/limits and [docking](../dnd/change-log.md) for layout work.

## Merged PRs

### 2026-11-08 — [#64: Break prose mirror into pages](https://github.com/benyakirten/writers-ide/pull/64)

- Introduced model-mutating pagination (`doc → page+ → block+`): overflow/underflow moves content between pages, explicit breaks constrain movement, and estimated line counts enforce widow/orphan settings. Peer paragraphs retain continuity across page boundaries and are reunited before reflow; formatting commands account for those fragments.
- Added per-view observation and a revision-aware valid prefix through the furthest visible page plus one. Edits invalidate from the predecessor to allow backward flow; document/view identity is separate, but synchronized same-document editing was not implemented.
- Added the shared cooperative generator work queue, scoped cancellation, priorities/progress, and dismissible catch-up UI. DOM measurement stays on the main thread, so yielding between steps does not make an individual measurement preemptible or guarantee the soft frame budget.
- Added numbered sample cases, mocked-geometry unit coverage, and real-browser geometry/content-marker checks at standard and Retina pixel densities, including independently scrolled panes. This did not establish complete selection/undo fidelity, general non-text layout, footnotes, headers/footers, collaboration, or whole-document virtualization.
- The owner described model page mutation as the quickest straightforward starting point. Automatic reflow is excluded from user history; this is not evidence that all user undo mappings were already correct (see #76 below).

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/64), `merged_at: 2026-11-08T13:23:10Z`, merge commit `b11d0d6`.

### 2026-11-12 — [#74: Add docs, remove custom editor attempt](https://github.com/benyakirten/writers-ide/pull/74)

- Established the pagination guide's source/test map, transaction and scheduling contracts, limitations, and explicit distinction between current implementation and accepted future direction; removed the abandoned custom-editor attempt.
- Recorded ProseMirror-based rich text as the live model and retained the existing model-mutating pagination engine. Derived per-view boundaries remain a research/prototype direction requiring owner approval, not an implemented migration or authorization to rewrite pagination.
- Recorded that footnotes should reduce available body height rather than physical sheet size, and that future collaborative views should default to nonpaginated mode with an override. Neither feature shipped in this documentation PR; print fidelity and the 8 GB responsiveness baseline remained goals rather than verified guarantees.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/74), `merged_at: 2026-11-12T04:03:49Z`, merge commit `46ff1b3`.

### 2026-11-12 — [#75: Use binary search to detect where pages overflow](https://github.com/benyakirten/writers-ide/pull/75)

- Replaced exhaustive character probing in production text splitting with hybrid search: probe the first ten UTF-16 offsets sequentially, binary-narrow the remaining range to at most ten offsets, then finish sequentially. A shared DOM text-node/range mapper supports production and benchmark measurement.
- Preserved the rounded line-count predicate and unmeasured exclusive end sentinel, relying on a monotonic predicate. Bounded predicate probes reduce measurement work but do not bound DOM collection, mapper construction, or browser layout time within a synchronous step.
- Added a focused real-Chromium comparison against sequential search and an independent old-loop baseline, with correctness/probe-bound gates and diagnostic timing rather than wall-clock thresholds. This does not substitute for page-geometry tests or demonstrate end-to-end editor responsiveness; see the [browser-performance context](../browser-performance/context.md) for benchmark contracts and limitations.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/75), `merged_at: 2026-11-12T05:23:49Z`, merge commit `e842b17`.

### 2026-11-12 — [#76: Update dependencies](https://github.com/benyakirten/writers-ide/pull/76)

- Changed pagination reflow from whole-page replacement/text delete-and-reinsert to structural splits and joins so ProseMirror step maps retain logical selections and user undo/redo mappings. Peer reunion crosses page/paragraph boundaries and restores the page boundary; a temporary empty paragraph keeps sole-peer pages valid under the production `block+` schema.
- Preserved explicit stored typing marks through reflow and dispatch-time index normalization. Selection mapping stays inside synchronous transactions rather than restoring a stale selection across cooperative yields.
- Added production-schema selection/history regressions with mocked geometry and Chromium/WebKit regressions for typing carets through new-page overflow and forward/reversed ranges through formatting reflow, reunion, and undo, including exact text/marked-text preservation. Browser helpers wait for `selectionchange` before formatting to respect ProseMirror's event processing.
- Extended app smoke and existing pagination/stylesheet checks across Chromium and WebKit. The goal is fitting/preserved content in each engine, not identical breaks. These are browser-engine checks, not native Tauri/WebView or minimum-macOS validation. Structural selections whose selected node is itself split/merged still use ProseMirror's normal fallback; non-text layout and print fidelity are not exhaustively covered.
- The model-mutating pagination architecture remained intact. General dependency/toolchain policy stays in [dependencies.md](../dependencies.md); benchmark-specific context stays in [browser performance](../browser-performance/context.md).

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/76), `merged_at: 2026-11-12T13:44:11Z`, merge commit `16b722a`.

### 2026-11-12 — [#77: Upgrade macos runner](https://github.com/benyakirten/writers-ide/pull/77)

- Moved the macOS WebKit smoke CI job from macOS 14 to macOS 15, keeping browser-engine smoke coverage (including pagination selection regressions) on the updated runner. Pagination behavior and the application's macOS 13.3 minimum did not change.
- Runner coverage is not packaged-app validation or proof of layout compatibility on the oldest supported native WKWebView. The Windows Chromium and Linux WebKit smoke jobs remain part of the engine-family matrix.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/77), `merged_at: 2026-11-12T13:54:56Z`, merge commit `87b67fa`.

### 2026-11-14 — [#80 — Safe peer-group queries for formatting](https://github.com/benyakirten/writers-ide/pull/80)

**Status: Merged 2026-11-14.** Branch: `bh/add-plugin-interface-js`.

- Reuses existing peer-paragraph rules in the host formatting bridge to calculate command availability without speculative document edits. Removes the peer-group helper's unconditional document-node console log because the helper now runs during ordinary formatting-state refreshes.
- Fixes structural peer lookup during ordinary selection updates: traverse adjacent blocks and page wrappers explicitly, resolve blocks using actual depth, and exclude a nonempty selection's end boundary. Document-end and leaf `pageEnd` positions must not be treated as textblock interiors. Identifies a page's last block by index, not equality with another identical node. The previous fixed traversal offset could cause `Index … out of range` exceptions from formatting snapshots and interrupt reflow/undo updates.
- Adds production-schema model and service regressions for multi-page forward/reversed ranges, peer pairs, final paragraphs, full-document selection, final `pageEnd`, document-end lookup, and identical blocks. Large-selection snapshots also assert no document-node logging. The model-mutating pagination architecture, geometry rules, and history policy are unchanged.
- Validation: 759 unit tests passed. The exact `CI=true pnpm test:smoke` command passed all 16 cases, plus three full repeats passed across Chromium/WebKit (48 cases), including pagination-selection reflow/undo regressions and production builds. A one-off Chromium caret-range assertion did not recur in five focused and three full repeats; the selection helper remains unchanged. See the [plugin PR entry](../plugins/change-log.md) for cumulative validation and remaining limits. This is not a new pagination geometry benchmark or native-runtime validation.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/80), verified by the parent agent: `merged: true`, `merged_at: 2026-11-14T19:08:58Z`, merge commit `4b39895c5218498fd1c0e79c99b1ea8012f1b67a` (matches current `main` HEAD).
