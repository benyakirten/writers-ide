// TODO: Should there be a far enline end to mirror InlineStartOuter?
export enum VerticalBarPosition {
	InlineStartOuter = 'START_OUTER',
	InlineStartInner = 'START_INNER',
	InlineEndInner = 'END_INNER'
}

export type VerticalBar = {
	width: number;
	visible: boolean;
	data?: null;
};

export enum TextDirection {
	LTR,
	RTL
}

class VerticalBarState {
	constructor(public readonly minSize = 100) {}

	resizedSection: { bar: VerticalBarPosition; x: number; resized: boolean } | null = $state(null);
	bars = $state<Record<VerticalBarPosition, VerticalBar>>({
		[VerticalBarPosition.InlineStartOuter]: { width: 200, data: null, visible: true },
		[VerticalBarPosition.InlineStartInner]: { width: 200, data: null, visible: true },
		[VerticalBarPosition.InlineEndInner]: { width: 200, data: null, visible: true }
	});

	width(bar: VerticalBarPosition): number {
		return this.bars[bar].width >= this.minSize && this.bars[bar].visible
			? this.bars[bar].width
			: 0;
	}

	toggle(bar: VerticalBarPosition) {
		if (this.resizedSection?.resized) {
			return;
		}

		const currentBar = this.bars[bar];
		if (currentBar.visible) {
			currentBar.visible = false;
			return;
		}

		currentBar.visible = true;
		if (this.bars[bar].width < this.minSize) {
			this.bars[bar].width = this.minSize;
		}
	}

	startResize(bar: VerticalBarPosition, x: number) {
		this.resizedSection = { bar, x, resized: false };
	}

	resize(event: MouseEvent) {
		if (!this.resizedSection || !(event.target instanceof HTMLElement)) {
			return;
		}

		if (!this.resizedSection.resized) {
			this.resizedSection.resized = true;
		}

		const { bar, x } = this.resizedSection;
		const shouldInvert = this.shouldInvert(bar);

		const delta = (event.clientX - x) * (shouldInvert ? -1 : 1);
		const newSize = this.bars[bar].width + delta;

		if (newSize <= this.minSize) {
			const { right, left } = event.target.getBoundingClientRect();
			this.resizedSection.x = shouldInvert ? right : left;
			this.bars[bar].width = 0;
		} else {
			if (newSize >= this.minSize && !this.bars[bar].visible) {
				this.bars[bar].visible = true;
			}
			this.bars[bar].width = newSize;
			this.resizedSection.x = event.clientX;
		}
	}

	getTextDirection(): TextDirection {
		const { body } = document;
		const dir = getComputedStyle(body).direction;
		return dir === 'rtl' ? TextDirection.RTL : TextDirection.LTR;
	}

	shouldInvert(bar: VerticalBarPosition): boolean {
		const dir = this.getTextDirection();
		switch (bar) {
			case VerticalBarPosition.InlineStartOuter:
				return dir === TextDirection.RTL;
			case VerticalBarPosition.InlineStartInner:
				return dir === TextDirection.RTL;
			case VerticalBarPosition.InlineEndInner:
				return dir === TextDirection.LTR;
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

	humanize(bar: VerticalBarPosition): string {
		switch (bar) {
			case VerticalBarPosition.InlineStartOuter:
				return 'Inline Start Outer';
			case VerticalBarPosition.InlineStartInner:
				return 'Inline Start Inner';
			case VerticalBarPosition.InlineEndInner:
				return 'Inline End Inner';
		}
	}
}

const verticalVerticalBarState = new VerticalBarState();
export default verticalVerticalBarState;
