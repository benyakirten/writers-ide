export enum HorizontalBarPosition {
	WindowTop = 'WINDOW_TOP',
	EditorTop = 'EDITOR_TOP',
	EditorBottom = 'EDITOR_BOTTOM'
}

export type VerticalBarState = {
	height: number;
	visible: boolean;
	data?: null;
};

class HorizontalVerticalBarState {
	bars = $state<Record<HorizontalBarPosition, VerticalBarState>>({
		[HorizontalBarPosition.WindowTop]: { height: 200, data: null, visible: true },
		[HorizontalBarPosition.EditorTop]: { height: 200, data: null, visible: true },
		[HorizontalBarPosition.EditorBottom]: { height: 200, data: null, visible: true }
	});
}

const horizontalVerticalBarState = new HorizontalVerticalBarState();
export default horizontalVerticalBarState;
