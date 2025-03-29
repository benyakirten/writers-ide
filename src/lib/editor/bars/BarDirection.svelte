<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	import type { BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';

	let {
		onmove,
		current
	}: { onmove: (direction: BarTransferLocation) => void; current: BarTransferLocation } = $props();

	function handleChange(
		event: Event & {
			currentTarget: EventTarget & HTMLSelectElement;
		}
	) {
		const select = event.target as HTMLSelectElement;
		const value = select.value as BarTransferLocation;
		onmove(value);
	}
</script>

<select value={current} onchange={handleChange}>
	<option value={HorizontalBarPosition.WindowBlockStart}>{m.move_to_window_block_start()}</option>
	<option value={HorizontalBarPosition.WindowBlockEnd}>{m.move_to_window_block_end()}</option>
	<option value={VerticalBarPosition.InlineStart}>{m.move_to_window_inline_start()}</option>
	<option value={VerticalBarPosition.InlineEnd}>{m.move_to_window_inline_end()}</option>
	<option value={'floating'}>{m.move_to_window_floating()}</option>
</select>
