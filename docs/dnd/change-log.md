# Bars, docking, and drag-and-drop — PR change log

For current behavior and rationale, read [context.md](context.md). Create one consolidated entry per PR when work begins and update the same entry with every commit so it is complete before merge. Keep unmerged work separate from merged history; do not append per-commit entries, session transcripts, or repeated validation logs. See [AGENTS.md](../../AGENTS.md) for the required workflow.

## In progress

### `main` working tree — Stage 2 reusable layout and tooltip integration

**Status: In progress / unmerged.** Working tree on `main`; no new branch or PR exists, and no merge date is assigned.

- Moves registry/capacity, item/bar state, validated transfers, floaters, feedback/palette, and drag/target primitives into private `@writers-ide/layout`. Explicit registry/ID/title/item-factory dependencies support independent workbenches without importing app singletons or ProseMirror.
- Keeps the app compatibility instance in `src/lib/editor/state/workbench.svelte.ts`, existing state facades, custom bar/presentation rendering, and `Editor.svelte` sensors/collisions/overlay/commit composition. Existing three-unit, destination-orientation, cancellation, placement-identity, and disabled-cost contracts are preserved; no persistence or general component-local-state transfer is added.
- Uses explicit tooltip state/provider from private `@writers-ide/components`; app wrappers retain the shared manager and suppression leases. The route provides that manager around `Editor` without a duplicate pointer. The base bar forwards the host-owned Plugins dialog action; feature contributions do not own management UI. See the [plugin entry](../plugins/change-log.md).
- Adds library integration/independence coverage in `src/lib/testing/layout-library.svelte.test.ts` and `components-library.svelte.test.ts`, alongside existing state/transfer and browser docking regressions.
- Validation: all 843 unit tests in 38 files passed; `CI=true pnpm test:e2e` passed all 114 Chromium/WebKit cases, including the complete docking/feedback/destination suite, pagination-selection and plugin-manager coverage, styles, and a production build. Lint and frozen offline workspace install passed. Type checking remains blocked by the pre-existing `Modal.svelte` typing error and five old generic DnD warnings. These browser results do not verify native WebViews, real touch hardware, or complete accessibility; see the linked plugin entry for limits and final smoke-command checks.

## Merged PRs

### 2026-11-13 — [#78: Add drag and drop support](https://github.com/benyakirten/writers-ide/pull/78)

- Connected the installed Svelte DnD kit to whole-bar and individual-item handles, workbench edge/gap targets, and in-app floating placement. Hover uses a lightweight preview rather than moving/rebuilding the authoritative layout or mounting duplicate feature component trees.
- Added validated, capacity-aware transfers: at most three logical units using destination-orientation costs; invalid interior drops cancel, while explicit gaps create bars for extracted items. Whole bars retain identity, ordered contents, title and remembered geometry without implicit merging, splitting, or silently discarded items. Floating bars support both orientations and bounds correction.
- Made destinations easier to acquire with larger persistent insertion slots and proximity-expanded hit areas that do not shift the editor layout. Destination colors and live release descriptions distinguish side, top/bottom, floating and invalid targets; ordinary tooltips are suppressed for the drag and resume on fresh hover/focus afterward. At merge, the main floating surface was tinted; #79 changes that presentation.
- Added mouse/touch activation constraints, keyboard dragging/cancellation and destination focus restoration, visible-surface collision resolution, and disabled docking auto-scroll. Existing menu relocation remains available through validated transfers.
- Added state and real Chromium/WebKit regression coverage for transfers, capacity rejection, preservation, ordering, floating orientation/bounds, handles, feedback and tooltip lifecycle. The caret regression selects its formatting suffix by existing logical-range helpers instead of assuming a fixed number of native arrow presses across physical page boundaries; typing/caret/content assertions remain intact.
- Established topic-oriented context/history documentation and the agent reading workflow. Layout persistence/undo, native floating windows, arbitrary split/tab docking, general plugin component-state transfer, and minimized-floater restoration were not implemented. Browser tests are not packaged Tauri, actual touch-hardware, or comprehensive accessibility validation.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/78) reports `merged: true`, `merged_at: 2026-11-13T05:58:21Z`, and merge commit `155adaab149724ee0d56db995b173277dfd15870`.

### 2026-11-13 — [#79: Remove highlighting in main area for dnd](https://github.com/benyakirten/writers-ide/pull/79)

**Status: Merged 2026-11-13.** Branch: `bh/fix-dnd-main-area`.

- Removes the workbench-wide drag tint and outline while preserving its floating drop target and validity metadata. Side/top/bottom targets remain highlighted; the preview still identifies floating placement with a red accent and a release description. This reduces visual clutter without changing transfer semantics or keyboard targeting.
- Extends the existing floater browser scenario to verify pointer repositioning before redocking. Visibility and bounding-box guards make the assertion report missing geometry as a failed condition rather than dereference null. The updated assertion follows repository formatting rules; application movement behavior is unchanged.
- Updates permanent documentation instructions: create a consolidated entry during PR work, update it with every commit, and have substantive changes/rationale/outcomes ready before merge. Separate `In progress` from `Merged PRs`; after merge, finalize only verified status/date/link metadata rather than writing the explanation afterward. This is a cumulative PR summary, not an implementation diary.
- Validation verified during this branch's implementation: 78 docking cases passed across Chromium/WebKit for neutral-background feedback; the latest visibility/bounding-box test edit passed five repeats per engine (10 runs), and repository `pnpm lint` passed after its formatting correction. The documentation workflow update also passed formatting, local Markdown file-link, and whitespace checks. These local results do not establish that every CI environment passes.
- Remaining limitation: a separately reported macOS WebKit pagination-selection test fails during initial document replacement. This PR does not claim to fix that issue or expand the selection-helper infrastructure.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/79), verified by the parent agent: `merged: true`, `merged_at: 2026-11-13T22:04:54Z`, merge commit `2116288ecf49ea0428cfbc9d3f1219d8cbc4286c`.

### 2026-11-14 — [#80 — Bundled plugin presentations and disabled capacity](https://github.com/benyakirten/writers-ide/pull/80)

**Status: Merged 2026-11-14.** Branch: `bh/add-plugin-interface-js`.

- Adds a trusted presentation branch to bar renderers, passing only the scoped plugin context rather than legacy editor/workspace props. Formatting now registers through the bundled plugin host; drag gestures, transfers, ordering, capacity rules, and geometry remain unchanged.
- Keeps disabled toolbar placement IDs and declared horizontal/vertical costs. Placeholders reserve that space so inserting items while disabled cannot overfill the bar on re-enable. Default legacy deregistration and registry clearing still release retained metadata.
- Tests cover presentation routing/cleanup, collisions and replacement ownership, repeated disable/re-enable across bars, and destination-orientation capacity. See the [plugin PR entry](../plugins/change-log.md) for the complete implementation and validation summary.
- Validation: registry/bar/transfer/application-adapter tests passed (88 cases in the focused run); the final cross-engine browser rerun and full-suite results are recorded in the linked plugin entry. No layout persistence or general feature-state transfer lifecycle is introduced.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/80), verified by the parent agent: `merged: true`, `merged_at: 2026-11-14T19:08:58Z`, merge commit `4b39895c5218498fd1c0e79c99b1ea8012f1b67a` (matches current `main` HEAD).
