<script lang="ts">
	import { Debouncer } from '$lib/utils/debounce';
	import TooltipManager, { type TooltipData } from '@/services/tooltip.svelte';

	let {} = $props();

	let el: HTMLElement;

	function showTooltip() {
		TooltipManager.tooltipDebouncer.update(true);
	}

	function hideTooltip() {
		TooltipManager.tooltipDebouncer.update(false);
	}
</script>

<div
	bind:this={el}
	onfocusincapture={() => showTooltip()}
	onmouseenter={() => showTooltip()}
	onfocusoutcapture={() => hideTooltip()}
	onmouseleave={() => hideTooltip()}
	role="region"
>
	<span>TODO</span>
</div>
