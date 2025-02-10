export enum HorizontalBarPosition {
	WindowTop = 'WINDOW_TOP',
	EditorTop = 'EDITOR_TOP',
	EditorBottom = 'EDITOR_BOTTOM'
}

export type HorizontalBar = {
	height: number;
	visible: boolean;
	data?: null;
};

class HorizontalBarState {
	constructor(public readonly minSize = 100) {}

	bars = $state<Record<HorizontalBarPosition, HorizontalBar>>({
		[HorizontalBarPosition.WindowTop]: { height: 200, data: null, visible: true },
		[HorizontalBarPosition.EditorTop]: { height: 200, data: null, visible: true },
		[HorizontalBarPosition.EditorBottom]: { height: 200, data: null, visible: true }
	});

	resizedSection: { bar: HorizontalBarPosition; y: number; resized: boolean } | null = $state(null);

	height(bar: HorizontalBarPosition): number {
		return this.bars[bar].height >= this.minSize && this.bars[bar].visible
			? this.bars[bar].height
			: 0;
	}

	toggle(bar: HorizontalBarPosition) {
		if (this.resizedSection?.resized) {
			return;
		}

		const currentBar = this.bars[bar];
		if (currentBar.visible) {
			currentBar.visible = false;
			return;
		}

		currentBar.visible = true;
		if (this.bars[bar].height < this.minSize) {
			this.bars[bar].height = this.minSize;
		}
	}

	startResize(bar: HorizontalBarPosition, y: number) {
		this.resizedSection = { bar, y, resized: false };
	}

	resize(event: MouseEvent) {
		if (!this.resizedSection || !(event.target instanceof HTMLElement)) {
			return;
		}

		if (!this.resizedSection.resized) {
			this.resizedSection.resized = true;
		}

		const { bar, y } = this.resizedSection;
		const shouldInvert = HorizontalBarState.shouldInvert(bar);

		const delta = (event.clientY - y) * (shouldInvert ? -1 : 1);
		const newSize = this.bars[bar].height + delta;

		if (newSize <= this.minSize) {
			// Collapse the bar
			const { bottom, top } = event.target.getBoundingClientRect();
			this.resizedSection.y = shouldInvert ? bottom : top;
			this.bars[bar].height = 0;
		} else {
			// Resize the bar doing two things:
			// 1. If the bar has been dragged enough that it's over minimum size
			//   and it's not visible, make it visible.
			// 2. Set the bar's new height
			// 3. Update the last Y position for future comparisons.
			if (newSize >= this.minSize && !this.bars[bar].visible) {
				this.bars[bar].visible = true;
			}
			this.bars[bar].height = newSize;
			this.resizedSection.y = event.clientY;
		}
	}

	static shouldInvert(bar: HorizontalBarPosition): boolean {
		return bar === HorizontalBarPosition.EditorBottom;
	}

	async endResize(): Promise<void> {
		// We defer this because we want the click trigger to run first (`this.toggle`).
		await new Promise((resolve) => {
			requestAnimationFrame(() => {
				this.resizedSection = null;
				resolve(true);
			});
		});
	}
}

const horizontalBarState = new HorizontalBarState();
export default horizontalBarState;
