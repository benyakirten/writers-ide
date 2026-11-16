# Workbench layout

`@writers-ide/layout` helps a Svelte 5 host arrange movable toolbars around its main content. Create a workbench, register the tools it can display, and render its bar collections. Use its transfer API to validate and commit moves.

A **bar item** is one tool's presentation. A **bar** groups ordered item IDs. A **dock** holds bars at a workbench edge. Top and bottom docks use horizontal presentations. Side docks use vertical presentations. A floating bar stays inside the application and can use either orientation.

Each bar has three logical capacity units. These describe item cost, not guaranteed pixel-sized slots. For example, a tool can cost one unit horizontally and two vertically. Moving its bar to a side dock must use the vertical cost.

This library provides the docking engine. It owns ordered dock collections, capacity checks, validated transfers, and floating geometry. Your host still owns rendering, feature controls, editor integration, plugin activation, and application services. A feature plugin may contribute a toolbar; this library arranges it but is not itself a feature plugin.

## Using it

Import the package by name as `@writers-ide/layout` from this repository's private pnpm workspace. Use a Svelte-aware TypeScript bundler. Install Svelte 5 and `@dnd-kit-svelte/core` as peer dependencies.

The package exports source, not precompiled JavaScript. Runes are Svelte's compiler syntax for reactive state, such as `$state`. Svelte must compile files that contain them.

The package is MIT licensed. It has no publication or build step and does not promise a stable external SDK.

Create a workbench explicitly, usually during a host component's initialization. Each call gets independent collections, transfer-session state, and a floating root. It also gets an independent registry unless you supply one.

There is no default or global workbench and no implicit Svelte context. Put separate workbenches under separate drag-and-drop (DnD) providers. Primitive IDs belong to their provider; the library does not add a global namespace.

### Minimal independent host

This complete Svelte component uses buttons to move a toolbar. It needs no Writer's IDE services, ProseMirror objects, plugin contexts, or feature components.

Here, `Component` is a string displayed by the host's renderer. A larger host can instead store typed Svelte components or another presentation descriptor.

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createWorkbench,
		HorizontalBarPosition as H,
		type BarItemSection,
	} from '@writers-ide/layout';

	type Section = BarItemSection & { Component?: string };
	const layout = createWorkbench<Section>({
		generateId: () => crypto.randomUUID(),
		unknownItemTitle: () => 'Unavailable tool',
		newBarTitle: () => 'Tools',
	});
	layout.registry.register(
		{
			title: 'Search',
			horizontal: { size: 1, Component: 'Search horizontally' },
			vertical: { size: 2, Component: 'Search vertically' },
		},
		'search',
	);
	layout.horizontal.add({ data: ['search'] }, H.WindowBlockStart);

	let root: HTMLDivElement;
	onMount(() => {
		layout.floating.root = root;
		const observer = new ResizeObserver(() => layout.floating.fitToRoot());
		observer.observe(root);
		return () => {
			observer.disconnect();
			layout.floating.root = null;
		};
	});
</script>

