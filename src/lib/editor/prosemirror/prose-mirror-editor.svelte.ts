import type { EditorView } from 'prosemirror-view';
import { PageObserver } from '../state/page-observer.svelte';

export class ProseMirrorEditors {
	editors = $state<Record<string, EditorView>>({});

	register(id: string, view: EditorView, obsId: string, el: HTMLElement): () => void {
		if (!this.editors[id]) {
			this.editors[id] = view;
		}

		const obsDeregister = PageObserver.register(obsId, el, id);

		return () => {
			this.deregister(id);
			obsDeregister();
		};
	}

	deregister(id: string): void {
		this.editors[id]?.destroy();
		delete this.editors[id];
	}

	get(id: string): EditorView | null {
		return this.editors[id] ?? null;
	}
}

const Editors = new ProseMirrorEditors();
export default Editors;
