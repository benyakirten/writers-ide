<script lang="ts">
	import type { WindowData } from './state.svelte.js';
	import ProseMirrorView from './view/ProseMirrorView.svelte';

	let { id, view } = $props<{ id: string; view?: WindowData['view'] }>();
</script>

<div class="tab">
	{#if view === undefined}
		<div></div>
	{:else}
		<ProseMirrorView {id} />
	{/if}
</div>

<style>
	.tab {
		width: 100%;
		min-height: 50vh;
		border: 1px solid black;
	}
</style>
