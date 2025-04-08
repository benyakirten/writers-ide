<script lang="ts">
	import TooltipManager from '$lib/services/tooltip.svelte';

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			TooltipManager.dismiss();
		}
	}
</script>

{#snippet textTooltip(text: string)}
	<p>{text}</p>
	<style>
		p {
			padding: 4px 8px;
		}
	</style>
{/snippet}

<svelte:window onkeydown={handleKeydown} />
{#if TooltipManager.tooltip !== null}
	<div
		onmouseleave={() => TooltipManager.tooltipDebouncer.update(false)}
		onmouseenter={() => TooltipManager.tooltipDebouncer.update(true)}
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
	}
</style>
