<script lang="ts">
	import { untrack } from 'svelte';
	import type { SvelteNodeViewProps } from '@writers-ide/word-processing/svelte';
	let {
		node,
		selected,
		getPos,
		contentDOM,
		viewId,
		onControl,
		onMount,
		onDestroy,
	}: SvelteNodeViewProps & {
		viewId: string;
		onControl: (position: number | undefined) => void;
		onMount: () => void;
		onDestroy: () => void;
	} = $props();
	$effect(() => {
		untrack(onMount);
		return onDestroy;
	});
</script>

<div data-renderer-node data-selected={selected} data-view={viewId} data-size={node.content.size}>
	<div contenteditable="false">
		<button onclick={() => onControl(getPos())}>Inspect paragraph position</button>
		<input aria-label="Paragraph note" />
	</div>
	<div data-renderer-content use:contentDOM></div>
</div>
