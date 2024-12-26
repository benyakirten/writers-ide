<script lang="ts">
    import type { TextProps } from "$lib/types/block.js";
    
    let { content, classes, type }: TextProps = $props();

    function updateContents(e: any) {
        console.log(e)
    }
</script>

<svelte:element this={type} class={classes.join(" ")} oninput={updateContents} contenteditable="true">
    {content}
</svelte:element>
