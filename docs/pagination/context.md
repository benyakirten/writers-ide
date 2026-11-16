# Document editing and pagination

This document describes the current ProseMirror editor and pagination implementation, followed by owner-approved product direction and research possibilities. Future direction is **not** an approved implementation plan. Every significant architectural decision must be run by the owner before implementation.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for repository conventions and validation requirements, [project context](../project-context.md) for the broader accepted direction, and [merged PR history](change-log.md) for completed changes.

## Model and architectural boundary

The approved direction is a project model with **ProseMirror-based rich text**, not a second live rich-text model kept in sync with ProseMirror. This does not mean the current code already implements the complete project model.

**Current implementation:** pagination mutates the ProseMirror document. The schema is `doc → page+ → block+`; reflow moves content between page nodes, splits paragraphs, creates pages, and removes emptied pages. Pages are not merely decorations or a separate layout cache. Keep this implementation unchanged unless a separately approved task changes it.

**Historical rationale supplied by the owner:** mutating page nodes was the quickest, most straightforward initial approach. That explains the starting point; it is not a reason to rewrite the implementation now.

## Source map

Paths below are relative to this documentation file.

| Source                                                                                                                                                                                                                                                   | Responsibility                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ProseMirrorView.svelte](../../src/lib/editor/prosemirror/view/ProseMirrorView.svelte)                                                                                                                                                                   | Mounts an editor inside a scrollable `.document-viewport`; currently opens the pagination sample document.                                         |
| [editor.ts](../../src/lib/editor/prosemirror/view/editor.ts)                                                                                                                                                                                             | Creates state/view, installs history/keymaps, runs transaction handlers and applies accepted root/appended transactions with pre-DOM invalidation. |
| [prose-mirror-editor.svelte.ts](../../src/lib/editor/prosemirror/prose-mirror-editor.svelte.ts)                                                                                                                                                          | Owns registered views, observer registration, cancellation and view destruction.                                                                   |
| [schema.ts](../../src/lib/editor/prosemirror/view/schema.ts), [nodes.ts](../../src/lib/editor/prosemirror/view/nodes.ts), [marks.ts](../../src/lib/editor/prosemirror/view/marks.ts), [constants.ts](../../src/lib/editor/prosemirror/view/constants.ts) | Document structure, attributes, DOM serialization, marks, depth and unit conventions.                                                              |
| [actions.ts](../../src/lib/editor/prosemirror/view/actions.ts), [selection.ts](../../src/lib/editor/prosemirror/view/selection.ts)                                                                                                                       | Formatting, selection inspection and continuation-aware paragraph commands.                                                                        |
| [event-bus.svelte.ts](../../src/lib/editor/state/event-bus.svelte.ts), [event-bus.plugin.ts](../../src/lib/editor/prosemirror/plugins/event-bus.plugin.ts)                                                                                               | Document-keyed events, including pre-transaction and post-view-update notifications.                                                               |
| [page-layout.svelte.ts](../../src/lib/editor/state/page-layout.svelte.ts)                                                                                                                                                                                | Geometry, overflow/underflow, explicit breaks, paragraph continuation/reunion, affected ranges and pagination transactions.                        |
| [page-observer.svelte.ts](../../src/lib/editor/state/page-observer.svelte.ts)                                                                                                                                                                            | Per-view visibility, valid-prefix boundary and layout revision.                                                                                    |
| [queue.svelte.ts](../../src/lib/components/pagination/queue.svelte.ts)                                                                                                                                                                                   | Converts visibility/invalidation into keyed, revision-aware pagination work.                                                                       |
| [work-queue.svelte.ts](../../src/lib/editor/state/work-queue.svelte.ts)                                                                                                                                                                                  | Compatibility exports and application-owned singleton for the extracted generic queue.                                                             |
| [Paginator.svelte](../../src/lib/components/pagination/Paginator.svelte)                                                                                                                                                                                 | Queue lifecycle, settings/font invalidation and catch-up dialog.                                                                                   |
| [Editor.svelte](../../src/lib/editor/Editor.svelte), [global.css](../../src/routes/global.css)                                                                                                                                                           | Reactive page dimensions/padding through CSS variables and fixed page styling.                                                                     |

