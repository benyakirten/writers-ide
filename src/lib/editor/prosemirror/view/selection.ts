import type { Node } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';

export function isSelectionAllBold({ from, to }: Selection, doc: Node): boolean {
	let isBold = true;
	doc.nodesBetween(from, to, (node) => {
		if (
			isBold &&
			node.isText &&
			!node.marks.find((mark) => mark.type.name.toLowerCase().includes('bold'))
		) {
			isBold = false;
			return isBold;
		}
	});
	return isBold;
}

export function isSelectionAllItalics({ from, to }: Selection, doc: Node): boolean {
	let isItalics = true;
	doc.nodesBetween(from, to, (node) => {
		if (
			isItalics &&
			node.isText &&
			!node.marks.find((mark) => mark.type.name.toLowerCase().includes('italic'))
		) {
			isItalics = false;
			return isItalics;
		}
	});
	return isItalics;
}

/**
 * Identify which marks cover a portion of the selection,
 * and which marks cover the entire selection.
 */
export type TextMarkPresence = Map<string, number>;

/**
 * Get all marks for text nodes in the current selection. If the selection range is 0,
 * no marks are returned.
 * based off https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils */
export function findTextMarks({ from, to }: Selection, doc: Node): TextMarkPresence {
	const ratios = new Map<string, number>();

	if (from === to) {
		return ratios;
	}

	doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isText) {
			return;
		}

		// See how much of the text is selected.
		const start = Math.max(from, pos);
		const end = Math.min(to, pos + node.nodeSize);
		const selectedTextLength = end - start;

		const marks = node.marks.map((mark) => mark.type.name.toLowerCase());
		for (const mark of marks) {
			const _mark = mark.toLowerCase();
			const numLettersMarked = ratios.get(_mark) || 0;
			ratios.set(_mark, numLettersMarked + selectedTextLength);
		}
	});

	const totalLength = doc.textBetween(from, to).length;
	ratios.forEach((numLettersMarked, mark) => {
		const ratio = numLettersMarked / totalLength;
		ratios.set(mark, ratio);
	});

	return ratios;
}
