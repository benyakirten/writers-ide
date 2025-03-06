<script lang="ts">
	import { onMount } from 'svelte';

	import FloaterBarState, { type FloatingBar } from '$lib/editor/state/floater-state.svelte.js';
	import FloaterBarTitle from './FloaterBarTitle.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';
	import ItemRenderer from './ItemRenderer.svelte';
	import { BarTransferHandler } from '../state/bar-transfer-handler.js';

	let { bar, items, index }: { bar: FloatingBar; items: BarItemData[]; index: number } = $props();

	let floater: HTMLElement;
	let mutationObserver: MutationObserver;
	let menu: HTMLElement;

	onMount(() => {
		mutationObserver = new MutationObserver(() => {
			FloaterBarState.updateMeasurements(bar.id, floater.clientWidth, floater.clientHeight);
		});
		mutationObserver.observe(floater, { attributes: true });

		return () => {
			mutationObserver.disconnect();
		};
	});

	function handleMousedown(e: MouseEvent) {
		FloaterBarState.focus(index);
		if (!(e.target instanceof HTMLElement) || !menu.contains(e.target)) {
			return;
		}
		FloaterBarState.startDragging(index, e);
	}

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowLeft':
				FloaterBarState.nudge(index, 'left');
				break;
			case 'ArrowRight':
				FloaterBarState.nudge(index, 'right');
				break;
			case 'ArrowUp':
				FloaterBarState.nudge(index, 'up');
				break;
			case 'ArrowDown':
				FloaterBarState.nudge(index, 'down');
				break;
		}
	}
</script>

<div
	bind:this={floater}
	class="floater"
	style:z-index={bar.z}
	style:width="{bar.position.width}px"
	style:height="{bar.position.height}px"
	style:top="{bar.position.top}px"
	style:left="{bar.position.left}px"
	style:min-width="{FloaterBarState.MIN_WIDTH_PX}px"
	style:min-height="{FloaterBarState.MIN_HEIGHT_PX}px"
	style:max-width="{FloaterBarState.MAX_WIDTH_PX}px"
	style:max-height="{FloaterBarState.MAX_HEIGHT_PERCENT}%"
	onfocusin={() => FloaterBarState.focus(index)}
	onkeydown={(e) => handleKeydown(e)}
	onmousemove={(e) => FloaterBarState.move(e)}
	tabindex="0"
	role="button"
>
	<div
		style:cursor={FloaterBarState.dragging?.id === bar.id ? 'grabbing' : 'grab'}
		class="menu"
		bind:this={menu}
		onmousedown={(e) => handleMousedown(e)}
		tabindex="0"
		role="button"
	>
		<FloaterBarTitle {index} title={bar.title} id={bar.id} />
		<BarMenu
			onMinimize={() => FloaterBarState.update(index, 'minimized', true)}
			onClose={() => FloaterBarState.remove(index)}
			{index}
		/>
	</div>
	<div class="items">
		{#each items as item, i (item.id)}
			<ItemRenderer
				vertical
				{...item}
				onremove={() => BarTransferHandler.remove('floating', bar.id, item.id)}
			/>
		{/each}
	</div>
</div>

<style>
	.floater {
		position: absolute;
		background-color: whitesmoke;
		border: 1px solid black;
		overflow: hidden;
		resize: both;

		display: grid;
		grid-template-rows: auto 1fr;
	}

	.menu {
		display: flex;
		gap: 8px;
		justify-content: space-between;
	}
</style>
