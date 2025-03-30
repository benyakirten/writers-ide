<script lang="ts">
	import IconButton from '$lib/components/IconButton.svelte';
	import { DotsSix, DotsSixVertical, X } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';
	import BarLocation, { type MoveDetails } from './BarLocation.svelte';
	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';

	let {
		title,
		position,
		moveDetails,
		onremove
	}: {
		title: string;
		position: BarTransferLocation;
		moveDetails: MoveDetails;
		onremove: () => void;
	} = $props();
</script>

<div class="menu">
	<p>{title}</p>
	<div class="buttons">
		<BarLocation {moveDetails} {position} onmove={console.log} onrelocate={console.log} />
		<div style:cursor={'grab'} class="drag-icon">
			{#if position === HorizontalBarPosition.WindowBlockEnd || position === HorizontalBarPosition.WindowBlockStart}
				<Icon src={DotsSix} size="18px" />
			{:else}
				<Icon src={DotsSixVertical} size="20px" />
			{/if}
		</div>
		<IconButton onclick={onremove} label="Remove item">
			{#snippet icon()}
				<Icon src={X} size="14px" />
			{/snippet}
		</IconButton>
	</div>
</div>

<style>
	.menu {
		display: flex;
		justify-content: space-between;
		align-items: center;

		width: 80%;
		padding: 4px 8px;
		margin-left: 4px;

		border: 1px solid black;
		border-bottom: none;

		border-top-left-radius: 4px;
		border-top-right-radius: 4px;

		p {
			max-width: 80%;
			text-overflow: ellipsis;
			font-size: 12px;
			overflow: hidden;
			text-wrap: nowrap;
			white-space: nowrap;
		}
	}

	.buttons {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.drag-icon {
		height: 100%;
		display: flex;
		align-items: center;
	}
</style>
