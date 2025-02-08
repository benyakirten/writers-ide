<script lang="ts">
	import MainView from './MainView.svelte';
	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import TabState from './state/tab-state.svelte.js';
</script>

<div
	class="overlay"
	onmouseupcapture={() => VerticalBarState.endResize()}
	onmousemovecapture={(event) => VerticalBarState.resize(event)}
>
	<div style="border: 1px solid black;">Window Top</div>
	<div class="main-container">
		<div
			style="background-color: #f0f0f0; border: 1px solid black; width: {VerticalBarState.width(
				VerticalBarPosition.InlineStartOuter
			)}px; position: relative;"
		>
			Inline Beginning
		</div>
		<button
			aria-label="Resize Inline Beginning"
			class="resize"
			onclick={() => VerticalBarState.toggle(VerticalBarPosition.InlineStartOuter)}
			onmousedowncapture={(event) =>
				VerticalBarState.startResize(VerticalBarPosition.InlineStartOuter, event.clientX)}
		></button>

		<div
			style="background-color: #f0f0f0; border: 1px solid black; width: {VerticalBarState.width(
				VerticalBarPosition.InlineStartInner
			)}px; position: relative;"
		>
			<button onclick={() => TabState.createTab()}>Add empty tab</button>
			<button onclick={() => TabState.createEditor()}>Add empty tab</button>
		</div>
		<button
			aria-label="Resize Inline Beginning"
			class="resize"
			onclick={() => VerticalBarState.toggle(VerticalBarPosition.InlineStartInner)}
			onmousedowncapture={(event) =>
				VerticalBarState.startResize(VerticalBarPosition.InlineStartInner, event.clientX)}
		></button>

		<main style="flex: 1;">
			<MainView />
		</main>

		<button
			aria-label="Resize Inline Beginning"
			class="resize"
			onclick={() => VerticalBarState.toggle(VerticalBarPosition.InlineEndInner)}
			onmousedowncapture={(event) =>
				VerticalBarState.startResize(VerticalBarPosition.InlineEndInner, event.clientX)}
		></button>
		<div
			style="background-color: #f0f0f0; border: 1px solid black; width: {VerticalBarState.width(
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
		width: 4px;
		padding: 0;
		appearance: none;
		outline: none;
		border: none;
		background-color: #bbb;
	}
</style>
