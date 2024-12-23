<script lang="ts">
    import type { ParagraphProps } from "$lib/types/block.js";
	import { onMount } from "svelte";
    
    let { content, classes, type, isNew, updateBlockContent, addBlock, removeNewStatus, id }: ParagraphProps = $props();

    const updateContent = (e: Event) => {
        if (e.target instanceof HTMLParagraphElement) {
            updateBlockContent(e.target.textContent ?? "");
        }
    }

    const handleKeydown = (e: KeyboardEvent) => {
        switch (e.key) {
            case "Enter":
                addBlock();
                e.preventDefault();
                break;
        }
    }

    onMount(() => {
        if (isNew) {
            const element = document.querySelector(`#${id}`);
            if (element instanceof HTMLElement) {
                element.focus();
                removeNewStatus();
            }
        }
    })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element tabindex={0} this={type} class={classes.join(" ")} id={id} onkeydown={handleKeydown} onblur={updateContent} contenteditable="true">
    {content}
    <!-- TODO: Children -->
</svelte:element>
