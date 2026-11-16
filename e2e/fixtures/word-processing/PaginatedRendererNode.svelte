<script lang="ts">
	import type { SvelteNodeViewProps } from '@writers-ide/word-processing/svelte';
	let { contentDOM, sizing }: SvelteNodeViewProps & { sizing: { height: number } } = $props();
</script>

<div data-paginated-renderer>
	<div contenteditable="false" aria-hidden="true" style:height={`${sizing.height}px`}></div>
	<p use:contentDOM></p>
</div>

<style>
	p {
		margin: 0;
	}
</style>
