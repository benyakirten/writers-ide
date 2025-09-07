import type { EditorView } from 'prosemirror-view';
import { type EditorState, type Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

import { clamp } from '$lib/utils/numbers';
import { SelectionUtilities } from './selection';
import { INDENT_MAX, INDENT_MIN } from './constants';
import type { marks } from './marks';
import {
	chainCommands,
	createParagraphNear,
	liftEmptyBlock,
	newlineInCode,
	splitBlockAs,
} from 'prosemirror-commands';
import { schema } from './schema';
import PageLayout, { PeerSelection } from '$lib/editor/state/page-layout.svelte';

export type UseableMarkName = keyof typeof marks;
export type TextAlignment = 'start' | 'end' | 'left' | 'center' | 'right' | 'justify';

/**
 * A collection of utility functions for adding and removing marks from a prosemirror document.
 */
export class ActionUtilities {
	/**
	 * Toggles a text mark on the current selection in the ProseMirror editor. It returns a boolean for whether the operation was successful.
	 * If every node in the selection has the mark, it removes the mark. It can optionally be passed in a `exclusiveWith` mark which will remove the other mark
	 * if the mark is being added to the current selection.
	 */
	static toggleTextMark(
		mark: UseableMarkName,
		state: EditorState,
		dispatch?: (tr: Transaction) => void,
		view?: EditorView,
		exclusiveWith?: UseableMarkName,
	): boolean {
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

	/**
	 * Adds or removes indentation from a selection of text between the maximum and minimum indentation levels (0-8).
	 */
	static dent(
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
				direction === 'dedent'
					? (node.attrs.indent || 0) - 1
					: (node.attrs.indent || INDENT_MIN) + 1;
			tr.setNodeMarkup(pos, null, {
				...node.attrs,
				indent: clamp(newIndent, INDENT_MIN, INDENT_MAX),
			});
		}

		const peerGroups = PageLayout.groupPeerParagraphs(state);
		for (const group of peerGroups) {
			if (group.type === PeerSelection.Peered) {
				setMarkupForNode(group.head.node, group.head.position);
			} else {
				setMarkupForNode(group.details.node, group.details.position);
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
	static setTextAlignment(
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

		const peerGroups = PageLayout.groupPeerParagraphs(state);
		for (const group of peerGroups) {
			if (group.type === PeerSelection.Peered) {
				align(group.head.node, group.head.position);
				align(group.peer.node, group.peer.position);
			} else {
				align(group.details.node, group.details.position);
			}
		}

		if (tr.docChanged) {
			dispatch(tr);
		}
		return true;
	}

	/**
	 * Slight modification of prosemirror-commands' `Enter` command to give the new paragraph generated
	 * an default indent value, which can be set in the PageLayout store. We undoubtedy want to separate
	 * this from various store. We will want some sort of ProseMirror layout settings store in the future
	 * where users can set/modify/add values for various options. I'm not sure where it belongs yet.
	 */
	static splitParagraph = chainCommands(
		newlineInCode,
		createParagraphNear,
		liftEmptyBlock,
		PageLayout.breakPeering,
		splitBlockAs(() => {
			return schema.node('paragraph', { indent: PageLayout.defaultParagraphIndent });
		}),
	);
}
