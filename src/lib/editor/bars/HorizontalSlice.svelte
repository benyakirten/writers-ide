<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		HorizontalBarPosition,
		type HorizontalBar
	} from '../state/horizontal-bar-state.svelte.js';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';
	import BarMenu from './BarMenu.svelte';

	let {
		bar,
		position,
		index,
		children
	}: {
		bar: HorizontalBar;
		position: HorizontalBarPosition;
		index: number;
		children: Snippet;
	} = $props();

	let shouldInvert = HorizontalBarState.shouldInvert(position);
	let height = $derived(HorizontalBarState.height(bar, position));
</script>

{#snippet resizeBar()}
	<button
		aria-label={HorizontalBarState.humanize(index, position)}
		class="resize"
		onclick={() => HorizontalBarState.toggle(index, position)}
		onmousedowncapture={(event) => HorizontalBarState.startResize(bar.id, position, event.clientY)}
	></button>
{/snippet}

<div class="horizontal-container">
	{#if shouldInvert}
		{@render resizeBar()}
	{/if}
	<div
		class="horizontal-slice"
		style:height={`${height}px`}
		style:overflow={height === 0 ? 'hidden' : 'auto'}
	>
		<BarMenu
			onMinimize={() => HorizontalBarState.toggle(index, position)}
			onClose={() => HorizontalBarState.remove(index, position)}
			{index}
		/>
		<div>
			{@render children()}
		</div>
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.horizontal-container {
		display: grid;
		width: 100%;
	}
	.resize {
		cursor: row-resize;
		z-index: 1;
		height: 4px;
		padding: 0;
		appearance: none;
		outline: none;
		border: none;
		background-color: #bbb;
	}

	.horizontal-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
		overflow: hidden;
		width: 100%;
	}
</style>
