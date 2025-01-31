import type { EditorView } from 'prosemirror-view';

type EditorData = {
	id: string;
	view: EditorView;
};

export class GlobalState {
	static data = $state<EditorData[]>([]);

	static register(view: EditorView): () => void {
		const id = crypto.randomUUID();
		this.data.push({ id, view });
		return () => {
			const index = this.data.findIndex((item) => item.id === id);
			if (index !== -1) {
				this.data.splice(index, 1);
			}
		};
	}
}
