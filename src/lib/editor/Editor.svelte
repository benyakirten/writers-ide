<script lang="ts">
	import GlobalEditorState from './state.svelte.js';
	import Tab from './Tab.svelte';

	function createEditor() {
		let id = GlobalEditorState.preregister();
		GlobalEditorState.register(id, null);
	}
</script>

<div style="display: flex;">
	<button onclick={() => GlobalEditorState.preregister()}>Register Tab</button>
	<button onclick={createEditor}>Create Editor</button>
	{#each GlobalEditorState.windows as window (window.id)}
		<Tab {...window} />
	{/each}
</div>
