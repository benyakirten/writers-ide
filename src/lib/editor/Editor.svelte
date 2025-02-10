<script lang="ts">
	import MainView from './MainView.svelte';
	import HorizontalBarState from './state/horizontal-bar-state.svelte.js';
	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import TabState from './state/tab-state.svelte.js';
	import VerticalSlice from './resize/VerticalSlice.svelte';
	import HorizontalSlice from './resize/HorizontalSlice.svelte';
	import { HorizontalBarPosition } from './state/horizontal-bar-state.svelte.js';

	function resize(e: MouseEvent) {
		if (VerticalBarState.resizedSection) {
			VerticalBarState.resize(e);
		} else if (HorizontalBarState.resizedSection) {
			HorizontalBarState.resize(e);
		}
	}

	function endResize() {
		VerticalBarState.endResize();
		HorizontalBarState.endResize();
	}
</script>

<div
	class="overlay"
	onmouseupcapture={() => endResize()}
	onmousemovecapture={(event) => resize(event)}
>
	<HorizontalSlice position={HorizontalBarPosition.WindowTop}>Window Top</HorizontalSlice>
	<div class="main-container">
		{#each VerticalBarState.inlineStart as bar, index (bar.id)}
			<VerticalSlice id={bar.id} position={VerticalBarPosition.InlineStart} {index}>
				Inline Bar Start #{index + 1}
			</VerticalSlice>
		{/each}
		<main class="main">
			<HorizontalSlice position={HorizontalBarPosition.EditorTop}>Editor Top</HorizontalSlice>
			<MainView />
		</main>
		{#each VerticalBarState.inlineEnd as bar, index (bar.id)}
			<VerticalSlice id={bar.id} position={VerticalBarPosition.InlineEnd} {index}>
				Inline Bar End #{index + 1}
			</VerticalSlice>
		{/each}
	</div>
</div>

<style>
	.overlay {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
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
