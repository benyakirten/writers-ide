<script lang="ts">
	import MainView from './MainView.svelte';
	import HorizontalBarState from './state/horizontal-bar-state.svelte.js';
	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import VerticalSlice from './bars/VerticalSlice.svelte';
	import HorizontalSlice from './bars/HorizontalSlice.svelte';
	import { HorizontalBarPosition } from './state/horizontal-bar-state.svelte.js';
	import FloaterBar from './bars/FloaterBar.svelte';
	import VerticalBaseBar from './bars/base/VerticalBaseBar.svelte';
	import FloaterState from './state/floater-state.svelte.js';

	function resize(e: MouseEvent) {
		VerticalBarState.resize(e);
		HorizontalBarState.resize(e);
	}

	function endResize() {
		VerticalBarState.endResize();
		HorizontalBarState.endResize();
		FloaterState.stopDragging();
	}
</script>

<div
	bind:this={FloaterState.root}
	class="overlay"
	onmouseupcapture={() => endResize()}
	onmousemovecapture={(event) => resize(event)}
>
	{#each FloaterState.bars as bar, index (bar.id)}
		<FloaterBar {bar} {index}>
			Floater Bar #{index + 1}
		</FloaterBar>
	{/each}
	{#each HorizontalBarState.windowBlockStart as bar, index (bar.id)}
		<HorizontalSlice {bar} position={HorizontalBarPosition.WindowBlockStart} {index}>
			Window Block Start Bar #{index + 1}
		</HorizontalSlice>
	{/each}
	<div class="main-container">
		<VerticalBaseBar />
		{#each VerticalBarState.inlineStart as bar, index (bar.id)}
			<VerticalSlice {bar} position={VerticalBarPosition.InlineStart} {index}>
				Inline Bar Start #{index + 1}
			</VerticalSlice>
		{/each}
		<main class="main">
			{#each HorizontalBarState.editorBlockStart as bar, index (bar.id)}
				<HorizontalSlice {bar} position={HorizontalBarPosition.EditorBlockStart} {index}>
					Editor Block Start Bar #{index + 1}
				</HorizontalSlice>
			{/each}
			<MainView />
			{#each HorizontalBarState.editorBlockEnd as bar, index (bar.id)}
				<HorizontalSlice {bar} position={HorizontalBarPosition.EditorBlockEnd} {index}>
					Editor Block End Bar #{index + 1}
				</HorizontalSlice>
			{/each}
		</main>
		{#each VerticalBarState.inlineEnd as bar, index (bar.id)}
			<VerticalSlice {bar} position={VerticalBarPosition.InlineEnd} {index}>
				Inline Bar End #{index + 1}
			</VerticalSlice>
		{/each}
	</div>
	{#each HorizontalBarState.windowBlockEnd as bar, index (bar.id)}
		<HorizontalSlice {bar} position={HorizontalBarPosition.WindowBlockEnd} {index}>
			Window Block End Bar #{index + 1}
		</HorizontalSlice>
	{/each}
</div>

<style>
	.overlay {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.main-container {
		flex: 1;
		display: flex;
		position: relative;
	}

	.main {
		flex: 1;
		position: relative;
		display: flex;
		flex-direction: column;
	}
</style>
