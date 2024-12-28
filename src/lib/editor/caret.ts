import type { Blocks } from '$lib/types/block.js';
import { nextAnimationFrame } from './utils.js';

export function getCaretPosition(): number {
	return window.getSelection()?.getRangeAt(0).endOffset ?? 0;
}

export function parseElementIndex(el: HTMLElement): number[] | null {
	const index = el.getAttribute('data-index');
	if (!index) {
		return null;
	}

	const indices: number[] = [];
	for (const possibleIndex of index.split('.')) {
		const parsedIndex = parseInt(possibleIndex);
		if (isNaN(parsedIndex)) {
			return null;
		}
		indices.push(parsedIndex);
	}

	return indices;
}

export function caretIsAtTopOfElement(el: HTMLElement, range: Range): boolean {
	const selectionRect = range.getBoundingClientRect();
	const elRect = el.getBoundingClientRect();

	const computedStyle = getComputedStyle(el);
	const paddingTop = parseFloat(computedStyle.paddingTop);

	const effectiveTop = elRect.top + paddingTop;

	return Math.abs(selectionRect.top - effectiveTop) < getLineHeight(computedStyle);
}

export function caretIsAtBottomOfElement(el: HTMLElement, range: Range): boolean {
	const selectionRect = getBottomSelectionRect(range);
	const elRect = el.getBoundingClientRect();

	const computedStyle = getComputedStyle(el);
	const paddingBottom = parseFloat(computedStyle.paddingBottom);

	const effectiveBottom = elRect.bottom - paddingBottom;

	return Math.abs(selectionRect.bottom - effectiveBottom) < getLineHeight(computedStyle);
}

const NORMAL_LINE_HEIGHT = 1.2;
export function getLineHeight(computedStyle: CSSStyleDeclaration): number {
	const lineHeight = parseFloat(computedStyle.lineHeight);
	if (isNaN(lineHeight)) {
		const fontSize = parseFloat(computedStyle.fontSize);
		return fontSize * NORMAL_LINE_HEIGHT - 1;
	}
	return lineHeight;
}

/**
 * If the user is using Firefox, there is a quirk when the caret is at the start
 * of the line of an element with multiple lines. It will return the caret position
 * as the end of the previous line. Therefore, we append a span with a content of
 * of a zero-width space to the end of the range and use its bounding client rect.
 *
 * This also applies if the range is collapsed.
 */
function getBottomSelectionRect(range: Range): DOMRect {
	// TODO: Fix this workaround.
	if (navigator.userAgent.toLowerCase().includes('firefox')) {
		const zeroWidthSpace = document.createElement('span');
		zeroWidthSpace.style.opacity = '0';
		zeroWidthSpace.textContent = '\u200B';

		range.insertNode(zeroWidthSpace);
		const selectionRect = zeroWidthSpace.getBoundingClientRect();
		zeroWidthSpace.remove();

		return selectionRect;
	}

	const selectionRect = range.getBoundingClientRect();
	return selectionRect;
}

export function isBrowserFirefox(): boolean {
	return navigator.userAgent.toLowerCase().includes('firefox');
}

export function getCaretHorizontalPosition(): number {
	const selection = window.getSelection();
	if (!selection?.rangeCount) {
		return 0;
	}

	const range = selection.getRangeAt(0).cloneRange();
	range.collapse(false);

	const rect = range.getBoundingClientRect();
	return rect ? rect.left : 0;
}

export function traverseFromStartOfLine(
	node: Node,
	position: number,
	startOffset: number
): Range | null {
	const range = document.createRange();
	let prevOffset = 0;
	range.setStart(node, 0);

	if (node.nodeType === Node.TEXT_NODE) {
		const textNode = node.textContent ?? '';
		for (let i = startOffset; i < textNode.length; i++) {
			const newRange = document.createRange();
			newRange.setStart(node, i);
			newRange.collapse(true);

			const rect = newRange.getBoundingClientRect();
			if (!rect) {
				continue;
			}

			if (i === textNode.length - 1) {
				newRange.setStart(node, i + 1);
				newRange.collapse(true);
				return newRange;
			}

			if (rect.left < prevOffset) {
				return range;
			}

			if (rect.left >= position) {
				// We want to find the closest selection to the position.
				// At this point, we know that the position must be between
				// the current offset and the previous offset, e.g.:
				// ----- [prevOffset] ---- [position] ---- [currentOffset] -----
				// We need to determine if the position is closer to the current
				// position (i.e. rect.left), or the previous position (prevOffset).
				//
				// We could do this with either always returning the previous range
				// or the current range (the default), but it feels more natural
				// to do the somewhat elaborate comparison.
				return startOffset === 0 || closerToLeft(position, prevOffset, rect.left)
					? range
					: newRange;
			}

			prevOffset = rect.left;
			range.setStart(node, i);
		}

		startOffset += textNode.length;
	}

	for (const child of node.childNodes) {
		const childRange = traverseFromStartOfLine(child, position, startOffset);
		if (childRange) {
			return childRange;
		}
	}

	return null;
}

export function moveCaretToPositionFromLeft(
	selection: Selection,
	el: HTMLElement,
	position: number,
	startOffset: number
): void {
	const range = traverseFromStartOfLine(el, position, startOffset);
	if (!range) {
		return;
	}

	selection.removeAllRanges();
	selection.addRange(range);
}

