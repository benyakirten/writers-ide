<script lang="ts">
	import { getContext, onDestroy, untrack } from 'svelte';
	import { IconButton, getTooltipManager } from '@writers-ide/components';
	import type { Probe } from './contracts';
	import image from './image.svg';
	let {
		probe,
		lifecycle,
		broken = false,
	}: { probe: Probe; lifecycle: (value: string) => void; broken?: boolean } = $props();
	const context = getContext<string>('fixture-context');
	const manager = getTooltipManager();
	if (untrack(() => broken)) {
		throw new Error('Fixture renderer failure');
	}
	onDestroy(() => lifecycle('ui-destroy'));
</script>

<div class="profile-plugin" data-context={context} data-tooltip={Boolean(manager)}>
	<span
		data-testid="dock-color"
		data-dock-color="vertical"
		style="background-color: var(--dock-accent)">Dock color</span
	>
	<IconButton
		label="Profile action"
		tooltipDirection="horizontal"
		onclick={() => probe.event('click')}
	>
		{#snippet icon()}<img src={image} alt="Profile emblem" />{/snippet}
	</IconButton>
</div>

<style>
	:global(.style-probe) {
		color: rgb(17, 83, 129);
	}
	.profile-plugin {
		color: rgb(17, 83, 129);
		border: 3px solid currentColor;
	}
	img {
		width: 19px;
		height: 13px;
	}
</style>
