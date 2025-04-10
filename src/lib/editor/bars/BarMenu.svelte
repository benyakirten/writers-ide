<script lang="ts">
	import { Icon } from '@steeze-ui/svelte-icon';
	import { X, Minus, DotsSix, DotsSixVertical } from '@steeze-ui/phosphor-icons';

	import * as m from '$lib/paraglide/messages';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';
	import BarLocation, { type MoveDetails } from './BarLocation.svelte';
	import TransferHandler from '../state/bar-transfer-handler.svelte';

	let {
		canMoveForward,
		draggable,
		index,
		position,
		onminimize,
		onclose
	}: {
		canMoveForward: boolean;
		draggable: boolean;
		index: number;
		position: BarTransferLocation;
		onminimize: () => void;
		onclose: () => void;
	} = $props();

	let moveDetails = $derived.by(() => {
		const base: MoveDetails = {
			up: null,
			down: null,
			left: null,
			right: null
		};
		if (
			position === VerticalBarPosition.InlineStart ||
			position === VerticalBarPosition.InlineEnd
		) {
			base.left = index > 0;
			base.right = canMoveForward;
		} else {
			base.up = index > 0;
			base.down = canMoveForward;
		}

		return base;
	});

	function handleMove(direction: 'up' | 'down' | 'left' | 'right') {
		const newIndex = index + (direction === 'up' || direction === 'left' ? -1 : 1);
		TransferHandler.swapBarPosition(index, position, newIndex);
	}
</script>

<div class="menu">
	{#if draggable}
		<div style:cursor="grab" class="drag-icon">
			{#if position === VerticalBarPosition.InlineStart || position === VerticalBarPosition.InlineEnd || position === 'floating'}
				<Icon src={DotsSix} size="18px" />
			{:else}
				<Icon src={DotsSixVertical} size="20px" />
			{/if}
		</div>
	{/if}
	<BarLocation
		{moveDetails}
		{position}
		onrelocate={(to) => TransferHandler.moveMenu(position, index, to)}
		onmove={handleMove}
	/>
	<IconButton
		tooltipDirection="horizontal"
		onclick={onminimize}
		label={m.minimize_bar({ num: index + 1 })}
	>
		{#snippet icon()}
			<Icon src={Minus} size="16px" />
		{/snippet}
	</IconButton>
	<IconButton
		tooltipDirection="horizontal"
		onclick={onclose}
		label={m.close_bar({ num: index + 1 })}
	>
		{#snippet icon()}
			<Icon src={X} size="16px" />
		{/snippet}
	</IconButton>
</div>

<style>
	.menu {
		position: relative;
		z-index: 10;
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}

	.drag-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-inline: 4px;
	}
</style>
