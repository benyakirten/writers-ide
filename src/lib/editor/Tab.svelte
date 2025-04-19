<script lang="ts">
	import type { TabData } from './state/tab-state.svelte';
	import ProseMirrorView from './prosemirror/view/ProseMirrorView.svelte';
	import { createUpdatePlugin } from './state/event-bus.svelte';

	let { index, id, view }: { index: number; id: string; view?: TabData['view'] } = $props();
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
