<script lang="ts">
	import TransferHandler, {
		type BarTransferLocation
	} from '../state/bar-transfer-handler.svelte.js';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte.js';
	import LocaleManager from '$lib/services/locale-manager.svelte';
	import Shortcuts from '$lib/services/shortcuts.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte.js';
	import { setLanguageTag } from '$lib/paraglide/runtime.js';
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';

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
		onclick={() => (LocaleManager.locale === 'en' ? setLanguageTag('fr') : setLanguageTag('en'))}
		>Change locale</button
	>
	<button onclick={() => Shortcuts.register('move-bar-up', 'meta-shift-arrowleft')}>
		Change shortcut
	</button>
	<Tooltip tooltip="This is a tooltip" calibrateFor="horizontal">
		<button>Hover Me</button>
		<span>This is some text</span>
	</Tooltip>
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
