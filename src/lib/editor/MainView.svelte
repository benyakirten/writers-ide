<script lang="ts">
	import TabState from './state/tab-state.svelte';
	import Tab from './Tab.svelte';
</script>

<div class="main-view">
	{#each TabState.windows as window, index (window.id)}
		<Tab {...window} {index} />
	{/each}
</div>

<style>
	.main-view {
		flex: 1;
	}
	/* Main view will be grid */
</style>
