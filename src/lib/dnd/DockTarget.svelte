<script lang="ts">
	import type { Snippet } from 'svelte';
	import { useDndContext, useDroppable } from '@dnd-kit-svelte/core';
	import TransferHandler, {
		type DockDragSource,
		type DockDropTarget,
	} from '$lib/editor/state/bar-transfer-handler.svelte';

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
</script>

<div
	bind:this={droppable.node.current}
	class={`dock-target ${className}`}
	class:dock-valid={hovered && valid}
	class:dock-invalid={hovered && !valid}
	{style}
	data-dock-target={target.kind}
	data-dock-valid={hovered ? valid : undefined}
>
	{@render children?.()}
</div>

<style>
	.dock-valid {
		outline: 2px solid var(--color-primary, Highlight);
		outline-offset: -2px;
	}
	.dock-invalid {
		outline: 2px solid var(--color-destructive, #b91c1c);
		outline-offset: -2px;
		cursor: not-allowed;
	}
</style>
