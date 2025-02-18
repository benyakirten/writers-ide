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
				return newRange;
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

export function closerToLeft(val: number, left: number, right: number): boolean {
	return Math.abs(val - left) < Math.abs(val - right);
}