[page-indexes.ts](../../src/lib/editor/prosemirror/view/page-indexes.ts) holds the unchanged `normalizePageIndexes` helper shared by root dispatch and managed appended-transaction preparation; it preserves incoming stored marks.

[split-search.ts](../../src/lib/editor/state/split-search.ts) supplies sequential and hybrid search strategies; [text-split-measurement.ts](../../src/lib/editor/state/text-split-measurement.ts) supplies the shared DOM range mapper used by production text splitting and the focused browser benchmark.

[pagination.plugin.ts](../../src/lib/editor/prosemirror/plugins/pagination.plugin.ts) is only an empty keyed plugin with aspirational comments. It is not the active pagination engine.

On unmerged Stage 2 branch `bh/phase-2-plugin-transition` (no PR known), owner-approved Part 3A adds private [word-processing contracts/service](../../packages-js/word-processing/README.md) without app imports and the actual [app provider/source adapter](../../src/lib/editor/prosemirror/word-processing.svelte.ts). `createWordProcessingPlugin(sources = defaultWordProcessingSources)` observes existing views, active-tab resolution and editor updates; it owns API resources, not view destruction. The [route](../../src/routes/+page.svelte) registers provider and formatting, activates formatting through required-provider resolution, and cascades provider teardown. `createFormattingPlugin()` no longer accepts an injected singleton; it builds `FormattingService(provider)` per activation.

Formatting contracts, policies and scoping remain in [contracts.ts](../../src/lib/editor/prosemirror/menu/basic/contracts.ts), [formatting-service.svelte.ts](../../src/lib/editor/prosemirror/menu/basic/formatting-service.svelte.ts), and [scope-formatting-service.ts](../../src/lib/editor/prosemirror/menu/basic/scope-formatting-service.ts). Copied summaries, stale requests, safe peer traversal, caret no-ops, mark exclusivity, continuation-aware commands and cleanup/error isolation remain feature-owned. Provider-owned edits call actual `view.dispatch`. Separately owner-approved Part 3B now adds in-place behavioral reconfiguration and accepted root/append dispatch integration below, preserving history, the fixed schema and model-mutating pagination. This is not full editor extraction, a pagination redesign or a security grant. Part 3C schema/custom content and Part 4 external loading/native enforcement remain gated. See [plugin context](../plugins/context.md) and the [feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md).

## Current transaction and layout flow

1. `createView` builds ProseMirror state with history, shortcuts, the base keymap and registered plugins. It normalizes model page indexes before the first render and registers a distinct view ID.
2. Dispatch runs registered transaction handlers and normalizes root page indexes when the document changes, then calls `view.state.applyTransaction(root)` so ProseMirror filters and append hooks participate. A filtered root yields no accepted transactions: dispatch returns without `PreUpdate` or DOM update.
3. For every accepted root/appended transaction, dispatch emits `PreUpdate` **after state calculation but before the single final `view.updateState(applied.state)`**. PageObserver invalidates using each transaction's own `tr.before`/`doc` and step coordinates, including appended changes; it must not treat all appends as coordinates in the original root document. The event-bus plugin's view update emits `Update`, synchronizing page indexes and observed DOM elements.
4. An `IntersectionObserver` rooted in the document viewport tracks the furthest visible page. The pagination queue requests work through that page plus one lookahead page.
5. The work queue advances the pagination generator. Each page step reunites the current continuation boundary, measures rendered DOM, and dispatches model-changing reflow transactions.
6. Progress advances the valid prefix. Edits/layout changes invalidate that prefix and obsolete work; scrolling can extend the target.

