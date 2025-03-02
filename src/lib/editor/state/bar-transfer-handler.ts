import Registry from './bar-item-registry.svelte.js';
import FloatingBarState, { type FloatingBar } from './floater-state.svelte.js';
import HorizontalBarState, {
	HorizontalBarPosition,
	type HorizontalBar
} from './horizontal-bar-state.svelte.js';
import VerticalBarState, {
	VerticalBarPosition,
	type VerticalBar
} from './vertical-bar-state.svelte.js';

type PossibleSlot = 0 | 1 | 2;
type BarTransferLocation = HorizontalBarPosition | VerticalBarPosition | 'floating';
type Bars = HorizontalBar[] | VerticalBar[] | FloatingBar[];
type BarTransfer = {
	location: BarTransferLocation;
	id: string;
	slot: PossibleSlot;
};

export class BarTransferHandler {
	// TODO: We may need to revisit this.
	MAX_SIZE = 3;
	#bars(location: BarTransferLocation): Bars {
		switch (location) {
			case HorizontalBarPosition.EditorBlockEnd:
				return HorizontalBarState.editorBlockEnd;
			case HorizontalBarPosition.EditorBlockStart:
				return HorizontalBarState.editorBlockStart;
			case HorizontalBarPosition.WindowBlockEnd:
				return HorizontalBarState.windowBlockEnd;
			case HorizontalBarPosition.WindowBlockStart:
				return HorizontalBarState.windowBlockStart;
			case VerticalBarPosition.InlineEnd:
				return VerticalBarState.inlineEnd;
			case VerticalBarPosition.InlineStart:
				return VerticalBarState.inlineStart;
			case 'floating':
				return FloatingBarState.bars;
		}
	}

	#index(bars: Bars, id: string): number | undefined {
		return bars.findIndex((bar) => bar.id === id);
	}

	#isVertical(location: BarTransferLocation): boolean {
		return (
			location === VerticalBarPosition.InlineStart || location === VerticalBarPosition.InlineEnd
		);
	}

	move(from: BarTransfer, to: BarTransfer): boolean {
		const fromBars = this.#bars(from.location);
		const toBars = this.#bars(to.location);

		const fromIndex = this.#index(fromBars, from.id);
		if (fromIndex === undefined) {
			return false;
		}

		if (from.location === to.location) {
			const toIndex = this.#index(toBars, to.id);
			if (toIndex === undefined) {
				return false;
			}
			return this.swap(fromBars, fromIndex, toIndex);
		}

		if (!this.isAvailable(toBars, to.location, to.id)) {
			return false;
		}

		this.remove(from);
		this.insert(to);

		return true;
	}

	copy(from: BarTransfer, to: BarTransfer): boolean {
		return true;
	}

	remove(from: BarTransfer, bars?: Bars): boolean {
		bars ??= this.#bars(from.location);
		return true;
	}

	insert(to: BarTransfer): boolean {
		return true;
	}

	sizeRemaining(location: BarTransferLocation, bars: Bars): number {
		const isVertical = this.#isVertical(location);
		const sizeUsed = bars.reduce((acc, bar) => {
			const id = bar.id;
			if (id === null) {
				return acc + 1;
			}

			const item = Registry.items.get(id);
			if (!item) {
				return acc + 1;
			}

			const size = isVertical ? item.vertical.size : item.horizontal.size;
			return acc + size;
		}, 0);

		return Math.max(this.MAX_SIZE - sizeUsed, 0);
	}

	/**
	 * Check if the transfer if available.
	 * The from parameter means that the transfer is from the
	 */
	isAvailable(bars: Bars, location: BarTransferLocation, id: string): boolean {
		const sizeRemaining = this.sizeRemaining(location, bars);
		if (sizeRemaining === 0) {
			return false;
		}

		const item = Registry.items.get(id);
		let size = 1;
		if (item) {
			size = this.#isVertical(location) ? item.vertical.size : item.horizontal.size;
		}

		return size <= sizeRemaining;
	}

	/**
	 * Swap the two items on the same bar, which should always be possible.
	 */
	swap(bars: Bars, index1: number, index2: number): boolean {
		[bars[index1], bars[index2]] = [bars[index2], bars[index1]];
		return true;
	}
}
