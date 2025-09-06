import type { EditorView } from 'prosemirror-view';
import { PageObserver } from '../state/page-observer.svelte';

export type ProsemirrorPage = {
	view: EditorView;
	raw: object;
	container: HTMLElement;
	modified: Date;
};
export type EditorData = {
	view: EditorView;
	pages: ProsemirrorPage[];
	remainingView: EditorView;
};

export class ProseMirrorEditors {
	editors = $state<Record<string, EditorData>>({});

	register(id: string, view: EditorView, obsId: string, el: HTMLElement): () => void {
		if (!this.editors[id]) {
			const editor: EditorData = {
				view,
				pages: [],
				remainingView: view,
			};
			this.editors[id] = editor;
		}

		const obsDeregister = PageObserver.register(obsId, el, id);
		return () => {
			this.deregister(id);
			obsDeregister();
		};
	}

	deregister(id: string): void {
		this.editors[id].view?.destroy();
		delete this.editors[id];
	}

	get(id: string): EditorView | null {
		return this.editors[id]?.view || null;
	}
}

const Editors = new ProseMirrorEditors();
export default Editors;
