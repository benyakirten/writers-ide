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

export enum CaretLinePosition {
	First,
	Last,
	Middle
}

const CARET_LINE_TOLERANCE_PX = 5;
export function getCaretLinePosition(
	el: HTMLElement,
	selection: Selection
): { isMultiLine: boolean; position: CaretLinePosition } {
	const range = selection.getRangeAt(0);
	const selectionRect = range.getBoundingClientRect();

	const elRect = el.getBoundingClientRect();

	const computedStyle = getComputedStyle(el);
	const paddingTop = parseFloat(computedStyle.paddingTop);
	const paddingBottom = parseFloat(computedStyle.paddingBottom);
	const lineHeight =
		parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.2;

	const effectiveBottom = elRect.bottom - paddingBottom;
	const effectiveTop = elRect.top + paddingTop;

	const isMultiLine = elRect.height - paddingTop - paddingBottom > lineHeight;
	let caretPosition = CaretLinePosition.Middle;

	if (Math.abs(selectionRect.bottom - effectiveBottom) < CARET_LINE_TOLERANCE_PX) {
		caretPosition = CaretLinePosition.Last;
	} else if (Math.abs(selectionRect.top - effectiveTop) < CARET_LINE_TOLERANCE_PX) {
		caretPosition = CaretLinePosition.First;
	}

	return { isMultiLine, position: caretPosition };
}
