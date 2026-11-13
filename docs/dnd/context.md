# Bars, docking, and drag-and-drop context

## Status and scope

This describes the **current working-branch implementation and owner-approved direction**, not a claim that the docking PR has merged. The inspected branch is `bh/41-drag-n-drop-implementation`; feature-branch commits alone do not establish merge status. Confirmed merged outcomes belong in [change-log.md](change-log.md).

This topic owns feature bars, item grouping, edge docking, floating overlays, and their drag interactions. Central tabs and split views are separate concerns. These are trusted in-process Svelte components, not an isolated third-party plugin platform.

## Philosophy and approved behavior

- A **bar item** is a feature presentation. A **bar** groups ordered items; a **dock** groups bars at one workbench edge.
- Each bar holds at most **three logical capacity units**. Units are not literal squares or a pixel-fit guarantee. Items provide horizontal and vertical presentations and may declare different costs for each.
- Top/bottom docks use horizontal presentations; side docks use vertical presentations. Floating bars are overlays inside the application and can use either arrangement. Detaching retains the source arrangement.
- Both whole bars and individual items are draggable through separate handles. Feature controls, title editing, and resizing must not accidentally start a drag.
- Docking is relative to the **whole workbench**, not a particular central view.

## Transfer contracts and rationale

The transfer handler is the state mutation boundary. DnD supplies a typed source and proposed destination; `canDrop()` validates without mutation, and `drop()` revalidates before committing. Sources use stable bar IDs rather than transient collection indices.

| Action/target                                       | Result                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Item into a bar interior/boundary with capacity     | Insert at the indicated position.                                                  |
| Item into a bar without capacity                    | Invalid target; release cancels, with no fallback to floating or implicit new bar. |
| Item into an explicit dock gap/empty dock           | Create a bar containing the item.                                                  |
| Whole bar into a dock gap                           | Move the container intact, without merging or splitting.                           |
| Free workbench space                                | Create/reposition a floater.                                                       |
| Escape or a delivered release outside the workbench | Cancel without changing contents.                                                  |

Capacity uses the **destination orientation**. Reject a whole-bar move or floating orientation switch if the resulting total exceeds three units; never silently omit items. Insertion indices refer to boundaries before source removal; same-container movement adjusts them after removal and excludes the moving item from capacity accounting.

Whole-bar transfers retain bar and `BarItems` identity, item order, title, and remembered docked/floating geometry. Moving the final item out removes the empty source bar. Registry IDs can repeat across different bars, but not within one bar. Meaningful feature state should live outside presentation instances: stable IDs do not preserve arbitrary component-local state across Svelte remounts.

Relocation menus use the same validated transfer API. Their existing convenience behavior may choose a fitting final bar or create a new one; pointer drops instead require an explicit gap to create a bar. Legacy directional item nudges remain separate operations.

## Interaction and feedback

The installed `@dnd-kit-svelte` packages own drag gestures, including floating movement. Authoritative layout stays unchanged during hover; only a lightweight overlay moves. This avoids duplicate feature component trees/subscriptions and repeated workbench resizing/pagination while dragging.

- Mouse activation: six pixels; touch: 200 ms hold with eight pixels tolerance; keyboard sensor plus existing relocation menus.
- Persistent insertion slots reserve 28 px for docks and 16 px for items. During dragging, eligible destinations remain highlighted. Destination colors are blue for vertical/side docks, yellow for horizontal/top-bottom docks, and red for floating-bar item targets. The main workbench remains unhighlighted while retaining its floating drop behavior; the red preview accent and release description communicate floating placement without tinting the entire editor. Color follows the destination location, not the shape of an insertion strip; text and outlines preserve meaning without relying on color alone. Hovered invalid destinations retain an explicit rejection outline and cancellation message. Forced-colors mode uses system highlight colors.
- Within 64 px, actual insertion hit areas grow proportionally up to 12 px per side along their narrow axis. Growth is absolute within stationary slots to avoid reflow and feedback jitter. Horizontal item sizing reserves insertion space before distributing capacity units.
- A high-contrast source-labelled preview follows the activator beside the pointer, stays viewport-bounded, and includes an Escape hint. Its accent matches the current destination. Live release text distinguishes whole-bar placement, item insertion/reordering, new-bar creation, floating/repositioning, unchanged order, and invalid/outside cancellation, including dock side and insertion position where applicable. Text uses the same `canDrop()` validation as commit and is also exposed in the polite live region for keyboard use. It is not a second live plugin component.
- Ordinary application tooltips are suppressed throughout an active bar/item drag. The tooltip service provides reference-counted suppression leases: activation immediately dismisses open/pending tooltips and discards requests while suppressed; drop, cancellation, and editor teardown release the lease. Suppressed requests are not replayed afterward—fresh hover/focus resumes normal tooltips. This prevents hovered controls obscuring the release description.
- Pointer collisions resolve the visible surface before choosing specific insertion/interior targets, preventing drops into hidden overlapping floaters. Invalid visible targets never fall through to another destination.
- Docking auto-scroll is disabled: edge acquisition must not scroll the source toolbar and clip its handle. The workbench clips target growth at viewport edges.
- Successful keyboard moves restore focus to the destination handle. Floating geometry is reclamped after size/workbench changes; guarded writes avoid observer churn.

