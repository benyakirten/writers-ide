# Workspace docking change log

This is a chronological engineering decision log, requested by the owner, for future design discussions and agent work. It records decisions, rationale, implementation outcomes, and remaining limitations—not a transcript. See [project context](docs/project-context.md) for the broader architecture and [contributing](CONTRIBUTING.md) for conventions.

## 2026-11-12 — 1. Assessment and owner-approved interaction contract

**Starting point:** all five bar locations, orientation-specific item components, capacity accounting, resizing, and relocation menus already existed. `Editor.svelte` had a DnD context with logging handlers; `src/lib/dnd/` had disconnected experimental wrappers. Floaters used a separate mouse-movement implementation.

**Safety finding:** `moveMenu()` removed the source and rebuilt a destination from item registry IDs. Construction could silently reject items that exceeded the destination's orientation-specific capacity. Identity, dimensions, and floating metadata were also reset. Wiring DnD directly to this method would have exposed a data-loss path.

**Decisions confirmed with the owner:**

- Support dragging both whole bars and individual bar items.
- A bar contains at most **three logical capacity units**. Units are not fixed-size squares; visual geometry remains adaptable. Item horizontal and vertical costs may differ.
- Top/bottom docks use horizontal presentations; side docks use vertical presentations. Floating bars are overlays inside the application and support either orientation.
- Dock targets are relative to the **whole workbench**, not each central document view.
- Dropping an item inside a bar inserts it only if destination capacity allows. An invalid interior remains an invalid target: release cancels, without floating or silently creating another bar.
- Explicit gaps between bars, or an empty edge target, create a new bar for an item. Whole bars move to those same gaps without merging or splitting.
- Dropping on free workbench space creates/repositions a floater. Detaching retains the source orientation. Escape or a delivered release outside the workbench cancels.
- Layout undo is explicitly out of scope. Layout changes do not enter ProseMirror document history. No durable layout persistence or native floating windows are introduced.

**Implementation defaults proposed before authorization and used here:** retain bar identity/title/geometry, remove an empty source bar after item extraction, and leave development/base controls fixed. `HorizontalBaseBar.svelte` contains creation controls and initial basic-menu setup; `VerticalBaseBar.svelte` contains test controls. They are not ordinary draggable feature bars.

## 2026-11-12 — 2. Validated state transfers before gestures

**Decision:** extend the existing Svelte state classes and transfer handler rather than migrate workspace state or introduce another dependency.

**Implementation:** `src/lib/editor/state/bar-transfer-handler.svelte.ts` exports `DockDragSource` and `DockDropTarget`, plus `canDrop()` and `drop()`. Sources use stable bar IDs and optional item IDs. Targets distinguish existing-bar item insertion, dock insertion/new-bar creation, and floating coordinates. Insertion indices are boundaries **before source removal**; same-container moves adjust the boundary after removal.

**Rationale/outcome:** validation occurs before mutation and is repeated at commit. Destination duplicates and over-capacity moves are rejected without changing either container. Whole-bar moves retain the same bar object and `BarItems` object, preserving optional geometry/metadata accumulated across locations. Item extraction creates a new container, while retaining remaining source contents and order. Empty source containers are removed. Registry IDs may occur in different bars, but not twice in one bar.

`moveMenu()` and `relocateItem()` use the same validated transfer boundary. Menu relocation retains its existing convenience policy of selecting a fitting last bar or creating a new one; this is distinct from the explicit pointer-drop policy. Existing directional nudge commands remain separate legacy operations.

`BarItems.isVertical` is reactive. `canOrient()` / `setOrientation()` validate destination costs. `FloaterBarState.setOrientation()` exposes this to floating UI. Floating positions accept zero coordinates and clamp nonnegatively, including workspaces smaller than the floater. Remembered docked width/height and floating position/size/title stay on the bar object; this is in-memory metadata, not a serialized workspace schema.

**Boundary:** preserving identity and shared feature state does not preserve arbitrary component-local UI state when orientation/location remounts a component. Plugins should keep meaningful feature state outside presentation instances. This work does not invent a public plugin state-transfer lifecycle or isolated plugin platform.

## 2026-11-12 — 3. Handles, targets, and workbench integration

**Decision:** use the installed `@dnd-kit-svelte` packages, with small docking-specific wrappers rather than build on assumptions from React DnD examples. The older generic `Draggable`, `Droppable`, and `Sortable` experiments remain unused.

**Implementation:**

