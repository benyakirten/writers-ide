# Document editing and pagination

This guide explains how the editor currently makes pages. It also records future direction approved by the owner. Future direction is not permission to redesign the implementation. Discuss every significant architectural change with the owner first.

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) for development rules and [project context](../project-context.md) for the broader plan. The [change log](change-log.md) separates merged history from current branch work. Parts 1–2, 3A–3B and Part 3C's first rendering slice below are implemented on `bh/phase-2-plugin-transition`. They are unmerged, with no known PR or merge date.

## Model and architectural boundary

ProseMirror holds the live rich-text document. Its **schema** defines which nodes and attributes a document can contain. The current structure is `doc → page+ → block+`: a document contains one or more pages, and each page contains one or more blocks. Paragraphs are one kind of block.

Pagination is **model-mutating**. This means it changes the document structure, not just how the screen displays it. **Reflow** is the process of fitting content onto pages again. Reflow moves blocks between page nodes, splits paragraphs, creates pages and removes emptied pages. Page boundaries are not a separate display cache.

The owner chose this as the quickest straightforward starting point. Keep it working unless a separate task approves a change. The accepted project direction uses ProseMirror-based rich text. It does not introduce a second live rich-text model to keep in sync. The complete project model is not implemented yet.

## Source map

Links here are relative to this file.

- [ProseMirrorView.svelte](../../src/lib/editor/prosemirror/view/ProseMirrorView.svelte) mounts the editor in a scrollable `.document-viewport`. It currently opens the pagination sample document.
- [editor.ts](../../src/lib/editor/prosemirror/view/editor.ts) creates the editor state and view. It installs undo history and keyboard bindings. It also applies transactions and sends events before the DOM update. The DOM is the browser's rendered element tree.
- [prose-mirror-editor.svelte.ts](../../src/lib/editor/prosemirror/prose-mirror-editor.svelte.ts) registers views and observers. It cancels their work and destroys views on teardown.
- [schema.ts](../../src/lib/editor/prosemirror/view/schema.ts), [nodes.ts](../../src/lib/editor/prosemirror/view/nodes.ts), [marks.ts](../../src/lib/editor/prosemirror/view/marks.ts) and [constants.ts](../../src/lib/editor/prosemirror/view/constants.ts) define document structure, formatting marks, DOM conversion and units. Marks describe inline formatting, such as bold.
- [actions.ts](../../src/lib/editor/prosemirror/view/actions.ts) and [selection.ts](../../src/lib/editor/prosemirror/view/selection.ts) implement formatting and selection helpers.
- [event-bus.svelte.ts](../../src/lib/editor/state/event-bus.svelte.ts) and [event-bus.plugin.ts](../../src/lib/editor/prosemirror/plugins/event-bus.plugin.ts) send document-keyed editor events.
- [page-layout.svelte.ts](../../src/lib/editor/state/page-layout.svelte.ts) measures pages and moves content. It handles explicit breaks, paragraph continuation, affected ranges and reflow transactions.
- [page-observer.svelte.ts](../../src/lib/editor/state/page-observer.svelte.ts) tracks visible pages and which pages need reflow in each view.
- [queue.svelte.ts](../../src/lib/components/pagination/queue.svelte.ts) turns that information into pagination jobs.
- [work-queue.svelte.ts](../../src/lib/editor/state/work-queue.svelte.ts) keeps the application queue instance and compatibility exports. The generic queue lives in [the tasks package](../../packages-js/tasks/src/work-queue.svelte.ts).
- [Paginator.svelte](../../src/lib/components/pagination/Paginator.svelte) manages pagination ownership, settings and font invalidation, and the catch-up dialog.
- [Editor.svelte](../../src/lib/editor/Editor.svelte) and [global.css](../../src/routes/global.css) apply page dimensions, padding and fixed page styling.
- [page-indexes.ts](../../src/lib/editor/prosemirror/view/page-indexes.ts) contains `normalizePageIndexes`. Root dispatch and managed appended transactions share this unchanged helper. It preserves incoming stored typing marks.
- [split-search.ts](../../src/lib/editor/state/split-search.ts) supplies sequential and hybrid split searches. [text-split-measurement.ts](../../src/lib/editor/state/text-split-measurement.ts) maps text offsets to browser ranges for production splitting and benchmarks.

