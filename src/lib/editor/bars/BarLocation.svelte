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
		canMoveBackward,
		canMoveForward,
		position
	}: {
		onrelocate: (to: BarTransferLocation) => void;
		onmove: (direction: 1 | -1) => void;
		canMoveBackward: boolean;
		canMoveForward: boolean;
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
		<DropdownMenu.Separator />
		<DropdownMenu.Group>
			<DropdownMenu.Item>
				<span>Team</span>
			</DropdownMenu.Item>
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger>
					<span>Invite users</span>
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent>
					<DropdownMenu.Item>
						<span>Email</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item>
						<span>Message</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item>
						<span>More...</span>
					</DropdownMenu.Item>
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
			<DropdownMenu.Item>
				<span>New Team</span>
				<DropdownMenu.Shortcut>⌘+T</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>
