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

export type PossibleSlot = 0 | 1 | 2;
export type BarTransferLocation = HorizontalBarPosition | VerticalBarPosition | 'floating';
export type Bars = HorizontalBar[] | VerticalBar[] | FloatingBar[];
export type BarTransfer = {
	location: BarTransferLocation;
	barId: string | number;
	slot: PossibleSlot;
	itemId: string;
};

export class BarTransferHandler {
	static #bars(location: BarTransferLocation): Bars {
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

	static #createEmptyBar(location: BarTransferLocation): string {
		switch (location) {
			case HorizontalBarPosition.EditorBlockEnd:
			case HorizontalBarPosition.EditorBlockStart:
			case HorizontalBarPosition.WindowBlockEnd:
			case HorizontalBarPosition.WindowBlockStart:
				return HorizontalBarState.add({}, location).id;
			case VerticalBarPosition.InlineEnd:
			case VerticalBarPosition.InlineStart:
				return VerticalBarState.add({}, location).id;
			case 'floating':
				return FloatingBarState.add({}).id;
		}
	}

	static #items(location: BarTransferLocation, id: string | number): BarItems | undefined {
		const bars = this.#bars(location);
		const bar = typeof id === 'string' ? bars.find((bar) => bar.id === id) : bars.at(id);
		return bar?.data;
	}

	static move(
		from: BarTransfer,
		to: Omit<BarTransfer, 'itemId'>,
		createToBarIfMissing: boolean = true
	): boolean {
		const items = this.barItems(from, to, createToBarIfMissing);
		if (!items) {
			return false;
		}

		const [fromItems, toItems] = items;

		if (fromItems === toItems) {
			return fromItems.swap(from.slot, to.slot);
		}

		fromItems.remove(from.slot);
		toItems.insert(from.itemId, to.slot);

		return true;
	}

	static barItems(
		from: BarTransfer,
		to: Omit<BarTransfer, 'itemId'>,
		createToBarIfMissing: boolean = true
	): [BarItems, BarItems] | null {
		const fromItems = this.#items(from.location, from.barId);
		const toItems = this.#items(to.location, to.barId);
		if (!toItems) {
			const bars = this.#bars(to.location);
			if (bars.length === 0 && createToBarIfMissing) {
				const id = this.#createEmptyBar(to.location);
				to.barId = id;
				return this.barItems(from, to);
			}
		}

		if (!fromItems || !toItems) {
			return null;
		}

		if (from.slot > fromItems.ids.length || to.slot > toItems.ids.length) {
			return null;
		}

		if (fromItems === toItems && !fromItems.canSwap(from.slot, to.slot)) {
			return null;
		}

		if (!fromItems.has(from.itemId) || toItems.has(from.itemId)) {
			return null;
		}

		return [fromItems, toItems];
	}

	static insert(to: BarTransfer): boolean {
		const toItems = this.#items(to.location, to.barId);
		if (!toItems) {
			return false;
		}

		return toItems.insert(to.itemId, to.slot);
	}

	static remove(location: BarTransferLocation, id: string | number, itemId: string): boolean {
		const items = this.#items(location, id);
		if (!items) {
			return false;
		}

		return items.remove(itemId);
	}
}
