export enum HorizontalBarPosition {
	WindowBlockStart = 'WINDOW_START',
	WindowBlockEnd = 'WINDOW_END',
	EditorBlockStart = 'EDITOR_START',
	EditorBlockEnd = 'EDITOR_END'
}

export type HorizontalBar = {
	height: number;
	visible: boolean;
	id: string;
	data?: null;
};

class HorizontalBarState {
	constructor(public readonly minSize = 50) {}

	windowBlockStart = $state<HorizontalBar[]>([
		{ height: 100, data: null, visible: true, id: 'window-start-1' }
	]);
	windowBlockEnd = $state<HorizontalBar[]>([
		{ height: 100, data: null, visible: true, id: 'window-end-1' }
	]);
	editorBlockStart = $state<HorizontalBar[]>([
		{ height: 100, data: null, visible: true, id: 'editor-start-1' }
	]);
	editorBlockEnd = $state<HorizontalBar[]>([
		{ height: 100, data: null, visible: true, id: 'editor-end-1' }
	]);

	resizedSection: {
		id: string;
		y: number;
		resized: boolean;
		position: HorizontalBarPosition;
	} | null = $state(null);

	bars(position: HorizontalBarPosition): HorizontalBar[] {
		switch (position) {
			case HorizontalBarPosition.WindowBlockStart:
				return this.windowBlockStart;
			case HorizontalBarPosition.WindowBlockEnd:
				return this.windowBlockEnd;
			case HorizontalBarPosition.EditorBlockStart:
				return this.editorBlockStart;
			case HorizontalBarPosition.EditorBlockEnd:
				return this.editorBlockEnd;
		}
	}

	bar(id: string | number, position: HorizontalBarPosition): HorizontalBar | undefined {
		const bars = this.bars(position);
		const bar = typeof id === 'number' ? bars.at(id) : bars.find((bar) => bar.id === id);
		return bar;
	}

	height(bar: HorizontalBar): number {
		return bar.height >= this.minSize && bar.visible ? bar.height : 0;
	}

	toggleBar(bar: HorizontalBar) {
		if (bar.visible) {
			bar.visible = false;
			return;
		}

		bar.visible = true;
		if (bar.height < this.minSize) {
			bar.height = this.minSize;
		}
	}

	toggle(id: string | number, position: HorizontalBarPosition) {
		const bar = this.bar(id, position);

		// Cannot toggle bar if the bar is being resized.
		// This is to fix that the mouseup listener is not removed when the bar is toggled.
		if (!bar || this.resizedSection?.resized) {
			return;
		}
		this.toggleBar(bar);
	}

	startResize(id: string, position: HorizontalBarPosition, y: number) {
		this.resizedSection = { id, position, y, resized: false };
	}

	resize(event: MouseEvent) {
		const { target } = event;
		if (!this.resizedSection || !(target instanceof HTMLElement)) {
			return;
		}

		if (!this.resizedSection.resized) {
			this.resizedSection.resized = true;
		}

		const { id, position, y } = this.resizedSection;
		const bar = this.bar(id, position);
		if (!bar) {
			return;
		}

		const shouldInvert = this.shouldInvert(position);

		const delta = (event.clientY - y) * (shouldInvert ? -1 : 1);
		const newSize = bar.height + delta;

		if (newSize <= this.minSize) {
			bar.height = 0;
			requestAnimationFrame(() => {
				if (this.resizedSection) {
					const { top, bottom } = target.getBoundingClientRect();
					this.resizedSection.y = shouldInvert ? bottom : top;
				}
			});
		} else {
			if (newSize >= this.minSize && !bar.visible) {
				bar.visible = true;
			}
			bar.height = newSize;
			this.resizedSection.y = event.clientY;
		}
	}

	shouldInvert(position: HorizontalBarPosition): boolean {
		return (
			position === HorizontalBarPosition.WindowBlockEnd ||
			position === HorizontalBarPosition.EditorBlockEnd
		);
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

	humanize(id: string | number, bar: HorizontalBarPosition): string {
		const index = typeof id === 'string' ? this.bars(bar).findIndex((bar) => bar.id === id) : id;
		let description: string;
		switch (bar) {
			case HorizontalBarPosition.WindowBlockStart:
				description = 'Window Block Start';
				break;
			case HorizontalBarPosition.WindowBlockEnd:
				description = 'Window Block End';
				break;
			case HorizontalBarPosition.EditorBlockStart:
				description = 'Editor Block Start';
				break;
			case HorizontalBarPosition.EditorBlockEnd:
				description = 'Editor Block End';
				break;
		}

		return `${description} ${index + 1}`;
	}

	remove(id: string | number, position: HorizontalBarPosition) {
		const bars = this.bars(position);
		const index = typeof id === 'string' ? bars.findIndex((bar) => bar.id === id) : id;
		bars.splice(index, 1);
	}
}

const horizontalBarState = new HorizontalBarState();
export default horizontalBarState;
