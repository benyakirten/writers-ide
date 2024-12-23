<script lang="ts">
	import type { Blocks } from "$lib/types/block.js";
	import Block from "./blocks/Block.svelte";

    let data: Blocks = $state([{
        type: "p",
        content: "hello!",
        id: "myp",
        classes: [],
        properties: {},
        children: []
    }])

    function updateBlockContent(index: number, content: string) {
        data[index].content = content;
    }

    function addBlock() {
        data = [...data, {
            type: "p",
            content: "",
            id: `a${Math.random().toString(36).substring(7)}`,
            classes: [],
            properties: {},
            children: [],
            isNew: true
        }]
    }

    function removeNewStatus(index: number) {
        data[index].isNew = false;
    }
</script>

<main>
    {#each data as block, idx (block.id)}
        <Block block={block} index={idx} updateBlockContent={updateBlockContent} addBlock={addBlock} removeNewStatus={removeNewStatus} />
    {/each}
</main>

