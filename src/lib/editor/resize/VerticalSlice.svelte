<script lang="ts">
	import type { Snippet } from 'svelte';

	import { VerticalBarPosition } from '../state/vertical-bar-state.svelte.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';

	let {
		id,
		position,
		index,
		children
	}: {
		id: string;
		position: VerticalBarPosition;
		index: number;
		children: Snippet;
	} = $props();

	let shouldInvert = VerticalBarState.shouldInvert(position);
</script>

{#snippet resizeBar()}
	<button
		aria-label={VerticalBarState.humanize(index, position)}
		class="resize"
		onclick={() => VerticalBarState.toggle(index, position)}
		onmousedowncapture={(event) => VerticalBarState.startResize(id, position, event.clientX)}
	></button>
{/snippet}

<div class="vertical-container">
	{#if shouldInvert}
		{@render resizeBar()}
	{/if}
	<div class="vertical-slice" style:width={`${VerticalBarState.width(id, position)}px`}>
		{@render children()}
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.vertical-container {
		display: flex;
	}
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
