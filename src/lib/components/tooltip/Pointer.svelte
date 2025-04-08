<script lang="ts">
	import TooltipManager from '$lib/services/tooltip.svelte';

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			TooltipManager.dismiss();
		}
	}
</script>

{#snippet textTooltip(text: string)}
	<p style:padding="4px 8px">{text}</p>
{/snippet}

<svelte:window onkeydown={handleKeydown} />
{#if TooltipManager.open && TooltipManager.tooltip !== null}
	<div
		onfocusincapture={() => TooltipManager.tooltipDebouncer.update(true)}
		onmouseenter={() => TooltipManager.tooltipDebouncer.update(true)}
		onfocusoutcapture={() => TooltipManager.tooltipDebouncer.update(false)}
		onmouseleave={() => TooltipManager.tooltipDebouncer.update(false)}
		id={TooltipManager.TOOLTIP_ID}
		role="tooltip"
	>
		{#if typeof TooltipManager.tooltip.data === 'string'}
			{@render textTooltip(TooltipManager.tooltip.data)}
		{:else}
			{@render TooltipManager.tooltip.data()}
		{/if}
	</div>
{/if}

<style>
	[role='tooltip'] {
		position: absolute;
		z-index: 9999;
		background: pink;
		border-radius: 4px;
		border: 2px solid #000;
	}
</style>
