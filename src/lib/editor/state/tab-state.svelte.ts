import { IdGenerator } from '@/services/ids';
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

export type TabData = {
	id: string;
	view: TabView;
};

export class TabState {
	windows = $state<TabData[]>([
		{
			id: 'my-1',
			view: null
		}
	]);

	#active = $state<string | null>(null);
	active = $derived.by(
		() => this.windows.find((window) => window.id === this.#active)?.view ?? null
	);

	activate = (id: string | number): boolean => {
		if (typeof id === 'number') {
			if (id > this.windows.length) {
				return false;
			}

			this.#active = this.windows[id].id;
			return true;
		}

		const active = this.windows.find((item) => item.id === id);
		if (!active) {
			return false;
		}

		this.#active = active.id;
		return true;
	};

	deactivate(): void {
		this.#active = null;
	}

	// Other types of tabs?
	registerEditor(id: string, view: EditorView): () => void {
		const index = this.windows.findIndex((item) => item.id === id);
		if (index === -1) {
			return () => {};
		}
		this.windows[index] = {
			id,
			view: {
				state: EditorState.Unpaginated,
				view
			}
		};
		return () => this.windows.splice(index, 1);
	}

	createTab(): string {
		const id = IdGenerator.generate();
		this.windows.push({ id, view: null });
		return id;
	}

	createEditor(): void {
		const id = IdGenerator.generate();
		this.windows.push({ id, view: { state: EditorState.Uninitialized } });
	}

	remove(id: string): void {
		const index = this.windows.findIndex((item) => item.id === id);
		this.windows.splice(index, 1);
	}

	swap(id1: string, id2: string): boolean {
		const index1 = this.windows.findIndex((item) => item.id === id1);
		const index2 = this.windows.findIndex((item) => item.id === id2);

		if (index1 === -1 || index2 === -1) {
			return false;
		}

		const temp = this.windows[index1];
		this.windows[index1] = this.windows[index2];
		this.windows[index2] = temp;

		return true;
	}

	private isValidWindowIndex(index: number): boolean {
		return index >= 0 && index < this.windows.length;
	}

	swapByIndex(index1: number, index2: number): boolean {
		if (!this.isValidWindowIndex(index1) || !this.isValidWindowIndex(index2)) {
			return false;
		}

		const temp = this.windows[index1];
		this.windows[index1] = this.windows[index2];
		this.windows[index2] = temp;

		return true;
	}

	moveToPosition(id: string | number, position: number): boolean {
		const index = typeof id === 'number' ? id : this.windows.findIndex((item) => item.id === id);

		if (index === -1 || position < 0 || position >= this.windows.length) {
			return false;
		}

		const [item] = this.windows.splice(index, 1);
		this.windows.splice(position, 0, item);

		return true;
	}
}

const tabState = new TabState();
export default tabState;
