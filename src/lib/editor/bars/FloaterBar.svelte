<script lang="ts">
	import { onMount } from 'svelte';

	import FloaterBarState, { type FloatingBar } from '$lib/editor/state/floater-state.svelte.js';
	import FloaterBarTitle from './FloaterBarTitle.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';
	import VerticalItemRenderer from './VerticalItemRenderer.svelte';
	import TransferHandler from '../state/bar-transfer-handler.svelte.js';

	let { bar, items, index }: { bar: FloatingBar; items: BarItemData[]; index: number } = $props();

	let floater: HTMLElement;
	let resizeObserver: ResizeObserver;
	let menu: HTMLElement;

	onMount(() => {
		resizeObserver = new ResizeObserver(([item]) => {
			if (!(item.target instanceof HTMLElement)) {
				return;
			}
			const { clientWidth, clientHeight } = item.target;
			FloaterBarState.updateMeasurements(bar.id, clientWidth, clientHeight);
		});

		// Changing the box doesn't seem to work.
		// TODO: Figure out why a border is a problem but not an outline.
		resizeObserver.observe(floater, { box: 'border-box' });

		return () => {
			resizeObserver.disconnect();
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
			onminimize={() => FloaterBarState.update(index, 'minimized', true)}
			onclose={() => FloaterBarState.remove(index)}
			draggable={false}
			position="floating"
			canMoveForward={false}
			{index}
		/>
	</div>
	<div class="items">
		{#each items as item (item.id)}
			<VerticalItemRenderer
				{...item}
				onremove={() => TransferHandler.remove('floating', bar.id, item.id)}
				position="floating"
				moveDetails={{ up: null, down: null, left: null, right: null }}
			/>
		{/each}
	</div>
</div>

<style>
	.floater {
		position: absolute;
		background-color: whitesmoke;
		outline: 1px solid black;
		outline-offset: 0px;
		overflow: hidden;
		resize: both;

		display: grid;
		grid-template-rows: auto 1fr;
		/* TODO: Is there a better solution to limiting child lengths? */
		grid-template-columns: 100%;
	}

	.menu {
		display: flex;
		gap: 8px;
		justify-content: space-between;
	}

	.items {
		width: 100%;
	}
</style>
