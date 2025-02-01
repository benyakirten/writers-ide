<script lang="ts">
	import GlobalEditorState from './state.svelte.js';
	import ProseMirrorView from './view/ProseMirrorView.svelte';

	let fakeData = [1, 2, 3];
	fakeData[5] = 4;
</script>

<div style="display: flex;">
	<button onclick={() => GlobalEditorState.preregister()}>Register Editor</button>
	{#each GlobalEditorState.editors as editor}
		<ProseMirrorView id={editor.id} />
	{/each}
</div>
