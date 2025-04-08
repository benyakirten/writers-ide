<script lang="ts">
	import {
		DndContext,
		KeyboardSensor,
		MouseSensor,
		TouchSensor,
		useSensor,
		useSensors,
		type DragEndEvent,
		type DragOverEvent,
		type DragStartEvent
	} from '@dnd-kit-svelte/core';
	import { SortableContext } from '@dnd-kit-svelte/sortable';

	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import HorizontalBarState from './state/horizontal-bar-state.svelte.js';
	import { HorizontalBarPosition } from './state/horizontal-bar-state.svelte.js';
	import FloaterBarState from './state/floater-state.svelte.js';

	import MainView from './MainView.svelte';
	import VerticalBar from './bars/VerticalBar.svelte';
	import HorizontalBar from './bars/HorizontalBar.svelte';
	import FloaterBar from './bars/FloaterBar.svelte';
	import VerticalBaseBar from './bars/VerticalBaseBar.svelte';
	import HorizontalBaseBar from './bars/HorizontalBaseBar.svelte';
	import Pointer from '$lib/components/tooltip/Pointer.svelte';

	function resize(e: MouseEvent) {
		VerticalBarState.resize(e);
		HorizontalBarState.resize(e);
	}

	function endResize() {
		VerticalBarState.endResize();
		HorizontalBarState.endResize();
		FloaterBarState.stopDragging();
	}

	const sensors = useSensors(
		useSensor(TouchSensor),
		useSensor(KeyboardSensor),
		useSensor(MouseSensor)
	);

	function handleDragEnd(e: DragEndEvent) {
		console.log('DRAG END');
		console.log(e);
	}

	function handleDragStart(e: DragStartEvent) {
		console.log('DRAG START');
		console.log(e);
	}

	function handleDragOver(e: DragOverEvent) {
		console.log('DRAG OVER');
		console.log(e);
	}
</script>

<DndContext
	{sensors}
	onDragEnd={handleDragEnd}
	onDragStart={handleDragStart}
	onDragOver={handleDragOver}
>
	<Pointer />
	<div
		bind:this={FloaterBarState.root}
		class="overlay"
		onmouseupcapture={() => endResize()}
		onmousemovecapture={(event) => resize(event)}
	>
		<HorizontalBaseBar />
		{#each FloaterBarState.visibleBars as bar, index (bar.id)}
			<FloaterBar {bar} {index} items={bar.data.items} />
		{/each}
		{#each HorizontalBarState.windowBlockStart as bar, index (bar.id)}
			<SortableContext items={HorizontalBarState.windowBlockStart.map((bar) => bar.id)}>
				<HorizontalBar
					{bar}
					position={HorizontalBarPosition.WindowBlockStart}
					{index}
					items={bar.data.items}
					canMoveForward={index !== HorizontalBarState.windowBlockStart.length - 1}
				/>
			</SortableContext>
		{/each}
		<div class="main-container">
			<VerticalBaseBar />
			<SortableContext items={VerticalBarState.inlineStart.map((bar) => bar.id)}>
				{#each VerticalBarState.inlineStart as bar, index (bar.id)}
					<VerticalBar
						{bar}
						position={VerticalBarPosition.InlineStart}
						{index}
						items={bar.data.items}
						canMoveForward={index !== VerticalBarState.inlineStart.length - 1}
					/>
				{/each}
			</SortableContext>
			<main class="main">
				<MainView />
			</main>
			<SortableContext items={VerticalBarState.inlineEnd.map((bar) => bar.id)}>
				{#each VerticalBarState.inlineEnd as bar, index (bar.id)}
					<VerticalBar
						{bar}
						position={VerticalBarPosition.InlineEnd}
						{index}
						items={bar.data.items}
						canMoveForward={index !== VerticalBarState.inlineEnd.length - 1}
					/>
				{/each}
			</SortableContext>
		</div>
		<SortableContext items={HorizontalBarState.windowBlockEnd.map((bar) => bar.id)}>
			{#each HorizontalBarState.windowBlockEnd as bar, index (bar.id)}
				<HorizontalBar
					{bar}
					position={HorizontalBarPosition.WindowBlockEnd}
					{index}
					items={bar.data.items}
					canMoveForward={index !== HorizontalBarState.windowBlockEnd.length - 1}
				/>
			{/each}
		</SortableContext>
	</div>
</DndContext>

<style>
	.overlay {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
	}

	.main-container {
		flex: 1;
		display: flex;
		position: relative;
	}

	.main {
		flex: 1;
		position: relative;
		display: flex;
		flex-direction: column;
	}
</style>
