import type { EditorView } from 'prosemirror-view';

export enum EditorState {
	Uninitialized = 'uninitialized',
	Unpaginated = 'unpaginated',
	Paginated = 'paginated'
}

export type UnpaginatedEditorData = {
	state: EditorState.Unpaginated;
	view: EditorView;
};

export type PaginatedEditorData = {
	state: EditorState.Paginated;
	data: EditorView;
	pages: EditorView[];
};

export type UninitializedEditorData = {
	state: EditorState.Uninitialized;
};

export type EditorData = UninitializedEditorData | UnpaginatedEditorData | PaginatedEditorData;

// Null represents an uninitialized state
export type TabView = EditorData | null;

export class ProseMirrorEditor {
	// registerEditor(id: string, view: EditorView): () => void {
	// 		const index = this.windows.findIndex((item) => item.id === id);
	// 		if (index === -1) {
	// 			return () => {};
	// 		}
	// 		this.windows[index] = {
	// 			id,
	// 			view: {
	// 				state: EditorState.Unpaginated,
	// 				view
	// 			}
	// 		};
	// 		return () => this.windows.splice(index, 1);
	// 	}
}
