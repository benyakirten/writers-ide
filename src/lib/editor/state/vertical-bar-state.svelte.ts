export type VerticalBar = {
	width: number;
	visible: boolean;
	id: string;
	data?: null;
};

export enum HorizontalTextDirection {
	LTR = 'LTR',
	RTL = 'RTL'
}

export enum VerticalBarPosition {
	InlineStart = 'START',
	InlineEnd = 'END'
}

class VerticalBarState {
	constructor(public readonly minSize = 100) {}

	resizedSection: {
		id: string;
		x: number;
		resized: boolean;
		position: VerticalBarPosition;
	} | null = $state(null);
	inlineStart = $state<VerticalBar[]>([
		{ width: 200, data: null, visible: true, id: 'inline-start-1' },
		{ width: 200, data: null, visible: true, id: 'inline-start-2' }
	]);

	inlineEnd = $state<VerticalBar[]>([
		{ width: 200, data: null, visible: true, id: 'inline-start-3' }
	]);

	bars(id: string | number, position: VerticalBarPosition): VerticalBar | undefined {
		const bars = position === VerticalBarPosition.InlineStart ? this.inlineStart : this.inlineEnd;
		const bar = typeof id === 'number' ? bars.at(id) : bars.find((bar) => bar.id === id);
		return bar;
	}

	width(id: string | number, position: VerticalBarPosition): number {
		const bar = this.bars(id, position);
		if (!bar) {
			return 0;
		}

		return bar.width >= this.minSize && bar.visible ? bar.width : 0;
	}

	toggleBar(bar: VerticalBar) {
		if (bar.visible) {
			bar.visible = false;
			return;
		}

		bar.visible = true;
		if (bar.width < this.minSize) {
			bar.width = this.minSize;
		}
	}

	toggle(id: string | number, position: VerticalBarPosition) {
		const bar = this.bars(id, position);

		// Cannot toggle bar if the bar is being resized.
		// This is to fix that the mouseup listener is not removed when the bar is toggled.
		if (!bar || this.resizedSection?.resized) {
			return;
		}
		this.toggleBar(bar);
	}

	startResize(id: string, position: VerticalBarPosition, x: number) {
		this.resizedSection = { id, position, x, resized: false };
	}

	resize(event: MouseEvent) {
		if (!this.resizedSection || !(event.target instanceof HTMLElement)) {
			return;
		}

		if (!this.resizedSection.resized) {
			this.resizedSection.resized = true;
		}

		const { id, position, x } = this.resizedSection;
		const bar = this.bars(id, position);
		if (!bar) {
			return;
		}

		const shouldInvert = this.shouldInvert(position);

		const delta = (event.clientX - x) * (shouldInvert ? -1 : 1);
		const newSize = bar.width + delta;

		if (newSize <= this.minSize) {
			const { right, left } = event.target.getBoundingClientRect();
			this.resizedSection.x = shouldInvert ? right : left;
			bar.width = 0;
		} else {
			if (newSize >= this.minSize && !bar.visible) {
				bar.visible = true;
			}
			bar.width = newSize;
			this.resizedSection.x = event.clientX;
		}
	}

	getHorizontalTextDirection(): HorizontalTextDirection {
		const { body } = document;
		const dir = getComputedStyle(body).direction;
		return dir === 'rtl' ? HorizontalTextDirection.RTL : HorizontalTextDirection.LTR;
	}

	shouldInvert(bar: VerticalBarPosition): boolean {
		const dir = this.getHorizontalTextDirection();
		if (dir === HorizontalTextDirection.LTR) {
			return bar === VerticalBarPosition.InlineEnd;
		} else {
			return bar === VerticalBarPosition.InlineStart;
		}
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

	humanize(id: string | number, position: VerticalBarPosition): string {
		const index = typeof id === 'string' ? this.inlineStart.findIndex((bar) => bar.id === id) : id;
		const description =
			position === VerticalBarPosition.InlineStart ? 'inline start bar' : 'inline end bar';
		return `${description} #${index + 1}`;
	}
}

const verticalVerticalBarState = new VerticalBarState();
export default verticalVerticalBarState;
