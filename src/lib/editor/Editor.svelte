<script lang="ts">
	import MainView from './MainView.svelte';
	import GlobalEditorState, { BarPosition } from './state.svelte.js';
</script>

<div class="overlay">
	{#if GlobalEditorState.ui[BarPosition.WindowTop].visible}
		<div style="border: 1px solid black;">Window Top</div>
	{/if}
	<div class="main-container">
		{#if GlobalEditorState.ui[BarPosition.InlineBeginning].visible}
			<div
				style={`background-color: #f0f0f0; border: 1px solid black; width: ${GlobalEditorState.ui[BarPosition.InlineBeginning].width ?? 200}px;}`}
			>
				Left Extreme
			</div>
		{/if}

		{#if GlobalEditorState.ui[BarPosition.InlineStart].visible}
			<div
				style={`background-color: #f0f0f0; border: 1px solid black; width: ${GlobalEditorState.ui[BarPosition.InlineBeginning].width ?? 200}px;}`}
			>
				Left
			</div>
		{/if}

		<main style="flex: 1;">
			<MainView />
		</main>

		{#if GlobalEditorState.ui[BarPosition.InlinEnd].visible}
			<div
				style={`background-color: #f0f0f0; border: 1px solid black; width: ${GlobalEditorState.ui[BarPosition.InlineBeginning].width ?? 200}px;}`}
			>
				Right
			</div>
		{/if}
	</div>
</div>

<style>
	.main-container {
		display: flex;
		width: 100vw;
		height: 100vh;
		position: relative;
	}
</style>
