import type { EditorView } from 'prosemirror-view';
import { isSelectionAllBold, isSelectionAllItalics } from './selection.js';
import type { EditorState, Transaction } from 'prosemirror-state';

import { clamp } from './utils.js';
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

	if (isSelectionAllBold(tr)) {
		tr.removeMark(from, to, state.schema.marks.strong);
		dispatch(tr);
		return true;
	}

	tr.addMark(from, to, state.schema.marks.strong.create());
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

	if (isSelectionAllItalics(tr)) {
		tr.removeMark(from, to, state.schema.marks.em);
		dispatch(tr);
		return true;
	}

	tr.addMark(from, to, state.schema.marks.em.create());
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
			console.log(node.attrs.indent, newIndent);
			tr.setNodeMarkup(pos, undefined, {
				...node.attrs,
				indent: clamp(newIndent, INDENT_MIN, INDENT_MAX)
			});
		}
	});

	if (tr.docChanged) dispatch(tr);
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
			console.log(node.attrs.indent, newIndent);
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: clamp(newIndent, 0, INDENT_MAX) });
		}
	});

	if (tr.docChanged) dispatch(tr);
	return true;
}