<div bind:this={root} class="workbench">
	{#each layout.horizontal.windowBlockStart as bar (bar.id)}
		<section>
			{#each bar.data.items as item (item.id)}
				<span>{item.Component ?? item.title}</span>
			{/each}
			<button
				onclick={() =>
					layout.transfer.drop(
						{ kind: 'bar', location: H.WindowBlockStart, barId: bar.id },
						{ kind: 'floating', left: 20, top: 60 },
					)}>Float</button
			>
		</section>
	{/each}
	<p>Your main application content</p>
	{#each layout.floating.visibleBars as bar (bar.id)}
		<section
			class="floating"
			style:left={`${bar.position.left}px`}
			style:top={`${bar.position.top}px`}
			style:width={`${bar.position.width}px`}
			style:height={`${bar.position.height}px`}
			style:z-index={bar.z}
		>
			<h2>{bar.title}</h2>
			{#each bar.data.items as item (item.id)}
				<span>{item.Component ?? item.title}</span>
			{/each}
			<button onclick={() => layout.transfer.moveMenu('floating', bar.id, H.WindowBlockStart)}
				>Dock at top</button
			>
		</section>
	{/each}
</div>

<style>
	.workbench {
		position: relative;
		height: 500px;
		overflow: hidden;
	}
	.floating {
		position: absolute;
		background: Canvas;
		border: 1px solid CanvasText;
	}
</style>
```

The host owns the DOM root's lifetime. Assign `floating.root`, observe size changes, and call `fitToRoot()`. On teardown, clear the root and disconnect observers, as above.

Collections and their derived items are Svelte-reactive, so Svelte can track their changes. Label callbacks can read reactive locale state.

Floating geometry methods accept browser elements and events. DOM measurements and resize methods require a browser. Server-side rendering cannot measure the layout.

## Main APIs

| API                                                                 | Responsibility                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWorkbench(options)`                                          | Compose `registry`, `horizontal`, `vertical`, `floating`, `transfer`, plus explicit `services`/`transferServices` for advanced adapters.            |
| `BarItemRegistry<S>(generateId)`                                    | Register/remove item descriptions and orientation costs. `S` extends `{ size: 1 \| 2 \| 3; Component?: unknown }` and may carry host-only metadata. |
| `BarItems<S>(registry, unknownTitle, vertical, ids?, maxSize?)`     | Ordered unique IDs, resolved presentations, available capacity, item edits and orientation validation.                                              |
| `HorizontalBarState<S>(services, windowMinSize?, editorMinSize?)`   | Top/bottom collections, visibility and resize mechanics.                                                                                            |
| `VerticalBarState<S>(services, minSize?, inlineStart?, inlineEnd?)` | Logical side collections, direction-aware visibility/resize mechanics.                                                                              |
| `FloaterBarState<S>(services)`                                      | Floating positions, size bounds, stacking, titles, minimization and orientation.                                                                    |
| `BarTransferHandler<S>(transferServices, deleteBarIfEmpty?)`        | Typed, capacity-validated docking plus existing relocation/nudge helpers.                                                                           |
| `getDockColor(target)`                                              | Destination category independent of a workbench instance.                                                                                           |

### Construction and dependencies

`createWorkbench` requires `generateId`, `unknownItemTitle`, and `newBarTitle` callbacks. IDs must be stable and unique within the host workbench. Its registry maps item IDs to their titles, orientation costs, and presentations.

Supply `registry` only when you intend to share registry metadata. Supply `createItems` to customize item construction, for example to preserve an existing application subclass. That factory must use the same registry as the transfer services. These options let the host supply the objects the engine uses. They do not create security isolation.

`LayoutServices` contains `generateId`, `createItems`, and `newBarTitle`. `TransferServices` contains the registry, the three collection instances, and `newBarTitle`. If you construct the classes directly, pass their services explicitly. There are no hidden service defaults.

### Presentation and feature state

The engine does not interpret presentation data. `items` resolves `{ id, title, size, Component }`. `Component` has the host's section type, or is `null` when unavailable. Additional section metadata remains available through `registry.items`. The engine imposes no Svelte component prop contract or plugin contract.

Keep meaningful feature state outside a presentation instance. A move can remount a component. Preserving item IDs and bar identity does not preserve arbitrary component-local state. The host owns presentation mounting and cleanup. Layout transfers do not define how arbitrary feature state moves between component instances. They also do not save data for later sessions.

### Capacity and missing items

Unknown item IDs cost one unit. They resolve to the supplied fallback title and a null presentation. The same registry ID can appear in different bars, but not twice within one bar.

`registry.deregister(id, true)` releases presentations while retaining both declared orientation costs. For example, disabling a tool that costs two vertical units does not free those units for another tool. Repeated preservation keeps the metadata. Re-registering restores the presentations and current costs. `clear()` releases both live and retained data; it is not a persistence API.

Whole-bar moves and orientation changes check the destination total against three units and any smaller item limit. Invalid changes never silently split a bar or omit its contents.

`BarItems` accepts a `maxSize` constructor parameter, and its low-level collections are mutable. Ordinary workbench bars use three units. Host drag operations must use transfer validation rather than bypassing it.

### Transfers

A `DockDragSource` identifies `kind: 'bar' | 'item'`, `location`, stable `barId` and, for items, `itemId`. A `DockDropTarget` is one of:

- `{ kind: 'bar', location, barId, index }`: item insertion into a bar;
- `{ kind: 'dock', location, index }`: an explicit collection gap, including an empty dock;
- `{ kind: 'floating', left, top }`: floating coordinates relative to the workbench root.

### Validate, then commit

`canDrop(source, target)` checks a move without changing state. `drop(source, target)` checks again before committing and returns whether it succeeded. Hover feedback must not change the collections that store the actual layout.

Insertion indices name boundaries before source removal. Same-container moves adjust those indices. For example, moving an item to a later boundary in its own bar accounts for the slot removed at its old position.

A bar interior without enough capacity is an invalid destination. It does not implicitly create another bar or floater. Use an explicit dock gap to request a new bar.

### What a move preserves

Whole-bar transfers preserve bar and `BarItems` identity, grouping, order, title, and remembered geometry. Moving the last item out removes the source container. Detaching a bar keeps its orientation. Floating placement stays within the assigned root.

These are in-memory layout guarantees. They do not save layout or feature data, and they do not guarantee that mounted component instances survive.

`moveMenu`, `relocateItem`, `nudge`, and `swap` support relocation menus and direct layout operations. A relocation menu may choose the last fitting bar or create a bar. Pointer drops instead need an explicit destination. `deleteBarIfEmpty` controls `remove()`. It does not control successful pointer/drop transfers.

## Optional drag primitives

`DockDraggable` wraps content and renders a separate button handle. Pass typed source metadata through `source`. Its `children` snippet receives a handle snippet to render. Only the handle starts a drag. Source data attributes and drag opacity are preserved. Supply `label` for an accessible, localized handle name.

`DockTarget` registers a typed `target` and `id`. It needs a `controller` with `canDrop(source, target)` and `isVertical(location, barId?)`. Pass `layout.transfer` directly. Supported props include `children`, `class`, `style`, `disabled`, and an optional localized `label`.

Invalid item destinations stay registered. This prevents a rejected destination from falling through to a different target behind it. Insertion slots stay in place while their hit areas grow as the pointer approaches. That growth does not reflow the layout.

The primitive imports its palette CSS. Hosts can also import `@writers-ide/layout/dock-colors.css` for overlays.

The following is a template excerpt, not a complete drag host. Add `DockTarget` and `DockDraggable` to the earlier component's imports from `@writers-ide/layout`. Place this inside your host-owned `DndContext`. The draggable belongs inside the top-bar loop, where `bar` is defined. The target belongs at the end of that dock:

```svelte
<DockTarget
	id="top-end"
	controller={layout.transfer}
	target={{
		kind: 'dock',
		location: H.WindowBlockStart,
		index: layout.horizontal.windowBlockStart.length,
	}}
/>

<DockDraggable source={{ kind: 'bar', location: H.WindowBlockStart, barId: bar.id }}>
	{#snippet children(handle)}
		{@render handle()}
		<!-- Render the host's items here. -->
	{/snippet}
</DockDraggable>
```

The host must give insertion slots nonzero sizes. It also supplies the DnD provider and input sensors, which recognize mouse, touch, or keyboard drag gestures. Collision detection chooses the destination under a drag. The host supplies that policy and the commit/cancel callbacks too.

On release, read `event.active.data.source` and `event.over?.data.target`. If a target exists, call `layout.transfer.drop()`.

For a full-workbench floating target, the host calculates coordinates relative to the workbench root. The library does not choose collision policy, drag previews, or focus targets. Those choices belong to the host, not the feature being moved.

## Writer's IDE adapter and integration

The app state modules delegate layout operations to this library. `src/lib/editor/state/workbench.svelte.ts` supplies the app ID service, fallback label, default bar title, registry, and `BarItems` constructor.

The app registry adds trusted plugin presentations and application component types to the generic metadata. The package does not import those app types. `src/lib/dnd/DockTarget.svelte` supplies the app transfer controller. The other DnD facades forward the primitive and palette.

Remaining application adapters intentionally include:

- bar rendering, feature controls, relocation menus and rendering of unavailable items;
- `Editor.svelte` workbench composition and input sensors;
- collision rules that choose visible destinations rather than hidden surfaces behind them;
- drag overlays, release descriptions, and live announcements for assistive technology;
- keyboard focus restoration and tooltip suppression;
- translation, plugin activation and presentation lifecycle.

The library does not provide persistence or layout undo. It also does not provide central tabs/splits, native floating windows, minimized-floater restore UI, scheduling, shortcuts, pagination, or external plugin loading and isolation. Svelte components run as trusted in-process code. Putting them in a package does not create a sandbox.

Application facades and independent-host tests import `@writers-ide/layout` through the workspace dependency. The app palette adapter imports `@writers-ide/layout/dock-colors.css`.

Consumers must compile the package's source exports with Svelte. The primitives use plain CSS rather than Tailwind utility classes. No extra Tailwind scan source is currently required.

`Editor.svelte`, host contribution adapters, and bar renderers share the application workbench through the app state modules.

## Validation

Run these commands from the repository root. Vitest discovers the library tests under the application's `src` tree; they exercise the package through its workspace import:

```sh
pnpm exec vitest run src/lib/testing/layout-library.svelte.test.ts
pnpm exec vitest run src/lib/editor/state/ src/lib/dnd/dock-feedback.test.ts
pnpm exec playwright test docking.test.ts docking-feedback.test.ts docking-destinations.test.ts --workers=2
```

Independent-host tests import only this package and Svelte/Vitest.

Real-browser docking tests cover gestures and geometry. jsdom state tests cannot establish hit geometry. Neither these state tests nor the browser suite establish native WebView behavior, real touch-hardware behavior, or complete accessibility.
