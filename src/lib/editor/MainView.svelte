<script lang="ts">
	import GlobalEditorState from './state.svelte.js';
	import Tab from './Tab.svelte';
</script>

<!-- TODO: Style -->
<main>
	{#each GlobalEditorState.windows as window (window.id)}
		<Tab {...window} />
	{/each}
</main>
