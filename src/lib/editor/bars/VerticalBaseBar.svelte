<script lang="ts">
	import ToastManager from '$lib/services/toaster.svelte';
	import { PageObserver } from '../state/page-observer.svelte';
	import TransferHandler, { type BarTransferLocation } from '../state/bar-transfer-handler.svelte';
	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';

	import tabState from '../state/tab-state.svelte';
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte';

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

	function generateRandomMessage() {
		const messages = [
			'Hello, world!',
			'This is a test toast.',
			'Toast with a long message to test the layout.',
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua..',
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua..',
		];
		return messages[Math.floor(Math.random() * messages.length)];
	}

	function paginate() {
		PageObserver.invalidateAll();
	}
</script>

<div class="base-bar">
	<div class="sticky-part">
		<select bind:value={selectValue}>
			<option value="vertical">Vertical Bar</option>
			<option value="horizontal">Horizontal Bar</option>
			<option value="floating">Floating Bar</option>
		</select>
		<button onclick={() => addNullToBar()}>Add null to bar</button>
		<button onclick={() => addBasicMenuToBar()}>Add basic menu to bar</button>
		<button onclick={() => ToastManager.addToast(generateRandomMessage(), null)}>
			Add Toast
		</button>
		<button onclick={() => tabState.create('prosemirror')}>Create Prosemirror</button>
		<button onclick={() => paginate()}>Paginate</button>
	</div>
</div>

<style>
	.sticky-part {
		display: grid;
		gap: 8px;
		padding: 8px 4px;
		align-content: baseline;
		position: relative;
		position: sticky;
		top: 0;
	}
</style>
