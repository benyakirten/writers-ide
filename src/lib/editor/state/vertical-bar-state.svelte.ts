// TODO: Should there be a far enline end to mirror InlineStartOuter?
export enum VerticalBarPosition {
	InlineStartOuter = 'START_OUTER',
	InlineStartInner = 'START_INNER',
	InlineEndInner = 'END_INNER'
}

export type VerticalBarState = {
	width: number;
	data?: null;
};

export enum TextDirection {
	LTR,
	RTL
}

class VerticalVerticalBarState {
	static readonly MIN_SIZE = 100;
	// TODO: Determine if this needs to be proxied with $state
	// TODO: Determine if this needs to be private with a getter or if it's valuable as public property
	resizedSection: { bar: VerticalBarPosition; x: number } | null = $state(null);
	bars = $state<Record<VerticalBarPosition, VerticalBarState>>({
		[VerticalBarPosition.InlineStartOuter]: { width: 200, data: null },
		[VerticalBarPosition.InlineStartInner]: { width: 200, data: null },
		[VerticalBarPosition.InlineEndInner]: { width: 200, data: null }
	});

	width(bar: VerticalBarPosition): number {
		return this.bars[bar].width < VerticalVerticalBarState.MIN_SIZE ? 0 : this.bars[bar].width;
	}

	toggle(bar: VerticalBarPosition) {
		if (this.bars[bar].width < VerticalVerticalBarState.MIN_SIZE) {
			this.bars[bar].width = VerticalVerticalBarState.MIN_SIZE;
		} else {
			this.bars[bar].width = 0;
		}
	}

	startResize(bar: VerticalBarPosition, x: number) {
		this.resizedSection = { bar, x: x };
	}

	resize(event: MouseEvent) {
		if (!this.resizedSection || !(event.target instanceof HTMLElement)) {
			return;
		}

		const { bar, x } = this.resizedSection;
		const shouldInvert = VerticalVerticalBarState.shouldInvert(bar);

		const delta = (event.clientX - x) * (shouldInvert ? -1 : 1);
		const newSize = this.bars[bar].width + delta;

		if (newSize <= VerticalVerticalBarState.MIN_SIZE) {
			const { right, left } = event.target.getBoundingClientRect();
			this.resizedSection.x = shouldInvert ? right : left;
			this.bars[bar].width = 0;
		} else {
			this.bars[bar].width = newSize;
			this.resizedSection.x = event.clientX;
		}
	}

	static getTextDirection(): TextDirection {
		const { body } = document;
		const dir = getComputedStyle(body).direction;
		return dir === 'rtl' ? TextDirection.RTL : TextDirection.LTR;
	}

	static shouldInvert(bar: VerticalBarPosition): boolean {
		const dir = VerticalVerticalBarState.getTextDirection();
		switch (bar) {
			case VerticalBarPosition.InlineStartOuter:
				return dir === TextDirection.RTL;
			case VerticalBarPosition.InlineStartInner:
				return dir === TextDirection.RTL;
			case VerticalBarPosition.InlineEndInner:
				return dir === TextDirection.LTR;
		}
	}

	endResize() {
		this.resizedSection = null;
	}
}

const verticalVerticalBarState = new VerticalVerticalBarState();
export default verticalVerticalBarState;
