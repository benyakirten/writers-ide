<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';

	import type { BarItemComponentProps } from '../state/bar-item-registry.svelte.js';
	import TabState from '../state/tab-state.svelte.js';
	import { schema } from '../prosemirror/view/schema.js';
	import ProseMirrorEventBus from '../state/event-bus.svelte.js';
	import { SelectionUtilies } from '../prosemirror/view/selection.js';
	import { ActionUtilities } from '../prosemirror/view/actions.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';
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

	import FloaterBarState, { type FloatingBar } from '$lib/editor/state/floater-state.svelte.js';
	import FloaterBarTitle from './FloaterBarTitle.svelte';
	import BarMenu from './BarMenu.svelte';
	import type { BarItemData } from '../state/bar-items.svelte.js';

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
	style:width={`${bar.position.width}px`}
	style:height={`${bar.position.height}px`}
	style:top={`${bar.position.top}px`}
	style:left={`${bar.position.left}px`}
	style:min-width={`${FloaterBarState.MIN_WIDTH_PX}px`}
	style:min-height={`${FloaterBarState.MIN_HEIGHT_PX}px`}
	style:max-width={`${FloaterBarState.MAX_WIDTH_PX}px`}
	style:max-height={`${FloaterBarState.MAX_HEIGHT_PERCENT}%`}
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
