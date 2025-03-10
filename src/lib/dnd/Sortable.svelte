<script lang="ts" generics="T extends Record<string, unknown>">
	import type { Snippet } from 'svelte';
	import { useSortable } from '@dnd-kit-svelte/sortable';
	import { CSS, styleObjectToString } from '@dnd-kit-svelte/utilities';

	let {
		id,
		data,
		children
	}: {
		id: string;
		data: T;
		children: Snippet<[isDragging: boolean, isSorting: boolean, isOver: boolean]>;
	} = $props();

	const {
		attributes,
		listeners,
		node,
		activatorNode,
		transform,
		transition,
		isDragging,
		isSorting,
		isOver
	} = useSortable({
		id: id,
		data
	});

	const style = $derived(
		styleObjectToString({
			transform: CSS.Transform.toString(transform.current),
			transition: isSorting.current ? transition.current : undefined,
			zIndex: isDragging.current ? 1 : undefined
		})
	);
</script>

<div
	class="container"
	{style}
	bind:this={node.current}
	{...listeners.current}
	{...attributes.current}
>
	{@render children(isDragging.current, isSorting.current, isOver.current)}
</div>

<style>
	.container {
		position: relative;
		user-select: none;
	}
</style>
