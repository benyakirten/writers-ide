<script lang="ts">
	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';

	import type { Snippet } from 'svelte';

	let { position, children } = $props<{ position: VerticalBarPosition; children: Snippet }>();

	let shouldInvert = VerticalBarState.shouldInvert(position);
</script>

{#snippet resizeBar()}
	<button
		aria-label={`Resize ${position}`}
		class="resize"
		onclick={() => VerticalBarState.toggle(position)}
		onmousedowncapture={(event) => VerticalBarState.startResize(position, event.clientX)}
	></button>
{/snippet}

{#if shouldInvert}
	{@render resizeBar()}
{/if}
<div class="vertical-slice" style:width={`${VerticalBarState.width(position)}px`}>
	{@render children()}
</div>
{#if !shouldInvert}
	{@render resizeBar()}
{/if}

<style>
	.resize {
		cursor: col-resize;
		z-index: 1;
		width: 4px;
		padding: 0;
		appearance: none;
		outline: none;
		border: none;
		background-color: #bbb;
	}

	.vertical-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
	}
</style>
