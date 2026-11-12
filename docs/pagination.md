# Document editing and pagination

This document describes the current ProseMirror editor and pagination implementation, followed by owner-approved product direction and research possibilities. Future direction is **not** an approved implementation plan. Every significant architectural decision must be run by the owner before implementation.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for repository conventions and validation requirements.

## Model and architectural boundary

The approved direction is a project model with **ProseMirror-based rich text**, not a second live rich-text model kept in sync with ProseMirror. This does not mean the current code already implements the complete project model.

**Current implementation:** pagination mutates the ProseMirror document. The schema is `doc → page+ → block+`; reflow moves content between page nodes, splits paragraphs, creates pages, and removes emptied pages. Pages are not merely decorations or a separate layout cache. Keep this implementation unchanged unless a separately approved task changes it.

**Historical rationale supplied by the owner:** mutating page nodes was the quickest, most straightforward initial approach. That explains the starting point; it is not a reason to rewrite the implementation now.

## Source map

Paths below are relative to this documentation file.

| Source                                                                                                                                                                                                                                       | Responsibility                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [ProseMirrorView.svelte](../src/lib/editor/prosemirror/view/ProseMirrorView.svelte)                                                                                                                                                          | Mounts an editor inside a scrollable `.document-viewport`; currently opens the pagination sample document.                      |
| [editor.ts](../src/lib/editor/prosemirror/view/editor.ts)                                                                                                                                                                                    | Creates state/view, installs history and keymaps, runs transaction handlers, normalizes page indexes, and applies transactions. |
| [prose-mirror-editor.svelte.ts](../src/lib/editor/prosemirror/prose-mirror-editor.svelte.ts)                                                                                                                                                 | Owns registered views, observer registration, cancellation and view destruction.                                                |
| [schema.ts](../src/lib/editor/prosemirror/view/schema.ts), [nodes.ts](../src/lib/editor/prosemirror/view/nodes.ts), [marks.ts](../src/lib/editor/prosemirror/view/marks.ts), [constants.ts](../src/lib/editor/prosemirror/view/constants.ts) | Document structure, attributes, DOM serialization, marks, depth and unit conventions.                                           |
| [actions.ts](../src/lib/editor/prosemirror/view/actions.ts), [selection.ts](../src/lib/editor/prosemirror/view/selection.ts)                                                                                                                 | Formatting, selection inspection and continuation-aware paragraph commands.                                                     |
| [event-bus.svelte.ts](../src/lib/editor/state/event-bus.svelte.ts), [event-bus.plugin.ts](../src/lib/editor/prosemirror/plugins/event-bus.plugin.ts)                                                                                         | Document-keyed events, including pre-transaction and post-view-update notifications.                                            |
| [page-layout.svelte.ts](../src/lib/editor/state/page-layout.svelte.ts)                                                                                                                                                                       | Geometry, overflow/underflow, explicit breaks, paragraph continuation/reunion, affected ranges and pagination transactions.     |
| [page-observer.svelte.ts](../src/lib/editor/state/page-observer.svelte.ts)                                                                                                                                                                   | Per-view visibility, valid-prefix boundary and layout revision.                                                                 |
| [queue.svelte.ts](../src/lib/components/pagination/queue.svelte.ts)                                                                                                                                                                          | Converts visibility/invalidation into keyed, revision-aware pagination work.                                                    |
| [work-queue.svelte.ts](../src/lib/editor/state/work-queue.svelte.ts)                                                                                                                                                                         | Generic cooperative synchronous-generator executor.                                                                             |
| [Paginator.svelte](../src/lib/components/pagination/Paginator.svelte)                                                                                                                                                                        | Queue lifecycle, settings/font invalidation and catch-up dialog.                                                                |
| [Editor.svelte](../src/lib/editor/Editor.svelte), [global.css](../src/routes/global.css)                                                                                                                                                     | Reactive page dimensions/padding through CSS variables and fixed page styling.                                                  |

[split-search.ts](../src/lib/editor/state/split-search.ts) supplies sequential and hybrid search strategies; [text-split-measurement.ts](../src/lib/editor/state/text-split-measurement.ts) supplies the shared DOM range mapper used by production text splitting and the focused browser benchmark.

[pagination.plugin.ts](../src/lib/editor/prosemirror/plugins/pagination.plugin.ts) is only an empty keyed plugin with aspirational comments. It is not the active pagination engine.

## Current transaction and layout flow

1. `createView` builds ProseMirror state with history, shortcuts, the base keymap and registered plugins. It normalizes model page indexes before the first render and registers a distinct view ID.
2. Dispatch runs registered transaction handlers, normalizes page indexes when the document changes, and emits `PreUpdate` before applying the transaction.
3. The observer manager uses `PreUpdate` to invalidate affected measurements. Applying state updates the DOM; the event-bus plugin emits `Update`, which synchronizes page indexes and observed page elements.
4. An `IntersectionObserver` rooted in the document viewport tracks the furthest visible page. The pagination queue requests work through that page plus one lookahead page.
5. The work queue advances the pagination generator. Each page step reunites the current continuation boundary, measures rendered DOM, and dispatches model-changing reflow transactions.
6. Progress advances the valid prefix. Edits/layout changes invalidate that prefix and obsolete work; scrolling can extend the target.

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
- Indentation commands affect a peer pair's head; alignment affects both halves and resets indentation. Enter at a continuation's beginning can break peering and restore default indentation.
- Pagination, reunion and page deletion set `addToHistory: false`. The user break-peering command remains history-eligible.
- Page indexes are normalized in the transaction before rendering. The observer also refreshes DOM `data-index` values, including unvisited pages. Document order, not potentially stale index attributes, identifies peer neighbors.
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

