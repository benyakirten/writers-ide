<script lang="ts">
	import MainView from './MainView.svelte';
	import HorizontalBarState from './state/horizontal-bar-state.svelte.js';
	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import VerticalSlice from './bars/VerticalSlice.svelte';
	import HorizontalSlice from './bars/HorizontalSlice.svelte';
	import { HorizontalBarPosition } from './state/horizontal-bar-state.svelte.js';
	import FloaterBar from './bars/FloaterBar.svelte';
	import VerticalBaseBar from './bars/VerticalBaseBar.svelte';
	import FloaterBarState from './state/floater-state.svelte.js';
	import HorizontalBaseBar from './bars/HorizontalBaseBar.svelte';

	function resize(e: MouseEvent) {
		VerticalBarState.resize(e);
		HorizontalBarState.resize(e);
	}

	function endResize() {
		VerticalBarState.endResize();
		HorizontalBarState.endResize();
		FloaterBarState.stopDragging();
	}
</script>

<div
	bind:this={FloaterBarState.root}
	class="overlay"
	onmouseupcapture={() => endResize()}
	onmousemovecapture={(event) => resize(event)}
>
	<HorizontalBaseBar />
	{#each FloaterBarState.visibleBars as bar, index (bar.id)}
		<FloaterBar {bar} {index} items={bar.data.items} />
	{/each}
	{#each HorizontalBarState.windowBlockStart as bar, index (bar.id)}
		<HorizontalSlice
			{bar}
			position={HorizontalBarPosition.WindowBlockStart}
			{index}
			items={bar.data.items}
		/>
	{/each}
	<div class="main-container">
		<VerticalBaseBar />
		{#each VerticalBarState.inlineStart as bar, index (bar.id)}
			<VerticalSlice
				{bar}
				position={VerticalBarPosition.InlineStart}
				{index}
				items={bar.data.items}
			/>
		{/each}
		<main class="main">
			{#each HorizontalBarState.editorBlockStart as bar, index (bar.id)}
				<HorizontalSlice
					{bar}
					position={HorizontalBarPosition.EditorBlockStart}
					{index}
					items={bar.data.items}
				/>
			{/each}
			<MainView />
			{#each HorizontalBarState.editorBlockEnd as bar, index (bar.id)}
				<HorizontalSlice
					{bar}
					position={HorizontalBarPosition.EditorBlockEnd}
					{index}
					items={bar.data.items}
				/>
			{/each}
		</main>
		{#each VerticalBarState.inlineEnd as bar, index (bar.id)}
			<VerticalSlice
				{bar}
				position={VerticalBarPosition.InlineEnd}
				{index}
				items={bar.data.items}
			/>
		{/each}
	</div>
	{#each HorizontalBarState.windowBlockEnd as bar, index (bar.id)}
		<HorizontalSlice
			{bar}
			position={HorizontalBarPosition.WindowBlockEnd}
			{index}
			items={bar.data.items}
		/>
	{/each}
</div>

<style>
	.overlay {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
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
