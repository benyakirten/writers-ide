<script lang="ts">
	import BasicMenu from '$lib/editor/prosemirror/menu/BasicMenu.svelte';
</script>

<div class="base-bar">
	<BasicMenu />
</div>

<style>
	.base-bar {
		height: min-content;
		padding: 8px;
		border-bottom: 1px solid black;
	}
</style>
