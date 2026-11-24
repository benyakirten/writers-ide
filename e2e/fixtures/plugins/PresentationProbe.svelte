<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { IconButton } from '@writers-ide/components';

	let {
		label,
		orientation,
		service,
		lifecycle,
		fail = false,
	}: {
		label: string;
		orientation: string;
		service: { count: number; increment: () => void };
		lifecycle: (event: string) => void;
		fail?: boolean;
	} = $props();
	let local = $state(0);
	function renderLabel(): string {
		if (fail) {
			throw new Error('Intentional presentation fixture render failure');
		}
		return label;
	}
	onMount(() => lifecycle(`mount:${label}:${orientation}`));
	onDestroy(() => lifecycle(`destroy:${label}:${orientation}`));
</script>

<div data-testid={label}>
	<h3>{renderLabel()}</h3>
	<output data-testid="orientation">{orientation}</output>
	<output data-testid="local">{local}</output>
	<output data-testid="service">{service.count}</output>
	<button onclick={() => local++}>Local increment</button>
	<button onclick={service.increment}>Service increment</button>
	<input aria-label={`${label} input`} />
	<IconButton label={`${label} help`} tooltipDirection="vertical" onclick={() => local++}>
		{#snippet icon()}<span>Help</span>{/snippet}
		{#snippet tooltip()}<span>Host tooltip for {label}</span>{/snippet}
	</IconButton>
</div>
