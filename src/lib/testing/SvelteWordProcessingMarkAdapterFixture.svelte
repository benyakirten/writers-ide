<script lang="ts">
	import type { SvelteMarkViewProps } from '@writers-ide/word-processing/svelte';
	let {
		mark,
		inline,
		contentDOM,
		onDestroy,
		readLabel,
	}: SvelteMarkViewProps & {
		onDestroy: () => void;
		readLabel?: () => string;
	} = $props();
	$effect(() => onDestroy);
</script>

<span
	data-mark-ui={mark.type.name}
	data-inline={inline}
	data-title={mark.attrs.title ?? ''}
	data-label={readLabel?.() ?? ''}
>
	<span use:contentDOM></span>
</span>
