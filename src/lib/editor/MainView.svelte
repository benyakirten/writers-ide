<script lang="ts">
	import { SortableContext } from '@dnd-kit-svelte/sortable';

	import TabRegistry from './state/tab-state-registry.svelte';
	import TabState from './state/tab-state.svelte';
	import Tab from './Tab.svelte';
</script>

<div class="main-view">
	<SortableContext items={TabState.windows.map((w) => w.id)}>
		{#each TabState.windows as { name, id, data }, index (id)}
			{@const Component = TabRegistry.get(name)}
			<Tab {id} {index} {Component} {data} />
		{/each}
	</SortableContext>
</div>

<style>
	.main-view {
		flex: 1;
	}
</style>