[pagination.plugin.ts](../../src/lib/editor/prosemirror/plugins/pagination.plugin.ts) is an empty keyed plugin with comments about possible work. A plugin key identifies a plugin and its state across editor updates. This file is not the active pagination engine.

The unmerged Part 3A adds private [word-processing contracts and services](../../packages-js/word-processing/README.md). The package has no app imports. The [app adapter](../../src/lib/editor/prosemirror/word-processing.svelte.ts) exposes existing views through `createWordProcessingPlugin(sources = defaultWordProcessingSources)`. It observes views, active tabs and editor updates. It owns API resources, not the views themselves.

The [route](../../src/routes/+page.svelte) registers the provider and formatting plugin. A **provider** exposes an API for other plugins. Formatting activates its required provider and creates `FormattingService(provider)` for that activation.

Formatting remains feature-owned in [contracts.ts](../../src/lib/editor/prosemirror/menu/basic/contracts.ts), [formatting-service.svelte.ts](../../src/lib/editor/prosemirror/menu/basic/formatting-service.svelte.ts) and [scope-formatting-service.ts](../../src/lib/editor/prosemirror/menu/basic/scope-formatting-service.ts). This includes copied summaries, stale-request checks, peer traversal, caret no-ops, mutually exclusive marks and cleanup. Provider-owned edits use the real `view.dispatch` path. Part 3B adds behavior reconfiguration and transaction handling described next. Neither part extracts the whole editor or redesigns pagination. Part 3C custom content/schema work and Part 4 external loading/native enforcement still need separate approval. See [plugin context](../plugins/context.md) and the [formatting guide](../../src/lib/editor/prosemirror/menu/basic/README.md).

## Current transaction and layout flow

A **transaction** describes a change to editor state. The **root transaction** is the one sent to dispatch. ProseMirror plugins may reject it with a filter. They may also produce **appended transactions**, which follow accepted changes.

The application handles them in this order:

1. `createView` installs history, shortcuts, the base keymap and registered plugins. It normalizes page indexes before the first render and registers a distinct view ID.
2. Dispatch runs registered transaction handlers. If the root changes the document, it normalizes the root's page indexes.
3. `view.state.applyTransaction(root)` calculates the new state. ProseMirror runs its filters and append hooks here. If the root is filtered out, dispatch returns. It emits no `PreUpdate` event and makes no DOM update.
4. For each accepted root or appended transaction, dispatch emits `PreUpdate`. State calculation has finished, but the view still has its old DOM. PageObserver uses each transaction's own `tr.before`, `doc` and step positions. An append's positions must not be interpreted against the root's starting document.
5. Dispatch calls `view.updateState(applied.state)` once with the final state. The event-bus plugin then emits `Update`. PageObserver refreshes page indexes and its list of rendered page elements.
6. A browser `IntersectionObserver` reports which pages intersect the document's viewport, the visible scroll area. The pagination target includes the furthest visible page and one page beyond it.
7. The queue advances pagination one step at a time. A step reunites the current paragraph boundary, measures rendered content and dispatches reflow transactions.
8. Completed work advances the valid page range. Edits or layout changes mark earlier work as needing recalculation. Scrolling can extend the target.

A managed behavior is a ProseMirror plugin installed through the word-processing API. Its appended transactions pass through optional synchronous `sources.prepareTransaction(transaction)`. Preparation happens before ProseMirror applies the transaction. The transaction must then satisfy `transaction.before === suppliedCurrentState.doc`.

The app adapter composes any supplied preparation with `normalizePageIndexes`. This preserves page attributes and incoming stored marks before rendering. It enforces app model rules; it is not schema migration. Standalone sources need not know about app pages. Root normalization stays in dispatch. This hook does not promise to normalize arbitrary appends from existing baseline plugins.

