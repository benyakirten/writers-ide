# Bars, docking, and drag-and-drop — PR change log

For current behavior and rationale, read [context.md](context.md). Create one consolidated entry per PR when work begins and update the same entry with every commit so it is complete before merge. Keep unmerged work separate from merged history; do not append per-commit entries, session transcripts, or repeated validation logs. See [AGENTS.md](../../AGENTS.md) for the required workflow.

## In progress

### [#79: Remove highlighting in main area for dnd](https://github.com/benyakirten/writers-ide/pull/79)

**Status: In progress / unmerged.** Branch: `bh/fix-dnd-main-area`. No merge date is assigned.

- Removes the workbench-wide drag tint and outline while preserving its floating drop target and validity metadata. Side/top/bottom targets remain highlighted; the preview still identifies floating placement with a red accent and a release description. This reduces visual clutter without changing transfer semantics or keyboard targeting.
- Extends the existing floater browser scenario to verify pointer repositioning before redocking. Visibility and bounding-box guards make the assertion report missing geometry as a failed condition rather than dereference null. The updated assertion follows repository formatting rules; application movement behavior is unchanged.
- Updates permanent documentation instructions: create a consolidated entry during PR work, update it with every commit, and have substantive changes/rationale/outcomes ready before merge. Separate `In progress` from `Merged PRs`; after merge, finalize only verified status/date/link metadata rather than writing the explanation afterward. This is a cumulative PR summary, not an implementation diary.
- Validation verified during this branch's implementation: 78 docking cases passed across Chromium/WebKit for neutral-background feedback; the latest visibility/bounding-box test edit passed five repeats per engine (10 runs), and repository `pnpm lint` passed after its formatting correction. The documentation workflow update also passed formatting, local Markdown file-link, and whitespace checks. These local results do not establish that every CI environment passes.
- Remaining limitation: a separately reported macOS WebKit pagination-selection test fails during initial document replacement. This PR does not claim to fix that issue or expand the selection-helper infrastructure.

Before merge, keep this entry and affected context accurate for subsequent commits, including verified validation and any remaining limitations. After confirmed merge, move this entry below and replace its unmerged status with authoritative merge metadata.

## Merged PRs

### 2026-11-13 — [#78: Add drag and drop support](https://github.com/benyakirten/writers-ide/pull/78)

- Connected the installed Svelte DnD kit to whole-bar and individual-item handles, workbench edge/gap targets, and in-app floating placement. Hover uses a lightweight preview rather than moving/rebuilding the authoritative layout or mounting duplicate feature component trees.
- Added validated, capacity-aware transfers: at most three logical units using destination-orientation costs; invalid interior drops cancel, while explicit gaps create bars for extracted items. Whole bars retain identity, ordered contents, title and remembered geometry without implicit merging, splitting, or silently discarded items. Floating bars support both orientations and bounds correction.
- Made destinations easier to acquire with larger persistent insertion slots and proximity-expanded hit areas that do not shift the editor layout. Destination colors and live release descriptions distinguish side, top/bottom, floating and invalid targets; ordinary tooltips are suppressed for the drag and resume on fresh hover/focus afterward. At merge, the main floating surface was tinted; #79 changes that presentation.
- Added mouse/touch activation constraints, keyboard dragging/cancellation and destination focus restoration, visible-surface collision resolution, and disabled docking auto-scroll. Existing menu relocation remains available through validated transfers.
- Added state and real Chromium/WebKit regression coverage for transfers, capacity rejection, preservation, ordering, floating orientation/bounds, handles, feedback and tooltip lifecycle. The caret regression selects its formatting suffix by existing logical-range helpers instead of assuming a fixed number of native arrow presses across physical page boundaries; typing/caret/content assertions remain intact.
- Established topic-oriented context/history documentation and the agent reading workflow. Layout persistence/undo, native floating windows, arbitrary split/tab docking, general plugin component-state transfer, and minimized-floater restoration were not implemented. Browser tests are not packaged Tauri, actual touch-hardware, or comprehensive accessibility validation.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/78) reports `merged: true`, `merged_at: 2026-11-13T05:58:21Z`, and merge commit `155adaab149724ee0d56db995b173277dfd15870`.
