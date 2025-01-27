<script lang="ts">
	// import BreakBlock from './BreakBlock.svelte';
	// import ImageBlock from './ImageBlock.svelte';
	// import DivBlock from './DivBlock.svelte';
	// import TableBlock from './TableBlock.svelte';
	// import TextBlock from './TextBlock.svelte';
	// import ListBlock from './ListBlock.svelte';
	// import LinkBlock from './LinkBlock.svelte';

	import type { BlockProps } from '$lib/types/block.js';
	import ParagraphBlock from './ParagraphBlock.svelte';

	let { index, block, updateBlockContent }: BlockProps = $props();
</script>

{#if block.type === 'p'}
	<ParagraphBlock
		{...block}
		updateBlockContent={(content) => updateBlockContent(index, content)}
		{index}
	/>
{/if}

<style>
</style>
