<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Cross2 } from '@steeze-ui/radix-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

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
		<button
			aria-label={`Close bar #${index + 1}`}
			class="remove-button"
			onclick={() => VerticalBarState.remove(id, position)}
		>
			<Icon src={Cross2} size="16px" />
		</button>
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

	.remove-button {
		position: absolute;
		top: 8px;
		right: 8px;
		border: 0;
		padding: 2px;
		border-radius: 4px;
	}

	.vertical-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
	}
</style>
