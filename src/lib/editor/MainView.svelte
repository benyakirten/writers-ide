<script lang="ts">
	import { SortableContext } from '@dnd-kit-svelte/sortable';

	import TabRegistry from './state/tab-state-registry.svelte';
	import TabState from './state/tab-state.svelte';
	import Tab from './Tab.svelte';
</script>

<div class="main-view">
	<SortableContext
		items={TabState.windows.filter((w) => TabRegistry.isVisible(w.name)).map((w) => w.id)}
	>
		{#each TabState.windows as { name, id, data }, index (id)}
			{#if TabRegistry.isVisible(name)}
				{@const Component = TabRegistry.get(name)}
				<Tab {id} {index} {Component} {data} plugin={TabRegistry.items[name]?.plugin} />
			{/if}
		{/each}
	</SortableContext>
</div>

<style>
	.main-view {
		min-height: 0;
		min-width: 0;
		display: flex;
		flex: 1;
	}
</style>
