<script lang="ts">
	import type { Component } from 'svelte';

	let {
		component: View,
		props,
		onerror,
	}: {
		component: Component<Record<string, unknown>>;
		props: Record<string, unknown>;
		onerror: (error: unknown) => void;
	} = $props();
</script>

<svelte:boundary {onerror}>
	<View {...props} />
	{#snippet failed()}{/snippet}
</svelte:boundary>
