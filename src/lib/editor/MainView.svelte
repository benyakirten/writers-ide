<script lang="ts">
	import GlobalEditorState from './state.svelte.js';
	import Tab from './Tab.svelte';
</script>

<div class="main-view">
	{#each GlobalEditorState.windows as window (window.id)}
		<Tab {...window} />
	{/each}
</div>

<style>
	/* Main view will be grid */
</style>
