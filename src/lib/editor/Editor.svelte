<script lang="ts">
	import type { Blocks, ParagraphData } from '$lib/types/block.js';
	import { tick } from 'svelte';
	import Block from './blocks/Block.svelte';
	import {
		getCaretHorizontalPosition,
		isCaretAtBottomOfElement,
		isCaretAtTopOfElement,
		moveCaretToPositionFromLeft,
		moveCaretToPositionFromRight
	} from './cursor.js';

	// TODO: Move this into a separate store.
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
				cursorPosition = Math.max(cursorPosition, getCaretHorizontalPosition());
				const nextBlock = moveToNextBlock(e, targetEl, selection, index);
				if (!nextBlock) {
					return;
				}

				moveCaretToPositionFromLeft(selection, nextBlock, cursorPosition);
				break;
			case 'ArrowUp':
				cursorPosition = Math.max(cursorPosition, getCaretHorizontalPosition());
				const prevBlock = moveToPrevBlock(e, targetEl, selection, index);

				if (!prevBlock) {
					return;
				}

				moveCaretToPositionFromRight(selection, prevBlock, cursorPosition);
				break;
			// TODO: Store the cursor position in the state on left or right move
			case 'ArrowLeft':
				cursorPosition = getCaretHorizontalPosition();
				break;
			case 'ArrowRight':
				cursorPosition = getCaretHorizontalPosition();
				break;
		}
	}

	function moveToNextBlock(
		e: KeyboardEvent,
		el: HTMLElement,
		selection: Selection,
		index: number
	): HTMLElement | null {
		if (!isCaretAtBottomOfElement(el, selection.getRangeAt(0))) {
			return null;
		}

		const nextBlockId = data.at(index + 1)?.id;
		if (!nextBlockId) {
			return null;
		}

		e.preventDefault();
		const nextBlock = document.getElementById(nextBlockId);

		if (!nextBlock) {
			return null;
		}

		nextBlock.focus();
		return nextBlock;
	}

	function moveToPrevBlock(
		e: KeyboardEvent,
		el: HTMLElement,
		selection: Selection,
		index: number
	): HTMLElement | null {
		if (!isCaretAtTopOfElement(el, selection.getRangeAt(0))) {
			return null;
		}

		const prevBlockId = data[index - 1]?.id;
		if (!prevBlockId) {
			return null;
		}

		e.preventDefault();
		const prevBlock = document.getElementById(prevBlockId);

		if (!prevBlock) {
			return null;
		}

		prevBlock.focus();
		moveCursorToEnd(prevBlock);

		return prevBlock;
	}

	let data: Blocks = $state([
		{
			classes: [],
			properties: {},
			id: 'myp1',
			content: 'Hello, world! I want to write a very long message that will span multiple lines.',
			type: 'p',
			children: []
		},
		{
			classes: [],
			properties: {},
			id: 'myp2',
			content: 'This is another long message that spans multiple lines..',
			type: 'p',
			children: []
		},
		{
			classes: [],
			properties: {},
			id: 'myp3',
			content: 'Short message!.',
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
		cursorPosition = 0;

		await tick();
		const el = document.getElementById(newBlock.id);
		el?.focus();
	}

	function moveCursorToEnd(editableElement: HTMLElement) {
		const selection = window.getSelection();
		if (!selection) {
			return;
		}

		const range = document.createRange();

		// Set the range to the end of the content
		range.selectNodeContents(editableElement);
		range.collapse(false);

		// Clear any existing selection and add the new range
		selection.removeAllRanges();
		selection.addRange(range);
	}

	function handleClick(e: PointerEvent) {
		if (!(e.target instanceof HTMLElement)) {
			return;
		}
		cursorPosition = e.clientX;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-editor bind:this={el} onkeydown={handleKeydown} onpointerdown={handleClick}>
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
			padding: 1rem;
			word-wrap: break-word;

			* {
				box-sizing: border-box;
				padding: 0;
				margin: 0;
				max-width: 20ch;
				padding-bottom: 1ch;
			}
			*:focus {
				outline: none;
			}
		}
	}
</style>
