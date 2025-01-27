import type { EditorView } from 'prosemirror-view';
import { isSelectionAllBold, isSelectionAllItalics } from './selection.js';
import type { EditorState, Transaction } from 'prosemirror-state';

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
