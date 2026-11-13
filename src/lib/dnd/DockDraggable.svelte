<script lang="ts">
	import type { Snippet } from 'svelte';
	import { useDraggable } from '@dnd-kit-svelte/core';

	import type { DockDragSource } from '$lib/editor/state/bar-transfer-handler.svelte';

	let {
		source,
		children,
		class: className = '',
		style = '',
		label = 'Drag toolbar',
	}: {
		source: DockDragSource;
		children: Snippet<[Snippet]>;
		class?: string;
		style?: string;
		label?: string;
	} = $props();

	const draggable = useDraggable({
		id: () =>
			JSON.stringify([
				'dock-source',
				source.kind,
				source.location,
				source.barId,
				source.itemId ?? null,
			]),
		data: {
			get source() {
				return source;
			},
		},
	});
	let grip: HTMLButtonElement | null = $state(null);
	$effect(() => {
		draggable.setActivatorNodeRef(grip);
	});
</script>

{#snippet handle()}
	<button
		bind:this={grip}
		type="button"
		class="dock-grip"
		{...draggable.attributes.current}
		{...draggable.listeners.current}
		aria-label={label}
	>
		<span aria-hidden="true">⠿</span>
	</button>
{/snippet}

<div
	bind:this={draggable.node.current}
	class={className}
	{style}
	style:opacity={draggable.isDragging.current ? 0.35 : undefined}
	data-dock-dragging={draggable.isDragging.current || undefined}
	data-dock-source-kind={source.kind}
	data-dock-bar-id={source.barId}
	data-dock-item-id={source.itemId}
>
	{@render children(handle)}
</div>

<style>
	.dock-grip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		border: none;
		background: transparent;
		padding: 0 4px;
		cursor: grab;
		touch-action: none;
	}
	.dock-grip:active {
		cursor: grabbing;
	}
</style>
