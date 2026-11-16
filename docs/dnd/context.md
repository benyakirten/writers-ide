# Bars, docking, and drag-and-drop context

This guide explains how feature toolbars move around the workspace. It covers docking at workspace edges, floating bars, capacity limits and drag feedback. Start here before changing placement behavior or reusing the layout library.

## Status and scope

Core docking shipped in [#78](https://github.com/benyakirten/writers-ide/pull/78). [#79](https://github.com/benyakirten/writers-ide/pull/79) merged on 2026-11-13 and removed highlighting from the main floating drop surface. [#80](https://github.com/benyakirten/writers-ide/pull/80) merged on 2026-11-14. It added bundled plugin presentations and preserved capacity for disabled items.

Stage 2 library extraction and feature-neutral presentation props are implemented on `bh/phase-2-plugin-transition`. They are **unmerged, with no known PR or merge date**. The [change log](change-log.md) separates this work from merged history.

This topic covers feature bars, item grouping, edge docking, floating overlays and dragging. It does not cover central tabs or split views. These components are trusted Svelte code running inside the app. They are not an isolated third-party plugin platform. The bundled formatting plugin uses the [plugin host](../plugins/context.md).

## Philosophy and approved behavior

A **bar item** is one feature's presentation, such as a set of formatting controls. A **bar** holds an ordered group of items. A **dock** holds bars along one edge of the **workbench**, the whole workspace around the central views. Docking is relative to that whole workspace, not one central view.

Every bar has **three logical capacity units**. A unit is a declared share of capacity, not a square or a promise that controls fit in a given number of pixels. Items declare a cost for each orientation. A bar accepts items only when their total cost is at most three.

**Orientation** means horizontal or vertical arrangement. Top and bottom docks use horizontal presentations. Side docks use vertical presentations. An item supplies a presentation for each arrangement and may assign them different costs.

A **floating bar**, or floater, is an overlay inside the app. It is not a native operating-system window. It can use either orientation. Detaching a bar keeps its source orientation.

Whole bars and individual items have separate drag handles. Using a feature control, editing a title or resizing a bar must not start a drag.

## Transfer contracts and rationale

The transfer handler owns committed layout changes. Drag-and-drop supplies a typed source and proposed destination. `canDrop()` checks validity without changing state. `drop()` checks again before committing. Sources identify bars by stable IDs, not collection indexes that may change during a move.

Drop behavior is explicit:

- Drop an item inside a bar or at an item boundary with capacity to insert it there.
- Drop an item into a bar without capacity to cancel the move. It must not fall back to floating or create a bar implicitly.
- Drop an item into an explicit dock gap or an empty dock to create a bar for it.
- Drop a whole bar into a dock gap to move it intact. It must not merge or split.
- Drop in free workbench space to create or reposition a floater.
- Press Escape to cancel. A release delivered outside the workbench also cancels. Neither changes the contents.

Capacity is calculated using the **destination orientation**. Reject a whole-bar move or floating orientation change if its new cost exceeds three units. Never omit items to make it fit.

Insertion indexes describe boundaries before removing the source. Reordering within one bar adjusts the boundary after removal. Capacity checks exclude the moving item so it is not counted twice.

A whole-bar move preserves the bar and `BarItems` collection identities. It also preserves item order, title and remembered docked/floating geometry. Removing the last item removes the empty source bar. An item registry ID may appear in different bars, but not twice in one bar. The registry associates IDs with presentations and orientation costs.

Disabling a contributed toolbar removes its live presentation but keeps placement IDs and declared costs. A missing-item placeholder reserves that capacity. Disabling and re-enabling an item therefore cannot create temporary spare capacity that later overfills the bar. Registry `clear()` releases retained metadata. This is not durable layout storage.

Feature state should live outside presentation instances. Stable placement IDs do not preserve arbitrary component-local state when Svelte unmounts and mounts a component again.

Relocation menus use the same validated transfer API. They may choose a fitting final bar or create a new one as a convenience. Pointer drops require an explicit gap to create a bar. Older directional item nudges remain separate operations.

## Interaction and feedback

The installed `@dnd-kit-svelte` packages handle drag gestures, including floating movement. Committed layout state does not change during hover. Only a lightweight preview moves. This avoids mounting duplicate feature components and subscriptions. It also avoids repeatedly resizing the editor and triggering pagination during a drag.

**Activation and targets.** Mouse dragging starts after six pixels of movement. Touch requires a 200 ms hold with eight pixels of tolerance. Keyboard dragging and relocation menus are also available.

Persistent insertion slots reserve 28 px in docks and 16 px between items. Within 64 px of a target, its actual hit area grows proportionally by up to 12 px per side along its narrow axis. The hit area grows inside a stationary slot, without shifting layout. Horizontal item sizing reserves insertion space before distributing capacity units. The workbench clips target growth at viewport edges.

**Destination feedback.** Eligible destinations stay highlighted while dragging. Side/vertical docks use blue. Top/bottom horizontal docks use yellow. Floating-bar item targets use red. Color describes the destination, not the shape of the insertion strip.

The main workbench stays unhighlighted but still accepts floating drops. A red preview accent and release description explain floating placement without tinting the editor. Text and outlines carry meaning without color alone. A hovered invalid target shows a rejection outline and cancellation message. Forced-colors mode uses system highlight colors.

**Preview and release text.** A high-contrast preview labels the source and follows the pointer beside the activator. It stays inside the viewport and includes an Escape hint. Its accent follows the destination. It is not another live feature component.

Release text describes bar placement, item insertion or reordering, new-bar creation, floating movement, unchanged order, or cancellation. It includes the dock side and insertion position where applicable. It uses the same `canDrop()` check as commit. A polite live region, which lets assistive technology announce updates, exposes the same text for keyboard use.

**Tooltips.** Ordinary app tooltips are suppressed during a bar/item drag. The tooltip service uses reference-counted suppression leases. Each lease keeps suppression active until released. Activation dismisses open or pending tooltips and discards new requests. Drop, cancellation and editor teardown release the drag's lease. Discarded requests are not replayed. A fresh hover or focus resumes normal tooltips. This keeps tooltips from covering the release description.

**Overlaps and focus.** Pointer collision checks choose the visible surface before its insertion or interior targets. This prevents drops into hidden overlapping floaters. An invalid visible target does not fall through to another destination.

Docking auto-scroll is disabled. Reaching an edge target must not scroll the source toolbar and clip its handle. Successful keyboard moves restore focus to the destination handle. Floating geometry is clamped back into bounds after size or workbench changes. Guarded writes avoid repeated observer updates when values have not changed.

## Source and test entry points

Paths below are repository-relative.

State ownership on the working branch is split as follows:

- Private `@writers-ide/layout` owns reusable registry/capacity mechanics, item/bar state, transfers, floating geometry, feedback and drag/target primitives. Its entry points are `packages-js/layout/index.ts` and `packages-js/layout/src/`. `createWorkbench` receives explicit registry, ID, title and item-factory dependencies. Independent instances do not share app state.
- `src/lib/editor/state/workbench.svelte.ts` owns the app compatibility instance. Existing state paths adapt or re-export it. The app still owns custom feature rendering and workbench composition.
- `src/lib/editor/Editor.svelte` composes docks, sensors, collision handling, preview, commit/cancel and keyboard focus.
- Features own meaningful feature state outside their presentations. The layout engine owns placement, not arbitrary component-local state.

Other source entry points:

- `src/lib/dnd/DockDraggable.svelte` and `DockTarget.svelte` wrap package primitives and bind the app transfer controller. Older generic wrappers are unused experiments.
- `src/lib/dnd/dock-feedback.ts` and `dock-colors.css` adapt package feedback and colors for the app.
- `@writers-ide/components` owns reusable tooltip state, its provider and suppression leases. `src/lib/services/tooltip.svelte.ts` supplies the shared app manager. The route provides it around `Editor` with `renderPointer={false}` because the app keeps its own pointer.
- `src/lib/editor/bars/` renders docked/floating bars, item boundaries, relocation menus, orientation controls and resizing.
- `src/lib/editor/state/bar-transfer-handler.svelte.ts` exposes sources, targets, `getBar()`, `isVertical()`, `canDrop()`, `drop()` and menu transfers.
- `src/lib/editor/state/bar-items.svelte.ts` and `bar-item-registry.svelte.ts` expose item IDs, orientation costs/components, capacity and fallback rendering.
- `src/lib/editor/state/horizontal-bar-state.svelte.ts`, `vertical-bar-state.svelte.ts` and `floater-state.svelte.ts` expose geometry, collections, stacking, orientation and bounds.

`src/lib/editor/prosemirror/menu/basic/` owns the bundled formatting plugin. Its horizontal and vertical presentations use copied state summaries and shared controls. `defineSveltePresentation(component, props)` supplies typed, explicit feature props. Components receive the dependencies supplied by the feature. Formatting services belong to that feature.

On the current branch, `createFormattingPlugin()` resolves the required word-processing provider and creates its feature-scoped service per activation. The feature-local scope helper owns subscriptions and revocation. These boundaries do not change placement or capacity rules and do not add general component-state transfer. See [plugin context](../plugins/context.md) and the [feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md).

Test entry points:

- `src/lib/testing/layout-library.svelte.test.ts` and `components-library.svelte.test.ts` cover injected dependencies, independent state and explicit tooltip providers.
- `src/lib/editor/state/dock-transfer.svelte.test.ts` and the bar/item/registry/floater state tests cover transfer rules, preservation, capacity, ordering and bounds.
- `e2e/docking.test.ts`, `e2e/docking-feedback.test.ts` and `e2e/docking-destinations.test.ts` cover Chromium/WebKit geometry and gestures. They check cancellation, focus, overlaps, target visibility, proximity hit areas, layout stability, colors, descriptions and tooltip suppression/resumption.
- `src/lib/dnd/dock-feedback.test.ts` covers descriptions and classification, including right-to-left layouts, insertion boundaries and invalid moves.
- `src/lib/services/tooltip.svelte.test.ts` covers suppression lifetime, pending timers, nested leases and fresh requests.

Use [CONTRIBUTING.md](../../CONTRIBUTING.md) for validation commands. Start with focused unit and browser tests. Real browsers are necessary for hit geometry. Recorded results are historical evidence, not a guarantee that a new checkout passes.

## Limitations and open questions

- Layout persistence and layout undo are out of scope. Layout changes must not enter ProseMirror document history. Native floating windows, arbitrary splits and tab-group docking are not implemented here.
- Minimized floaters still lack a completed restore UI.
- There is no general plugin lifecycle contract for transferring component-local state.
- Logical capacity does not guarantee visual fit after resizing, translation or larger text.
- Native out-of-window event loss, packaged Tauri WebViews, real touch hardware and comprehensive screen-reader behavior need separate validation. Playwright engine tests are not substitutes.
- Development/base controls are fixed scaffolding, not draggable feature bars. `HorizontalBaseBar.svelte` creates bars and the initial menu. It forwards `onplugins` to open the route-owned manager dialog. `VerticalBaseBar.svelte` contains test controls.
