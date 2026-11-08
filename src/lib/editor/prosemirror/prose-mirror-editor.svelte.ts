import type { EditorView } from 'prosemirror-view';
import { PageObserver } from '../state/page-observer.svelte';
import { workQueue } from '../state/work-queue.svelte';

export type EditorDetails = {
	name: string;
	documentId: string;
	viewId: string;
	view: EditorView;
};

export class ProseMirrorEditors {
	/** View identity is independent of document identity; shared editing is not implemented yet. */
	editors = $state<Record<string, EditorDetails>>({});

	register(
		documentId: string,
		name: string,
		view: EditorView,
		viewId: string,
		viewport: HTMLElement,
	): () => void {
		this.deregister(viewId);
		this.editors[viewId] = { name, documentId, viewId, view };

		PageObserver.register(viewId, documentId, view, viewport);

		const registration = this.editors[viewId];
		return () => {
			if (this.editors[viewId] === registration) this.deregister(viewId);
		};
	}

	deregister(viewId: string): void {
		workQueue.cancelView(viewId);
		PageObserver.deregister(viewId);
		this.editors[viewId]?.view.destroy();
		delete this.editors[viewId];
	}

	getView(viewId: string): EditorDetails | null {
		return this.editors[viewId] ?? null;
	}

	getViews(documentId: string): EditorDetails[] {
		return Object.values(this.editors).filter((editor) => editor.documentId === documentId);
	}

	/** Compatibility lookup for document-oriented menu callers. */
	get(documentId: string): EditorDetails | null {
		return this.getViews(documentId)[0] ?? null;
	}
}

const Editors = new ProseMirrorEditors();
export default Editors;
