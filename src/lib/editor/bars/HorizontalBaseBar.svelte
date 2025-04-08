<script lang="ts">
	import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
	import FloaterBarState from '../state/floater-state.svelte.js';
	import HorizontalBarState, {
		HorizontalBarPosition
	} from '../state/horizontal-bar-state.svelte.js';
	import VerticalBarState, { VerticalBarPosition } from '../state/vertical-bar-state.svelte.js';
</script>

<div class="base-bar">
	<button onclick={() => HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart)}
		>Add horizontal bar
	</button>
	<button onclick={() => VerticalBarState.add({}, VerticalBarPosition.InlineStart)}
		>Add vertical bar
	</button>
	<button onclick={() => FloaterBarState.add()}>Add floater bar</button>
	<Tooltip tooltip="This is a tooltip" calibrateFor="vertical">
		<button>Hover Me</button>
		<span>This is some text</span>
	</Tooltip>
</div>

<style>
	.base-bar {
		height: min-content;
		padding: 8px;
		border-bottom: 1px solid black;
	}
</style>
