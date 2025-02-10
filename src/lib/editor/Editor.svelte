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
		<VerticalSlice position={VerticalBarPosition.InlineStartOuter}>Inline Beginning</VerticalSlice>
		<VerticalSlice position={VerticalBarPosition.InlineStartInner}>
			<button onclick={() => TabState.createTab()}>Add empty tab</button>
			<button onclick={() => TabState.createEditor()}>Add empty tab</button>
		</VerticalSlice>

		<main class="main">
			<MainView />
		</main>

		<VerticalSlice position={VerticalBarPosition.InlineEndInner}>Inline End</VerticalSlice>
	</div>
</div>

<style>
	.main-container {
		display: flex;
		width: 100vw;
		height: 100vh;
		position: relative;
	}

	.main {
		flex: 1;
		position: relative;
		display: grid;
	}
</style>
