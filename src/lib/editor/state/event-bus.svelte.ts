import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { Observable } from '$lib/utils/observable.js';

export const createUpdatePlugin = (id: string) =>
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

export class ProseMirrorEventBus extends Observable<{ id: string; view: EditorView }> {}

const proseMirrorEventBus = new ProseMirrorEventBus();
export default proseMirrorEventBus;
