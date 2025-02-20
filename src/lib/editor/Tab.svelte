<script lang="ts">
	import type { WindowData } from './state/tab-state.svelte.js';
	import ProseMirrorView from './prosemirror/view/ProseMirrorView.svelte';

	let { index, id, view }: { index: number; id: string; view?: WindowData['view'] } = $props();
</script>

<!-- TODO: Much more complexity here -->
<div class="tab">
	{#if view === undefined}
		<div></div>
	{:else}
		<ProseMirrorView {index} {id} />
	{/if}
</div>

<style>
	.tab {
		height: 200px;
		width: 200px;
		border: 1px solid black;
	}
</style>
