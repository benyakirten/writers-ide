<script lang="ts">
	import { Icon } from '@steeze-ui/svelte-icon';
	import { X, Minus, DotsSix, DotsSixVertical } from '@steeze-ui/phosphor-icons';

	import * as m from '$lib/paraglide/messages';
	import IconButton from '$lib/components/IconButton.svelte';
	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';
	import BarLocation from './BarLocation.svelte';

	let {
		canMoveForward,
		draggable,
		index,
		position,
		onminimize,
		onclose,
		onrelocate,
		onmove
	}: {
		canMoveForward: boolean;
		draggable: boolean;
		index: number;
		position: BarTransferLocation;
		onminimize: () => void;
		onclose: () => void;
		onrelocate: (to: BarTransferLocation) => void;
		onmove: (direction: 1 | -1) => void;
	} = $props();
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
	<BarLocation canMoveBackward={index > 0} {canMoveForward} {position} {onrelocate} {onmove} />
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
