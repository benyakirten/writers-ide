<script lang="ts">
	import { DndContext } from '@dnd-kit-svelte/core';
	import { TooltipProvider } from '@writers-ide/components';
	import MainView from '$lib/editor/MainView.svelte';
	import HorizontalBar from '$lib/editor/bars/HorizontalBar.svelte';
	import VerticalBar from '$lib/editor/bars/VerticalBar.svelte';
	import FloaterBar from '$lib/editor/bars/FloaterBar.svelte';
	import { BarItems } from '$lib/editor/state/bar-items.svelte';
	import {
		HorizontalBarPosition,
		type HorizontalBar as HorizontalBarModel,
	} from '$lib/editor/state/horizontal-bar-state.svelte';
	import {
		VerticalBarPosition,
		type VerticalBar as VerticalBarModel,
	} from '$lib/editor/state/vertical-bar-state.svelte';
	import type { FloatingBar } from '$lib/editor/state/floater-state.svelte';

	let {
		toolbarIds = [],
		vertical = false,
		horizontalBars = [],
		verticalBars = [],
		floatingBars = [],
	}: {
		toolbarIds?: string[];
		vertical?: boolean;
		horizontalBars?: HorizontalBarModel[];
		verticalBars?: VerticalBarModel[];
		floatingBars?: FloatingBar[];
	} = $props();

	// Compatibility inputs render one real docked bar per toolbar without editing workspace storage.
	const toolbarBars = $derived(
		toolbarIds.map((id) => ({
			id: `fixture-bar:${id}`,
			height: 100,
			width: 200,
			visible: true,
			data: new BarItems(vertical, [id]),
		})),
	);
	const horizontal = $derived(vertical ? horizontalBars : [...toolbarBars, ...horizontalBars]);
	const side = $derived(vertical ? [...toolbarBars, ...verticalBars] : verticalBars);
</script>

<TooltipProvider>
	<DndContext>
		<MainView />
		{#each horizontal as bar, index (bar.id)}
			<HorizontalBar
				{bar}
				{index}
				items={bar.data.items}
				position={HorizontalBarPosition.WindowBlockStart}
				canMoveForward={index < horizontal.length - 1}
			/>
		{/each}
		{#each side as bar, index (bar.id)}
			<VerticalBar
				{bar}
				{index}
				items={bar.data.items}
				position={VerticalBarPosition.InlineStart}
				canMoveForward={index < side.length - 1}
			/>
		{/each}
		{#each floatingBars as bar, index (bar.id)}
			<FloaterBar {bar} {index} items={bar.data.items} />
		{/each}
	</DndContext>
</TooltipProvider>