## Source and test entry points

Paths below are repository-relative:

- `src/lib/editor/Editor.svelte`: workbench composition, dock gaps, sensors, collisions, overlay, commit/cancel, and keyboard focus.
- `src/lib/dnd/DockDraggable.svelte`, `DockTarget.svelte`: handle activation, typed metadata, target registration, validity and proximity feedback. Older generic wrappers remain unused experiments.
- `src/lib/dnd/dock-feedback.ts`, `dock-colors.css`: shared destination classification, capacity-aware release descriptions, logical-to-physical side labels, and forced-colors-aware palette. `src/lib/services/tooltip.svelte.ts` owns tooltip suppression leases.
- `src/lib/editor/bars/`: docked/floating rendering, item boundaries, relocation menus, orientation control, and resizing.
- `src/lib/editor/state/bar-transfer-handler.svelte.ts`: `DockDragSource`, `DockDropTarget`, `getBar()`, `isVertical()`, `canDrop()`, `drop()`, and menu transfers.
- `src/lib/editor/state/bar-items.svelte.ts`, `bar-item-registry.svelte.ts`: item IDs, orientation-specific costs/components, capacity and fallback rendering.
- `src/lib/editor/state/horizontal-bar-state.svelte.ts`, `vertical-bar-state.svelte.ts`, `floater-state.svelte.ts`: geometry, collections, stacking, orientation, and bounds.
- `src/lib/editor/prosemirror/menu/basic/`: example horizontal/vertical presentations sharing feature controls.
- `src/lib/editor/state/dock-transfer.svelte.test.ts` and the bar/item/registry/floater state test files: transfer invariants, preservation, capacity, ordering, and bounds.
- `e2e/docking.test.ts`, `e2e/docking-feedback.test.ts`, `e2e/docking-destinations.test.ts`: Chromium/WebKit geometry and gesture regressions, cancellation, focus, overlap, target visibility, proximity hit acquisition, layout stability, destination colors/descriptions, and tooltip suppression/resumption.
- `src/lib/dnd/dock-feedback.test.ts`, `src/lib/services/tooltip.svelte.test.ts`: classification/descriptions (including RTL, insertion boundaries and invalid moves), suppression lifetime, pending timers, nested leases, and fresh tooltip requests.

Use [CONTRIBUTING.md](../../CONTRIBUTING.md) for validation commands. Start with focused unit/browser tests; real browser tests are necessary for hit geometry. Test results recorded elsewhere are historical evidence, not a guarantee that a new checkout passes.

## Limitations and open questions

- Layout persistence and layout undo are deliberately out of scope; layout changes must not enter ProseMirror document history. No native floating windows, arbitrary splits, or tab-group docking are introduced.
- Minimized floaters still lack a completed restore UI.
- Component-local state transfer has no general plugin lifecycle contract. Logical capacity does not guarantee visual fit under resizing, translations, or larger text.
- Native out-of-window event loss, packaged Tauri WebViews, real touch hardware, and comprehensive screen-reader behavior need separate validation; Playwright engine tests are not substitutes.
- Development/base controls are fixed scaffolding, not draggable feature bars: `HorizontalBaseBar.svelte` creates bars/initial menu; `VerticalBaseBar.svelte` contains test controls.
