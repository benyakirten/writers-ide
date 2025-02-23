import type { EditorView } from 'prosemirror-view';
import { type EditorState, type Transaction } from 'prosemirror-state';

import { clamp } from '$lib/utils/numbers.js';
import { doesSelectionHaveTextMark } from './selection.js';
import { INDENT_MAX, INDENT_MIN } from './constants.js';

export function toggleMark(
	mark: string,
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
	view?: EditorView
) {
	if (!view || !dispatch) {
		return false;
	}

	const { tr } = view.state;
	const { from, to } = tr.selection;
	if (from === to) {
		return false;
	}

	if (doesSelectionHaveTextMark(tr.selection, tr.doc, mark)) {
		tr.removeMark(from, to, state.schema.marks[mark]);
		dispatch(tr);
		return true;
	}

	tr.addMark(from, to, state.schema.marks[mark].create());
	dispatch(tr);
	return true;
}

export function indentLess(state: EditorState, dispatch?: (tr: Transaction) => void) {
	if (!dispatch) {
		return false;
	}
	const { from, to } = state.selection;
	const tr = state.tr;

	state.doc.nodesBetween(from, to, (node, pos) => {
		if (node.type.name === 'paragraph') {
			const newIndent = (node.attrs.indent || 0) - 1;
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

export function indentMore(state: EditorState, dispatch?: (tr: Transaction) => void) {
	if (!dispatch) {
		return false;
	}
	const { from, to } = state.selection;
	const tr = state.tr;

	state.doc.nodesBetween(from, to, (node, pos) => {
		if (node.type.name === 'paragraph') {
			const newIndent = (node.attrs.indent || INDENT_MIN) + 1;
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: clamp(newIndent, 0, INDENT_MAX) });
		}
	});

	if (tr.docChanged) {
		dispatch(tr);
	}
	return true;
}
