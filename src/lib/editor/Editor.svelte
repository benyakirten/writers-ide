<script lang="ts">
	import type { Blocks, ParagraphData } from '$lib/types/block.js';
	import { tick } from 'svelte';
	import Block from './blocks/Block.svelte';
	import { CaretLinePosition, getCaretLinePosition, getCaretPosition } from './utils.js';

	let cursorPosition = $state(0);
	let el: HTMLElement;

	function handleKeydown(e: KeyboardEvent) {
		const targetEl = e.target;
		const selection = window.getSelection();
		if (!selection || !(targetEl instanceof HTMLElement)) {
			return;
		}

		const dataIndex = targetEl.getAttribute('data-index');
		// TODO: Add handling for children
		const index = dataIndex ? parseInt(dataIndex) : -1;
		if (index < 0 || isNaN(index)) {
			return;
		}

		switch (e.key) {
			case 'Enter':
				e.preventDefault();
				let newContent = '';

				if (selection) {
					// Text node should be this element
					// Try to split it into two parts - before and after the cursor
					// If there's any text, we delete the after, otherwise we
					// move the contents to the new line.
					const position = selection.getRangeAt(0).startOffset;
					const text = targetEl.textContent ?? '';
					const before = text.slice(0, position);
					const after = text.slice(position);
					if (selection.toString().length === 0) {
						newContent = after;
					}
					updateBlockContent(index, before);
					// TODO: Figure out why the text content isn't rerendering when we update the block content.
					targetEl.textContent = before;
				}
				addBlock(newContent);
				break;
			case 'ArrowDown':
				e.preventDefault();
				moveToNextBlock(targetEl, selection, index);
				break;
			case 'ArrowUp':
				e.preventDefault();
				moveToPrevBlock(targetEl, selection, index);
				break;
		}
	}

	function moveToNextBlock(el: HTMLElement, selection: Selection, index: number) {
		const { isMultiLine, position } = getCaretLinePosition(el, selection);
		if (isMultiLine && position !== CaretLinePosition.Last) {
			return;
		}

		const nextBlockId = data.at(index + 1)?.id;
		if (!nextBlockId) {
			return;
		}

		const nextBlock = document.getElementById(nextBlockId);
		nextBlock?.focus();
	}

	function moveToPrevBlock(el: HTMLElement, selection: Selection, index: number) {
		const { isMultiLine, position } = getCaretLinePosition(el, selection);
		if (isMultiLine && position !== CaretLinePosition.First) {
			return;
		}

		const prevBlockId = data.at(index - 1)?.id;
		if (!prevBlockId) {
			return;
		}

		const prevBlock = document.getElementById(prevBlockId);
		prevBlock?.focus();
	}

	let data: Blocks = $state([
		{
			classes: [],
			properties: {},
			id: 'myp',
			content: 'Hello, world!',
			type: 'p',
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-editor bind:this={el} onkeydown={handleKeydown}>
	{#each data as block, idx (block.id)}
		<Block {block} index={idx} {updateBlockContent} {addBlock} />
	{/each}
</div>

<style>
	:global {
		body {
			margin: 0;
		}
		[data-editor] {
			* {
				box-sizing: border-box;
				padding: 0;
				margin: 0;
				width: 20ch;
				padding-bottom: 1ch;
			}
			*:focus {
				outline: none;
			}
		}
	}
</style>
