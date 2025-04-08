<script lang="ts">
	import type { Snippet } from 'svelte';

	import TooltipManager from '@/services/tooltip.svelte';

	let { content, tooltip }: { content: Snippet; tooltip: Snippet | string } = $props();

	let el: HTMLElement;

	function showTooltip() {
		TooltipManager.set(tooltip, el);
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
	{@render content()}
</div>
