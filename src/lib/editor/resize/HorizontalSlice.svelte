<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Cross2, Minus } from '@steeze-ui/radix-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import {
		HorizontalBarPosition,
		type HorizontalBar
	} from '../state/horizontal-bar-state.svelte.js';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';

	let {
		bar,
		position,
		index,
		children
	}: {
		bar: HorizontalBar;
		position: HorizontalBarPosition;
		index: number;
		children: Snippet;
	} = $props();

	let shouldInvert = HorizontalBarState.shouldInvert(position);
	let height = $derived(HorizontalBarState.height(bar));
</script>

{#snippet resizeBar()}
	<button
		aria-label={HorizontalBarState.humanize(index, position)}
		class="resize"
		onclick={() => HorizontalBarState.toggle(index, position)}
		onmousedowncapture={(event) => HorizontalBarState.startResize(bar.id, position, event.clientY)}
	></button>
{/snippet}

<div class="horizontal-container">
	{#if shouldInvert}
		{@render resizeBar()}
	{/if}
	<div
		class="horizontal-slice"
		style:height={`${height}px`}
		style:overflow={height === 0 ? 'hidden' : 'auto'}
	>
		<div class="menu">
			<button
				aria-label={`Minimize bar #${index + 1}`}
				onclick={() => HorizontalBarState.toggle(index, position)}
			>
				<Icon src={Minus} size="16px" />
			</button>
			<button
				aria-label={`Close bar #${index + 1}`}
				onclick={() => HorizontalBarState.remove(index, position)}
			>
				<Icon src={Cross2} size="16px" />
			</button>
		</div>
		<div>
			{@render children()}
		</div>
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.horizontal-container {
		display: grid;
		width: 100%;
	}
	.resize {
		cursor: row-resize;
		z-index: 1;
		height: 4px;
		padding: 0;
		appearance: none;
		outline: none;
		border: none;
		background-color: #bbb;
	}

	.menu {
		display: flex;
		justify-content: flex-end;
	}

	.horizontal-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
		overflow: hidden;
		width: 100%;
	}
</style>
