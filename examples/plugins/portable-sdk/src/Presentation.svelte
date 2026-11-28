<script lang="ts">
	import { getContext, onDestroy, untrack } from 'svelte';
	import { IconButton } from '@writers-ide/components';
	import Card from './Card.svelte';
	import type { Probe } from './contracts';
	let { probe, label }: { probe: Probe; label: string } = $props();
	const inherited = getContext<string>('fixture-context');
	const lifecycle = untrack(() => probe.lifecycle());
	onDestroy(() => lifecycle('portable:ui-destroy'));
</script>

<div class="portable-sdk" data-context={inherited}>
	<Card value={{ id: 'sample', count: 42 }}>
		{#snippet render(value)}<span>{label}: {value.count}</span>{/snippet}
	</Card>
	<IconButton
		label="Portable action"
		tooltipDirection="horizontal"
		onclick={() => probe.event('portable:click')}
	>
		{#snippet icon()}<span>+</span>{/snippet}
	</IconButton>
</div>

<style>
	.portable-sdk {
		color: rgb(17, 83, 129);
	}
</style>
