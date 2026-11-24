<script lang="ts">
	import { onMount } from 'svelte';
	let { label, onEvent }: { label: string; onEvent: (event: string) => void } = $props();
	onMount(() => {
		onEvent(`mount:${label}`);
		return () => {
			onEvent(`unmount:${label}`);
		};
	});
</script>

<button data-probe={label}>{label}</button>
