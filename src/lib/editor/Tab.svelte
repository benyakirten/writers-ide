<script lang="ts">
	import type { WindowData } from './state/tab-state.svelte.js';
	import ProseMirrorView from './view/ProseMirrorView.svelte';

	let { id, view } = $props<{ id: string; view?: WindowData['view'] }>();
</script>

<!-- TODO: Much more complexity here -->
<div class="tab">
	{#if view === undefined}
		<div></div>
	{:else}
		<ProseMirrorView {id} />
	{/if}
</div>

<style>
	.tab {
		height: 200px;
		width: 200px;
		border: 1px solid black;
	}
</style>
