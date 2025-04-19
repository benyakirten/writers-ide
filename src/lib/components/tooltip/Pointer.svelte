<script lang="ts">
	import TooltipManager from '$lib/services/tooltip.svelte';
	import { MAX_Z_INDEX } from '$lib/constants';

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
		style:--pointer-z={MAX_Z_INDEX}
		onfocusincapture={() => TooltipManager.tooltipDebouncer.update(true)}
		onmouseenter={() => TooltipManager.tooltipDebouncer.update(true)}
		onfocusoutcapture={() => TooltipManager.tooltipDebouncer.update(false)}
		onmouseleave={() => TooltipManager.tooltipDebouncer.update(false)}
		id={TooltipManager.TOOLTIP_ID}
		bind:this={TooltipManager.tooltipEl}
		role="tooltip"
	>
		<div class="arrow"></div>
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
		z-index: var(--pointer-z);
		background: pink;
		border-radius: 4px;
		border: 2px solid #000;
		visibility: hidden;

		animation: fadeIn 150ms ease-in-out;
	}

	.arrow {
		background-color: black;
		position: absolute;
		clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
		width: 12px;
		height: 14px;
	}

	@keyframes fadeIn {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}
</style>
