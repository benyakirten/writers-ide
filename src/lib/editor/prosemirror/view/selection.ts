import type { Transaction } from 'prosemirror-state';

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
