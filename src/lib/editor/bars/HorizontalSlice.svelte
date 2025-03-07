<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	import type { BarItemComponentProps } from '../state/bar-item-registry.svelte.js';
	import TabState from '../state/tab-state.svelte.js';
	import { schema } from '../prosemirror/view/schema.js';
	import ProseMirrorEventBus from '../state/event-bus.svelte.js';
	import { SelectionUtilies } from '../prosemirror/view/selection.js';
	import { ActionUtilities } from '../prosemirror/view/actions.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';
	import FloaterBarState from '../state/floater-state.svelte.js';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';

	let itemProps: BarItemComponentProps = {
		proseMirror: {
			actions: ActionUtilities,
			selections: SelectionUtilies,
			eventBus: ProseMirrorEventBus,
			schema
		},
		bars: {
			vertical: VerticalBarState,
			horizontal: HorizontalBarState,
			floater: FloaterBarState
		},
		tabs: TabState,
		internationalization: {
			translation: m
		}
	};

	import {
		HorizontalBarPosition,
		type HorizontalBar
	} from '../state/horizontal-bar-state.svelte.js';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';
	import ItemRenderer from './ItemRenderer.svelte';
	import { BarTransferHandler } from '../state/bar-transfer-handler.js';

	let {
		bar,
		position,
		index,
		items
	}: {
		bar: HorizontalBar;
		position: HorizontalBarPosition;
		index: number;
		items: BarItemData[];
	} = $props();

	let shouldInvert = HorizontalBarState.shouldInvert(position);
	let height = $derived(HorizontalBarState.height(bar, position));
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
		<div class="bar-title">
			<BarMenu
				onMinimize={() => HorizontalBarState.toggle(index, position)}
				onClose={() => HorizontalBarState.remove(index, position)}
				{index}
			/>
		</div>
		<div class="items">
			{#each items as item (item.id)}
				<ItemRenderer
					onremove={() => BarTransferHandler.remove(position, bar.id, item.id)}
					{...item}
				/>
			{/each}
		</div>
	</div>
	{#if !shouldInvert}
		{@render resizeBar()}
	{/if}
</div>

<style>
	.horizontal-container {
		position: relative;
		display: grid;
		width: 100%;
		overflow: hidden;
	}
	.bar-title {
		position: absolute;
		top: 4px;
		right: 4px;
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

	.horizontal-slice {
		background-color: #f0f0f0;
		border: 1px solid black;
		position: relative;
		overflow: hidden;
		width: 100%;
	}

	.items {
		margin-top: 4px;
		display: flex;
	}
</style>
