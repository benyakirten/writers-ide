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

	move(from: BarTransfer, to: BarTransfer): boolean {
		const fromBars = this.#bars(from.location);
		const toBars = this.#bars(to.location);

		const fromIndex = this.#index(fromBars, from.id);
		if (fromIndex === undefined) {
			return false;
		}

		const toIndex = this.#index(toBars, to.id);
		if (toIndex === undefined) {
			return false;
		}

		if (from.location === to.location) {
			return this.swap(fromBars, fromIndex, toIndex);
		}

		if (!this.isAvailable(to)) {
			return false;
		}

		this.remove(from);
		this.insert(to);

		return true;
	}

	copy(from: BarTransfer, to: BarTransfer): boolean {
		return true;
	}

	remove(from: BarTransfer): boolean {
		return true;
	}

	insert(to: BarTransfer): boolean {
		return true;
	}

	/**
	 * Check if the transfer if available.
	 * The from parameter means that the transfer is from the
	 */
	isAvailable(to: BarTransfer): boolean {
		return true;
	}

	/**
	 * Swap the two items on the same bar, which should always be possible.
	 */
	swap(bars, index1: number, index2: number): boolean {
		return true;
	}
}
