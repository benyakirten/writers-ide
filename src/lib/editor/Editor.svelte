<script lang="ts">
	import type { EditorProps, ParagraphData } from '$lib/types/block.js';
	import { tick } from 'svelte';
	import Block from './blocks/Block.svelte';
	import {
		getCaretHorizontalPosition,
		isCaretAtBottomOfElement,
		isCaretAtTopOfElement,
		moveCaretToPositionFromLeft,
		moveCaretToPositionFromRight,
		moveCursorDownOneLine,
		moveCursorToEnd
	} from './cursor.js';

	let { blocks = $bindable() }: EditorProps = $props();

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
		let range: Range | null = selection.getRangeAt(0);

		switch (e.key) {
			case 'Enter':
				e.preventDefault();
				let newContent = '';

				if (selection) {
					const position = selection.getRangeAt(0).startOffset;
					const text = targetEl.textContent ?? '';
					const before = text.slice(0, position);
					const after = text.slice(position);
					if (selection.toString().length === 0) {
						newContent = after;
					}
					updateBlockContent(index, before);
					targetEl.textContent = before;
				}
				addBlock(index, newContent);
				break;
			case 'ArrowDown':
				e.preventDefault();
				cursorPosition = Math.max(cursorPosition, getCaretHorizontalPosition());
				if (!isCaretAtBottomOfElement(targetEl, range)) {
					range = moveCursorDownOneLine(targetEl, selection);
					if (!range) {
						return;
					}
					moveCaretToPositionFromLeft(selection, targetEl, cursorPosition, range.startOffset);
				} else if (index === blocks.length - 1) {
					moveCursorToEnd(targetEl);
				} else {
					const nextBlock = moveToNextBlock(index);
					if (!nextBlock) {
						return;
					}
					moveCaretToPositionFromLeft(selection, nextBlock, cursorPosition, 0);
				}

				break;
			case 'ArrowUp':
				cursorPosition = Math.max(cursorPosition, getCaretHorizontalPosition());
				if (!isCaretAtTopOfElement(targetEl, range)) {
					return;
				}

				const prevBlock = moveToPrevBlock(index);
				if (!prevBlock) {
					return;
				}

				moveCaretToPositionFromRight(selection, prevBlock, cursorPosition);
				break;
			case 'ArrowLeft':
				cursorPosition = getCaretHorizontalPosition();
				break;
			case 'ArrowRight':
				cursorPosition = getCaretHorizontalPosition();
				break;
		}
	}

	function moveToNextBlock(index: number): HTMLElement | null {
		const nextBlockId = blocks.at(index + 1)?.id;
		if (!nextBlockId) {
			return null;
		}

		const nextBlock = document.getElementById(nextBlockId);

		if (!nextBlock) {
			return null;
		}

		nextBlock.focus();
		return nextBlock;
	}

	function moveToPrevBlock(index: number): HTMLElement | null {
		const prevBlockId = blocks[index - 1]?.id;
		if (!prevBlockId) {
			return null;
		}

		const prevBlock = document.getElementById(prevBlockId);

		if (!prevBlock) {
			return null;
		}

		prevBlock.focus();
		moveCursorToEnd(prevBlock);

		return prevBlock;
	}

	function updateBlockContent(index: number, content: string) {
		blocks[index].content = content;
	}

	async function addBlock(index: number, text: string) {
		const newBlock: ParagraphData = {
			type: 'p',
			content: text,
			id: `a${Math.random().toString(36).substring(7)}`,
			classes: [],
			properties: {},
			children: []
		};
		blocks.splice(index + 1, 0, newBlock);
		cursorPosition = 0;

		await tick();
		const el = document.getElementById(newBlock.id);
		el?.focus();
	}

	function handlePointerDown(e: PointerEvent) {
		if (!(e.target instanceof HTMLElement)) {
			return;
		}
		cursorPosition = e.clientX;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-editor bind:this={el} onkeydown={handleKeydown} onpointerdown={handlePointerDown}>
	{#each blocks as block, idx (block.id)}
		<Block {block} index={idx} {updateBlockContent} />
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
