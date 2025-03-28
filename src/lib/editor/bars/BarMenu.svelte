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
		PictureInPicture
	} from '@steeze-ui/phosphor-icons';

	import IconButton from '$lib/components/IconButton.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';

	let {
		onminimize,
		onclose,
		draggable,
		index,
		position
	}: {
		onminimize: () => void;
		draggable: boolean;
		onclose: () => void;
		index: number;
		position: BarTransferLocation;
		onmove: (to: BarTransferLocation) => void;
	} = $props();
</script>

<div class="menu">
	<div class="initial-buttons">
		<IconButton
			disabled={position === HorizontalBarPosition.WindowBlockStart}
			onclick={() => {}}
			label={m.move_menu_to_window_block_end()}
		>
			{#snippet icon()}
				<Icon src={AlignTopSimple} size="16px" />
			{/snippet}
		</IconButton>
		<IconButton
			disabled={position === HorizontalBarPosition.WindowBlockEnd}
			onclick={() => {}}
			label={m.move_menu_to_window_block_end()}
		>
			{#snippet icon()}
				<Icon src={AlignBottomSimple} size="16px" />
			{/snippet}
		</IconButton>
		<IconButton
			disabled={position === VerticalBarPosition.InlineStart}
			onclick={() => {}}
			label={m.move_menu_to_window_inline_start_bar()}
		>
			{#snippet icon()}
				<Icon src={AlignLeftSimple} size="16px" />
			{/snippet}
		</IconButton>
		<IconButton
			disabled={position === VerticalBarPosition.InlineEnd}
			onclick={() => {}}
			label={m.move_menu_to_window_inline_end_bar()}
		>
			{#snippet icon()}
				<Icon src={AlignRightSimple} size="16px" />
			{/snippet}
		</IconButton>
		<IconButton
			disabled={position === 'floating'}
			onclick={() => {}}
			label={m.move_menu_to_window_floating()}
		>
			{#snippet icon()}
				<Icon src={PictureInPicture} size="16px" />
			{/snippet}
		</IconButton>
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
		<IconButton onclick={onminimize} label="Minimize bar #{index}">
			{#snippet icon()}
				<Icon src={Minus} size="16px" />
			{/snippet}
		</IconButton>
		<IconButton onclick={onclose} label="Close bar #{index}">
			{#snippet icon()}
				<Icon src={X} size="16px" />
			{/snippet}
		</IconButton>
	</div>
</div>

<style>
	.menu {
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
