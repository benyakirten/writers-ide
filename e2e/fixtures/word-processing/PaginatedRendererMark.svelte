<script lang="ts">
	import type { SvelteMarkViewProps } from '@writers-ide/word-processing/svelte';
	let { contentDOM, sizing }: SvelteMarkViewProps & { sizing: { fontSize: number } } = $props();
</script>

<span data-paginated-mark style:font-size={`${sizing.fontSize}px`} style:line-height="1.2">
	<span use:contentDOM></span>
</span>
