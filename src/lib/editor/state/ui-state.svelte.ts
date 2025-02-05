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
	width: number;
	data?: null;
};

class UIState {
	readonly MIN_SIZE = 100;
	ui = $state<Record<BarPosition, BarState>>({
		[BarPosition.InlineBeginning]: { visible: true, width: 200, data: null },
		[BarPosition.InlineStart]: { visible: true, width: 200, data: null },
		[BarPosition.InlinEnd]: { visible: true, width: 200, data: null },
		[BarPosition.WindowTop]: { visible: true, width: 200, data: null },
		[BarPosition.EditorTop]: { visible: true, width: 200, data: null },
		[BarPosition.EditorBottom]: { visible: true, width: 200, data: null }
	});
}

const uiState = new UIState();
export default uiState;
