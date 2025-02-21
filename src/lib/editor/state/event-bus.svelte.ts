import { Observable } from '$lib/utils/observable.js';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const observer = new Observable<{ id: string; view: EditorView }>();

export const createUpdtePlugin = (id: string) =>
	new Plugin({
		view(view) {
			observer.update({ id, view });

			return {
				destroy() {
					proseMirrorEventBus.remove(id);
				},
				update(view) {
					observer.update({ id, view });
				}
			};
		}
	});

export class ProseMirrorEventBus {
	#subscribers: Map<string, (view: EditorView) => void> = new Map();
	views: Map<string, EditorView> = new Map();
	unsubscribe: () => void;

	constructor() {
		this.unsubscribe = observer.subscribe(({ id, view }) => {
			this.views.set(id, view);
			for (const subscriber of this.#subscribers.values()) {
				subscriber(view);
			}
		});
	}

	remove(id: string) {
		this.views.delete(id);
	}

	destroy() {
		this.unsubscribe();
	}

	subscribe(callback: (view: EditorView) => void) {
		const id = crypto.randomUUID();
		this.#subscribers.set(id, callback);
		return () => this.#subscribers.delete(id);
	}

	// https://github.com/PierBover/prosemirror-cookbook?tab=readme-ov-file#utils
	getActiveMarkCodes(view: EditorView | undefined): string[] {
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
