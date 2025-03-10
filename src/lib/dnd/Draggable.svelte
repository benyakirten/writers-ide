<script lang="ts" generics="T extends Record<string, unknown>">
	import { useDraggable } from '@dnd-kit-svelte/core';
	import { CSS } from '@dnd-kit-svelte/utilities';

	let { id, data }: { id: string; data: T } = $props();

	const { transform, listeners, attributes, node } = useDraggable({ id, data });

	const style = $derived(
		transform.current ? `transform: ${CSS.Translate.toString(transform.current)};` : ''
	);
</script>

<div {style} bind:this={node.current} {...listeners.current} {...attributes.current}>Drag me</div>
