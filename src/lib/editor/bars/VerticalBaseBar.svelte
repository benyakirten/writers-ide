<script lang="ts">
	import { BarTransferHandler, type BarTransferLocation } from '../state/bar-transfer-handler.js';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte.js';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte.js';

	let selectValue: 'vertical' | 'horizontal' | 'floating' = 'floating';

	function getBarPosition(): BarTransferLocation {
		switch (selectValue) {
			case 'vertical':
				return VerticalBarPosition.InlineStart;
			case 'horizontal':
				return HorizontalBarPosition.WindowBlockStart;
			case 'floating':
				return 'floating';
		}
	}

	function addNullToBar() {
		const location = getBarPosition();
		BarTransferHandler.insert({
			location,
			slot: 0,
			dataId: null,
			id: 0
		});
	}

	function addBasicMenuToBar() {
		const location = getBarPosition();
		BarTransferHandler.insert({
			location,
			slot: 0,
			dataId: 'basic-menu',
			id: 0
		});
	}
</script>

<div class="base-bar">
	<select bind:value={selectValue}>
		<option value="vertical">Vertical Bar</option>
		<option value="horizontal">Horizontal Bar</option>
		<option value="floating">Floating Bar</option>
	</select>
	<button onclick={() => addNullToBar()}>Add null to bar</button>
	<button onclick={() => addBasicMenuToBar()}>Add basic menu to bar</button>
</div>

<style>
	.base-bar {
		width: min-content;
	}
</style>
