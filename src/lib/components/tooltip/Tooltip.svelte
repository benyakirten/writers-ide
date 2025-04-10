<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import TooltipManager, { type TooltipData } from '@/services/tooltip.svelte';

	let {
		children,
		tooltip,
		calibrateFor
	}: { children: Snippet; tooltip: Snippet | string; calibrateFor: TooltipData['calibrateFor'] } =
		$props();

	let el: HTMLElement;

	function showTooltip() {
		TooltipManager.set(tooltip, calibrateFor, el);
	}

	function hideTooltip() {
		TooltipManager.tooltipDebouncer.update(false);
	}

	onMount(() => {
		return () => TooltipManager.dismiss();
	});
</script>

<div
	bind:this={el}
	style:display="inline-block"
	onfocusincapture={() => showTooltip()}
	onmouseenter={() => showTooltip()}
	onfocusoutcapture={() => hideTooltip()}
	onmouseleave={() => hideTooltip()}
	role="presentation"
>
	{@render children()}
</div>
