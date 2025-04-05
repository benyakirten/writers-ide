<script lang="ts" module>
	export type MoveDetails = {
		up: boolean | null;
		down: boolean | null;
		left: boolean | null;
		right: boolean | null;
	};
</script>

<script lang="ts">
	import { Icon } from '@steeze-ui/svelte-icon';
	import { DotsThree } from '@steeze-ui/phosphor-icons';

	import * as m from '$lib/paraglide/messages';

	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import TransferHandler from '../state/bar-transfer-handler.svelte';
	import { onMount } from 'svelte';
	import Shortcuts from '../state/shortcuts.svelte';

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

	let open = $state(false);

	function handleRelocate(val: string | undefined) {
		if (!val) {
			return;
		}

		if (TransferHandler.isBarLocation(val)) {
			onrelocate(val);
		}
	}

	onMount(() => {
		// TODO: Figure out to determine if what bar the keydown is relevant to - maybe track last interacted bar?
		const unsub = Shortcuts.on({
			'move-bar-up': () => open && onmove('up'),
			'move-bar-down': () => open && onmove('down'),
			'move-bar-left': () => open && onmove('left'),
			'move-bar-right': () => open && onmove('right'),
			'move-bar-inline-start': () => open && onrelocate(VerticalBarPosition.InlineStart),
			'move-bar-inline-end': () => open && onrelocate(VerticalBarPosition.InlineEnd),
			'move-bar-block-start': () => open && onrelocate(HorizontalBarPosition.WindowBlockStart),
			'move-bar-block-end': () => open && onrelocate(HorizontalBarPosition.WindowBlockEnd),
			'move-bar-floating': () => open && onrelocate('floating')
		});
		return unsub;
	});
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger aria-label={m.position_item()}>
		<Icon src={DotsThree} size="16px" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-56">
		<DropdownMenu.Label>{m.position_item()}</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.RadioGroup value={position} onValueChange={(e) => handleRelocate(e)}>
			<DropdownMenu.RadioItem value={HorizontalBarPosition.WindowBlockStart}>
				<span>{m.window_block_start()}</span>
				<DropdownMenu.Shortcut>
					{Shortcuts.commandsToDisplayedShortcuts['move-bar-block-start']}
				</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value={HorizontalBarPosition.WindowBlockEnd}>
				<span>{m.window_block_end()}</span>
				<DropdownMenu.Shortcut>
					{Shortcuts.commandsToDisplayedShortcuts['move-bar-block-end']}
				</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value={VerticalBarPosition.InlineStart}>
				<span>{m.window_inline_start()}</span>
				<DropdownMenu.Shortcut>
					{Shortcuts.commandsToDisplayedShortcuts['move-bar-inline-start']}
				</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value={VerticalBarPosition.InlineEnd}>
				<span>{m.window_inline_end()}</span>
				<DropdownMenu.Shortcut>
					{Shortcuts.commandsToDisplayedShortcuts['move-bar-inline-end']}
				</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value="floating">
				<span>{m.window_floating()}</span>
				<DropdownMenu.Shortcut>
					{Shortcuts.commandsToDisplayedShortcuts['move-bar-floating']}
				</DropdownMenu.Shortcut>
			</DropdownMenu.RadioItem>
		</DropdownMenu.RadioGroup>
		<DropdownMenu.Separator />
		<DropdownMenu.Group>
			{#if moveDetails.up !== null}
				<DropdownMenu.Item disabled={!moveDetails.up} on:click={() => onmove('up')}>
					<span>{m.move_up()}</span>
					<DropdownMenu.Shortcut>
						{Shortcuts.commandsToDisplayedShortcuts['move-bar-up']}
					</DropdownMenu.Shortcut>
				</DropdownMenu.Item>
			{/if}
			{#if moveDetails.down !== null}
				<DropdownMenu.Item disabled={!moveDetails.down} on:click={() => onmove('down')}>
					<span>{m.move_down()}</span>
					<DropdownMenu.Shortcut>
						{Shortcuts.commandsToDisplayedShortcuts['move-bar-down']}
					</DropdownMenu.Shortcut>
				</DropdownMenu.Item>
			{/if}
			{#if moveDetails.left !== null}
				<DropdownMenu.Item disabled={!moveDetails.left} on:click={() => onmove('left')}>
					<span>{m.move_left()}</span>
					<DropdownMenu.Shortcut>
						{Shortcuts.commandsToDisplayedShortcuts['move-bar-left']}
					</DropdownMenu.Shortcut>
				</DropdownMenu.Item>
			{/if}
			{#if moveDetails.right !== null}
				<DropdownMenu.Item disabled={!moveDetails.right} on:click={() => onmove('right')}>
					<span> {m.move_right()}</span>
					<DropdownMenu.Shortcut>
						{Shortcuts.commandsToDisplayedShortcuts['move-bar-right']}
					</DropdownMenu.Shortcut>
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>
