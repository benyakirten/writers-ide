<script lang="ts">
	import { onMount } from 'svelte';

	import FloaterState, { type FloatingBar } from '$lib/editor/state/floater-state.svelte.js';
	import FloaterBarTitle from './FloaterBarTitle.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';

	let { bar, items, index }: { bar: FloatingBar; items: BarItemData[]; index: number } = $props();

	let floater: HTMLElement;
	let mutationObserver: MutationObserver;
	let menu: HTMLElement;

	onMount(() => {
		mutationObserver = new MutationObserver(() => {
			FloaterState.updateMeasurements(bar.id, floater.clientWidth, floater.clientHeight);
		});
		mutationObserver.observe(floater, { attributes: true });

		return () => {
			mutationObserver.disconnect();
		};
	});

	function handleMousedown(e: MouseEvent) {
		FloaterState.focus(index);
		if (!(e.target instanceof HTMLElement) || !menu.contains(e.target)) {
			return;
		}
		FloaterState.startDragging(index, e);
	}

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowLeft':
				FloaterState.nudge(index, 'left');
				break;
			case 'ArrowRight':
				FloaterState.nudge(index, 'right');
				break;
			case 'ArrowUp':
				FloaterState.nudge(index, 'up');
				break;
			case 'ArrowDown':
				FloaterState.nudge(index, 'down');
				break;
		}
	}
</script>

<div
	bind:this={floater}
	class="floater"
	style:z-index={bar.z}
	style:width={`${bar.position.width}px`}
	style:height={`${bar.position.height}px`}
	style:top={`${bar.position.top}px`}
	style:left={`${bar.position.left}px`}
	style:min-width={`${FloaterState.MIN_WIDTH_PX}px`}
	style:min-height={`${FloaterState.MIN_HEIGHT_PX}px`}
	style:max-width={`${FloaterState.MAX_WIDTH_PX}px`}
	style:max-height={`${FloaterState.MAX_HEIGHT_PERCENT}%`}
	onfocusin={() => FloaterState.focus(index)}
	onkeydown={(e) => handleKeydown(e)}
	onmousemove={(e) => FloaterState.move(e)}
	tabindex="0"
	role="button"
>
	<div
		style:cursor={FloaterState.dragging?.id === bar.id ? 'grabbing' : 'grab'}
		class="menu"
		bind:this={menu}
		onmousedown={(e) => handleMousedown(e)}
		tabindex="0"
		role="button"
	>
		<FloaterBarTitle {index} title={bar.title} id={bar.id} />
		<BarMenu
			onMinimize={() => FloaterState.update(index, 'minimized', true)}
			onClose={() => FloaterState.remove(index)}
			{index}
		/>
	</div>
	<!-- Render items -->
</div>

<style>
	.floater {
		position: absolute;
		background-color: whitesmoke;
		border: 1px solid black;
		overflow: auto;
		resize: both;
	}

	.menu {
		padding-inline: 2px;
		display: flex;
		gap: 8px;
		justify-content: space-between;
		align-items: center;
	}
</style>