- `src/lib/dnd/DockDraggable.svelte` owns measurement and metadata, and exposes an accessible button-handle snippet. Bar/item controls and resize handles do not activate drags.
- `src/lib/dnd/DockTarget.svelte` publishes typed target metadata and valid/invalid outlines. Invalid item targets stay registered; whole-bar drags exclude item interiors.
- Docked/floating bars expose separate whole-bar and item handles, item insertion boundaries, and interior append targets.
- `Editor.svelte` registers all four dock collections with permanent empty/gap targets. The previous disconnected sortable contexts were replaced by explicit insertion targets; no speculative sorting mutation occurs during hover.
- Mouse activation requires six pixels of movement; touch uses a 200 ms hold with eight pixels of tolerance. Keyboard uses the package's keyboard sensor. Existing relocation menus remain available.
- A lightweight `DragOverlay` shows the feature title instead of mounting a second live feature component tree. The real source stays in place and dims until commit.
- Floaters use the same DnD gesture path; their custom mouse movement is no longer wired in the UI. Existing state helper APIs remain for compatibility. Focus/stacking, title editing, and native CSS resizing remain. A capacity-validated orientation button changes the floating arrangement.

**Rationale:** stable source geometry avoids repeated workbench resizing/pagination during hover. Explicit gaps distinguish grouping changes from invalid capacity. The lightweight overlay avoids duplicate subscriptions/editor components.

## 2026-11-12 — 4. Browser feedback and hardening

**Observed and corrected during browser validation:**

1. Capturing `useDndContext()` once yielded stale hover/active data with this package. A Svelte derived context now tracks updates, so invalid outlines and whole-bar target disabling react correctly.
2. Translating the original source caused Chromium edge scrolling and lost docking targets. Only the overlay moves; the source remains stationary.
3. A default tall floater was already clamped to the bottom after detaching. The keyboard movement regression was corrected to move upward into available space rather than assert an impossible downward move.
4. Area-only collision priority could choose a smaller floater hidden behind the front floater. Pointer collision resolution first restricts candidates to the visible workbench surface, then prefers specific insertion/interior targets. A full visible target still rejects instead of falling through.
5. Successful keyboard relocation can unmount the original activator. After commit and Svelte rendering, the editor focuses the destination bar/item handle. Escape leaves the original handle available for the library's restoration.
6. Floater coordinates are reclamped when measurements change and when the workbench root resizes. Guarded writes avoid ResizeObserver feedback churn; all bars, including minimized ones, participate in root-bound correction.

**Validation and outcome:** see the final validation entry below for commands actually run. Intermediate failures drove the changes above; they are not hidden by skipped tests.

## Limitations and follow-up boundaries

- Logical capacity is not a DOM-fit guarantee. Feature authors still provide suitable horizontal/vertical presentations, and large UI text/translations may require scrolling or a future sizing contract.
- Layout remains in memory. No layout undo/redo, save/load schema, tab-group docking, arbitrary splits, or native windows were added.
- The pre-existing minimized-floater restore UI remains incomplete; this work does not redesign minimization.
- Browser-engine tests are proxies for Tauri WebViews, not packaged/native-window tests. Native out-of-window release/event-loss behavior and actual touch hardware still require manual validation.
- Existing generic DnD wrapper warnings and unrelated `Modal.svelte` / `Tab.svelte` type errors are not silently fixed as part of docking.
- This is still a trusted in-process component registry, not the planned permission-checked third-party plugin runtime.

## Final validation

Final run on 2026-11-12:

| Check                                                      | Outcome                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:unit:ci`                                        | **626 tests passed** in 29 files, including 78 new transfer tests and nine new floater-bound regressions.                                                                                                                                                                                                                                        |
| `pnpm exec playwright test docking.test.ts`                | **42 passed**: 21 docking scenarios in each of Chromium and WebKit.                                                                                                                                                                                                                                                                              |
| `pnpm test:e2e`                                            | **74 passed**, including docking, smoke, pagination/selection, and stylesheet compatibility across Chromium/WebKit.                                                                                                                                                                                                                              |
| `pnpm build`                                               | Passed as the Playwright web-server build step in the browser runs. Existing deprecated SvelteKit alias and large-bundle warnings remain.                                                                                                                                                                                                        |
| Focused `pnpm exec oxfmt --check …` / `pnpm exec oxlint …` | Passed for docking source, tests, and documentation (formatting); zero focused lint warnings/errors.                                                                                                                                                                                                                                             |
| `git diff --check`                                         | Passed.                                                                                                                                                                                                                                                                                                                                          |
| `pnpm check`                                               | **Still fails outside changed code:** `src/lib/components/Modal.svelte:4` uses an unsupported `$props` type argument; `src/lib/editor/Tab.svelte:26` omits required `proseMirror.editors`. Also reports five existing initial-value-capture warnings in the three unused generic DnD wrappers. No diagnostics in the new docking implementation. |

Not run: packaged Tauri application tests, actual touch-device tests, screen-reader testing, and the separate Storybook performance suite. Layout undo/persistence were deliberately not added. No dependencies, branches, or commits were created.
