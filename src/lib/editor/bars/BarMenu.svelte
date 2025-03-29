<script lang="ts">
	import { Icon } from '@steeze-ui/svelte-icon';
	import {
		X,
		Minus,
		DotsSix,
		DotsSixVertical,
		AlignTopSimple,
		AlignBottomSimple,
		AlignLeftSimple,
		AlignRightSimple,
		PictureInPicture,
		ArrowLeft,
		ArrowRight,
		ArrowUp,
		ArrowDown
	} from '@steeze-ui/phosphor-icons';

	import IconButton from '$lib/components/IconButton.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';
	import TransferHandler from '../state/bar-transfer-handler.svelte';
	import BarLocation from './BarLocation.svelte';

	let {
		onminimize,
		onclose,
		canMoveForward,
		draggable,
		index,
		position
	}: {
		onminimize: () => void;
		onclose: () => void;
		canMoveForward: boolean;
		draggable: boolean;
		index: number;
		position: BarTransferLocation;
	} = $props();
</script>

<div class="menu">
	<div class="initial-buttons">
		<BarLocation {position} onmove={(to) => TransferHandler.moveMenu(position, index, to)} />
		{#if position !== 'floating'}
			{@const isHorizontal =
				position === VerticalBarPosition.InlineStart || position === VerticalBarPosition.InlineEnd}
			<IconButton
				disabled={index === 0}
				onclick={() => TransferHandler.swapBarPosition(index, position, index - 1)}
				label={isHorizontal ? m.move_backward() : m.move_up()}
			>
				{#snippet icon()}
					<Icon src={isHorizontal ? ArrowLeft : ArrowUp} size="16px" />
				{/snippet}
			</IconButton>
			<IconButton
				disabled={!canMoveForward}
				onclick={() => TransferHandler.swapBarPosition(index, position, index + 1)}
				label={isHorizontal ? m.move_forward() : m.move_down()}
			>
				{#snippet icon()}
					<Icon src={isHorizontal ? ArrowRight : ArrowDown} size="16px" />
				{/snippet}
			</IconButton>
		{/if}
	</div>
	<div class="latter-buttons">
		{#if draggable}
			<div style:cursor="grab" class="drag-icon">
				{#if position === VerticalBarPosition.InlineStart || position === VerticalBarPosition.InlineEnd || position === 'floating'}
					<Icon src={DotsSix} size="18px" />
				{:else}
					<Icon src={DotsSixVertical} size="20px" />
				{/if}
			</div>
		{/if}
		<IconButton onclick={onminimize} label={m.minimize_bar({ num: index + 1 })}>
			{#snippet icon()}
				<Icon src={Minus} size="16px" />
			{/snippet}
		</IconButton>
		<IconButton onclick={onclose} label={m.close_bar({ num: index + 1 })}>
			{#snippet icon()}
				<Icon src={X} size="16px" />
			{/snippet}
		</IconButton>
	</div>
</div>

<style>
	.menu {
		position: relative;
		z-index: 10;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.initial-buttons {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.latter-buttons {
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
