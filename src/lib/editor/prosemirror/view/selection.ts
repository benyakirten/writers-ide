import type { Transaction } from 'prosemirror-state';

export function isSelectionAllBold(tr: Transaction): boolean {
	const { from, to } = tr.selection;
	let isBold = true;
	tr.doc.nodesBetween(from, to, (node) => {
		if (
			isBold &&
			node.isText &&
			!node.marks.find((mark) => mark.type.name.toLowerCase().includes('strong'))
		) {
			isBold = false;
			return isBold;
		}
	});
	return isBold;
}

export function isSelectionAllItalics(tr: Transaction): boolean {
	const { from, to } = tr.selection;
	let isItalic = true;
	tr.doc.nodesBetween(from, to, (node) => {
		if (
			isItalic &&
			node.isText &&
			!node.marks.find((mark) => mark.type.name.toLowerCase().includes('em'))
		) {
			isItalic = false;
			return isItalic;
		}
	});
	return isItalic;
}
