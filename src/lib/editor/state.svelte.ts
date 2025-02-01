import type { EditorView } from 'prosemirror-view';

export type WindowData = {
	id: string;
	view?: EditorView | null;
};

class GlobalEditorState {
	windows = $state<WindowData[]>([]);

	// Other types of tabs?
	register(id: string, view: EditorView | null): () => void {
		const index = this.windows.findIndex((item) => item.id === id);
		this.windows[index].view = view;
		return () => this.windows.splice(index, 1);
	}

	preregister(): string {
		const id = crypto.randomUUID();
		this.windows.push({ id });
		return id;
	}

	remove(id: string): void {
		const index = this.windows.findIndex((item) => item.id === id);
		this.windows.splice(index, 1);
	}
}

const globalEditorState = new GlobalEditorState();
export default globalEditorState;
