import type { EditorView } from 'prosemirror-view';
import { type EditorState, type Transaction } from 'prosemirror-state';

import { dent, setTextAlignment, toggleTextMark } from '../menu/basic/formatting-actions';
import type { marks } from './marks';
import {
	chainCommands,
	createParagraphNear,
	liftEmptyBlock,
	newlineInCode,
	splitBlockAs,
} from 'prosemirror-commands';
import { schema } from './schema';
import PageLayout from '$lib/editor/state/page-layout.svelte';

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
		return toggleTextMark(mark, state, dispatch, view, exclusiveWith);
	}

	/**
	 * Adds or removes indentation from a selection of text between the maximum and minimum indentation levels (0-8).
	 */
	static dent(
		direction: 'indent' | 'dedent',
		state: EditorState,
		dispatch?: (tr: Transaction) => void,
	) {
		return dent(direction, state, dispatch);
	}

	/**
	 * Sets text alignment on a paragraph node of the following options: left, right, center and justify.
	 */
	static setTextAlignment(
		alignment: TextAlignment,
		state: EditorState,
		dispatch?: (tr: Transaction) => void,
	) {
		return setTextAlignment(alignment, state, dispatch);
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
