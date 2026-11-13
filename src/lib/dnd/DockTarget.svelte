<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		useDndContext,
		useDndMonitor,
		useDroppable,
		type DragMoveEvent,
		type DragStartEvent,
	} from '@dnd-kit-svelte/core';
	import TransferHandler, {
		type DockDragSource,
		type DockDropTarget,
	} from '$lib/editor/state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '$lib/editor/state/horizontal-bar-state.svelte';

	let {
		id,
		target,
		children,
		class: className = '',
		style = '',
		disabled = false,
	}: {
		id: string;
		target: DockDropTarget;
		children?: Snippet;
		class?: string;
		style?: string;
		disabled?: boolean;
	} = $props();

	const context = $derived(useDndContext());
	const source = $derived(context.active?.data?.source as DockDragSource | undefined);
	// Invalid item targets stay registered: rejecting a full bar must not float the item.
	const inactive = $derived(disabled || (target.kind === 'bar' && source?.kind === 'bar'));
	const active = $derived(!!source && !inactive && target.kind !== 'floating');
	const insertion = $derived(!children && target.kind !== 'floating');
	const vertical = $derived(
		target.kind === 'dock'
			? TransferHandler.isVertical(target.location)
			: target.kind === 'bar' && !TransferHandler.isVertical(target.location, target.barId),
	);
	const label = $derived(
		target.kind !== 'dock'
			? 'Insert item'
			: target.location === HorizontalBarPosition.WindowBlockStart
				? 'Dock top'
				: target.location === HorizontalBarPosition.WindowBlockEnd
					? 'Dock bottom'
					: 'Dock here',
	);
	let slot: HTMLDivElement | undefined = $state();
	let proximity = $state(0);
	const near = $derived(active && proximity > 0);
	const droppable = useDroppable({
		id: () => id,
		data: {
			get target() {
				return target;
			},
		},
		disabled: () => inactive,
	});
	const hovered = $derived(!inactive && context.over?.id === id && !!source);
	const valid = $derived(source ? TransferHandler.canDrop(source, target) : false);

	function updateProximity(event: DragStartEvent | DragMoveEvent) {
		if (!insertion || !slot) {
			return;
		}
		const origin = event.activatorEvent;
		const delta = 'delta' in event ? event.delta : { x: 0, y: 0 };
		const initial = event.active.rect.initial;
		let x = (initial?.left ?? 0) + (initial?.width ?? 0) / 2 + delta.x;
		let y = (initial?.top ?? 0) + (initial?.height ?? 0) / 2 + delta.y;
		if (origin instanceof MouseEvent) {
			x = origin.clientX + delta.x;
			y = origin.clientY + delta.y;
		} else if (
			typeof TouchEvent !== 'undefined' &&
			origin instanceof TouchEvent &&
			origin.touches[0]
		) {
			x = origin.touches[0].clientX + delta.x;
			y = origin.touches[0].clientY + delta.y;
		}
		// Measure the stationary slot, never the growing hit area, to avoid feedback/jitter.
		const rect = slot.getBoundingClientRect();
		const distance = Math.hypot(
			Math.max(rect.left - x, 0, x - rect.right),
			Math.max(rect.top - y, 0, y - rect.bottom),
		);
		proximity = Math.max(0, 1 - distance / 64);
	}
	useDndMonitor({
		onDragStart: updateProximity,
		onDragMove: updateProximity,
		onDragEnd: () => {
			proximity = 0;
		},
		onDragCancel: () => {
			proximity = 0;
		},
	});
</script>

{#if insertion}
	<div
		bind:this={slot}
		class={`dock-target dock-slot ${className}`}
		class:dock-vertical={vertical}
		{style}
		style:--dock-growth={`${near ? proximity * 12 : 0}px`}
		data-dock-target={target.kind}
		data-dock-active={active || undefined}
		data-dock-near={near || undefined}
		data-dock-valid={hovered ? valid : undefined}
	>
		<div
			bind:this={droppable.node.current}
			class="dock-hit"
			class:dock-active={active}
			class:dock-near={near}
			class:dock-valid={hovered && valid}
			class:dock-invalid={hovered && !valid}
		>
			{#if active}<span class="dock-cue" aria-hidden="true"
					>{target.kind === 'dock' ? label : '+'}</span
				>{/if}
		</div>
	</div>
{:else}
	<div
		bind:this={droppable.node.current}
		class={`dock-target ${className}`}
		class:dock-active={active}
		class:dock-valid={hovered && valid}
		class:dock-invalid={hovered && !valid}
		{style}
		data-dock-target={target.kind}
		data-dock-active={active || undefined}
		data-dock-valid={hovered ? valid : undefined}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.dock-slot {
		position: relative;
		flex-shrink: 0;
	}
	.dock-hit {
		position: absolute;
		inset: 0;
		border-radius: 4px;
	}
	.dock-active {
		outline: 2px dashed Highlight;
		outline-offset: -2px;
		background-color: color-mix(in srgb, Highlight 12%, transparent);
	}
	.dock-hit.dock-active {
		z-index: 20;
		background-color: color-mix(in srgb, Highlight 22%, Canvas);
	}
	.dock-hit.dock-near {
		inset-block: calc(-1 * var(--dock-growth));
		background-color: color-mix(in srgb, Highlight 38%, Canvas);
		box-shadow:
			0 0 0 2px Canvas,
			0 3px 12px color-mix(in srgb, CanvasText 25%, transparent);
	}
	.dock-vertical > .dock-hit.dock-near {
		inset-block: 0;
		inset-inline: calc(-1 * var(--dock-growth));
	}
	.dock-cue {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: CanvasText;
		font-size: 11px;
		font-weight: 700;
		white-space: nowrap;
		pointer-events: none;
	}
	.dock-vertical .dock-cue {
		writing-mode: vertical-rl;
	}
	.dock-valid {
		outline: 3px solid Highlight;
		outline-offset: -3px;
		background-color: color-mix(in srgb, Highlight 30%, Canvas);
	}
	.dock-invalid {
		outline: 3px solid var(--color-destructive, #b91c1c);
		outline-offset: -3px;
		cursor: not-allowed;
		background-color: color-mix(in srgb, var(--color-destructive, #b91c1c) 15%, Canvas);
	}
	@media (forced-colors: active) {
		.dock-active {
			outline-color: Highlight;
		}
	}
</style>
