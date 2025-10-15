import type { EditorView } from 'prosemirror-view';
import { PageObserver } from '../state/page-observer.svelte';

type EditorDetails = {
	name: string;
	view: EditorView;
};

export class ProseMirrorEditors {
	editors = $state<Record<string, EditorDetails>>({});

	register(
		id: string,
		fileName: string,
		view: EditorView,
		obsId: string,
		el: HTMLElement,
	): () => void {
		if (!this.editors[id]) {
			this.editors[id] = { name: fileName, view };
		}

		const obsDeregister = PageObserver.register(obsId, el, id);

		return () => {
			this.deregister(id);
			obsDeregister();
		};
	}

	deregister(id: string): void {
		this.editors[id]?.view.destroy();
		delete this.editors[id];
	}

	get(id: string): EditorDetails | null {
		return this.editors[id] ?? null;
	}
}

const Editors = new ProseMirrorEditors();
export default Editors;
