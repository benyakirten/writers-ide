export function getCaretPosition(): number {
	return window.getSelection()?.getRangeAt(0).startOffset ?? 0;
}

export function parseElementIndex(el: HTMLElement): number[] | null {
	const index = el.getAttribute('data-index');
	if (!index) return null;

	const indices: number[] = [];
	for (const possibleIndex of index.split('.')) {
		const parsedIndex = parseInt(possibleIndex);
		if (isNaN(parsedIndex)) return null;
		indices.push(parsedIndex);
	}

	return indices;
}

export function isCaretAtTopOfElement(el: HTMLElement, range: Range): boolean {
	const selectionRect = range.getBoundingClientRect();
	const elRect = el.getBoundingClientRect();

	const computedStyle = getComputedStyle(el);
	const paddingTop = parseFloat(computedStyle.paddingTop);

	const effectiveTop = elRect.top + paddingTop;

	return Math.abs(selectionRect.top - effectiveTop) < getLineHeight(computedStyle);
}

export function isCaretAtBottomOfElement(el: HTMLElement, range: Range): boolean {
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
				return closerToLeft(position, prevOffset, rect.left) ? range : newRange;
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
	position: number
): void {
	const range = traverseFromEndOfLine(el, position);
	if (!range) {
		return;
	}

	selection.removeAllRanges();
	selection.addRange(range);
}

export function traverseFromEndOfLine(node: Node, position: number): Range | null {
	if (node.nodeType === Node.TEXT_NODE) {
		const range = document.createRange();

		let prevOffset = 0;
		const textContent = node.textContent ?? '';
		range.setStart(node, textContent.length - 1);

		for (let i = textContent.length - 1; i >= 0; i--) {
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
			const range = traverseFromEndOfLine(child, position);
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

export function moveCursorToEnd(el: HTMLElement) {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}

	const range = document.createRange();

	// Set the range to the end of the content
	range.selectNodeContents(el);
	range.collapse(false);

	// Clear any existing selection and add the new range
	selection.removeAllRanges();
	selection.addRange(range);
}

export function moveCursorUpOneLine(range: Range) {
	const currentBottom = range.getBoundingClientRect().bottom;
	let nextBottom = currentBottom;
	while (nextBottom >= currentBottom) {
		range.setStartBefore(range.startContainer);
		nextBottom = range.getBoundingClientRect().bottom;
	}
}

export function moveCursorDownOneLine(el: HTMLElement, selection: Selection): Range | null {
	const range = selection.getRangeAt(0);
	const currentTop = range.getBoundingClientRect().top;
	const nextRange = traverseDownOneLine(el, range.startOffset, currentTop);
	if (!nextRange) {
		return null;
	}

	selection.removeAllRanges();
	selection.addRange(nextRange);

	return nextRange;
}

export function traverseDownOneLine(node: Node, startOffset: number, top: number): Range | null {
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
		const childRange = traverseDownOneLine(child, startOffset, top);
		if (childRange) {
			return childRange;
		}
	}

	return null;
}
