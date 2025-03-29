<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	import {
		HorizontalBarPosition,
		type HorizontalBar
	} from '../state/horizontal-bar-state.svelte.js';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';
	import TransferHandler from '../state/bar-transfer-handler.svelte.js';
	import HorizontalItemRenderer from './HorizontalItemRenderer.svelte';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';

	let {
		bar,
		position,
		index,
		items,
		canMoveForward
	}: {
		bar: HorizontalBar;
		position: HorizontalBarPosition;
		index: number;
		items: BarItemData[];
		canMoveForward: boolean;
	} = $props();

	let shouldInvert = HorizontalBarState.shouldInvert(position);
	let height = $derived(HorizontalBarState.height(bar, position));
	let resizeLabel = $derived.by(() =>
		position === HorizontalBarPosition.WindowBlockStart
			? m.resize_block_start_bar({ num: index + 1 })
			: m.resize_block_end_bar({ num: index + 1 })
	);
</script>

{#snippet resizeBar()}
	<button
		aria-label={resizeLabel}
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
		<div class="bar-title">
			<BarMenu
				onminimize={() => HorizontalBarState.toggle(index, position)}
				onclose={() => HorizontalBarState.remove(index, position)}
				draggable
				{position}
				{index}
				{canMoveForward}
			/>
		</div>
		<div class="items">
			{#each items as item (item.id)}
				<HorizontalItemRenderer
					{position}
					onremove={() => TransferHandler.remove(position, bar.id, item.id)}
					{...item}
				/>
			{/each}
		</div>
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.horizontal-container {
		position: relative;
		display: grid;
		width: 100%;
		overflow: hidden;
	}
	.bar-title {
		position: absolute;
		top: 4px;
		right: 4px;
	}

	.resize {
		cursor: row-resize;
		z-index: 1;
		height: 4px;
		padding: 0;
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

	.items {
		height: 100%;
		margin-top: 4px;
		display: flex;
	}
</style>
