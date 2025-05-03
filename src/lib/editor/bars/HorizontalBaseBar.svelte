<script lang="ts">
	import FloaterBarState from '../state/floater-state.svelte';
	import HorizontalBarState, { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte';
	import VerticalBarState, { VerticalBarPosition } from '../state/vertical-bar-state.svelte';
</script>

<div class="base-bar">
	<button onclick={() => HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart)}
		>Add horizontal bar
	</button>
	<button onclick={() => VerticalBarState.add({}, VerticalBarPosition.InlineStart)}
		>Add vertical bar
	</button>
	<button onclick={() => FloaterBarState.add()}>Add floater bar</button>
</div>

<style>
	.base-bar {
		height: min-content;
		padding: 8px;
		border-bottom: 1px solid black;
	}
</style>
