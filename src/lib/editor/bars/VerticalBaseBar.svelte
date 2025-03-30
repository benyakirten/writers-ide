<script lang="ts">
	import TransferHandler, {
		type BarTransferLocation
	} from '../state/bar-transfer-handler.svelte.js';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte.js';
	import LocaleManager from '../state/locale-manager.svelte.js';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte.js';

	let selectValue: 'vertical' | 'horizontal' | 'floating' = 'vertical';

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
		TransferHandler.append(location, 0, Math.random().toString());
	}

	function addBasicMenuToBar() {
		const location = getBarPosition();
		TransferHandler.append(location, 0, 'basic-menu');
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
	<button
		onclick={() =>
			LocaleManager.data === 'en' ? (LocaleManager.data = 'fr') : (LocaleManager.data = 'en')}
		>Change locale</button
	>
</div>

<style>
	.base-bar {
		width: min-content;
		display: grid;
		gap: 8px;
		padding: 8px 4px;
		align-content: baseline;
	}
</style>