Part 3B installs and removes behaviors with `EditorState.reconfigure`. It keeps the same schema, document, selection, stored marks, history and surviving keyed plugin state. Reconfiguration does not create a transaction or undo entry, and it does not recreate the editor view. Managed plugins run before the baseline plugins, the plugins already installed by the editor. Higher priority runs first; equal priorities keep insertion order. The baseline keeps its identity and order.

Behavior reconciliation means bringing installed plugins into line with current registrations and sources. It runs in a microtask, a callback deferred until the current synchronous work finishes. It does not run inside plugin hooks. Reconfiguration makes strict editor result targets stale. Surviving factories, wrapped Plugin objects and cancellation signals keep their identities. A cancellation signal tells work when its owner has stopped or cancelled it. ProseMirror may still recreate plugin-view resources.

Before installing candidate states, the service checks whether sources, plugin lifetimes or editor states changed across views. It tries at most 16 passes to reach a stable configuration. If that fails, it disables the remaining active registrations. The implementation calls this **quarantine**: callbacks stop immediately across views, and physical removal happens when safe.

A failing transaction filter rejects the current transaction. Once disabled, its guard allows later transactions. Disabled append hooks return `null`. State application temporarily keeps its previous value until removal. See the [behavior contracts](../plugins/context.md#lifecycle-owned-behaviors-part-3b-implemented--unmerged) for other callback fallbacks and error reporting.

These checks cannot undo arbitrary callback side effects. They cannot interrupt a running CPU loop or an unlimited chain of appended transactions. They are not a sandbox.

The first Part 3C rendering slice adds dedicated APIs for node and mark views using existing schema types. A renderer can change geometry without changing document content. Optional `sources.invalidateLayout(viewId)` connects these changes to `PageObserver.invalidate(viewId)` through the app's word-processing adapter.

Renderer installation and removal request layout invalidation after the new plugin set is installed. One lazy resize observer per editor view tracks registered renderer roots and editable elements. Inline renderers also observe a containing layout box. A shared child-list observer updates those targets after mounting or page reparenting. The work visits registered resources rather than traversing the document model. Initial size notifications establish baselines. Later dimension changes are coalesced into one animation frame. Ordinary source notifications, selection changes and renderer reconstruction do not themselves invalidate layout. A final invalidation survives provider disposal when a still-live view has returned to schema rendering.

The [renderer author guide](../../packages-js/word-processing/README.md#part-3c-renderers-for-existing-content) explains ownership and failure recovery. The [production-pagination fixture](../../e2e/fixtures/word-processing/README.md#production-pagination-example) tests block UI resizing and inline mark font changes with the real schema, editor dispatch and pagination queue. These additions do not change the model-mutating pagination algorithm or provide arbitrary custom layout support.

View identity and document identity are different. Teardown cancels view-scoped work, disconnects observation and destroys the `EditorView`. Events keyed by document ID can invalidate several views. They do not synchronize those views' contents. Shared editing is not implemented.

## Current pagination invariants

### Geometry and content movement

Pages sit at depth 1 in the document tree. Blocks sit at depth 2. Helpers depend on that structure.

Content bounds come from rendered page rectangles after subtracting computed padding and borders. Measurements use CSS pixels, not physical device pixels. Absolute unit conversion uses 96 CSS pixels per inch. Overflow detection tolerates 0.5 CSS pixels beyond the boundary. It continues checking later sibling blocks after a fitting block.

Overflow moves content forward and creates a page if needed. Underflow pulls fitting content backward and may delete the emptied next page. An atomic `pageEnd` node represents an explicit break. “Atomic” means the editor treats it as one indivisible node. Content after it moves forward. Spare space before it must not pull later content across the break.

Text splitting collects DOM text nodes in order with `TreeWalker`. A mapper converts UTF-16 offsets, JavaScript's string positions, into browser `Range` measurements. Production uses a hybrid search:

1. Test the first ten offsets in order.
2. Use binary search to narrow the rest to at most ten offsets.
3. Test that final window in order.

The search preserves the rounded line-count test and an exclusive end marker that is not measured. Its fit test must be monotonic: once an offset fails, later offsets must not fit. Estimated line counts enforce widow and orphan settings. These control how many lines remain on either side of a paragraph split. Both start at 2.

The global `PageLayout` instance supplies fixed sizes and margins. Its initial A5 preset uses inches. The constructor calls this a testing default.

### Paragraph continuity, history and indexes

A paragraph can span model pages. The first fragment is its **head**. A continuation fragment is a **peer paragraph**, marked `peer: true` with zero indentation. The head needs no special continuation attribute. Before reflowing a boundary, the engine joins the preceding page's last paragraph with the next page's first peer. It prepares only that boundary, not the whole requested range.

Indentation commands affect the pair's head. Alignment affects both halves and resets indentation. Enter at the start of a continuation can break the peer relationship and restore default indentation. This user command can enter undo history.

Since [#80](https://github.com/benyakirten/writers-ide/pull/80), merged 2026-11-14, formatting queries peer groups without making trial edits or logging document nodes. Queries resolve direct blocks at their actual depth and cross page wrappers explicitly. A nonempty selection excludes its end boundary. A leaf `pageEnd` or document-end position must not be treated as an interior text position. These read-only queries must not interrupt editor updates.

Automatic pagination, reunion and page deletion use `addToHistory: false`. They do not create user undo entries. That flag alone does not preserve selection or undo positions. Reflow must also provide correct **step maps**, which describe how document positions move during each structural change.

Reflow splits and joins page/block nodes instead of replacing whole pages or deleting and reinserting text. Peer reunion joins across page and paragraph boundaries, then restores the page boundary. The step maps preserve positions for text ranges, reversed ranges, inline atom selections and user undo/redo. An inline atom is an indivisible node inside text. If a page contains only a peer, a temporary empty paragraph keeps it valid under the one-or-more-block schema rule.

Reflow restores explicit **stored marks**, the formatting intended for subsequently typed text. Index normalization preserves the incoming transaction's marks, not an older state's marks. Selection maps within each synchronous transaction. It is never cached and restored after yielding to other work.

Page indexes are zero-based positions in document order. Root and managed appended transactions normalize them before rendering. The observer also refreshes DOM `data-index` attributes, even on unvisited pages. Peer lookup uses document order rather than possibly stale index attributes.

`paginateRange(from, to)` uses page indexes with an exclusive upper bound. For example, `(0, 3)` requests indexes 0, 1 and 2. Each yield reports the next index, which is also the exclusive end of completed work. Page deletion makes the engine revisit the same index. Page creation does not automatically extend the requested end.

Cancellation is checked before boundary preparation, between preparation and pagination, and before yielding or reporting success. Callers must account for edits between steps.

## Scheduling and invalidation

### Per-view validity

PageObserver tracks three values per view:

- `viewedPage` is the index of the furthest visible page.
- `paginatedTo` is the exclusive end of the **valid prefix**, the consecutive pages from the start that need no recalculation. It starts at 0. A value of 3 means indexes 0, 1 and 2 are valid.
- `revision` is the layout revision. It changes when edits or layout settings make existing pagination work obsolete.

The target is `min(viewedPage + 2, document.childCount)`. If page index 2 is visible, the target is 4 unless the document is shorter. That includes the visible page and one lookahead page. This is viewport-driven pagination, not a full-document pass or whole-document virtualization.

PageObserver updates its state in these steps:

1. Keep a persistent set of visible page elements. Browser intersection notifications report only changed elements, not a complete visibility list.
2. Find the furthest visible index in the current DOM order. Ignore removed elements. If no page is visible, keep the previous target.
3. On an external document change, find the affected range. Mark work as invalid starting at the affected page's predecessor. This allows content to move backward onto that page.
4. Reduce `paginatedTo` if needed and increment the layout revision. Invalidation must never advance an already dirty prefix.
5. After the view update, refresh DOM indexes and observed page elements for that view.

Pagination's own transactions do not invalidate their work. `BreakPeering` is a user edit and does invalidate it. Selection-only transactions do not invalidate layout.

For a single-step edit, affected-range detection checks old and new step-map positions. Mark or attribute steps may have empty maps. Those fall back to serialized `from`, `to` or `pos` values. Multi-step transactions conservatively invalidate the full range because steps use different intermediate documents.

Changes invalidate views with the same document ID. Only the updated view's DOM observations are synchronized. `Paginator` invalidates all registered views when tracked page size, margins, units, widow/orphan settings or default indentation change. Completed font loading (`loadingdone`) also invalidates them.

### Pagination jobs

A job uses the key `pagination:<viewId>` and interactive priority. A new layout revision cancels obsolete work. The generator reads the target again between yields, so scrolling can extend work. Each preparation request covers one page. During input-method composition, such as composing characters with an IME, the job yields without preparing pages.

Failed jobs remain recorded rather than retrying forever. A new revision allows a retry. After about one second, an active job still behind its target can show a modal catch-up dialog. Dismissing it leaves background work running.

### Generic work queue

Unmerged task Part 1 moves generic `WorkQueue` mechanics into private `@writers-ide/tasks`. The app keeps its existing queue instance and compatibility exports. The library has no singleton or editor dependency. Pagination invalidation, revisions and catch-up UI remain app-owned.

**Cooperative scheduling** means work voluntarily returns control between small units. Here, synchronous generators yield between steps. The queue advances them on `requestAnimationFrame`, the browser's animation-frame callback.

- One frame has an **8 ms soft budget** and a 1,000-step safety cap. The budget is checked between steps. It cannot interrupt a running step.
- Jobs take turns within each priority. When both priorities can run, background work receives every fourth turn.
- `start()` returns a lease, a claim that the queue should keep running. Releasing the last generic lease pauses work without cancelling it. Releasing the last pagination owner explicitly cancels pagination jobs.
- Enqueuing the same key replaces old work. Cancelling one view affects only its jobs.
- Cancellation aborts the signal and closes the generator. If cancellation happens inside `next()`, cleanup waits for that call to return. Work and cleanup errors are isolated; both are retained if both fail.
- Finished jobs leave the active list. Retained handles still expose status, progress and errors.

### Plugin consumers (Part 1 implemented / unmerged)

`createApplicationPluginHost` defaults to the app queue. Pagination and plugin cooperative work therefore share one frame budget. A standalone `PluginHost` can receive `workQueue`; otherwise it creates an independent queue.

An activation is one enabled lifetime of a plugin. Activation-owned `context.tasks` provides `forEach`, `cooperative`, `async` and bundled one-shot `worker` helpers. Handles expose reactive progress, errors and outcomes that do not reject. Tasks can be cancelled individually or by owner. Replacement keys work across task modes but stay within the activation's namespace. Unloading a plugin leaves peer plugins and pagination alone.

Cooperative helpers manage queue leases. Async and worker tasks need no lease. Task errors appear in plugin management without disabling the plugin or failing an otherwise successful deactivation. Activation and host-cleanup failures still affect lifecycle success.

Helpers are optional. Short commands and synchronous hooks remain immediate. A Promise does not move CPU work off the main thread. Async cancellation cannot undo unguarded side effects. The separate Svelte-free worker helper handles requests, results, errors, transfers, termination and late responses. Workers do not receive DOM/editor access. Worker pooling, progress and timeouts are not implemented. See the [task guide](../../packages-js/tasks/README.md), [contracts](../../packages-js/tasks/src/contracts.ts) and [execution direction](../plugins/context.md#accepted-direction-actions-and-cooperative-execution).

Editor work captures only needed data and an exact result target. After computation, it constructs and applies a fresh transaction synchronously. Do not retain mutable transactions across steps. Tasks themselves are editor-neutral; the separate word-processing provider supplies `applyResult`.

A Part 3A target is `{ viewId, documentId, revision }`. Its revision is an **editor-state revision**, not a layout revision. Tokens increase across service instances within the module. Even a selection-only change makes an editor target stale, although it leaves layout valid. Stale worker/task results are discarded. They are not mapped to new positions or redirected to another view.

`inspect`, `edit`, `runCommand`, command registration/execution/listing and `applyResult` check exact identity and freshness. They also check lifetime, cancellation, editability and any active-view requirement. A command captures at most one transaction. It applies only after synchronous boolean success and another validation. These commands belong to the editor command service, not the ProseMirror plugin registry. Connections own registrations and callbacks. Nested inspection is allowed. Nested edits and edits during notifications return `busy`.

The owner approved live `EditorState`/`EditorView` access inside synchronous callbacks, with provider-owned edits. This is a trusted-code contract, not isolation. Do not retain live objects or transactions or dispatch through raw views. Rejecting a Promise-like return cannot undo an already-started async body or raw dispatch. Checking `tr.before === current.state.doc` proves document identity, not the originating state. An old same-document transaction supplied with a fresh target can pass that check while violating the contract. Cleanup never destroys source-owned views. See the [word-processing guide](../../packages-js/word-processing/README.md).

Parts 1–2 and 3A–3B are implemented but unmerged. Part 3C schema/custom content and Part 4 external loading/native enforcement remain separately gated. None authorizes a pagination redesign.

## Rationale and evidence

Source comments explain why DOM measurement stays on the main thread. Generators let callers yield between steps; each step must still be short. Model indexes are normalized before rendering so parsed DOM attribute changes do not feed back through ProseMirror's DOM observer. Predecessor invalidation allows backward flow. Full-range multi-step invalidation favors correctness until coordinate remapping exists.

Some rationale is inferred from code rather than stated intent. View-scoped work and one-boundary preparation appear intended to keep panes responsive. Peer attributes preserve paragraph continuity across model pages. Excluding automatic reflow from history separates layout from authored edits. History metadata tests alone do not prove end-to-end undo correctness.

The owner's historical explanation for model mutation is separate from these source comments and inferences.

## Known limitations

- The scheduler cannot interrupt a step. Hybrid search bounds fit-test probes, not DOM collection, mapper construction, each range measurement or browser layout time. It does not guarantee the 8 ms budget.
- Non-text splitting is unfinished. Schema acceptance does not prove reliable pagination for images, inline atoms or complex nested blocks.
- Peer lookup returns adjacent head/peer pairs, not arbitrary multi-page continuation groups. Underflow still has an unfinished peer-handling case.
- Line estimation needs a usable line height. [css.ts](../../src/lib/utils/css.ts) approximates `normal` as font size times 1.2, with a 16 px fallback. Mixed-size inline content needs browser evidence.
- Invalidation covers the named settings and completed font loading. It does not cover general image-load or resize-driven geometry changes.
- Layout settings are global, not per-document or per-view. Preset margins use literal 0.5/0.4 values in the chosen units.
- The generator retains an unexplained empty-page workaround. Production requires one or more blocks per page; some tests allow empty pages.
- Browser coverage is not exhaustive for node types, selection types, widow/orphan results or print fidelity. Selecting a structural node that is itself split or merged still uses ProseMirror's normal fallback.
- Headers, footers and footnote-aware body space are not implemented here. Node definitions do not prove layout support. The footer is absent from the exported node registry, and their group is not ordinary page body content.
- Collaboration is absent. View registration and document-keyed invalidation are not collaboration.

## Future direction and approval gates

These are owner-approved directions, not completed features or permission to replace pagination:

- Keep ProseMirror as the live rich-text model inside the project model.
- Calculated page boundaries could later become derived per-view layout data or a cache. That means calculating them from authored content without storing them as authored structure. This needs research, a prototype and owner approval. Keep current model-mutating pagination in the meantime.
- Preserve authored explicit breaks, layout settings and footnote meaning in any future representation.
- Footnotes should reduce body content height, not physical sheet size. Planned headers and footers also need space. Detailed design remains open.
- Print/PDF output should match intended pagination as closely as possible. Universal fidelity across fonts, renderers, platforms and printers is not promised.
- Nonpaginated views are future work. Future collaboration should default to pagination off, with an override. Neither collaboration nor that switching policy exists today.
- Responsive operation on an **8 GB RAM baseline** is a product target, not a measured guarantee. Prioritize visible content. No particular cache or virtualization design is approved by that target alone.

Discuss significant changes with the owner first. This includes rich-text authority, page representation, layout ownership, collaboration, printing and footnote allocation. Part 3C custom content/schema work and Part 4 external loading/native enforcement have separate approval gates.

## Tests and validation

Unit tests use jsdom through [vite.config.ts](../../vite.config.ts). jsdom has no layout engine. It can test state, transactions and mocked geometry, not actual page fit.

- [page-layout.svelte.test.ts](../../src/lib/editor/state/page-layout.svelte.test.ts) covers peers, mocked overflow, pixel-density handling, affected ranges, generator bounds/cancellation, indexes and history metadata.
- [page-observer.svelte.test.ts](../../src/lib/editor/state/page-observer.svelte.test.ts) covers partial visibility reports, page replacement, invalidation, own-transaction filtering, independent views and cleanup.
- [work-queue.svelte.test.ts](../../src/lib/editor/state/work-queue.svelte.test.ts) covers budgets, fairness, leases, pause/resume, replacement, cancellation during execution, cleanup errors and progress.
- [queue.svelte.test.ts](../../src/lib/components/pagination/queue.svelte.test.ts) covers targets, revision restart, cleanup, catch-up timing/dismissal, composition and retry policy.
- [actions.test.ts](../../src/lib/editor/prosemirror/view/actions.test.ts) and [selection.test.ts](../../src/lib/editor/prosemirror/view/selection.test.ts) cover formatting and selection helpers.
- [pagination.test.ts](../../e2e/pagination.test.ts) checks real page bounds at device pixel ratios 1 and 2. It checks mount/edit/scroll indexes, marker order and independently scrolled panes.

[smoke.test.ts](../../e2e/smoke.test.ts) runs the built app in Chromium and WebKit. It checks startup exceptions, typing, selection, formatting, undo, dropdown keyboard/focus behavior, visible-page geometry, markers and locale resolution. Existing pagination and stylesheet suites also run in both engines. They require fitting, preserved content in each engine, not identical page breaks. They do not run native Tauri WebViews or verify macOS 13.3's WKWebView.

[pagination-selection.svelte.test.ts](../../src/lib/editor/state/pagination-selection.svelte.test.ts) uses the production schema and mocked geometry. It covers carets, forward/reversed ranges, inline atoms, stored marks, empty-page fillers, peer reunion and actual dispatch/index normalization. [pagination-selection.test.ts](../../e2e/pagination-selection.test.ts) checks real caret preservation through overflow and new pages. It also checks ranges through formatting splits, reunion and undo, including exact text and marked-text preservation.

Browser helpers wait for `selectionchange` before formatting. DOM selection can change before ProseMirror receives that event. Range tests also scroll the first page into view and wait for fitting content before recording an undo baseline. Waiting only for currently visible pages can miss an unpaginated offscreen first page after document replacement.

The formatting bridge suite lives in [formatting-service.svelte.test.ts](../../src/lib/editor/prosemirror/menu/basic/formatting-service.svelte.test.ts). It covers page boundaries, final `pageEnd`, forward/reversed and full-document selections, peers, separate document/view IDs, stale commands, cleanup, errors and quiet availability queries. [scope-formatting-service.test.ts](../../src/lib/editor/prosemirror/menu/basic/scope-formatting-service.test.ts) covers feature lifecycle. Generic host tests stay feature-neutral.

Task tests are [tasks-library.svelte.test.ts](../../src/lib/testing/tasks-library.svelte.test.ts), [tasks-library-worker.test.ts](../../src/lib/testing/tasks-library-worker.test.ts) and [plugin-tasks.svelte.test.ts](../../src/lib/plugins/plugin-tasks.svelte.test.ts). [tasks.test.ts](../../e2e/tasks.test.ts) uses a production-built [fixture](../../e2e/fixtures/tasks/TasksFixture.svelte) and [config](../../playwright.tasks.config.ts). It checks emitted workers, transfers, cancellation, error recovery and shared ownership in Chromium/WebKit. Run `pnpm test:tasks` separately from app smoke/e2e. Browser Smoke CI has a task step for its selected engine. These are lifecycle/correctness checks, not native-runtime or end-to-end responsiveness measurements.

Part 3A has [core service tests](../../src/lib/testing/word-processing.svelte.test.ts) and [app adapter tests](../../src/lib/editor/prosemirror/word-processing.svelte.test.ts). [QuickFormat](../../src/lib/editor/prosemirror/menu/quick-format/menu.ts) is an independent public-API consumer. It wraps upstream `toggleMark` for production `bold` or conventional `strong`. It is opt-in, registered only in the browser fixture.

The dedicated [browser suite](../../e2e/word-processing.test.ts), [fixture](../../e2e/fixtures/word-processing/WordProcessingFixture.svelte) and [config](../../playwright.word-processing.config.ts) use the real app adapter, generic host, ProseMirror views/history and a bundled worker. They do not import or register Basic Menu. Six Part 3A scenarios cover formatting, focus, remounting, undo, stale/cancelled/closed-view results, independent same-document views, cascade revocation and reactivation. The earlier Part 3A run passed 53 core regressions and 12 browser cases. Those are historical results, not totals for the expanded Part 3B work. The app manager regression also checks manuscript and undo preservation during provider cascade.

Part 3B adds [core behavior tests](../../src/lib/testing/word-processing-behaviors.svelte.test.ts) and [app dispatch tests](../../src/lib/editor/prosemirror/view/editor-behaviors.svelte.test.ts). They cover filters, appends, invalidation, page-index/stored-mark preparation, ordering, original keys, surviving state/history and failure guards. Three [opt-in examples](../../src/lib/editor/prosemirror/behaviors/README.md) demonstrate upstream input rules and undo, mapped keyed selection decorations, and bounded worker analysis. Decorations are visual annotations, not authored marks. Worker capture is limited to 32,768 model positions and 1,024 chunks. It neither scans the whole manuscript nor joins tokens across nodes. Per-view cancellation and strict targets reject stale output.

[BehaviorFixture.svelte](../../e2e/fixtures/word-processing/BehaviorFixture.svelte) is behind **Mount behavior proofs**, not on the default route. [word-processing-behaviors.test.ts](../../e2e/word-processing-behaviors.test.ts) adds six scenarios/twelve Chromium/WebKit cases. `pnpm test:word-processing` runs both files for 24 cases. The existing CI step includes them; main app e2e excludes them. The fixture's structural split does not verify pagination geometry.

The branch's recorded validation passed 1,111 unit tests, including 79 behavior cases, and final browser runs of 116 app, 22 smoke and 24 word-processing cases. Type checking retained the existing Modal error and five DnD warnings. Initial runs also encountered intermittent collapsed-selection failures. Their cause is not established or proven fixed. These are prior verified results, not checks rerun for this editorial revision. See the [cumulative change-log entry](change-log.md) for outcomes and limits.

The separate [browser performance suite](../browser-performance/context.md) runs nine focused paragraph-search scenarios in real Chromium. It compares sequential and hybrid searches with an independent old-loop baseline. Correctness and probe bounds gate changes. Warmups and repeated samples with rotated order produce diagnostic timing attachments. There are no wall-clock gates. This is not an end-to-end editor benchmark or a replacement for geometry tests.

[sample-data.ts](../../src/lib/editor/prosemirror/view/sample-data.ts) supplies 20 labeled cases for overflow, underflow, explicit breaks and empty pages. Labels survive reflow. They are not physical page numbers.

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

[playwright.config.ts](../../playwright.config.ts) builds the app and starts preview on port 4173. Use real browsers for pagination geometry. Broader contributor checks are `pnpm check`, `pnpm lint`, `pnpm test:unit:ci`, `pnpm test:e2e` and `pnpm build`.

This guide is not a standing claim that checks pass on a new checkout.
