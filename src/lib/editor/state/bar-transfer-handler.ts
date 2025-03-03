import type { BarItems } from './bar-items.svelte.js';
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
	dataId: string | null;
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

	#items(location: BarTransferLocation, id: string): BarItems | undefined {
		const bars = this.#bars(location);
		return bars.find((bar) => bar.id === id)?.data;
	}

	move(from: BarTransfer, to: Omit<BarTransfer, 'dataId'>): boolean {
		const items = this.barItems(from, to);
		if (!items) {
			return false;
		}

		const [fromItems, toItems] = items;

		if (fromItems === toItems) {
			return fromItems.swap(from.slot, to.slot);
		}

		fromItems.remove(from.slot);
		toItems.insert(from.dataId, to.slot);

		return true;
	}

	barItems(from: BarTransfer, to: Omit<BarTransfer, 'dataId'>): [BarItems, BarItems] | null {
		const fromItems = this.#items(from.location, from.id);
		const toItems = this.#items(to.location, to.id);

		if (!fromItems || !toItems) {
			return null;
		}

		if (from.slot > fromItems.ids.length || to.slot > toItems.ids.length) {
			return null;
		}

		if (fromItems === toItems && !fromItems.canSwap(from.slot, to.slot)) {
			return null;
		}

		if (!fromItems.has(from.dataId) || toItems.has(from.dataId)) {
			return null;
		}

		return [fromItems, toItems];
	}

	insert(dataId: string | null, to: BarTransfer): boolean {
		const toItems = this.#items(to.location, to.id);
		if (!toItems) {
			return false;
		}

		return toItems.insert(dataId, to.slot);
	}
}
