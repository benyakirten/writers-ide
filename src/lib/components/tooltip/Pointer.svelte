<script lang="ts">
	import TooltipManager from '$lib/services/tooltip.svelte';

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			TooltipManager.dismiss();
		}
	}
</script>

{#snippet textTooltip(text: string)}
	<div>{text}</div>
{/snippet}

<svelte:window onkeydown={handleKeydown} />
{#if TooltipManager.tooltip !== null}
	<div
		onmouseleave={() => TooltipManager.dismissDebouncer.update(true)}
		onmouseenter={() => TooltipManager.dismissDebouncer.cancel()}
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
