import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { Observable } from '$lib/utils/observable.js';

export const createUpdtePlugin = (id: string) =>
	new Plugin({
		view(view) {
			proseMirrorEventBus.update({ id, view });

			return {
				update(view) {
					proseMirrorEventBus.update({ id, view });
				}
			};
		}
	});

export type MarkAnalysis = {
	active: Set<string>;
	partial: Set<string>;
};
export class ProseMirrorEventBus extends Observable<{ id: string; view: EditorView }> {
	// based off https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils
	getActiveMarkCodes(view: EditorView | undefined): string[] {
		// TODO: Seperate these into marks that are in every part of the selection
		// and marks that are only in some parts of the selection
		if (!view) {
			return [];
		}

		const isEmpty = view.state.selection.empty;
		const state = view.state;

		if (isEmpty) {
			const from = view.state.selection.$from;
			const storedMarks = state.storedMarks;

			// Return either the stored marks, or the marks at the cursor position.
			// Stored marks are the marks that are going to be applied to the next input
			// if you dispatched a mark toggle with an empty cursor.
			if (storedMarks) {
				return storedMarks.map((mark) => mark.type.name);
			} else {
				return from.marks().map((mark) => mark.type.name);
			}
		} else {
			const head = view.state.selection.$head;
			const anchor = view.state.selection.$anchor;

			// We're using a Set to not get duplicate values
			const activeMarks = new Set<string>();

			// Here we're getting the marks at the head and anchor of the selection
			head.marks().forEach((mark) => activeMarks.add(mark.type.name));
			anchor.marks().forEach((mark) => activeMarks.add(mark.type.name));

			return Array.from(activeMarks);
		}
	}
}

const proseMirrorEventBus = new ProseMirrorEventBus();
export default proseMirrorEventBus;
