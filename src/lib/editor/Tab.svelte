<script lang="ts">
	import type { WindowData } from './state/tab-state.svelte.js';
	import ProseMirrorView from './prosemirror/view/ProseMirrorView.svelte';
	import { createUpdatePlugin } from './state/event-bus.svelte.js';

	let { index, id, view }: { index: number; id: string; view?: WindowData['view'] } = $props();
</script>

<!-- TODO: Much more complexity here -->
<div class="tab">
	{#if view === undefined}
		<div></div>
	{:else}
		{@const updatePlugin = createUpdatePlugin(id)}
		<ProseMirrorView plugins={[updatePlugin]} {index} {id} />
	{/if}
</div>

<style>
	.tab {
		width: 100%;
		height: 100%;
		border: 1px solid black;
	}
</style>
