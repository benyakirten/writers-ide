<script lang="ts">
	import MainView from './MainView.svelte';
	import GlobalEditorState, { BarPosition } from './state.svelte.js';
</script>

<div class="overlay">
	<MainView />

	{#if GlobalEditorState.ui[BarPosition.LeftExtreme].visible}
		<div style="width: 200px; background-color: #f0f0f0; border-right: 1px solid black;">
			Left Extreme
		</div>
	{/if}

	{#if GlobalEditorState.ui[BarPosition.Left].visible}
		<div style="width: 200px; background-color: #f0f0f0; border-right: 1px solid black;">Left</div>
	{/if}

	{#if GlobalEditorState.ui[BarPosition.Right].visible}
		<div style="width: 200px; background-color: #f0f0f0; border-left: 1px solid black;">Right</div>
	{/if}

	{#if GlobalEditorState.ui[BarPosition.WindowTop].visible}
		<div style="height: 200px; background-color: #f0f0f0; border-bottom: 1px solid black;">
			Window Top
		</div>
	{/if}
</div>

<style>
	.overlay {
		display: flex;
		position: relative;
		& > :global(*) {
			border: 1px solid black;
		}
	}
</style>
