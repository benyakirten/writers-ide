<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { TooltipState } from './tooltip-state.svelte';
	import { getTooltipManager } from './tooltip-context';

	let { manager, zIndex = 10000 }: { manager?: TooltipState; zIndex?: number } = $props();
	const TooltipManager = untrack(() => manager) ?? getTooltipManager();

	onMount(() => () => {
		TooltipManager.clear();
		TooltipManager.tooltipEl = null;
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			TooltipManager.clear();
		}
	}
</script>

{#snippet textTooltip(text: string)}
	<p style:padding="4px 8px">{text}</p>
{/snippet}

<svelte:window onkeydown={handleKeydown} />
{#if TooltipManager.open && TooltipManager.tooltip !== null}
	<div
		style:--pointer-z={zIndex}
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
			{#key TooltipManager.tooltip}
				{#key TooltipManager.tooltip.data}
					<svelte:boundary>
						{@render TooltipManager.tooltip.data()}
						{#snippet failed()}
							<p style:padding="4px 8px">Tooltip unavailable</p>
						{/snippet}
					</svelte:boundary>
				{/key}
			{/key}
		{/if}
	</div>
{/if}

<style>
	[role='tooltip'] {
		position: absolute;
		z-index: var(--pointer-z);
		box-sizing: border-box;
		color: var(--tooltip-color, inherit);
		background: var(--tooltip-background, pink);
		border-radius: 4px;
		border: 2px solid #000;
		visibility: hidden;

		animation: fadeIn 150ms ease-in-out;
	}

	p {
		margin: 0;
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
