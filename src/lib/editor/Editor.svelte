<script lang="ts">
	import MainView from './MainView.svelte';
	import UIState, { BarPosition } from './state/ui-state.svelte.js';
	import TabState from './state/tab-state.svelte.js';

	let resizedSection: { bar: BarPosition; startingXPosition: number } | null = $state(null);

	function startResize(event: MouseEvent, section: BarPosition) {
		resizedSection = { bar: section, startingXPosition: event.clientX };
	}

	// TODO: Resize adjacent sections if releant
	// TODO: Offload this to state class
	function mouseMove(event: MouseEvent) {
		if (resizedSection === null || !(event.target instanceof HTMLElement)) {
			return;
		}

		const delta = event.clientX - resizedSection.startingXPosition;
		UIState.ui[resizedSection.bar].width += delta;
		resizedSection.startingXPosition = event.clientX;
	}

	function stopResize() {
		resizedSection = null;
	}
</script>

<div class="overlay" onmouseupcapture={stopResize} onmousemovecapture={(event) => mouseMove(event)}>
	{#if UIState.ui[BarPosition.WindowTop].visible}
		<div style="border: 1px solid black;">Window Top</div>
	{/if}
	<div class="main-container">
		{#if UIState.ui[BarPosition.InlineBeginning].visible}
			<div
				style={`background-color: #f0f0f0; border: 1px solid black; width: ${UIState.ui[BarPosition.InlineBeginning].width}px; position: relative;`}
			>
				<button
					aria-label="Resize Inline Beginning"
					style="position: absolute; top: 0; left: 100%; height: 100%; cursor: col-resize; z-index: 1; width: 1px; appearance: none; outline: none; border: none;"
					onmousedowncapture={(event) => startResize(event, BarPosition.InlineBeginning)}
				></button>
				Inline Beginning
			</div>
		{/if}

		{#if UIState.ui[BarPosition.InlineStart].visible}
			<div
				style={`background-color: #f0f0f0; border: 1px solid black; width: ${UIState.ui[BarPosition.InlineStart].width}px; position: relative;`}
			>
				<button onclick={() => TabState.createTab()}>Add Editor</button>
				<button onclick={() => TabState.createEditor()}>Add Empty Tab</button>
			</div>
		{/if}

		<main style="flex: 1;">
			<MainView />
		</main>

		{#if UIState.ui[BarPosition.InlinEnd].visible}
			<div
				style={`background-color: #f0f0f0; border: 1px solid black; width: ${UIState.ui[BarPosition.InlinEnd].width}px; position: relative;`}
			>
				Inline End
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
