<script lang="ts">
	import type { Selection } from 'prosemirror-state';

	import BasicMenu from '$lib/editor/prosemirror/menu/BasicMenu.svelte';

	let { selection }: { selection: Selection | undefined } = $props();
</script>

<div class="base-bar">
	<BasicMenu {selection} />
</div>

<style>
	.base-bar {
		height: min-content;
		padding: 8px;
		border-bottom: 1px solid black;
	}
</style>