export function moveCaretToPositionFromRight(
	selection: Selection,
	el: HTMLElement,
	position: number,
	startOffset: number
): void {
	const range = traverseFromEndOfLine(el, position, startOffset);
	if (!range) {
		return;
	}

	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

export function traverseFromEndOfLine(
	node: Node,
	position: number,
	startOffset: number
): Range | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const range = document.createRange();

		let prevOffset = 0;
		range.setStart(node, startOffset);

		for (let i = startOffset; i >= 0; i--) {
			const newRange = document.createRange();
			newRange.setStart(node, i);

			const rect = newRange.getBoundingClientRect();
			if (!rect) {
				continue;
			}

			if (rect.left <= position) {
				return closerToLeft(position, prevOffset, rect.left) ? range : newRange;
			}

			prevOffset = rect.left;
			range.setStart(node, i);
		}
	} else {
		for (let i = node.childNodes.length - 1; i >= 0; i--) {
			const child = node.childNodes[i];
			const range = traverseFromEndOfLine(child, position, startOffset);
			if (range) {
				return range;
			}
		}
	}

	return null;
}

/**
 * Test if a quantity is closer to the left value than the right value.
 * NOTE: If JavaScript allowed extension methods, this would be an ideal candidate.
 */
export function closerToLeft(val: number, left: number, right: number): boolean {
	return Math.abs(val - left) < Math.abs(val - right);
}

export async function moveCaretToEnd(el: HTMLElement) {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}

	const range = document.createRange();

	range.setStart(el, el.childNodes.length);
	range.collapse(true);

	selection.removeAllRanges();
	selection.addRange(range);
}

export function moveCaretDownOneLine(el: HTMLElement, selection: Selection): Range | null {
	const range = selection.getRangeAt(0);
	const currentTop = range.getBoundingClientRect().top;
	const nextRange = traverseDownOneLine(el, currentTop);
	if (!nextRange) {
		return null;
	}

	selection.removeAllRanges();
	selection.addRange(nextRange);

	return nextRange;
}

export function traverseDownOneLine(node: Node, top: number): Range | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const range = document.createRange();
		const textNode = node.textContent ?? '';
		for (let i = 0; i < textNode.length; i++) {
			range.setStart(node, i);

			const rect = range.getBoundingClientRect();
			if (!rect) {
				continue;
			}

			if (rect.top > top) {
				return range;
			}
		}
	}

	for (const child of node.childNodes) {
		const childRange = traverseDownOneLine(child, top);
		if (childRange) {
			return childRange;
		}
	}

	return null;
}

export function moveCaretUpOneLine(el: HTMLElement, selection: Selection): Range | null {
	const range = selection.getRangeAt(0);

	const currentY = range.getBoundingClientRect().y;
	const nextRange = traverseUpOneLine(el, currentY, range.startOffset);

	if (!nextRange) {
		return null;
	}

	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(nextRange);

	return nextRange;
}

export function traverseUpOneLine(node: Node, y: number, startOffset: number): Range | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const range = document.createRange();

		for (let i = startOffset - 1; i >= 0; i--) {
			range.setStart(node, i);

			const rect = range.getBoundingClientRect();
			if (!rect) {
				continue;
			}

			if (rect.y < y) {
				range.setStart(node, i + 1);
				range.setEnd(node, i + 1);
				return range;
			}
		}
	}

	for (let i = node.childNodes.length - 1; i >= 0; i--) {
		const child = node.childNodes[i];
		const range = traverseUpOneLine(child, y, startOffset);
		if (range) {
			return range;
		}
	}

	return null;
}

export async function moveCaretToStart(blocks: Blocks) {
	const firstBlock = blocks.at(0);
	const selection = window.getSelection();
	const firstEl = firstBlock ? document.getElementById(firstBlock.id) : null;
	if (!firstEl || !selection) {
		return;
	}

	const range = selection.getRangeAt(0);
	range.setStart(firstEl, 0);
	range.setEnd(firstEl, 0);

	selection.removeAllRanges();
	selection.addRange(range);

	// If there's padding at the top of the elemnt, the bounding client rect will
	// be at 0,0, but we want it to be at the top of the element. This is a workaround
	// to make the selection move the caret to the top of the element.
	// TODO: Figure out how to fix this.
	const rangeRect = range.getBoundingClientRect();
	if (
		rangeRect.top === 0 &&
		rangeRect.left === 0 &&
		rangeRect.right === 0 &&
		rangeRect.bottom === 0
	) {
		await nextAnimationFrame();
		moveCaretDownOneLine(firstEl, selection);
	}
}

export function moveToNextBlock(index: number, blocks: Blocks): HTMLElement | null {
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

export function moveToPrevBlock(index: number, blocks: Blocks): HTMLElement | null {
	const prevBlockId = blocks[index - 1]?.id;
	if (!prevBlockId) {
		return null;
	}

	const prevBlock = document.getElementById(prevBlockId);

	if (!prevBlock) {
		return null;
	}

	prevBlock.focus();
	moveCaretToEnd(prevBlock);

	return prevBlock;
}

export function caretIsAtEndOfEl(el: HTMLElement, selection: Selection) {
	if (selection.rangeCount === 0) {
		return false;
	}

	const range = selection.getRangeAt(0);
	const { endContainer, endOffset } = range;
	if (!el.contains(endContainer)) {
		return false;
	}

	if (endContainer.nodeType === Node.TEXT_NODE) {
		return endOffset === endContainer.textContent?.length;
	}

	const lastChild = el.lastChild;
	return (
		endContainer === el &&
		endOffset === el.childNodes.length &&
		lastChild &&
		lastChild.nodeType === Node.TEXT_NODE &&
		lastChild.textContent?.length === 0
	);
}
