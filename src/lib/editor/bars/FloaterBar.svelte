<script lang="ts">
	import { onMount } from 'svelte';
	import DockDraggable from '$lib/dnd/DockDraggable.svelte';
	import DockTarget from '$lib/dnd/DockTarget.svelte';
	import HorizontalItemRenderer from './HorizontalItemRenderer.svelte';

	import FloaterBarState, { type FloatingBar } from '$lib/editor/state/floater-state.svelte';
	import FloaterBarTitle from './FloaterBarTitle.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte';
	import VerticalItemRenderer from './VerticalItemRenderer.svelte';
	import TransferHandler, { type BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import type { MoveDetails } from './BarLocation.svelte';

	let { bar, items, index }: { bar: FloatingBar; items: BarItemData[]; index: number } = $props();

	let floater: HTMLElement;
	let resizeObserver: ResizeObserver;
	let workbenchHeight = $state<number | null>(null);

	onMount(() => {
		resizeObserver = new ResizeObserver((entries) => {
			for (const item of entries) {
				if (!(item.target instanceof HTMLElement)) {
					continue;
				}
				const { clientWidth, clientHeight } = item.target;
				if (item.target === floater) {
					FloaterBarState.updateMeasurements(bar.id, clientWidth, clientHeight);
				} else {
					workbenchHeight = clientHeight;
				}
			}
		});

		// Changing the box doesn't seem to work.
		// TODO: Figure out why a border is a problem but not an outline.
		resizeObserver.observe(floater, { box: 'border-box' });
		if (FloaterBarState.root) {
			workbenchHeight = FloaterBarState.root.clientHeight;
			resizeObserver.observe(FloaterBarState.root);
		}

		return () => {
			resizeObserver.disconnect();
		};
	});

	function handleItemRelocate(to: BarTransferLocation, itemId: string) {
		TransferHandler.relocateItem(
			{
				location: 'floating',
				barId: bar.id,
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
		if (
			bar.data.isVertical
				? direction === 'left' || direction === 'right'
				: direction === 'up' || direction === 'down'
		) {
			return;
		}

		TransferHandler.swap(
			{
				location: 'floating',
				barId: bar.id,
				itemId,
			},
			direction === 'up' || direction === 'left' ? itemIndex - 1 : itemIndex + 1,
		);
	}

	function determineMoveDetails(index: number, numItems: number): MoveDetails {
		return {
			up: bar.data.isVertical ? index > 0 : null,
			down: bar.data.isVertical ? index < numItems - 1 : null,
			left: !bar.data.isVertical ? index > 0 : null,
			right: !bar.data.isVertical ? index < numItems - 1 : null,
		};
	}
</script>

<DockDraggable
	source={{ kind: 'bar', location: 'floating', barId: bar.id }}
	style={`position: absolute; left: ${bar.position.left}px; top: ${bar.position.top}px; z-index: ${bar.z}`}
>
	{#snippet children(handle)}
		<div
			bind:this={floater}
			class="floater"
			style:width="{bar.position.width}px"
			style:height="{bar.position.height}px"
			style:min-width="{FloaterBarState.MIN_WIDTH_PX}px"
			style:min-height="{FloaterBarState.MIN_HEIGHT_PX}px"
			style:max-width="{FloaterBarState.MAX_WIDTH_PX}px"
			style:max-height={workbenchHeight === null
				? undefined
				: `${(workbenchHeight * FloaterBarState.MAX_HEIGHT_PERCENT) / 100}px`}
			onfocusin={() => FloaterBarState.focus(bar.id)}
			onpointerdowncapture={() => FloaterBarState.focus(bar.id)}
		>
			<DockTarget
				id={JSON.stringify(['bar-interior', 'floating', bar.id])}
				target={{ kind: 'bar', location: 'floating', barId: bar.id, index: items.length }}
				style="height: 100%; display: grid; grid-template-rows: auto 1fr; grid-template-columns: 100%"
			>
				<div class="menu">
					<FloaterBarTitle {index} title={bar.title} id={bar.id} />
					<button
						type="button"
						disabled={!bar.data.canOrient(!bar.data.isVertical)}
						title="Switch toolbar orientation (maximum 3 units)"
						onclick={() => FloaterBarState.setOrientation(bar.id, !bar.data.isVertical)}
					>
						{bar.data.isVertical ? 'Horizontal' : 'Vertical'}
					</button>
					<BarMenu
						onminimize={() => FloaterBarState.update(bar.id, 'minimized', true)}
						onclose={() => FloaterBarState.remove(bar.id)}
						{handle}
						position="floating"
						canMoveForward={false}
						{index}
					/>
				</div>
				<div
					class="items"
					class:horizontal={!bar.data.isVertical}
					style:--insertion-space={`${(items.length + 1) * 16}px`}
				>
					{#each items as item, itemIndex (item.id)}
						{@const moveDetails = determineMoveDetails(itemIndex, items.length)}
						<DockTarget
							id={JSON.stringify(['bar-boundary', 'floating', bar.id, itemIndex])}
							target={{ kind: 'bar', location: 'floating', barId: bar.id, index: itemIndex }}
							style={bar.data.isVertical
								? 'height: 16px; width: 100%'
								: 'width: 16px; min-width: 16px; height: 100%'}
						/>
						{@const Renderer = bar.data.isVertical ? VerticalItemRenderer : HorizontalItemRenderer}
						<Renderer
							barId={bar.id}
							{...item}
							onremove={() => TransferHandler.remove('floating', bar.id, item.id)}
							position="floating"
							{moveDetails}
							onmove={(direction) => handleItemMove(direction, item.id, itemIndex)}
							onrelocate={(to) => handleItemRelocate(to, item.id)}
						/>
					{/each}
					<DockTarget
						id={JSON.stringify(['bar-boundary', 'floating', bar.id, items.length])}
						target={{ kind: 'bar', location: 'floating', barId: bar.id, index: items.length }}
						style={bar.data.isVertical
							? 'height: 16px; width: 100%'
							: 'width: 16px; min-width: 16px; height: 100%'}
					/>
				</div>
			</DockTarget>
		</div>
	{/snippet}
</DockDraggable>

<style>
	.floater {
		position: relative;
		background-color: whitesmoke;
		outline: 1px solid black;
		outline-offset: 0px;
		overflow: hidden;
		resize: both;
	}

	.menu {
		display: flex;
		gap: 8px;
		justify-content: space-between;
	}

	.horizontal {
		display: flex;
	}

	.items {
		width: 100%;
	}
</style>
