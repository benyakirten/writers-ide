import type { EditorView } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';

import { clamp } from '$lib/utils/numbers.js';
import { isSelectionAllBold, isSelectionAllItalics } from './selection.js';
import { INDENT_MAX, INDENT_MIN } from './constants.js';

export function toggleBold(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
	view?: EditorView
): boolean {
	if (!view || !dispatch) {
		return false;
	}

	const { tr } = view.state;
	const { from, to } = tr.selection;
	if (from === to) {
		return false;
	}

	if (isSelectionAllBold(tr.selection, tr.doc)) {
		tr.removeMark(from, to, state.schema.marks.bold);
		dispatch(tr);
		return true;
	}

	tr.addMark(from, to, state.schema.marks.bold.create());
	dispatch(tr);
	return true;
}

export function toggleItalics(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
	view?: EditorView
): boolean {
	if (!view || !dispatch) {
		return false;
	}

	const { tr } = view.state;
	const { from, to } = tr.selection;
	if (from === to) {
		return false;
	}

	if (isSelectionAllItalics(tr.selection, tr.doc)) {
		tr.removeMark(from, to, state.schema.marks.italic);
		dispatch(tr);
		return true;
	}

	tr.addMark(from, to, state.schema.marks.italic.create());
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
		if (node.isTextblock) {
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
		if (node.isTextblock) {
			const newIndent = (node.attrs.indent || INDENT_MIN) + 1;
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: clamp(newIndent, 0, INDENT_MAX) });
		}
	});

	if (tr.docChanged) {
		dispatch(tr);
	}
	return true;
}
