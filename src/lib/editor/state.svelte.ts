import type { EditorView } from 'prosemirror-view';

export type WindowData = {
	id: string;
	view?: EditorView | null;
};

export enum BarPosition {
	InlineBeginning,
	InlineStart,
	InlinEnd,
	WindowTop,
	EditorTop,
	EditorBottom
}

export type BarState = {
	visible: boolean;
	width?: number;
	data?: null;
};

class GlobalEditorState {
	windows = $state<WindowData[]>([]);
	ui = $state<Record<BarPosition, BarState>>({
		[BarPosition.InlineBeginning]: { visible: true },
		[BarPosition.InlineStart]: { visible: true },
		[BarPosition.InlinEnd]: { visible: true },
		[BarPosition.WindowTop]: { visible: true },
		[BarPosition.EditorTop]: { visible: true },
		[BarPosition.EditorBottom]: { visible: true }
	});
	floatingBars = $state<BarPosition[]>([]);

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

const globalEditorState = new GlobalEditorState();
export default globalEditorState;
