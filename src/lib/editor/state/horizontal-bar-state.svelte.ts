import * as m from '$lib/paraglide/messages.js';

import { capitalize } from '$lib/utils/strings.js';

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

export class HorizontalBarState {
	constructor(
		public readonly windowMinSize = 50,
		public readonly editorMinSize = 30
	) {}

	windowBlockStart = $state<HorizontalBar[]>([]);
	windowBlockEnd = $state<HorizontalBar[]>([]);
	editorBlockStart = $state<HorizontalBar[]>([]);
	editorBlockEnd = $state<HorizontalBar[]>([]);

	resizedSection: {
		id: string;
		y: number;
		resized: boolean;
		position: HorizontalBarPosition;
	} | null = $state(null);

	add(
		{ height, id = crypto.randomUUID(), visible = true, data = null }: Partial<HorizontalBar>,
		position: HorizontalBarPosition
	): HorizontalBar {
		const bars = this.bars(position);
		const existingBar = bars.find((bar) => bar.id === id);
		if (existingBar) {
			return existingBar;
		}

		height = height ?? this.minSize(position);
		const bar = { height, id, visible, data };
		bars.push(bar);
		return bar;
	}

	minSize(position: HorizontalBarPosition): number {
		if (
			position === HorizontalBarPosition.WindowBlockEnd ||
			HorizontalBarPosition.WindowBlockStart
		) {
			return this.windowMinSize;
		} else {
			return this.editorMinSize;
		}
	}

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

	height(bar: HorizontalBar, position: HorizontalBarPosition): number {
		return bar.height >= this.minSize(position) && bar.visible ? bar.height : 0;
	}

	toggleBar(bar: HorizontalBar, position: HorizontalBarPosition) {
		if (bar.visible) {
			bar.visible = false;
			return;
		}

		const minSize = this.minSize(position);

		bar.visible = true;
		if (bar.height < minSize) {
			bar.height = minSize;
		}
	}

	toggle(id: string | number, position: HorizontalBarPosition) {
		const bar = this.bar(id, position);

		// Cannot toggle bar if the bar is being resized.
		// This is to fix that the mouseup listener is not removed when the bar is toggled.
		if (!bar || this.resizedSection?.resized) {
			return false;
		}

		this.toggleBar(bar, position);
		return true;
	}

	startResize(id: string, position: HorizontalBarPosition, y: number) {
		this.resizedSection = { id, position, y, resized: false };
	}

	async resize(event: MouseEvent): Promise<boolean> {
		const { target } = event;
		if (!this.resizedSection || !(target instanceof HTMLElement)) {
			return false;
		}

		const { id, position, y } = this.resizedSection;
		const bar = this.bar(id, position);
		if (!bar) {
			return false;
		}

		if (!this.resizedSection.resized) {
			this.resizedSection.resized = true;
		}

		const shouldInvert = this.shouldInvert(position);

		const delta = (event.clientY - y) * (shouldInvert ? -1 : 1);
		const newSize = bar.height + delta;

		if (newSize <= this.minSize(position)) {
			bar.height = 0;
			return new Promise((resolve) => {
				requestAnimationFrame(() => {
					if (this.resizedSection) {
						const { top, bottom } = target.getBoundingClientRect();
						this.resizedSection.y = shouldInvert ? bottom : top;
						resolve(true);
					}
				});
			});
		} else {
			if (!bar.visible) {
				bar.visible = true;
			}
			bar.height = newSize;
			this.resizedSection.y = event.clientY;
			return true;
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
		const bars = this.bars(bar);
		const index = typeof id === 'string' ? bars.findIndex((bar) => bar.id === id) : id;
		let description: string;
		switch (bar) {
			case HorizontalBarPosition.WindowBlockStart:
				description = m.window_block_start();
				break;
			case HorizontalBarPosition.WindowBlockEnd:
				description = m.window_block_end();
				break;
			case HorizontalBarPosition.EditorBlockStart:
				description = m.editor_block_start();
				break;
			case HorizontalBarPosition.EditorBlockEnd:
				description = m.editor_block_end();
				break;
		}

		const message =
			index === -1 || index >= bars.length
				? `${m.unknown()} ${description}`
				: `${description} ${m.number({ count: index + 1 })}`;

		return capitalize(message);
	}

	remove(id: string | number, position: HorizontalBarPosition) {
		const bars = this.bars(position);
		const index = typeof id === 'string' ? bars.findIndex((bar) => bar.id === id) : id;
		bars.splice(index, 1);
	}
}

const horizontalBarState = new HorizontalBarState();
export default horizontalBarState;