- Work consists of synchronous generators advanced on `requestAnimationFrame`.
- A frame has an **8 ms soft budget** and a 1,000-step safety cap. It cannot interrupt an executing step.
- Scheduling is round-robin within priority. With both priorities runnable, background work receives every fourth turn.
- Execution requires a `start()` lease. Releasing the last generic queue lease suspends work without cancelling it; releasing the last pagination owner explicitly cancels its pagination jobs.
- Same-key enqueue replaces old work. View cancellation affects only that view's jobs.
- Cancellation aborts the signal and closes the generator. Cleanup is deferred until `next()` returns if cancellation occurs during execution. Work/cleanup failures are isolated and combined when both occur.
- Terminal jobs leave the active list; retained handles preserve status, progress and errors.

## Rationale and evidence

**Explicit in source comments:** DOM-dependent measurement must remain on the main thread, so generators allow callers to yield control; each generator step must itself remain short. Model indexes are normalized before rendering to avoid parsed DOM attribute mutations feeding back through ProseMirror's DOM observer. Predecessor invalidation permits backward flow. Full-range multi-step invalidation favors correctness until coordinate remapping is implemented.

**Inferred from implementation, not separately documented intent:** view-scoped work and one-boundary preparation aim to keep panes responsive; peer attributes preserve logical paragraph continuity across physical model pages; history exclusion separates automatic reflow from user-authored edits. Metadata tests alone do not establish complete end-to-end undo behavior.

The owner's historical explanation above is separate from rationale explicitly recorded in code.

## Known limitations

- The scheduler is cooperative, not preemptive. Hybrid text splitting bounds predicate probes rather than measuring every character, but DOM text-node collection, mapper construction, each `Range` measurement and browser layout costs remain synchronous and uninterruptible within a step. A bounded probe count does not guarantee the nominal frame budget.
- Non-text splitting contains unfinished handling. Schema acceptance does not establish reliable pagination for images, inline atoms or complex nested blocks.
- Peer identification returns adjacent head/peer pairs, not a general multi-page continuation group. Underflow code still contains a peer-handling TODO.
- Line-count estimation assumes a usable line height. [css.ts](../src/lib/utils/css.ts) approximates `normal` as font size multiplied by 1.2, with a 16 px fallback. Mixed-size inline content needs browser evidence.
- The inspected invalidation path covers specified settings and completed font loading, not general image-load or resize-driven geometry changes.
- Layout settings are global rather than per-document/per-view. Preset margins are assigned literal 0.5/0.4 values in the chosen units.
- The generator retains an explicitly unexplained empty-page workaround. Production schema requires `block+`, while some layout tests allow structurally empty pages.
- Current browser tests check page bounds and marker order, not exhaustive text/mark preservation, selection stability, widow/orphan outcomes or print fidelity.
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

Unit tests run under jsdom via [vite.config.js](../vite.config.js). They validate state, transactions and mocked geometry; jsdom cannot establish real layout correctness.

| Tests                                                                                                                                            | Coverage                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [page-layout.svelte.test.ts](../src/lib/editor/state/page-layout.svelte.test.ts)                                                                 | Peer boundaries, mocked overflow geometry/DPR, affected ranges, generator bounds/cancellation, indexes and history metadata.  |
| [page-observer.svelte.test.ts](../src/lib/editor/state/page-observer.svelte.test.ts)                                                             | Partial intersections, page replacement, valid-prefix invalidation, own-transaction filtering, independent views and cleanup. |
| [work-queue.svelte.test.ts](../src/lib/editor/state/work-queue.svelte.test.ts)                                                                   | Budget/fairness, leases, pause/resume, replacement, reentrant cancellation, cleanup errors and reactive progress.             |
| [queue.svelte.test.ts](../src/lib/components/pagination/queue.svelte.test.ts)                                                                    | Targets, revision restart, lifecycle cleanup, catch-up timing/dismissal, composition and retry policy.                        |
| [actions.test.ts](../src/lib/editor/prosemirror/view/actions.test.ts), [selection.test.ts](../src/lib/editor/prosemirror/view/selection.test.ts) | Formatting commands and selection utilities.                                                                                  |
| [pagination.test.ts](../e2e/pagination.test.ts)                                                                                                  | Real page bounds at DPR 1/2, mount/edit/scroll indexes and marker order, independent pane scrolling.                          |

The separate [browser performance suite](browser-performance.md) runs nine focused paragraph search scenarios in real Chromium, comparing sequential and hybrid searches against an independent old-loop baseline. Correctness and probe bounds gate changes; warmups and repeated, rotated samples produce timing attachments without wall-clock gates. It is not an end-to-end editor performance fixture and does not replace the existing geometry tests.

[sample-data.ts](../src/lib/editor/prosemirror/view/sample-data.ts) supplies 20 labeled source cases for overflow, underflow, explicit breaks and empty pages. Source-case labels deliberately survive reflow; they are not physical page numbers.

Run from the repository root:

```sh
pnpm test:unit:ci src/lib/editor/state/page-layout.svelte.test.ts src/lib/editor/state/page-observer.svelte.test.ts src/lib/editor/state/work-queue.svelte.test.ts src/lib/components/pagination/queue.svelte.test.ts
pnpm test:unit:ci src/lib/editor/prosemirror/view
pnpm test:e2e e2e/pagination.test.ts
pnpm test:performance
```

[playwright.config.ts](../playwright.config.ts) builds and starts preview on port 4173. Use real-browser tests for pagination geometry. Broader checks from contributor guidance are `pnpm check`, `pnpm lint`, `pnpm test:unit:ci`, `pnpm test:e2e` and `pnpm build`.

This document records source inspection, not a claim that those checks have passed.
