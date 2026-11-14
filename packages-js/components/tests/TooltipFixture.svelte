<script lang="ts">
	import { IconButton, TooltipProvider, type TooltipState } from '@writers-ide/components';

	let {
		manager,
		showFirst = true,
		showSecond = true,
		disabled = false,
		onclick = () => {},
	}: {
		manager?: TooltipState;
		showFirst?: boolean;
		showSecond?: boolean;
		disabled?: boolean;
		onclick?: () => void;
	} = $props();
</script>

<TooltipProvider {manager}>
	{#if showFirst}
		<IconButton label="Bold" tooltipDirection="vertical" inversion={0.5} {disabled} {onclick}>
			{#snippet icon()}<span data-icon="bold">B</span>{/snippet}
		</IconButton>
	{/if}
	{#if showSecond}
		<IconButton label="Indent" tooltipDirection="horizontal" {onclick}>
			{#snippet icon()}<span>→</span>{/snippet}
			{#snippet tooltip()}<em>Indent content</em>{/snippet}
		</IconButton>
	{/if}
</TooltipProvider>
