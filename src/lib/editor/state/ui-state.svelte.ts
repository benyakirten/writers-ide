export enum BarPosition {
	InlineBeginning,
	InlineStart,
	InlinEnd,
	WindowTop,
	EditorTop,
	EditorBottom
}

// TODO: Add all CSS units
// type CSSUnit = 'px' | 'em' | 'rem' | 'vw' | 'vh' | 'vmin' | 'vmax' | '%' | 'fr';

export type BarState = {
	visible: boolean;
	width: number;
	data?: null;
};

class UIState {
	ui = $state<Record<BarPosition, BarState>>({
		[BarPosition.InlineBeginning]: { visible: true, width: 200 },
		[BarPosition.InlineStart]: { visible: true, width: 200 },
		[BarPosition.InlinEnd]: { visible: true, width: 200 },
		[BarPosition.WindowTop]: { visible: true, width: 200 },
		[BarPosition.EditorTop]: { visible: true, width: 200 },
		[BarPosition.EditorBottom]: { visible: true, width: 200 }
	});
	floatingBars = $state<BarPosition[]>([]);
}

const uiState = new UIState();
export default uiState;
