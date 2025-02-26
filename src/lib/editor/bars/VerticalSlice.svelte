<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X, Minus } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import { VerticalBarPosition, type VerticalBar } from '../state/vertical-bar-state.svelte.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';

	let {
		bar,
		position,
		index,
		children
	}: {
		bar: VerticalBar;
		position: VerticalBarPosition;
		index: number;
		children: Snippet;
	} = $props();

	let shouldInvert = VerticalBarState.shouldInvert(position);
	let width = $derived(VerticalBarState.width(bar));
</script>

{#snippet resizeBar()}
	<button
		aria-label={VerticalBarState.humanize(index, position)}
		class="resize"
		onclick={() => VerticalBarState.toggle(index, position)}
		onmousedowncapture={(event) => VerticalBarState.startResize(bar.id, position, event.clientX)}
	></button>
{/snippet}

<div class="vertical-container">
	{#if shouldInvert}
		{@render resizeBar()}
	{/if}
	<div
		class="vertical-slice"
		style:width={`${width}px`}
		style:overflow={width === 0 ? 'hidden' : 'auto'}
	>
		<div class="menu">
			<button
				aria-label={`Minimize bar #${index + 1}`}
				onclick={() => VerticalBarState.toggle(index, position)}
			>
				<Icon src={Minus} size="16px" />
			</button>
			<button
				aria-label={`Close bar #${index + 1}`}
				onclick={() => VerticalBarState.remove(index, position)}
			>
				<Icon src={X} size="16px" />
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

	.menu {
		display: flex;
		justify-content: flex-end;
	}

	.vertical-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
		overflow: hidden;
	}
</style>
