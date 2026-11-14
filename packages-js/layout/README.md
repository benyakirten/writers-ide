# Workbench layout

`@writers-ide/layout` is a private, source-exported Svelte 5 library for movable toolbars. It owns ordered dock collections, item capacity, validated transfers and in-application floating geometry. It does not own your feature controls, editor, plugin system or application services.

The goal is to reuse the existing docking engine, not to introduce a different layout model. One bar groups ordered item IDs. Top/bottom docks use horizontal presentations; side docks use vertical presentations. Floaters retain either orientation. Each bar has three logical capacity units, not three guaranteed pixel-sized slots.

## Using it

The package is included in this repository's private pnpm workspace and consumed by name as `@writers-ide/layout`. Use a Svelte-aware TypeScript bundler with Svelte 5 and `@dnd-kit-svelte/core` installed as peers. Source files containing runes must be compiled by Svelte; this is not a precompiled JavaScript distribution. The package is MIT licensed and has no publication/build step or stable external SDK guarantee.

Create a workbench explicitly, usually during a host component's initialization. Every call gets independent collections, transfer-session state, floating root and, unless supplied explicitly, registry. There is no default/global workbench or implicit Svelte context. Keep separate workbenches under separate DnD providers; primitive IDs are scoped by their provider, not globally namespaced by the library.

### Minimal independent host

This deliberately small host uses buttons to relocate a toolbar. It needs no Writer's IDE services, ProseMirror objects, plugin contexts or feature components. Here `Component` is just a string selected by the host's renderer; a real application can use typed Svelte components or another presentation descriptor instead.

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

The host owns the DOM root's lifetime. Assign `floating.root`, observe size changes and call `fitToRoot()`; clear it and release observers on teardown. Collections and their derived items are Svelte-reactive. Label callbacks can read reactive locale state. Floating geometry methods accept browser elements/events; DOM measurements and resize methods require a browser, not an SSR layout engine.

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

`createWorkbench` requires `generateId`, `unknownItemTitle` and `newBarTitle` callbacks. IDs must be stable and unique within the host workbench. An optional `registry` intentionally shares registry metadata; an optional `createItems` adapts item construction (for example, preserving an existing application subclass). The injected item factory must use the same registry as the transfer services. These advanced options do not create a new security boundary.

`LayoutServices` contains `generateId`, `createItems` and `newBarTitle`. `TransferServices` contains the registry and the three collection instances plus `newBarTitle`. Direct class construction also requires explicit services; there are no hidden service defaults.

Presentation data is opaque to the engine. `items` resolves `{ id, title, size, Component }`, where `Component` has the host's section type (or is `null` when unavailable); additional section metadata remains accessible through `registry.items`. No Svelte component prop contract or plugin contract is imposed. Meaningful feature state belongs outside a presentation instance: preserving IDs and bar identity does not preserve component-local state across remounts.

### Capacity and missing items

- Unrecognized IDs cost one unit and resolve to the supplied fallback title and a null presentation.
- `registry.deregister(id, true)` releases presentations but retains both declared orientation costs. Repeated preservation does not lose retained metadata. Re-registering restores presentations and current costs; `clear()` releases both live and retained data.
- Duplicate registry IDs can appear in different bars but not within one bar.
- Whole-bar moves and orientation changes validate the destination total against three units (and any smaller item limit). Invalid changes never silently split or omit contents.
- The optional legacy `BarItems.maxSize` constructor parameter and low-level mutable collections are retained for compatibility; ordinary workbench bars use three units. Do not bypass transfer validation to implement host drag operations.

### Transfers

A `DockDragSource` identifies `kind: 'bar' | 'item'`, `location`, stable `barId` and, for items, `itemId`. A `DockDropTarget` is one of:

- `{ kind: 'bar', location, barId, index }`: item insertion into a bar;
- `{ kind: 'dock', location, index }`: an explicit collection gap, including an empty dock;
- `{ kind: 'floating', left, top }`: floating coordinates relative to the workbench root.

