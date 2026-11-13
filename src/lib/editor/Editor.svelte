<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		DndContext,
		DragOverlay,
		KeyboardSensor,
		MouseSensor,
		TouchSensor,
		useSensor,
		useSensors,
		pointerWithin,
		type CollisionDetection,
		type DragEndEvent,
		type DragStartEvent,
		type MouseSensorOptions,
		type TouchSensorOptions,
		type Modifier,
	} from '@dnd-kit-svelte/core';
	import DockTarget from '$lib/dnd/DockTarget.svelte';
	import TransferHandler, {
		type DockDragSource,
		type DockDropTarget,
		type BarTransferLocation,
	} from './state/bar-transfer-handler.svelte';
	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte';
	import HorizontalBarState, { HorizontalBarPosition } from './state/horizontal-bar-state.svelte';
	import FloaterBarState from './state/floater-state.svelte';
	import MainView from './MainView.svelte';
	import VerticalBar from './bars/VerticalBar.svelte';
	import HorizontalBar from './bars/HorizontalBar.svelte';
	import FloaterBar from './bars/FloaterBar.svelte';
	import VerticalBaseBar from './bars/VerticalBaseBar.svelte';
	import HorizontalBaseBar from './bars/HorizontalBaseBar.svelte';
	import Pointer from '$lib/components/tooltip/Pointer.svelte';
	import Toaster from '$lib/components/toaster/Toaster.svelte';
	import PageLayout from './state/page-layout.svelte';
	import Paginator from '$lib/components/pagination/Paginator.svelte';

	let active = $state<DockDragSource | null>(null);
	let announcement = $state('');
	let previewLabel = $state('');
	onMount(() => {
		const root = FloaterBarState.root;
		if (!root) {
			return;
		}
		const observer = new ResizeObserver(() => FloaterBarState.fitToRoot());
		observer.observe(root);
		return () => observer.disconnect();
	});
	const sensors = useSensors(
		useSensor<MouseSensorOptions>(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor<TouchSensorOptions>(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 8 },
		}),
		useSensor(KeyboardSensor),
	);

	// Anchor the compact preview to the activator, not the source bar's potentially huge rect.
	const pointerPreview: Modifier = ({ transform, activatorEvent, activeNodeRect }) => {
		if (!activeNodeRect) {
			return transform;
		}
		let x = transform.x + 18;
		let y = transform.y + 20;
		if (activatorEvent instanceof MouseEvent) {
			x += activatorEvent.clientX - activeNodeRect.left;
			y += activatorEvent.clientY - activeNodeRect.top;
		} else if (
			typeof TouchEvent !== 'undefined' &&
			activatorEvent instanceof TouchEvent &&
			activatorEvent.touches[0]
		) {
			x += activatorEvent.touches[0].clientX - activeNodeRect.left;
			y += activatorEvent.touches[0].clientY - activeNodeRect.top;
		}
		const width = Math.min(280, window.innerWidth - 16);
		return {
			...transform,
			x:
				Math.max(8, Math.min(activeNodeRect.left + x, window.innerWidth - width - 8)) -
				activeNodeRect.left,
			y:
				Math.max(8, Math.min(activeNodeRect.top + y, window.innerHeight - 120)) -
				activeNodeRect.top,
		};
	};

	// Prefer specific insertion/interior targets over the encompassing floating surface.
	const collisionDetection: CollisionDetection = (args) => {
		const source = args.active.data?.source as DockDragSource | undefined;
		const candidates = {
			...args,
			droppableContainers: args.droppableContainers.filter(
				(container) => source?.kind !== 'bar' || container.data?.target?.kind !== 'bar',
			),
		};
		const hits = args.pointerCoordinates
			? pointerWithin(candidates)
			: pointerWithin({
					...candidates,
					pointerCoordinates: {
						x: args.collisionRect.left + args.collisionRect.width / 2,
						y: args.collisionRect.top + args.collisionRect.height / 2,
					},
				});
		// Respect the visible surface before considering smaller insertion targets beneath it.
		if (args.pointerCoordinates) {
			const { x, y } = args.pointerCoordinates;
			const topElement = document
				.elementsFromPoint(x, y)
				.find((element) => !element.closest('.drag-preview') && !!element.closest('.overlay'));
			const surface = topElement?.closest('.floater, [data-dock], .overlay');
			if (surface) {
				const visibleHits = hits.filter((hit) => {
					const container = candidates.droppableContainers.find((entry) => entry.id === hit.id);
					return (
						container?.data?.target?.kind === 'floating' ||
						container?.node?.closest('.floater, [data-dock], .overlay') === surface
					);
				});
				hits.splice(0, hits.length, ...visibleHits);
			}
		}
		return hits.sort((a, b) => {
			const first = args.droppableRects.get(a.id);
			const second = args.droppableRects.get(b.id);
			return (
				(first ? first.width * first.height : Infinity) -
				(second ? second.width * second.height : Infinity)
			);
		});
	};

	function resize(event: MouseEvent) {
		if (!active) {
			VerticalBarState.resize(event);
			HorizontalBarState.resize(event);
		}
	}
	function endResize() {
		VerticalBarState.endResize();
		HorizontalBarState.endResize();
	}
	function handleDragStart(event: DragStartEvent) {
		active = event.active.data?.source ?? null;
		if (active) {
			const bar = TransferHandler.getBar(active.location, active.barId);
			previewLabel =
				active.kind === 'item'
					? (bar?.data.items.find((item) => item.id === active?.itemId)?.title ?? 'Bar item')
					: bar?.title || bar?.data.items.map((item) => item.title).join(' · ') || 'Empty toolbar';
			announcement = '';
			VerticalBarState.resizedSection = null;
			HorizontalBarState.resizedSection = null;
		}
	}
	function cancelDrag() {
		active = null;
		announcement = 'Move cancelled.';
	}
	function barsAt(location: BarTransferLocation) {
		if (location === 'floating') {
			return FloaterBarState.bars;
		}
		return TransferHandler.isVertical(location)
			? VerticalBarState.bars(location as VerticalBarPosition)
			: HorizontalBarState.bars(location as HorizontalBarPosition);
	}

	async function handleDragEnd(event: DragEndEvent) {
		const source = active;
		let target = event.over?.data?.target as DockDropTarget | undefined;
		const root = FloaterBarState.root;
		if (source && target?.kind === 'floating' && root) {
			const rect = root.getBoundingClientRect();
			const translated = event.active.rect.translated;
			const initial = event.active.rect.initial;
			target = {
				kind: 'floating',
				left: (translated?.left ?? (initial?.left ?? rect.left) + event.delta.x) - rect.left,
				top: (translated?.top ?? (initial?.top ?? rect.top) + event.delta.y) - rect.top,
			};
		}
		const location = target?.kind === 'floating' ? 'floating' : target?.location;
		const previousIds = new Set(location ? barsAt(location).map((bar) => bar.id) : []);
		const moved = !!source && !!target && TransferHandler.drop(source, target);
		announcement = moved
			? 'Toolbar layout updated.'
			: 'Move cancelled: the destination is unavailable or has insufficient capacity.';
		active = null;
		if (moved && source && target && location && event.activatorEvent instanceof KeyboardEvent) {
			const barId =
				source.kind === 'bar'
					? source.barId
					: target.kind === 'bar'
						? target.barId
						: barsAt(location).find((bar) => !previousIds.has(bar.id))?.id;
			await tick();
			requestAnimationFrame(() => {
				const wrapper = Array.from(
					document.querySelectorAll<HTMLElement>('[data-dock-source-kind]'),
				).find(
					(node) =>
						node.dataset.dockSourceKind === source.kind &&
						node.dataset.dockBarId === barId &&
						(source.kind === 'bar' || node.dataset.dockItemId === source.itemId),
				);
				wrapper?.querySelector<HTMLButtonElement>('button.dock-grip')?.focus();
			});
		}
	}
