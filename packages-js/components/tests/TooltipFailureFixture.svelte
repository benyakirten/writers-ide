<script lang="ts">
	import { IconButton, TooltipProvider, type TooltipState } from '@writers-ide/components';
	import ThrowingTooltip from './ThrowingTooltip.svelte';

	let {
		manager,
		mode,
		fail = true,
	}: {
		manager: TooltipState;
		mode: 'render' | 'effect';
		fail?: boolean;
	} = $props();
	let clicks = $state(0);
</script>

<TooltipProvider {manager}>
	<IconButton label="Plugin control" tooltipDirection="vertical" onclick={() => {}}>
		{#snippet icon()}<span>P</span>{/snippet}
		{#snippet tooltip()}<ThrowingTooltip {mode} {fail} />{/snippet}
	</IconButton>
	<IconButton
		label="Host control"
		tooltipDirection="vertical"
		onclick={() => {
			clicks++;
		}}
	>
		{#snippet icon()}<span>Host clicks: {clicks}</span>{/snippet}
		{#snippet tooltip()}<strong>Host tooltip</strong>{/snippet}
	</IconButton>
</TooltipProvider>
