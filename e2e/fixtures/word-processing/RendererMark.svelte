<script lang="ts">
	import { untrack } from 'svelte';
	import type { SvelteMarkViewProps } from '@writers-ide/word-processing/svelte';
	let {
		mark,
		inline,
		contentDOM,
		onMount,
		onDestroy,
	}: SvelteMarkViewProps & {
		onMount: () => void;
		onDestroy: () => void;
	} = $props();
	$effect(() => {
		untrack(onMount);
		return onDestroy;
	});
</script>

<span data-renderer-mark={mark.type.name} data-inline={inline} style="font-weight: bold">
	<span use:contentDOM></span>
</span>
