<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import type { TooltipData, TooltipState } from './tooltip-state.svelte';
	import { getTooltipManager } from './tooltip-context';

	let {
		children,
		tooltip,
		calibrateFor,
		manager,
		target,
	}: {
		children: Snippet;
		tooltip: Snippet | string;
		calibrateFor: TooltipData['calibrateFor'];
		manager?: TooltipState;
		target?: HTMLElement;
	} = $props();

	const service = untrack(() => manager) ?? getTooltipManager();
	let el: HTMLDivElement;

	function showTooltip() {
		service.set(tooltip, calibrateFor, target ?? el);
	}

	function hideTooltip() {
		if (service.tooltip?.target === (target ?? el)) {
			service.tooltipDebouncer.update(false);
		}
	}

	onMount(() => {
		return () => {
			// A relocated/unmounted sibling must not dismiss another trigger's tooltip.
			if (service.tooltip?.target === (target ?? el)) {
				service.clear();
			}
		};
	});
</script>

<div
	bind:this={el}
	style:display="inline-block"
	onfocusincapture={showTooltip}
	onmouseenter={showTooltip}
	onfocusoutcapture={hideTooltip}
	onmouseleave={hideTooltip}
	role="presentation"
>
	{@render children()}
</div>
