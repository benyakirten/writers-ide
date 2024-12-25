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

export function isCaretAtTopOfElement(el: HTMLElement, selection: Selection): boolean {
	const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
	const elRect = el.getBoundingClientRect();

	const computedStyle = getComputedStyle(el);
	const paddingTop = parseFloat(computedStyle.paddingTop);

	const effectiveTop = elRect.top + paddingTop;

	return Math.abs(selectionRect.top - effectiveTop) < getLineHeight(computedStyle);
}

export function isCaretAtBottomOfElement(el: HTMLElement, selection: Selection): boolean {
	const selectionRect = getBottomSelectionRect(selection);
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
		return fontSize / NORMAL_LINE_HEIGHT;
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
function getBottomSelectionRect(selection: Selection): DOMRect {
	const range = selection.getRangeAt(0);

	if (navigator.userAgent.toLowerCase().includes('firefox')) {
		const zeroWidthSpace = document.createElement('span');
		zeroWidthSpace.style.opacity = '0';
		zeroWidthSpace.textContent = ' ';

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
