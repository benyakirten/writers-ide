<script lang="ts">
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';
	import { VerticalBarPosition, type VerticalBar } from '../state/vertical-bar-state.svelte.js';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';
	import ItemRenderer from './ItemRenderer.svelte';

	let {
		bar,
		position,
		index,
		items
	}: {
		bar: VerticalBar;
		position: VerticalBarPosition;
		index: number;
		items: BarItemData[];
	} = $props();

	let shouldInvert = VerticalBarState.shouldInvert(position);
	let width = $derived(VerticalBarState.width(bar));
</script>

{#snippet resizeBar()}
	<button
		aria-label={VerticalBarState.humanize(index, position)}
		class="resize"
		onclick={() => VerticalBarState.toggle(index, position)}
		onmousedowncapture={(event) => VerticalBarState.startResize(bar.id, position, event.clientX)}
	></button>
{/snippet}

<div class="vertical-container">
	{#if shouldInvert}
		{@render resizeBar()}
	{/if}
	<div
		class="vertical-slice"
		style:width={`${width}px`}
		style:overflow={width === 0 ? 'hidden' : 'auto'}
	>
		<BarMenu
			onMinimize={() => VerticalBarState.toggle(index, position)}
			onClose={() => VerticalBarState.remove(index, position)}
			{index}
		/>
		{#each items as item (item.id)}
			<ItemRenderer Component={item.Component} size={item.size} />
		{/each}
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.vertical-container {
		display: flex;
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

	.vertical-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
		overflow: hidden;
	}
</style>