Managed behavior appends pass through optional synchronous library `sources.prepareTransaction(transaction)` before ProseMirror application, then must satisfy `transaction.before === suppliedCurrentState.doc`. The app provider composes any supplied preparation with `normalizePageIndexes` from `view/page-indexes.ts`, preserving page attributes and incoming stored marks before DOM rendering. This hook expresses host model invariants, not schema migration; standalone library sources need not implement app page semantics. Root normalization remains in dispatch, and this is not a guarantee to normalize arbitrary foreign baseline append hooks.

Part 3B behavior installation/removal uses owner-approved in-place `EditorState.reconfigure` with the same schema instance: document, selection, stored marks, history and surviving keyed state remain intact, with no transaction or undo entry from reconfiguration itself. Managed plugins run before the untouched actual current baseline, in descending priority/insertion-order ties. Source arrivals/replacements/closures reconcile in a microtask outside baseline/managed hook stacks; strict editor result targets become stale when state is reconfigured. Factories/wrapped Plugin identities/signals survive unrelated registration changes, but ProseMirror may recreate plugin-view resources. Multi-view stages guard source/lifecycle/state mutations; a 16-pass reconciliation bound quarantines still-active registrations on instability, not arbitrary callback side effects. Runtime failure quarantines a registration across views immediately and defers physical detach; first failing filters reject, then inactive guards allow, append returns null and state apply transiently retains its previous value. Safe prop fallbacks and independent source/connection error reports are detailed in [plugin behavior contracts](../plugins/context.md#lifecycle-owned-behaviors-part-3b-implemented--unmerged). This cannot preempt callback CPU loops or unbounded ProseMirror append cycles and is not a sandbox.

View identity is separate from document identity. View teardown cancels scoped work, disconnects observation and destroys the `EditorView`. The registry explicitly states that shared editing is not implemented: document-keyed invalidation does **not** synchronize the contents of multiple views.

## Current pagination invariants

### Geometry and content movement

- Page depth is 1 and block depth is 2. Helpers rely on this structure.
- Content bounds come from rendered page rectangles minus computed padding and borders. Measurements use CSS pixels, not physical device pixels; absolute conversion in `PageLayout` uses 96 CSS pixels per inch.
- Block overflow detection allows 0.5 CSS pixels of boundary excess and continues scanning later siblings after a fitting block.
- Overflow moves content forward, creating a page if necessary. Underflow pulls fitting content backward and may delete the emptied next page.
- Atomic `pageEnd` nodes represent explicit breaks. Content after a break is moved forward; free space before a break is not a reason to pull subsequent content across it.
- Text splitting collects ordered DOM text nodes with a `TreeWalker` and uses a shared UTF-16 offset-to-`Range` mapper. The production hybrid search probes the first ten offsets linearly, narrows the remainder by binary search to a window of at most ten, then finishes linearly. It preserves the rounded line-count predicate and unmeasured exclusive end sentinel; the predicate must be monotonic. Estimated line counts enforce widow/orphan settings, both initially 2.
- Fixed page sizes and margins come from the global `PageLayout` singleton. Its current initial preset is A5 in inches; the constructor labels this a testing default.

### Paragraph continuity, history and indexes

- A split paragraph's continuation has `peer: true` and zero indentation. The head does not need a special continuation attribute.
- Before reflowing a boundary, the engine reunites the preceding page's last paragraph with the next page's first peer. Preparation is limited to the current boundary rather than the entire requested range.
- Indentation commands affect a peer pair's head; alignment affects both halves and resets indentation. Enter at a continuation's beginning can break peering and restore default indentation. Since [#80](https://github.com/benyakirten/writers-ide/pull/80) (merged 2026-11-14), the host formatting bridge also queries peer groups for command availability without generating speculative transactions; the helper no longer logs document nodes. Peer grouping resolves direct blocks using actual structural depth, crosses page boundaries explicitly, and treats the end of a nonempty selection as exclusive. Leaf `pageEnd` selections and document-end positions must not be resolved as textblock interiors. These read-only queries preserve pagination/continuation semantics and must not interrupt editor state updates.
- Pagination, reunion and page deletion set `addToHistory: false`. The user break-peering command remains history-eligible.
- Forward/backward reflow uses structural page/block splits and joins rather than whole-page replacement or text delete/reinsert. Peer reunion joins across both page and paragraph boundaries, then restores the page boundary. These step maps retain content positions for text selections (including reversed ranges), inline atom selections, and user undo/redo. A sole-peer page temporarily retains an empty paragraph to satisfy the production `block+` schema.
- Automatic reflow restores explicit stored typing marks after its structural/index steps. Dispatch-time page index normalization also preserves the incoming transaction's stored marks, not an older state's marks. Selection is mapped within each synchronous transaction; no cached selection is restored across cooperative yields.
- Root and managed appended page indexes are normalized in their transaction before rendering; the app provider's preparation hook handles managed appends before ProseMirror applies them. The observer also refreshes DOM `data-index` values, including unvisited pages. Document order, not potentially stale index attributes, identifies peer neighbors.
- `paginateRange(from, to)` uses page indexes and an exclusive upper bound. Yields report the next index, equivalently the exclusive completed prefix. Deleting a page revisits the same index; creating a page does not automatically extend the requested upper bound.
- Cancellation is checked before preparation, between preparation and pagination, and before yielding or reporting successful completion. Callers must account for edits and cancellation between cooperative steps.

## Scheduling and invalidation

### Per-view validity

Each observed view stores `viewedPage`, `paginatedTo` and `revision`:

- `paginatedTo` is the **exclusive end of the valid prefix**, initially 0.
- Target is `min(viewedPage + 2, document.childCount)`. Pagination is viewport-driven, not an automatic full-document pass.
- Visibility is a persistent set updated by partial intersection notifications. The furthest visible current DOM index wins. Removed elements are ignored, and no visible pages preserves the previous target.
- External document changes invalidate from the affected page's predecessor, because content may now fit on that preceding page. Invalidation never advances an already dirty prefix and increments revision.
- Pagination's own transactions do not invalidate their work; `BreakPeering` is treated as a user edit. Selection-only transactions do not invalidate layout.
- Single-step affected ranges inspect old/new step-map positions. Empty-map mark/attribute steps fall back to serialized `from`, `to` or `pos`. Multi-step transactions conservatively invalidate the full range because positions belong to different intermediate documents.
- Changes invalidate views sharing the document ID, but only the updated view's DOM observations are synchronized.
- `Paginator` invalidates all registered views on tracked page-size, margin, unit, widow/orphan and default-indent changes, and on font `loadingdone`.

### Pagination jobs

Jobs use `pagination:<viewId>` keys and interactive priority. Obsolete revisions are cancelled, and the generator rereads the target between yields. Each preparation request covers one page. During IME composition, the job yields without preparing pages.

A failed job is retained rather than retried indefinitely; a new revision permits retry. After about one second, an active job that remains behind its target can show a modal catch-up dialog. Dismissing the dialog continues background work rather than cancelling it.

### Generic work queue

On unmerged `bh/phase-2-plugin-transition`, owner-authorized task Part 1 extracts `WorkQueue` to private `@writers-ide/tasks`. The [app facade](../../src/lib/editor/state/work-queue.svelte.ts) retains compatibility exports and the same singleton used by pagination; the library has no singleton or editor dependency. Generic mechanics live in [work-queue.svelte.ts](../../packages-js/tasks/src/work-queue.svelte.ts); invalidation, revision tracking and catch-up UI remain application-owned. This extraction preserves the following scheduling contracts:

- Work consists of synchronous generators advanced on `requestAnimationFrame`.
- A frame has an **8 ms soft budget** and a 1,000-step safety cap. It cannot interrupt an executing step.
- Scheduling is round-robin within priority. With both priorities runnable, background work receives every fourth turn.
- Execution requires a `start()` lease. Releasing the last generic queue lease suspends work without cancelling it; releasing the last pagination owner explicitly cancels its pagination jobs.
- Same-key enqueue replaces old work. View cancellation affects only that view's jobs.
- Cancellation aborts the signal and closes the generator. Cleanup is deferred until `next()` returns if cancellation occurs during execution. Work/cleanup failures are isolated and combined when both occur.
- Terminal jobs leave the active list; retained handles preserve status, progress and errors.

### Plugin consumers (Part 1 implemented / unmerged)

`createApplicationPluginHost` defaults to the same app queue, preserving one frame budget shared with pagination. Generic standalone `PluginHost` accepts optional `workQueue`, otherwise creating an independent queue. The host adds activation-owned `context.tasks` alongside `signal`, `own` and `contributions`, without changing contribution capabilities. Services provide `forEach`, `cooperative`, `async` and bundled one-shot `worker` helpers, reactive handles/progress/errors, nonrejecting outcomes and per-task/owner cancellation. Same-key replacement spans modes but is namespaced by service activation; unload leaves peer plugins and pagination intact. Cooperative helpers manage queue leases; async/worker tasks need none. Task-phase errors appear in management without disabling plugins or making otherwise successful deactivation fail; activation/host cleanup failures still do.

Helpers remain opt-in; short commands and synchronous hooks stay immediate. Promises do not offload CPU work, the soft budget cannot interrupt a step, and async cancellation cannot undo unguarded side effects. The separate Svelte-free worker entry supplies the request/result/error helper, transfers and managed termination/late-response protection, not DOM/editor access. Pooling and worker progress/timeouts are not implemented. Part 3A's separate word-processing provider now offers strict `applyResult`; tasks themselves remain editor-neutral. Editor tasks capture only required data plus an exact target, then construct/apply a new transaction synchronously after computation, never retain mutable transactions across steps. See the [task guide](../../packages-js/tasks/README.md), [contracts](../../packages-js/tasks/src/contracts.ts), and [plugin execution direction](../plugins/context.md#accepted-direction-actions-and-cooperative-execution). Parts 1–2 and 3A–3B are implemented / unmerged; 3C/4 remain separately gated. None authorizes a pagination redesign.

Part 3A targets are `{ viewId, documentId, revision }`, with monotonic tokens across service instances within the module. These are editor-state tokens, **not** pagination layout revisions: selection-only state changes stale editor targets even though they do not invalidate layout. `inspect`, `edit`, `runCommand`, command registration/execution/listing and `applyResult` validate exact identity/freshness, lifetime, cancellation, editability and optional active-view requirements. Stale task/worker results are discarded without mapping or retargeting. Commands capture at most one transaction, applied only after a synchronous boolean `true` and revalidation. Registrations belong to the editor command service, not the ProseMirror plugin registry; connections own their cleanup and callbacks. Nested inspection is allowed; nested edits and edits during notifications return `busy`.

The owner approved live synchronous `EditorState`/`EditorView` callback access with provider-owned edits. This is trusted access, not enforced isolation: do not retain live objects/transactions or dispatch raw views. Thenable rejection cannot undo an already-started async callback or raw dispatch. `tr.before === current.state.doc` cannot prove originating state; a retained old transaction from the same document supplied with a fresh target can pass and violates the contract. Service/connection/source cleanup never destroys source-owned views. See the [word-processing guide](../../packages-js/word-processing/README.md) for exact contracts.

## Rationale and evidence

**Explicit in source comments:** DOM-dependent measurement must remain on the main thread, so generators allow callers to yield control; each generator step must itself remain short. Model indexes are normalized before rendering to avoid parsed DOM attribute mutations feeding back through ProseMirror's DOM observer. Predecessor invalidation permits backward flow. Full-range multi-step invalidation favors correctness until coordinate remapping is implemented.

**Inferred from implementation, not separately documented intent:** view-scoped work and one-boundary preparation aim to keep panes responsive; peer attributes preserve logical paragraph continuity across physical model pages; history exclusion separates automatic reflow from user-authored edits. Metadata tests alone do not establish complete end-to-end undo behavior.

The owner's historical explanation above is separate from rationale explicitly recorded in code.

## Known limitations

- The scheduler is cooperative, not preemptive. Hybrid text splitting bounds predicate probes rather than measuring every character, but DOM text-node collection, mapper construction, each `Range` measurement and browser layout costs remain synchronous and uninterruptible within a step. A bounded probe count does not guarantee the nominal frame budget.
- Non-text splitting contains unfinished handling. Schema acceptance does not establish reliable pagination for images, inline atoms or complex nested blocks.
- Peer identification returns adjacent head/peer pairs, not a general multi-page continuation group. Underflow code still contains a peer-handling TODO.
- Line-count estimation assumes a usable line height. [css.ts](../../src/lib/utils/css.ts) approximates `normal` as font size multiplied by 1.2, with a 16 px fallback. Mixed-size inline content needs browser evidence.
- The inspected invalidation path covers specified settings and completed font loading, not general image-load or resize-driven geometry changes.
- Layout settings are global rather than per-document/per-view. Preset margins are assigned literal 0.5/0.4 values in the chosen units.
- The generator retains an explicitly unexplained empty-page workaround. Production schema requires `block+`, while some layout tests allow structurally empty pages.
- Browser tests cover page bounds/marker order, typing-caret preservation through new-page overflow, and forward/reversed text ranges through formatting-driven reflow and undo. These are not exhaustive guarantees for all node types, selection types, widow/orphan outcomes or print fidelity. Selecting a structural node that is itself split or merged still follows ProseMirror's normal selection fallback.
- Headers/footers and footnote-aware body allocation are not implemented by this pagination path. Header/footer node definitions are not evidence of completed layout support: the footer is not included in the exported node registry, and their group is not accepted as ordinary page body content.
- Collaboration is absent. Independent view registration and document-keyed invalidation are not collaboration support.

## Future direction and approval gates

The following records owner-approved direction and constraints, **not completed features or authorization to redesign pagination**:

- Keep ProseMirror as the live rich-text model within the project model; do not introduce a second independently live rich-text representation.
- A possible later separation of authored content from calculated page boundaries could represent those boundaries as **derived per-view layout/cache**. This is compatible in principle with ProseMirror, but requires research, a prototype and owner approval. It is not an approved implementation plan or a reason to replace current model-mutating pagination now.
- Any future representation must preserve authored explicit breaks, layout settings and footnote semantics. Calculated boundaries must not silently replace or erase authored meaning.
- Footnotes should reduce the available **body content height**, not shrink the physical sheet. Headers/footers are planned and must be considered when allocating content space; their detailed design remains open.
- Precision print/PDF output should match intended pagination as closely as possible. Universal fidelity across fonts, renderers, platforms and printers is not promised.
- Nonpaginated views are a future direction. For future collaboration, pagination should default off, with an override; neither that policy nor collaboration itself is implemented currently.
- Performance should remain fast on an **8 GB memory baseline**, prioritizing viewport-relevant work. This is a product constraint, not a measured performance guarantee or approval for a specific cache/virtualization strategy.

Run every significant architectural decision by the owner before implementation, including changes to rich-text authority, page representation, layout/cache ownership, collaboration behavior, printing or footnote allocation.

## Tests and validation

Unit tests run under jsdom via [vite.config.ts](../../vite.config.ts). They validate state, transactions and mocked geometry; jsdom cannot establish real layout correctness.

| Tests                                                                                                                                                  | Coverage                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [page-layout.svelte.test.ts](../../src/lib/editor/state/page-layout.svelte.test.ts)                                                                    | Peer boundaries, mocked overflow geometry/DPR, affected ranges, generator bounds/cancellation, indexes and history metadata.  |
| [page-observer.svelte.test.ts](../../src/lib/editor/state/page-observer.svelte.test.ts)                                                                | Partial intersections, page replacement, valid-prefix invalidation, own-transaction filtering, independent views and cleanup. |
| [work-queue.svelte.test.ts](../../src/lib/editor/state/work-queue.svelte.test.ts)                                                                      | Budget/fairness, leases, pause/resume, replacement, reentrant cancellation, cleanup errors and reactive progress.             |
| [queue.svelte.test.ts](../../src/lib/components/pagination/queue.svelte.test.ts)                                                                       | Targets, revision restart, lifecycle cleanup, catch-up timing/dismissal, composition and retry policy.                        |
| [actions.test.ts](../../src/lib/editor/prosemirror/view/actions.test.ts), [selection.test.ts](../../src/lib/editor/prosemirror/view/selection.test.ts) | Formatting commands and selection utilities.                                                                                  |
| [pagination.test.ts](../../e2e/pagination.test.ts)                                                                                                     | Real page bounds at DPR 1/2, mount/edit/scroll indexes and marker order, independent pane scrolling.                          |

[smoke.test.ts](../../e2e/smoke.test.ts) exercises the built application in Chromium and WebKit: startup exceptions, typing/selection/formatting/undo, dropdown keyboard navigation/focus restoration, visible-page geometry and marker preservation, and browser-locale resolution. The existing pagination and stylesheet compatibility suites also run in both engines. These tests require valid layout in each engine, not identical physical page breaks. They do not execute native Tauri WebViews or establish compatibility with macOS 13.3's WKWebView.

[pagination-selection.svelte.test.ts](../../src/lib/editor/state/pagination-selection.svelte.test.ts) exercises selection/history mappings with the production schema and mocked geometry: retained/moved carets, forward/reversed ranges, atomic inline selections, marks, empty-page fillers, peer reunion, and actual dispatch/index normalization. [pagination-selection.test.ts](../../e2e/pagination-selection.test.ts) provides real Chromium/WebKit regressions for the typing caret through overflow/new-page creation and ranges through formatting-induced page splits, reunion and undo, checking exact text/marked-text preservation. Browser selection helpers wait for `selectionchange` delivery before issuing formatting commands; DOM selection can update before ProseMirror receives that event. Before capturing a first-page split as an undo baseline, range tests scroll that page into view and wait for fitting content. Waiting only for whatever pages are currently visible can accept an unpaginated offscreen first page after document replacement.

The full formatting bridge regression suite moved with the feature to [formatting-service.svelte.test.ts](../../src/lib/editor/prosemirror/menu/basic/formatting-service.svelte.test.ts), preserving production-schema coverage for page boundaries, final `pageEnd`, forward/reversed and full-document selections, peer paragraphs, separate document/view IDs, stale commands, subscription cleanup/error isolation, and quiet availability queries. Feature lifecycle regressions now live in [scope-formatting-service.test.ts](../../src/lib/editor/prosemirror/menu/basic/scope-formatting-service.test.ts); generic host lifecycle tests are feature-neutral. Current unit/browser results, diagnostic limitations and lint/link verification are recorded in the [in-progress entry](change-log.md), not treated as a standing suite guarantee.

Task coverage lives in [tasks-library.svelte.test.ts](../../src/lib/testing/tasks-library.svelte.test.ts), [tasks-library-worker.test.ts](../../src/lib/testing/tasks-library-worker.test.ts) and [plugin-tasks.svelte.test.ts](../../src/lib/plugins/plugin-tasks.svelte.test.ts); the original work-queue suite still tests the compatibility export. [tasks.test.ts](../../e2e/tasks.test.ts) uses a separate production-built [fixture](../../e2e/fixtures/tasks/TasksFixture.svelte) and [config](../../playwright.tasks.config.ts) for actual emitted workers, transfers, cancellation/error recovery and shared ownership in Chromium/WebKit. Run `pnpm test:tasks` separately from app smoke/e2e; Browser Smoke CI includes a task step for its selected engine. These are correctness/lifecycle checks, not native-runtime or end-to-end responsiveness measurements.

Part 3A coverage includes [core service tests](../../src/lib/testing/word-processing.svelte.test.ts), [app adapter tests](../../src/lib/editor/prosemirror/word-processing.svelte.test.ts), and [QuickFormat](../../src/lib/editor/prosemirror/menu/quick-format/menu.ts), an independent public-API consumer wrapping upstream `toggleMark` for production `bold` or conventional `strong`. QuickFormat is opt-in and registered only in the browser fixture, not the default app. The dedicated [browser suite](../../e2e/word-processing.test.ts), [fixture](../../e2e/fixtures/word-processing/WordProcessingFixture.svelte) and [config](../../playwright.word-processing.config.ts) use the actual app provider adapter, generic host, real ProseMirror views/history and a bundled worker without Basic Menu import/registration. Run `pnpm test:word-processing` separately from app e2e; Browser Smoke CI runs it per selected engine. Six scenarios cover formatting/focus/remount/undo, strict stale/cancelled/closed-view result handling, independent same-document views, cascade revocation and reactivation. Prior Part 3A validation included 53 core service regressions and all 12 dedicated browser cases; these are not final totals for the expanded Part 3B diff. The actual app manager regression also covers provider cascade with manuscript and undo preservation; see the [cumulative entry](change-log.md) for full validation and diagnostic limits. This fixture is not pagination geometry or native-runtime verification.

Part 3B adds [core behavior tests](../../src/lib/testing/word-processing-behaviors.svelte.test.ts) and [app dispatch/reconfiguration tests](../../src/lib/editor/prosemirror/view/editor-behaviors.svelte.test.ts), covering accepted/filter/append invalidation, managed append page-index/stored-mark preparation, ordering, original key identity, surviving state/history and mutation/failure guards. Three [opt-in examples](../../src/lib/editor/prosemirror/behaviors/README.md) demonstrate real upstream input rules/undo, mapped keyed selection decorations without authored marks, and bounded selected-chunk module-worker analysis (32,768 model positions/1,024 chunks, no cross-node tokens or full-manuscript scan). They use per-view cancellation and strict-target fresh metadata application.

[BehaviorFixture.svelte](../../e2e/fixtures/word-processing/BehaviorFixture.svelte) extends the existing fixture behind **Mount behavior proofs**, not the default app route. [word-processing-behaviors.test.ts](../../e2e/word-processing-behaviors.test.ts) adds six scenarios/twelve Chromium/WebKit cases; `test:word-processing` now includes both files for 24 cases, included by the existing CI step and excluded from main app e2e. Its non-history structural split is not actual pagination geometry. Current validation passed 1,111 unit tests (including 79 behavior cases) and the final 116 app/22 smoke/24 dedicated word-processing browser cases. Check retains only the existing Modal error/five DnD warnings; initial validation also encountered intermittent collapsed-selection failures, not proven resolved. See the [current branch entry](change-log.md) for complete outcomes and limits.

The separate [browser performance suite](../browser-performance/context.md) runs nine focused paragraph search scenarios in real Chromium, comparing sequential and hybrid searches against an independent old-loop baseline. Correctness and probe bounds gate changes; warmups and repeated, rotated samples produce timing attachments without wall-clock gates. It is not an end-to-end editor performance fixture and does not replace the existing geometry tests.

[sample-data.ts](../../src/lib/editor/prosemirror/view/sample-data.ts) supplies 20 labeled source cases for overflow, underflow, explicit breaks and empty pages. Source-case labels deliberately survive reflow; they are not physical page numbers.

Run from the repository root:

```sh
pnpm test:unit:ci src/lib/editor/state/page-layout.svelte.test.ts src/lib/editor/state/page-observer.svelte.test.ts src/lib/editor/state/work-queue.svelte.test.ts src/lib/components/pagination/queue.svelte.test.ts
pnpm test:unit:ci src/lib/editor/prosemirror/view
pnpm test:smoke
pnpm test:tasks
pnpm test:word-processing
pnpm test:e2e e2e/pagination.test.ts
pnpm test:smoke --project=webkit
pnpm test:performance
```

[playwright.config.ts](../../playwright.config.ts) builds and starts preview on port 4173. Use real-browser tests for pagination geometry. Broader checks from contributor guidance are `pnpm check`, `pnpm lint`, `pnpm test:unit:ci`, `pnpm test:e2e` and `pnpm build`.

This document records source inspection, not a claim that those checks have passed.
