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
	// Collapse to the right side point.
	// TODO: Determine if this is unnecessary.
	range.collapse(false);

	const rect = range.getBoundingClientRect();
	return rect ? rect.left : 0;
}

export function traverseFromLeft(node: Node, position: number): Range | null {
	const range = document.createRange();
	let prevOffset = 0;
	range.setStart(node, 0);
	if (node.nodeType === Node.TEXT_NODE) {
		const textNode = node.textContent ?? '';
		for (let i = 0; i < textNode.length; i++) {
			const newRange = document.createRange();
			newRange.setStart(node, i);
			newRange.collapse(true);

			const rect = newRange.getBoundingClientRect();
			if (!rect) {
				continue;
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
	}

	for (const child of node.childNodes) {
		const childRange = traverseFromLeft(child, position);
		if (childRange) {
			return childRange;
		}
	}

	return null;
}

export function moveCaretToPositionFromLeft(
	selection: Selection,
	el: HTMLElement,
	position: number
): void {
	const range = traverseFromLeft(el, position);
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
	// TODO
}

/**
 * Test if a quantity is closer to the left value than the right value.
 * NOTE: If JavaScript allowed extension methods, this would be an ideal candidate.
 */
export function closerToLeft(val: number, left: number, right: number): boolean {
	return Math.abs(val - left) < Math.abs(val - right);
}
