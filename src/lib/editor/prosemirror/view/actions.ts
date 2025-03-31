import type { EditorView } from 'prosemirror-view';
import { type EditorState, type Transaction } from 'prosemirror-state';

import { clamp } from '$lib/utils/numbers.js';
import { SelectionUtilities } from './selection.js';
import { INDENT_MAX, INDENT_MIN } from './constants.js';
import type { marks } from './marks.js';

export type UseableMarkName = keyof typeof marks;
export type TextAlignment = 'start' | 'end' | 'left' | 'center' | 'right' | 'justify';
export class ActionUtilities {
	static toggleTextMark(
		mark: UseableMarkName,
		state: EditorState,
		dispatch?: (tr: Transaction) => void,
		view?: EditorView,
		exclusiveWith?: UseableMarkName
	) {
		if (!view || !dispatch) {
			return false;
		}

		const { tr } = view.state;
		const { from, to } = tr.selection;
		if (from === to) {
			return false;
		}

		if (SelectionUtilities.doesSelectionHaveTextMark(tr.selection, tr.doc, mark)) {
			tr.removeMark(from, to, state.schema.marks[mark]);
			dispatch(tr);
			return true;
		}

		tr.addMark(from, to, state.schema.marks[mark].create());
		if (exclusiveWith) {
			tr.removeMark(from, to, state.schema.marks[exclusiveWith]);
		}

		dispatch(tr);
		return true;
	}

	static dent(
		direction: 'indent' | 'dedent',
		state: EditorState,
		dispatch?: (tr: Transaction) => void
	) {
		if (!dispatch) {
			return false;
		}
		const { from, to } = state.selection;
		const tr = state.tr;

		state.doc.nodesBetween(from, to, (node, pos) => {
			if (node.type.name === 'paragraph') {
				const newIndent =
					direction === 'dedent'
						? (node.attrs.indent || 0) - 1
						: (node.attrs.indent || INDENT_MIN) + 1;
				tr.setNodeMarkup(pos, undefined, {
					...node.attrs,
					indent: clamp(newIndent, INDENT_MIN, INDENT_MAX)
				});
			}
		});

		if (tr.docChanged) {
			dispatch(tr);
		}
		return true;
	}

	static setTextAlignment(
		alignment: TextAlignment,
		state: EditorState,
		dispatch?: (tr: Transaction) => void
	) {
		if (!dispatch) {
			return false;
		}

		const { from, to } = state.selection;
		const tr = state.tr;

		state.doc.nodesBetween(from, to, (node, pos) => {
			if (node.type.name === 'paragraph') {
				tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: alignment });
			}
		});

		if (tr.docChanged) {
			dispatch(tr);
		}
		return true;
	}
}
