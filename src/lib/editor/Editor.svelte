<script lang="ts">
	import type { Blocks, ParagraphData } from '$lib/types/block.js';
	import { tick } from 'svelte';
	import Block from './blocks/Block.svelte';

	let data: Blocks = $state([
		{
			type: 'p',
			content: 'hello!',
			id: 'myp',
			classes: [],
			properties: {},
			children: []
		}
	]);

	function updateBlockContent(index: number, content: string) {
		data[index].content = content;
	}

	async function addBlock(text: string) {
		const newBlock: ParagraphData = {
			type: 'p',
			content: text,
			id: `a${Math.random().toString(36).substring(7)}`,
			classes: [],
			properties: {},
			children: []
		};
		data.push(newBlock);

		await tick();
		const el = document.getElementById(newBlock.id);
		el?.focus();
	}
</script>

<main>
	{#each data as block, idx (block.id)}
		<Block {block} index={idx} {updateBlockContent} {addBlock} />
	{/each}
</main>

<style>
	:global {
		main {
			* {
				box-sizing: border-box;
				padding: 0;
				margin: 0;
			}
			*:focus {
				outline: none;
			}
		}
	}
</style>
