<script lang="ts" generics="T extends { id: string }">
	import type { Snippet } from 'svelte';
	let { value, render }: { value: T; render: Snippet<[T]> } = $props();
</script>

<section data-testid="portable-card" data-id={value.id}>{@render render(value)}</section>