</script>

{#snippet horizontalDock(position: HorizontalBarPosition)}
	{@const bars = HorizontalBarState.bars(position)}
	<div class="horizontal-dock" data-dock={position}>
		{#each bars as bar, index (bar.id)}
			<DockTarget
				id={`gap-${position}-${index}`}
				target={{ kind: 'dock', location: position, index }}
				class="dock-gap"
				style="height: 28px; width: 100%;"
			/>
			<HorizontalBar
				{bar}
				{position}
				{index}
				items={bar.data.items}
				canMoveForward={index !== bars.length - 1}
			/>
		{/each}
		<DockTarget
			id={`gap-${position}-${bars.length}`}
			target={{ kind: 'dock', location: position, index: bars.length }}
			class="dock-gap"
			style="height: 28px; width: 100%;"
		/>
	</div>
{/snippet}

{#snippet verticalDock(position: VerticalBarPosition)}
	{@const bars = VerticalBarState.bars(position)}
	<div class="vertical-dock" data-dock={position}>
		{#each bars as bar, index (bar.id)}
			<DockTarget
				id={`gap-${position}-${index}`}
				target={{ kind: 'dock', location: position, index }}
				class="dock-gap"
				style="width: 28px; height: 100%; flex-shrink: 0;"
			/>
			<VerticalBar
				{bar}
				{position}
				{index}
				items={bar.data.items}
				canMoveForward={index !== bars.length - 1}
			/>
		{/each}
		<DockTarget
			id={`gap-${position}-${bars.length}`}
			target={{ kind: 'dock', location: position, index: bars.length }}
			class="dock-gap"
			style="width: 28px; height: 100%; flex-shrink: 0;"
		/>
	</div>
{/snippet}

<!-- Docking targets belong to the fixed workbench; scrolling source toolbars moves their handles. -->
<DndContext
	autoScroll={false}
	{sensors}
	{collisionDetection}
	onDragStart={handleDragStart}
	onDragEnd={handleDragEnd}
	onDragCancel={cancelDrag}
>
	<Paginator />
	<Toaster />
	<Pointer />
	<DockTarget
		id="workbench-floating"
		target={{ kind: 'floating', left: 0, top: 0 }}
		style="width: 100vw; height: 100vh;"
	>
		<div
			bind:this={FloaterBarState.root}
			class="overlay"
			class:drag-active={!!active}
			onmouseupcapture={endResize}
			onmousemovecapture={resize}
			style:--editor-height={`${PageLayout.pageHeight}${PageLayout.units}`}
			style:--editor-width={`${PageLayout.pageWidth}${PageLayout.units}`}
			style:--editor-x-padding={`${PageLayout.pageXMargin}${PageLayout.units}`}
			style:--editor-y-padding={`${PageLayout.pageYMargin}${PageLayout.units}`}
		>
			{@render horizontalDock(HorizontalBarPosition.WindowBlockStart)}
			<HorizontalBaseBar />
			{#each FloaterBarState.visibleBars as bar, index (bar.id)}
				<FloaterBar {bar} {index} items={bar.data.items} />
			{/each}
			<div class="main-container">
				{@render verticalDock(VerticalBarPosition.InlineStart)}
				<VerticalBaseBar />
				<main class="main"><MainView /></main>
				{@render verticalDock(VerticalBarPosition.InlineEnd)}
			</div>
			{@render horizontalDock(HorizontalBarPosition.WindowBlockEnd)}
		</div>
	</DockTarget>
	<DragOverlay dropAnimation={null} modifiers={[pointerPreview]} zIndex={10000}>
		{#if active}
			<div class="drag-preview" aria-hidden="true">
				<div class="preview-heading">
					<span class="preview-grip">⠿</span><span
						>{active.kind === 'bar' ? 'Move toolbar' : 'Move item'}</span
					>
				</div>
				<strong>{previewLabel}</strong>
				<small>Drop on a highlighted target · Esc to cancel</small>
			</div>
		{/if}
	</DragOverlay>
</DndContext>
<div class="sr-only" role="status" aria-live="polite">{announcement}</div>

<style>
	.overlay {
		overflow: clip;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		position: relative;
	}
	.main-container {
		min-height: 0;
		min-width: 0;
		flex: 1;
		display: flex;
		position: relative;
	}
	.main {
		min-height: 0;
		min-width: 0;
		flex: 1;
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.vertical-dock {
		display: flex;
		min-height: 0;
	}
	.horizontal-dock {
		flex-shrink: 0;
	}
	.drag-preview {
		box-sizing: border-box;
		width: min(280px, calc(100vw - 16px));
		padding: 12px 16px;
		background: Canvas;
		color: CanvasText;
		border: 3px solid Highlight;
		outline: 2px solid Canvas;
		border-radius: 10px;
		box-shadow:
			0 10px 30px color-mix(in srgb, CanvasText 35%, transparent),
			0 0 0 4px color-mix(in srgb, Highlight 30%, transparent);
		pointer-events: none;
	}
	.preview-heading {
		display: flex;
		align-items: center;
		gap: 8px;
		color: Highlight;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.preview-grip {
		font-size: 20px;
		line-height: 1;
	}
	.drag-preview strong {
		display: block;
		margin-top: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.drag-preview small {
		display: block;
		margin-top: 8px;
		font-size: 11px;
		line-height: 1.4;
	}
	@media (forced-colors: active) {
		.drag-preview {
			outline: 2px solid CanvasText;
		}
	}
</style>
