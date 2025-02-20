<script lang="ts">
	import type { Selection } from 'prosemirror-state';
	import type { EditorView } from 'prosemirror-view';

	let { selection }: { selection: Selection | undefined } = $props();
</script>

<div class="menu">This is a menu.</div>

<style>
	.menu {
		width: 100%;
	}
</style>
