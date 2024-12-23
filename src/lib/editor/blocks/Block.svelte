<script lang="ts">
    import BreakBlock from "./BreakBlock.svelte";
	import ImageBlock from "./ImageBlock.svelte";
    import DivBlock from "./DivBlock.svelte";
	import TableBlock from "./TableBlock.svelte";
	import TextBlock from "./TextBlock.svelte";
	import ListBlock from "./ListBlock.svelte";
	import LinkBlock from "./LinkBlock.svelte";

	import type { BlockProps } from "$lib/types/block.js";
	import ParagraphBlock from "./ParagraphBlock.svelte";

    let { index, block, updateBlockContent, addBlock, removeNewStatus }: BlockProps = $props();
</script>

{#if block.type === "br"}
    <BreakBlock {...block} />
{:else if block.type === "a"}
    <LinkBlock {...block} />
{:else if block.type === "img"}
    <ImageBlock {...block} />
{:else if block.type === "div"}
    <DivBlock {...block} />
{:else if block.type === "ol" || block.type === "ul"}
    <ListBlock {...block} />
{:else if block.type === "table"}
    <TableBlock {...block} />
{:else if block.type === "p"}
    <ParagraphBlock {...block} isNew={block.isNew} updateBlockContent={(content) => updateBlockContent(index, content)} addBlock={addBlock} removeNewStatus={() => removeNewStatus(index)} />
{:else}
    <TextBlock {...block}  />
{/if}

<style>
    
</style>
