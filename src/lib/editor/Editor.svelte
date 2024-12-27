<script lang="ts">
	import type { EditorProps, ParagraphData } from '$lib/types/block.js';
	import { tick } from 'svelte';
	import Block from './blocks/Block.svelte';
	import {
		getCaretHorizontalPosition,
		caretIsAtBottomOfElement,
		caretIsAtTopOfElement,
		moveCaretToPositionFromLeft,
		moveCaretToPositionFromRight,
		moveCaretDownOneLine,
		moveCaretToEnd,
		moveCaretToStart,
		moveCaretUpOneLine,
		moveToNextBlock,
		moveToPrevBlock,
		caretIsAtEndOfEl
	} from './caret.js';
	import { nextAnimationFrame } from './utils.js';

	let { blocks = $bindable() }: EditorProps = $props();

	let caretPosition = $state(0);
	let el: HTMLElement;

	async function handleKeydown(e: KeyboardEvent) {
		if (e.metaKey) {
			// TODO
			return;
		}

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
				caretPosition = Math.max(caretPosition, getCaretHorizontalPosition());
				if (!caretIsAtBottomOfElement(targetEl, range) && index !== blocks.length - 1) {
					range = moveCaretDownOneLine(targetEl, selection);
					if (!range) {
						return;
					}
					moveCaretToPositionFromLeft(selection, targetEl, caretPosition, range.startOffset);
				} else if (index === blocks.length - 1) {
					moveCaretToEnd(targetEl);
					recalibrateCaretPosition();
				} else {
					const nextBlock = moveToNextBlock(index, blocks);
					if (!nextBlock) {
						return;
					}
					moveCaretToPositionFromLeft(selection, nextBlock, caretPosition, 0);
				}

				break;
			case 'ArrowUp':
				e.preventDefault();
				caretPosition = Math.max(caretPosition, getCaretHorizontalPosition());
				if (!caretIsAtTopOfElement(targetEl, range)) {
					range = moveCaretUpOneLine(targetEl, selection);
					if (!range) {
						return;
					}
					moveCaretToPositionFromRight(selection, targetEl, caretPosition, range.endOffset);
				} else if (index === 0) {
					moveCaretToStart(blocks);
					recalibrateCaretPosition();
				} else {
					const prevBlock = moveToPrevBlock(index, blocks);
					if (!prevBlock) {
						return;
					}

					moveCaretToPositionFromRight(
						selection,
						prevBlock,
						caretPosition,
						prevBlock.textContent?.length ?? 0
					);
				}
				break;
			case 'ArrowLeft':
				if (selection.anchorOffset === 0 && index !== 0) {
					e.preventDefault();
					moveToPrevBlock(index, blocks);
				}
				recalibrateCaretPosition();
				break;
			case 'ArrowRight':
				if (caretIsAtEndOfEl(targetEl, selection) && index !== blocks.length - 1) {
					e.preventDefault();
					moveToNextBlock(index, blocks);
				}
				recalibrateCaretPosition();
				break;
		}
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
		caretPosition = 0;

		await tick();
		const el = document.getElementById(newBlock.id);
		el?.focus();
	}

	async function recalibrateCaretPosition() {
		await nextAnimationFrame();
		caretPosition = getCaretHorizontalPosition();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	data-editor
	bind:this={el}
	onkeydown={handleKeydown}
	onpointerup={recalibrateCaretPosition}
	onselectionchange={recalibrateCaretPosition}
>
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

			[contenteditable] {
				cursor: text;
			}
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
