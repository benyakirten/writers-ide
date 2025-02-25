import type { Node } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';

import { INDENT_MAX } from './constants.js';
import type { TextAlignment } from './actions.js';

/**
 * Check if every text node in the selection has a specific mark.
 */
export function doesSelectionHaveTextMark(
	{ from, to }: Selection,
	doc: Node,
	name: string
): boolean {
	if (from === to) {
		return false;
	}

	let hasMark = true;
	doc.nodesBetween(from, to, (node) => {
		if (
			hasMark &&
			node.isText &&
			!node.marks.find((mark) => mark.type.name.toLowerCase().includes(name.toLowerCase()))
		) {
			hasMark = false;
			return hasMark;
		}
	});
	return hasMark;
}

/**
 * Identify which marks cover a portion of the selection,
 * and which marks cover the entire selection.
 */
export type TextMarkPresence = Map<string, number>;

/**
 * Get all marks for text nodes in the current selection. If the selection range is 0,
 * no marks are returned.
 * based off https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils
 * but heavily modified.
 */
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

export function getIndentRatio({ from, to }: Selection, doc: Node): number | null {
	let indentLevels = 0;
	let maxIndents = 0;

	doc.nodesBetween(from, to, (node) => {
		if (node.type.name !== 'paragraph') {
			return;
		}

		maxIndents += INDENT_MAX;
		const indent = +node.attrs.indent;
		if (!isNaN(indent)) {
			indentLevels += node.attrs.indent ?? 0;
		}
	});

	if (maxIndents === 0) {
		return null;
	}

	return indentLevels / maxIndents;
}

export function getBlockAttributeRatio<Value>(
	{ from, to }: Selection,
	doc: Node,
	attribute: string,
	value: TextAlignment | ((val: Value) => boolean)
): number {
	let totalBlocks = 0;
	let occurrences = 0;

	doc.nodesBetween(from, to, (node) => {
		if (node.type.name !== 'paragraph') {
			return;
		}

		totalBlocks++;
		const val = node.attrs[attribute];
		if ((typeof val === 'string' && val === value) || (typeof value === 'function' && value(val))) {
			occurrences++;
		}
	});

	if (totalBlocks === 0) {
		return 0;
	}

	return occurrences / totalBlocks;
}
