<script lang="ts">
	import {
		DndContext,
		KeyboardSensor,
		MouseSensor,
		TouchSensor,
		useSensor,
		useSensors,
		type DragEndEvent,
		type DragStartEvent
	} from '@dnd-kit-svelte/core';

	import VerticalBarState, { VerticalBarPosition } from './state/vertical-bar-state.svelte.js';
	import HorizontalBarState from './state/horizontal-bar-state.svelte.js';
	import { HorizontalBarPosition } from './state/horizontal-bar-state.svelte.js';
	import FloaterBarState from './state/floater-state.svelte.js';

	import MainView from './MainView.svelte';
	import VerticalSlice from './bars/VerticalSlice.svelte';
	import HorizontalSlice from './bars/HorizontalSlice.svelte';
	import FloaterBar from './bars/FloaterBar.svelte';
	import VerticalBaseBar from './bars/VerticalBaseBar.svelte';
	import HorizontalBaseBar from './bars/HorizontalBaseBar.svelte';
	import { SortableContext } from '@dnd-kit-svelte/sortable';

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
</script>

<DndContext {sensors} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
	<div
		bind:this={FloaterBarState.root}
		class="overlay"
		onmouseupcapture={() => endResize()}
		onmousemovecapture={(event) => resize(event)}
	>
		<HorizontalBaseBar />
		<SortableContext items={FloaterBarState.visibleBars.map((bar) => bar.id)}>
			{#each FloaterBarState.visibleBars as bar, index (bar.id)}
				<FloaterBar {bar} {index} items={bar.data.items} />
			{/each}
		</SortableContext>
		{#each HorizontalBarState.windowBlockStart as bar, index (bar.id)}
			<SortableContext items={HorizontalBarState.windowBlockStart.map((bar) => bar.id)}>
				<HorizontalSlice
					{bar}
					position={HorizontalBarPosition.WindowBlockStart}
					{index}
					items={bar.data.items}
				/>
			</SortableContext>
		{/each}
		<div class="main-container">
			<VerticalBaseBar />
			<SortableContext items={VerticalBarState.inlineStart.map((bar) => bar.id)}>
				{#each VerticalBarState.inlineStart as bar, index (bar.id)}
					<VerticalSlice
						{bar}
						position={VerticalBarPosition.InlineStart}
						{index}
						items={bar.data.items}
					/>
				{/each}
			</SortableContext>
			<main class="main">
				<SortableContext items={HorizontalBarState.editorBlockStart.map((bar) => bar.id)}>
					{#each HorizontalBarState.editorBlockStart as bar, index (bar.id)}
						<HorizontalSlice
							{bar}
							position={HorizontalBarPosition.EditorBlockStart}
							{index}
							items={bar.data.items}
						/>
					{/each}
				</SortableContext>
				<MainView />
				<SortableContext items={HorizontalBarState.editorBlockEnd.map((bar) => bar.id)}>
					{#each HorizontalBarState.editorBlockEnd as bar, index (bar.id)}
						<HorizontalSlice
							{bar}
							position={HorizontalBarPosition.EditorBlockEnd}
							{index}
							items={bar.data.items}
						/>
					{/each}
				</SortableContext>
			</main>
			<SortableContext items={VerticalBarState.inlineEnd.map((bar) => bar.id)}>
				{#each VerticalBarState.inlineEnd as bar, index (bar.id)}
					<VerticalSlice
						{bar}
						position={VerticalBarPosition.InlineEnd}
						{index}
						items={bar.data.items}
					/>
				{/each}
			</SortableContext>
		</div>
		<SortableContext items={HorizontalBarState.windowBlockEnd.map((bar) => bar.id)}>
			{#each HorizontalBarState.windowBlockEnd as bar, index (bar.id)}
				<HorizontalSlice
					{bar}
					position={HorizontalBarPosition.WindowBlockEnd}
					{index}
					items={bar.data.items}
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
