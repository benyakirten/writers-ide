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

/**
 * Identify which marks cover a portion of the selection,
 * and which marks cover the entire selection.
 */
export type MarkAnalysis = {
	/** Marks that cover the entire selection. */
	complete: Set<string>;
	/** Marks that cover a portion of the selection. */
	partial: Set<string>;
};
export class ProseMirrorEventBus extends Observable<{ id: string; view: EditorView }> {
	/**  based off https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils */
	analyzeTextMarks(view: EditorView | undefined): MarkAnalysis {
		const complete = new Set<string>();
		const partial = new Set<string>();
		const analysis = {
			complete,
			partial
		};

		if (!view) {
			return analysis;
		}

		const { selection, doc } = view.state;
		const { from, to } = selection;

		let isFirstRun = true;

		doc.nodesBetween(from, to, (node) => {
			if (!node.isText) {
				return;
			}

			const marks = node.marks.map((mark) => mark.type.name);
			if (isFirstRun) {
				marks.forEach((mark) => complete.add(mark));
				isFirstRun = false;
			} else {
				complete.forEach((mark) => {
					if (!marks.includes(mark)) {
						complete.delete(mark);
						partial.add(mark);
					}
				});
				marks.forEach((mark) => {
					if (!complete.has(mark)) {
						partial.add(mark);
					}
				});
			}
		});

		return analysis;
	}
}

const proseMirrorEventBus = new ProseMirrorEventBus();
export default proseMirrorEventBus;
