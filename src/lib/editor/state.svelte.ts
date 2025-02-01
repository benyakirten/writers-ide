import type { EditorView } from 'prosemirror-view';

type EditorData = {
	id: string;
	view?: EditorView;
};

class GlobalEditorState {
	editors = $state<EditorData[]>([]);

	register(id: string, view: EditorView): () => void {
		const index = this.editors.findIndex((item) => item.id === id);
		this.editors[index].view = view;
		return () => this.editors.splice(index, 1);
	}

	preregister(): string {
		const id = crypto.randomUUID();
		this.editors.push({ id });
		return id;
	}

	remove(id: string): void {
		const index = this.editors.findIndex((item) => item.id === id);
		this.editors.splice(index, 1);
	}
}

const globalEditorState = new GlobalEditorState();
export default globalEditorState;
