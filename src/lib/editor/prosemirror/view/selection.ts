import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export function isSelectionAllBold(tr: Transaction): boolean {
	const { from, to } = tr.selection;
	let isBold = true;
	tr.doc.nodesBetween(from, to, (node) => {
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

export function isSelectionAllItalics(tr: Transaction): boolean {
	const { from, to } = tr.selection;
	let isItalics = true;
	tr.doc.nodesBetween(from, to, (node) => {
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
export type TextMarkPresence = {
	/** Marks that cover the entire selection. */
	complete: Set<string>;
	/** Marks that cover a portion of the selection. */
	partial: Set<string>;
};

/**
 * Get all marks for text nodes in the current selection. If the selection range is 0,
 * no marks are returned.
 * based off https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils */
export function findTextMarks(view: EditorView | undefined): TextMarkPresence {
	const complete = new Set<string>();
	const partial = new Set<string>();
	const analysis = {
		complete,
		partial
	};

	if (!view) {
		return analysis;
	}

	const { selection, doc } = view.state;
	const { from, to } = selection;
	if (from === to) {
		return analysis;
	}

	let isFirstRun = true;

	doc.nodesBetween(from, to, (node) => {
		if (!node.isText) {
			return;
		}

		const marks = node.marks.map((mark) => mark.type.name.toLowerCase());
		if (isFirstRun) {
			marks.forEach((mark) => complete.add(mark));
			isFirstRun = false;
		} else {
			complete.forEach((mark) => {
				if (!marks.includes(mark)) {
					complete.delete(mark);
					partial.add(mark);
				}
			});
			marks.forEach((mark) => {
				if (!complete.has(mark)) {
					partial.add(mark);
				}
			});
		}
	});

	return analysis;
}
