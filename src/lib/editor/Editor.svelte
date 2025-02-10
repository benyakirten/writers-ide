<script lang="ts">
	import MainView from './MainView.svelte';
	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import TabState from './state/tab-state.svelte.js';
	import VerticalSlice from './resize/VerticalSlice.svelte';
</script>

<div
	class="overlay"
	onmouseupcapture={() => VerticalBarState.endResize()}
	onmousemovecapture={(event) => VerticalBarState.resize(event)}
>
	<div style="border: 1px solid black;">Window Top</div>
	<div class="main-container">
		<VerticalSlice position={VerticalBarPosition.InlineStartOuter}>Inline Beginning</VerticalSlice>
		<VerticalSlice position={VerticalBarPosition.InlineStartInner}>
			<button onclick={() => TabState.createTab()}>Add empty tab</button>
			<button onclick={() => TabState.createEditor()}>Add empty tab</button>
		</VerticalSlice>

		<main style:flex="1">
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
</style>
