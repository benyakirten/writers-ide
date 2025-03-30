<script lang="ts" module>
	export type MoveDetails = {
		up: boolean | null;
		down: boolean | null;
		left: boolean | null;
		right: boolean | null;
	};
</script>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Icon } from '@steeze-ui/svelte-icon';
	import { DotsThree } from '@steeze-ui/phosphor-icons';
	import TransferHandler from '../state/bar-transfer-handler.svelte';

	let {
		onrelocate,
		onmove,
		moveDetails,
		position
	}: {
		onrelocate: (to: BarTransferLocation) => void;
		onmove: (direction: 'up' | 'down' | 'left' | 'right') => void;
		moveDetails: MoveDetails;
		position: BarTransferLocation;
	} = $props();

	function handleRelocate(val: string | undefined) {
		if (!val) {
			return;
		}

		if (TransferHandler.isBarLocation(val)) {
			onrelocate(val);
		} else {
			console.error('Invalid bar location:', val);
		}
	}

	let isVertical = $derived.by(
		() => position === VerticalBarPosition.InlineStart || position === VerticalBarPosition.InlineEnd
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger aria-label={m.position_item()}>
		<Icon src={DotsThree} size="16px" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-56">
		<DropdownMenu.Label>{m.position_item()}</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.RadioGroup value={position} onValueChange={(e) => handleRelocate(e)}>
			<DropdownMenu.RadioItem value={HorizontalBarPosition.WindowBlockStart}>
				<span>{m.window_block_start()}</span>
				<DropdownMenu.Shortcut>⇧⌘P</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value={HorizontalBarPosition.WindowBlockEnd}>
				<span>{m.window_block_end()}</span>
				<DropdownMenu.Shortcut>⌘B</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value={VerticalBarPosition.InlineStart}>
				<span>{m.window_inline_start()}</span>
				<DropdownMenu.Shortcut>⌘S</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value={VerticalBarPosition.InlineEnd}>
				<span>{m.window_inline_end()}</span>
				<DropdownMenu.Shortcut>⌘K</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value="floating">
				<span>{m.window_floating()}</span>
				<DropdownMenu.Shortcut>⇧⌘F</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
		</DropdownMenu.RadioGroup>
		{#if position !== 'floating'}
			<DropdownMenu.Separator />
			<DropdownMenu.Group>
				{#if moveDetails.up !== null}
					<DropdownMenu.Item disabled={!moveDetails.up} on:click={() => onmove('up')}>
						{m.move_up()}
					</DropdownMenu.Item>
				{/if}
				{#if moveDetails.down !== null}
					<DropdownMenu.Item disabled={!moveDetails.down} on:click={() => onmove('down')}>
						{m.move_down()}
					</DropdownMenu.Item>
				{/if}
				{#if moveDetails.left !== null}
					<DropdownMenu.Item disabled={!moveDetails.left} on:click={() => onmove('left')}>
						{m.move_left()}
					</DropdownMenu.Item>
				{/if}
				{#if moveDetails.right !== null}
					<DropdownMenu.Item disabled={!moveDetails.right} on:click={() => onmove('right')}>
						{m.move_right()}
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Group>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
