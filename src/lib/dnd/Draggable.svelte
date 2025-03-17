<script lang="ts">
	import type { Snippet } from 'svelte';
	import { useDraggable } from '@dnd-kit-svelte/core';
	import { CSS } from '@dnd-kit-svelte/utilities';

	let { id, data, children }: { id: string; data: Record<string, unknown>; children: Snippet } =
		$props();

	const { transform, listeners, attributes, node } = useDraggable({ id, data });

	const style = $derived(
		transform.current ? `transform: ${CSS.Translate.toString(transform.current)};` : ''
	);
</script>

<div {style} bind:this={node.current} {...listeners.current} {...attributes.current}>
	{@render children()}
</div>
