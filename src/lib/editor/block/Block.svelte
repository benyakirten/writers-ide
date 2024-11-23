<script lang="ts">
    import Self from "./Block.svelte";
	import type { BlockProps } from "$lib/types/block.js";

    let { type, data }: BlockProps = $props();
</script>

<svelte:element this={type} class={data.classes.join(" ")} {...data.properties}>
    {#each data.children as child (child.id)}
        <Self {...child}  />
    {/each}
    {#if data.content}
        {data.content}
    {/if}
</svelte:element>