`canDrop(source, target)` is nonmutating. `drop(source, target)` revalidates before committing and returns success. Insertion indices are boundaries **before** source removal; same-container moves adjust them. Interior overflow is an invalid destination, never an implicit new bar or floater. Whole-bar transfers preserve bar/`BarItems` identity, grouping, order, title and remembered geometry. Extracting the last item removes the source container. Detaching retains orientation. Floating placement is bounded by the assigned root.

`moveMenu`, `relocateItem`, `nudge`, `swap`, and other compatibility methods retain their existing behavior. In particular relocation menus may choose the fitting last bar or create a bar, unlike pointer drops. `deleteBarIfEmpty` controls legacy `remove()`, not successful pointer/drop transfers.

## Optional drag primitives

`DockDraggable` wraps content and renders a separate button handle. Its `source` prop is typed metadata; `children` receives a handle snippet. It preserves handle-only activation, source data attributes and drag opacity. Supply `label` for an accessible/localized handle name.

`DockTarget` registers a typed `target`/`id` and takes an explicit `controller` with `canDrop(source, target)` and `isVertical(location, barId?)`; pass `layout.transfer` directly. It supports `children`, `class`, `style`, `disabled` and an optional localized `label`. Invalid item destinations stay registered so they cannot fall through to a different target. Stationary insertion slots grow their hit area with proximity without reflow. The primitive imports its palette CSS; `@writers-ide/layout/dock-colors.css` is also exported for host overlays.

Inside a host-owned `DndContext`, the basic composition is:

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

The host must supply nonzero insertion-slot sizes and compose its DnD provider, sensors, collision detection and commit/cancel callbacks. Read `event.active.data.source` and `event.over?.data.target`, then call `transfer.drop()` on release if a target exists. Do not mutate authoritative collections during hover. Full-workbench floating targets require host-calculated workbench-relative coordinates. The library does not choose a host's collision policy, previews or focus targets.

## Writer's IDE adapter and integration

The app state modules are compatibility facades over this implementation. `src/lib/editor/state/workbench.svelte.ts` supplies the app ID service, fallback label, default bar title, registry and `BarItems` constructor. The app registry extends generic metadata with its trusted plugin presentation and legacy component types; none of that flows back into the package. `src/lib/dnd/DockTarget.svelte` injects the app transfer controller; the other DnD facades forward the primitive and palette.

Remaining application adapters intentionally include:

- bar rendering, feature controls, relocation menus and rendering of unavailable items;
- `Editor.svelte` workbench composition, sensors, visible-surface collision policy, overlay, release descriptions/live announcements, keyboard focus restoration and tooltip suppression;
- translation, plugin activation and presentation lifecycle.

This extraction does not add persistence, layout undo, central tabs/splits, native floating windows, minimized-floater restore UI, scheduling, shortcuts, pagination or external plugin loading/isolation. Trusted in-process Svelte components remain trusted; packaging is not a sandbox.

The application facades and independent-host tests import `@writers-ide/layout` through the workspace dependency. The app palette adapter imports `@writers-ide/layout/dock-colors.css`. Consumers must preserve Svelte compilation of the package's source exports. The primitives use plain CSS, not Tailwind utility classes, so **no extra Tailwind scan source is currently required**.

The compatibility facades preserve the existing imports used by `Editor.svelte`, host contribution adapters and bar renderers. Those consumers do not need to construct a second workbench or change their rendering contracts.

## Validation

Run these commands from the repository root. Vitest discovers the library tests under the application's `src` tree; they exercise the package through its workspace import:

```sh
pnpm exec vitest run src/lib/testing/layout-library.svelte.test.ts
pnpm exec vitest run src/lib/editor/state/ src/lib/dnd/dock-feedback.test.ts
pnpm exec playwright test docking.test.ts docking-feedback.test.ts docking-destinations.test.ts --workers=2
```

The independent-host tests import only this package and Svelte/Vitest. Existing application state assertions remain unchanged. Real-browser docking tests cover gesture/geometry behavior; jsdom state tests cannot establish hit geometry, native WebView behavior, real touch hardware or complete accessibility.
