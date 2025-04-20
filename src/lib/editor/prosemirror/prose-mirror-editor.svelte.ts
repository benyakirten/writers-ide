import type { EditorView } from 'prosemirror-view';

export enum EditorState {
	Unpaginated = 'unpaginated',
	Paginated = 'paginated'
}

export type UnpaginatedEditorData = {
	state: EditorState.Unpaginated;
	view: EditorView;
};

export type PaginatedEditorData = {
	state: EditorState.Paginated;
	view: EditorView;
	pages: EditorView[];
};

export type EditorData = UnpaginatedEditorData | PaginatedEditorData;

export class ProseMirrorEditors {
	editors = $state<Record<string, EditorData>>({});

	register(id: string, view: EditorView): () => void {
		if (!this.editors[id]) {
			const editor: UnpaginatedEditorData = {
				state: EditorState.Unpaginated,
				view
			};
			this.editors[id] = editor;
		}

		return () => this.deregister(id);
	}

	deregister(id: string): void {
		if (this.editors[id]) {
			this.editors[id].view.destroy();
			delete this.editors[id];
		}
	}
}

const Editors = new ProseMirrorEditors();
export default Editors;
