<script lang="ts">
	import DockDraggable from '$lib/dnd/DockDraggable.svelte';
	import DockTarget from '$lib/dnd/DockTarget.svelte';
	import * as m from '$lib/paraglide/messages';
	import VerticalBarState from '../state/vertical-bar-state.svelte';
	import { VerticalBarPosition, type VerticalBar } from '../state/vertical-bar-state.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte';
	import VerticalItemRenderer from './VerticalItemRenderer.svelte';
	import TransferHandler, { type BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import type { MoveDetails } from './BarLocation.svelte';

	let {
		bar,
		position,
		index,
		items,
		canMoveForward,
	}: {
		bar: VerticalBar;
		position: VerticalBarPosition;
		index: number;
		items: BarItemData[];
		canMoveForward: boolean;
	} = $props();

	let shouldInvert = $derived(VerticalBarState.shouldInvert(position));
	let width = $derived(VerticalBarState.width(bar));
	let resizeLabel = $derived.by(() =>
		position === VerticalBarPosition.InlineStart
			? m.resize_inline_start_bar({ num: index + 1 })
			: m.resize_inline_end_bar({ num: index + 1 }),
	);

	function determineMoveDetails(
		itemIndex: number,
		numItems: number,
		barIndex: number,
		canMoveForward: boolean,
	): MoveDetails {
		return {
			up: itemIndex > 0,
			down: itemIndex < numItems - 1,
			left: barIndex > 0,
			right: canMoveForward,
		};
	}

	function handleItemRelocate(to: BarTransferLocation, itemId: string) {
		TransferHandler.relocateItem(
			{
				location: position,
				barId: index,
				itemId,
			},
			to,
		);
	}

	function handleItemMove(
		direction: 'up' | 'down' | 'left' | 'right',
		itemId: string,
		itemIndex: number,
	) {
		if (direction === 'up' || direction === 'down') {
			TransferHandler.swap(
				{
					location: position,
					barId: index,
					itemId,
				},
				direction === 'up' ? itemIndex - 1 : itemIndex + 1,
			);
		} else {
			TransferHandler.nudge(
				{
					location: position,
					barId: index,
					itemId,
				},
				direction === 'left' ? -1 : 1,
			);
		}
	}
</script>

{#snippet resizeBar()}
	<button
		aria-label={resizeLabel}
		class="resize"
		onclick={() => VerticalBarState.toggle(index, position)}
		onmousedowncapture={(event) => VerticalBarState.startResize(bar.id, position, event.clientX)}
	></button>
{/snippet}

<DockDraggable
	source={{ kind: 'bar', location: position, barId: bar.id }}
	style="display: flex; height: 100%"
>
	{#snippet children(handle)}
		<div class="vertical-container">
			{#if shouldInvert}
				{@render resizeBar()}
			{/if}
			<div
				class="vertical-slice"
				style:width={`${width}px`}
				style:overflow={width === 0 ? 'hidden' : 'auto'}
			>
				<DockTarget
					id={JSON.stringify(['bar-interior', position, bar.id])}
					target={{ kind: 'bar', location: position, barId: bar.id, index: items.length }}
					style="height: 100%; width: 100%"
				>
					<BarMenu
						onminimize={() => VerticalBarState.toggle(index, position)}
						onclose={() => VerticalBarState.remove(index, position)}
						{handle}
						{position}
						{index}
						{canMoveForward}
					/>
					<div>
						{#each items as item, itemIndex (item.id)}
							{@const moveDetails = determineMoveDetails(
								itemIndex,
								items.length,
								index,
								canMoveForward,
							)}
							<DockTarget
								id={JSON.stringify(['bar-boundary', position, bar.id, itemIndex])}
								target={{ kind: 'bar', location: position, barId: bar.id, index: itemIndex }}
								style="height: 16px; width: 100%"
							/>
							<VerticalItemRenderer
								barId={bar.id}
								{position}
								onremove={() => TransferHandler.remove(position, bar.id, item.id)}
								{moveDetails}
								onmove={(direction) => handleItemMove(direction, item.id, itemIndex)}
								{...item}
								onrelocate={(to) => handleItemRelocate(to, item.id)}
							/>
						{/each}
						<DockTarget
							id={JSON.stringify(['bar-boundary', position, bar.id, items.length])}
							target={{ kind: 'bar', location: position, barId: bar.id, index: items.length }}
							style="height: 16px; width: 100%"
						/>
					</div>
				</DockTarget>
			</div>
			{#if !shouldInvert}
				{@render resizeBar()}
			{/if}
		</div>
	{/snippet}
</DockDraggable>

<style>
	.vertical-container {
		display: flex;
	}
	.resize {
		cursor: col-resize;
		z-index: 1;
		width: 4px;
		padding: 0;
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
