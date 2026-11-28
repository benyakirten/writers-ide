import type { Node } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';

import {
	doesSelectionHaveTextMark,
	findTextMarks,
	getIndentRatio,
	getBlockAttributeRatio,
} from '../menu/basic/selection-coverage';
import type { TextAlignment } from './actions';

/**
 * Identify which marks cover a portion of the selection,
 * and which marks cover the entire selection.
 */
export type TextMarkPresence = Map<string, number>;

export class SelectionUtilities {
	/**
	 * Check if every text node in the selection has a specific mark.
	 */
	static doesSelectionHaveTextMark(selection: Selection, doc: Node, name: string): boolean {
		return doesSelectionHaveTextMark(selection, doc, name);
	}

	/**
	 * Get all marks for text nodes in the current selection. If the selection range is 0,
	 * no marks are returned.
	 * based off https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils
	 * but heavily modified.
	 */
	static findTextMarks(selection: Selection, doc: Node): TextMarkPresence {
		return findTextMarks(selection, doc);
	}

	/**
	 * Given a selection of text of paragraph nodes, return the ratio of indentation levels
	 * to its potential maximum.
	 */
	static getIndentRatio(selection: Selection, doc: Node): number | null {
		return getIndentRatio(selection, doc);
	}

	/**
	 * Given a selection fo text nodes, return the ratio of nodes with a specific attribute
	 * to the total amount of nodes.
	 */
	static getBlockAttributeRatio<Value>(
		selection: Selection,
		doc: Node,
		attribute: string,
		value: TextAlignment | ((val: Value) => boolean),
	): number {
		return getBlockAttributeRatio(selection, doc, attribute, value);
	}
}
