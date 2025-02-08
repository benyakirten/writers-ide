<script lang="ts">
	import MainView from './MainView.svelte';
	import VerticalVerticalBarState, {
		VerticalBarPosition
	} from './state/vertical-bar-state.svelte.js';
	import TabState from './state/tab-state.svelte.js';
</script>

<div
	class="overlay"
	onmouseupcapture={() => VerticalVerticalBarState.endResize()}
	onmousemovecapture={(event) => VerticalVerticalBarState.resize(event)}
>
	<div style="border: 1px solid black;">Window Top</div>
	<div class="main-container">
		<div
			style="background-color: #f0f0f0; border: 1px solid black; width: {VerticalVerticalBarState.width(
				VerticalBarPosition.InlineStartOuter
			)}px; position: relative;"
		>
			Inline Beginning
		</div>
		<button
			aria-label="Resize Inline Beginning"
			class="resize"
			onmousedowncapture={(event) =>
				VerticalVerticalBarState.startResize(VerticalBarPosition.InlineStartOuter, event.clientX)}
		></button>

		<div
			style="background-color: #f0f0f0; border: 1px solid black; width: {VerticalVerticalBarState.width(
				VerticalBarPosition.InlineStartInner
			)}px; position: relative;"
		>
			<button onclick={() => TabState.createTab()}>Add empty tab</button>
			<button onclick={() => TabState.createEditor()}>Add empty tab</button>
		</div>
		<button
			aria-label="Resize Inline Beginning"
			class="resize"
			onmousedowncapture={(event) =>
				VerticalVerticalBarState.startResize(VerticalBarPosition.InlineStartInner, event.clientX)}
		></button>

		<main style="flex: 1;">
			<MainView />
		</main>

		<button
			aria-label="Resize Inline Beginning"
			class="resize"
			onmousedowncapture={(event) =>
				VerticalVerticalBarState.startResize(VerticalBarPosition.InlineEndInner, event.clientX)}
		></button>
		<div
			style="background-color: #f0f0f0; border: 1px solid black; width: {VerticalVerticalBarState.width(
				VerticalBarPosition.InlineEndInner
			)}px; position: relative;"
		>
			Inline End
		</div>
	</div>
</div>

<style>
	.main-container {
		display: flex;
		width: 100vw;
		height: 100vh;
		position: relative;
	}

	.resize {
		cursor: col-resize;
		z-index: 1;
		width: 1px;
		appearance: none;
		outline: none;
		border: none;
		background-color: #bbb;
	}
</style>
