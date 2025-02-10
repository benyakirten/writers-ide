<script lang="ts">
	import type { Snippet } from 'svelte';

	import { HorizontalBarPosition } from '../state/horizontal-bar-state.svelte.js';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';

	let { position, children } = $props<{ position: HorizontalBarPosition; children: Snippet }>();

	let shouldInvert = HorizontalBarState.shouldInvert(position);
</script>

{#snippet resizeBar()}
	<button
		aria-label={`Resize ${position}`}
		class="resize"
		onclick={() => HorizontalBarState.toggle(position)}
		onmousedowncapture={(event) => HorizontalBarState.startResize(position, event.clientX)}
	></button>
{/snippet}

<div class="horizontal-container">
	{#if shouldInvert}
		{@render resizeBar()}
	{/if}
	<div class="horizontal-slice" style:height={`${HorizontalBarState.height(position)}px`}>
		{@render children()}
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.horizontal-container {
		display: flex;
		flex-direction: column;
	}

	.resize {
		cursor: row-resize;
		z-index: 1;
		width: 100%;
		height: 4px;
		appearance: none;
		outline: none;
		border: none;
		background-color: #bbb;
	}

	.horizontal-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
	}
</style>
