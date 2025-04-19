<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	import { HorizontalBarPosition, type HorizontalBar } from '../state/horizontal-bar-state.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte';
	import TransferHandler, { type BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import HorizontalItemRenderer from './HorizontalItemRenderer.svelte';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte';
	import type { MoveDetails } from './BarLocation.svelte';

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

	function determineMoveDetails(
		itemIndex: number,
		numItems: number,
		barIndex: number,
		canMoveForward: boolean
	): MoveDetails {
		return {
			up: barIndex > 0,
			down: canMoveForward,
			left: itemIndex > 0,
			right: itemIndex < numItems - 1
		};
	}

	function handleItemRelocate(to: BarTransferLocation, itemId: string) {
		TransferHandler.relocateItem(
			{
				location: position,
				barId: index,
				itemId
			},
			to
		);
	}

	function handleItemMove(
		direction: 'up' | 'down' | 'left' | 'right',
		itemId: string,
		itemIndex: number
	) {
		if (direction === 'left' || direction === 'right') {
			TransferHandler.swap(
				{
					location: position,
					barId: index,
					itemId
				},
				direction === 'left' ? itemIndex - 1 : itemIndex + 1
			);
		} else {
			TransferHandler.nudge(
				{
					location: position,
					barId: index,
					itemId
				},
				direction === 'up' ? -1 : 1
			);
		}
	}
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
			{#each items as item, itemIndex (item.id)}
				{@const moveDetails = determineMoveDetails(itemIndex, items.length, index, canMoveForward)}
				<HorizontalItemRenderer
					{position}
					onremove={() => TransferHandler.remove(position, bar.id, item.id)}
					{moveDetails}
					onrelocate={(to) => handleItemRelocate(to, item.id)}
					onmove={(direction) => handleItemMove(direction, item.id, itemIndex)}
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
