import type { EditorView } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { groupSelectedBlocks } from '@writers-ide/word-processing/structure';
import { clampIndent, INDENT_MIN, type TextAlignment } from './formatting-policy';
import { doesSelectionHaveTextMark } from './selection-coverage';

/**
 * Toggles a text mark on the current selection in the ProseMirror editor. It returns a boolean for whether the operation was successful.
 * If every node in the selection has the mark, it removes the mark. It can optionally be passed in a `exclusiveWith` mark which will remove the other mark
 * if the mark is being added to the current selection.
 */
export function toggleTextMark(
	mark: string,
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
	view?: EditorView,
	exclusiveWith?: string,
): boolean {
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
	if (exclusiveWith) {
		tr.removeMark(from, to, state.schema.marks[exclusiveWith]);
	}

	dispatch(tr);
	return true;
}

/**
 * Adds or removes indentation from a selection of text between the maximum and minimum indentation levels (0-8).
 */
export function dent(
	direction: 'indent' | 'dedent',
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
) {
	if (!dispatch) {
		return false;
	}

	const { tr } = state;

	function setMarkupForNode(node: ProseMirrorNode, pos: number) {
		if (node.type.name !== 'paragraph') {
			return;
		}

		const newIndent =
			direction === 'dedent' ? (node.attrs.indent || 0) - 1 : (node.attrs.indent || INDENT_MIN) + 1;
		tr.setNodeMarkup(pos, null, {
			...node.attrs,
			indent: clampIndent(newIndent),
		});
	}

	const peerGroups = groupSelectedBlocks(state);
	for (const group of peerGroups) {
		if (group.kind === 'continuation') {
			setMarkupForNode(group.head.node, group.head.position);
		} else {
			setMarkupForNode(group.block.node, group.block.position);
		}
	}

	if (tr.docChanged) {
		dispatch(tr);
	}
	return true;
}

/**
 * Sets text alignment on a paragraph node of the following options: left, right, center and justify.
 */
export function setTextAlignment(
	alignment: TextAlignment,
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
) {
	if (!dispatch) {
		return false;
	}

	const tr = state.tr;

	function align(node: ProseMirrorNode, pos: number) {
		if (node.type.name !== 'paragraph') {
			return;
		}
		tr.setNodeMarkup(pos, null, { ...node.attrs, indent: INDENT_MIN, align: alignment });
	}

	const peerGroups = groupSelectedBlocks(state);
	for (const group of peerGroups) {
		if (group.kind === 'continuation') {
			align(group.head.node, group.head.position);
			align(group.continuation.node, group.continuation.position);
		} else {
			align(group.block.node, group.block.position);
		}
	}

	if (tr.docChanged) {
		dispatch(tr);
	}
	return true;
}
