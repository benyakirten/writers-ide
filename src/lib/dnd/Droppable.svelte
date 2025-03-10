<script lang="ts">
	import { useDroppable, type UseDroppableArguments } from '@dnd-kit-svelte/core';
	import type { Snippet } from 'svelte';

	interface DroppableProps extends UseDroppableArguments {
		children: Snippet<[ReturnType<typeof useDroppable>]>;
	}

	let { children, ...rest }: DroppableProps = $props();

	const droppable = useDroppable(rest);
</script>

<div bind:this={droppable.node.current}>
	{@render children(droppable)}
</div>
