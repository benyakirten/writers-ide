<script lang="ts">
    import BreakBlock from "./BreakBlock.svelte";
    import AnchorBlock from "./AnchorBlock.svelte";
	import ImageBlock from "./ImageBlock.svelte";
    import DivBlock from "./DivBlock.svelte";
	import TableBlock from "./TableBlock.svelte";
	import TextBlock from "./TextBlock.svelte";
	import ListBlock from "./ListBlock.svelte";

	import type { BlockProps } from "$lib/types/block.js";

    let block: BlockProps = $props();
</script>

{#if block.type === "br"}
    <BreakBlock {...block} />
{:else if block.type === "a"}
    <AnchorBlock {...block} />
{:else if block.type === "img"}
    <ImageBlock {...block} />
{:else if block.type === "div"}
    <DivBlock {...block} />
{:else if block.type === "ol" || block.type === "ul"}
    <ListBlock {...block} />
{:else if block.type === "table"}
    <TableBlock {...block} />
{:else}
    <TextBlock {...block} />
{/if}
