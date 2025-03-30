import { swap } from '$lib/utils/arrays.js';
import { clamp } from '@/utils/numbers.js';
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
	itemId: string;
};

export type MenuTransferInProgress = {
	type: 'menu';
	barId: string;
	location: BarTransferLocation;
	itemId: string;
};

export type BarTransferInProgress = {
	type: 'bar';
	id: string;
	location: BarTransferLocation;
};

export class BarTransferHandler {
	constructor(public deleteBarIfEmpty: boolean = true) {}
	transfer: MenuTransferInProgress | BarTransferInProgress | null = $state(null);

	startTransfer(transfer: MenuTransferInProgress | BarTransferInProgress): void {
		this.transfer = transfer;
	}

	endTransfer(): void {
		this.transfer = null;
	}

	#bars(location: BarTransferLocation): Bars {
		switch (location) {
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

	#createEmptyBar(location: BarTransferLocation): string {
		switch (location) {
			case 'floating':
				return FloatingBarState.add().id;
			case HorizontalBarPosition.WindowBlockEnd:
			case HorizontalBarPosition.WindowBlockStart:
				return HorizontalBarState.add({}, location).id;

			default:
				return VerticalBarState.add({}, location).id;
		}
	}

	#items(location: BarTransferLocation, id: string | number): BarItems | undefined {
		const bars = this.#bars(location);
		const bar = typeof id === 'string' ? bars.find((bar) => bar.id === id) : bars.at(id);
		return bar?.data;
	}

	/**
	 * Remove the item from a group of bars bar and add it to a different group bars.
	 * If you are looking for a method to move the item from one bar to another
	 * in the same group of bars, see `nudge`.
	 *
	 * It will append the item to the last bar. If there are no bars or
	 * the item can't fit in the last bar, it will create a new bar.
	 */
	relocateItem(from: BarTransfer, to: BarTransferLocation): boolean {
		if (from.location === to) {
			return false;
		}
		const toBars = this.#bars(to);

		// Put on the last bar
		const lastBar = toBars.at(toBars.length - 1);
		if (!lastBar || !lastBar.data.canFit(from.itemId)) {
			this.#createEmptyBar(to);
		}

		this.remove(from.location, from.barId, from.itemId);
		this.append(to, toBars.length - 1, from.itemId);

		if (to === 'floating') {
			FloatingBarState.focus(toBars.length - 1);
		}

		return true;
	}

	/**
	 * Move the item from one bar to another among a the same group of bars.
	 * If you are looking for the method to move the item from to a different group of bars,
	 * see `relocateItem`.
	 *
	 * If there is no available slot in the next bar, it will create a new bar on the other side.
	 * E.g. if you are moving to the right and there is no available slot in any bar to the right, it will create a new bar on the left.
	 */
	nudge(from: BarTransfer, direction: 1 | -1): boolean {
		if (from.location === 'floating') {
			return false;
		}

		const bars = this.#bars(from.location);
		const barIndex =
			typeof from.barId === 'string' ? bars.findIndex((bar) => bar.id === from.barId) : from.barId;
		const bar = bars[barIndex];

		if (!bar || !bar.data.has(from.itemId) || bars.length < 2) {
			return false;
		}

		// Making this into a separate if check to make it a little cleaner - checking for invalid movement types.
		if ((barIndex === 0 && direction === -1) || (barIndex === bars.length - 1 && direction === 1)) {
			return false;
		}

		let nextBar = bars.at(barIndex + direction);
		if (!nextBar || !nextBar.data.canFit(from.itemId)) {
			const newIndex = clamp(barIndex + 2 * direction, 0, bars.length);
			if (
				from.location === HorizontalBarPosition.WindowBlockStart ||
				from.location === HorizontalBarPosition.WindowBlockEnd
			) {
				nextBar = HorizontalBarState.add({}, from.location, newIndex);
			} else {
				nextBar = VerticalBarState.add({}, from.location, newIndex);
			}
		}

		if (!nextBar) {
			return false;
		}

		if (!this.remove(from.location, from.barId, from.itemId)) {
			return false;
		}
		return nextBar.data.append(from.itemId);
	}

	swap(from: BarTransfer, to: string | number): boolean {
		const items = this.#items(from.location, from.barId);
		if (!items) {
			return false;
		}

		const item1Index = items.ids.findIndex((id) => id === from.itemId);
		const item2Index = typeof to === 'string' ? items.ids.findIndex((id) => id === to) : to;

		return items.swap(item1Index, item2Index);
	}

	insert(to: BarTransfer, slot: PossibleSlot): boolean {
		const toItems = this.#items(to.location, to.barId);
		if (!toItems) {
			return false;
		}

		return toItems.insert(to.itemId, slot);
	}

	append(to: BarTransferLocation, id: string | number, itemId: string): boolean {
		const items = this.#items(to, id);
		if (!items) {
			return false;
		}

		return items.append(itemId);
	}

	remove(location: BarTransferLocation, id: string | number, itemId: string): boolean {
		const items = this.#items(location, id);
		if (!items) {
			return false;
		}

		if (!items.remove(itemId)) {
			return false;
		}

		if (this.deleteBarIfEmpty && items.ids.length === 0) {
			const bars = this.#bars(location);
			const barIndex = typeof id === 'string' ? bars.findIndex((bar) => bar.id === id) : id;
			if (barIndex !== -1) {
				bars.splice(barIndex, 1);
			}
		}

		return true;
	}

	moveMenu(from: BarTransferLocation, id: string | number, to: BarTransferLocation): boolean {
		if (from === to) {
			return false;
		}

		const fromItems = this.#items(from, id)?.ids;
		if (!fromItems) {
			return false;
		}

		if (from === 'floating') {
			if (!FloatingBarState.remove(id)) {
				return false;
			}
		} else if (
			from === HorizontalBarPosition.WindowBlockStart ||
			from === HorizontalBarPosition.WindowBlockEnd
		) {
			if (!HorizontalBarState.remove(id, from)) {
				return false;
			}
		} else {
			if (!VerticalBarState.remove(id, from)) {
				return false;
			}
		}

		if (to === 'floating') {
			FloatingBarState.add({ data: fromItems });
		} else if (
			to === HorizontalBarPosition.WindowBlockStart ||
			to === HorizontalBarPosition.WindowBlockEnd
		) {
			HorizontalBarState.add({ data: fromItems }, to);
		} else {
			VerticalBarState.add({ data: fromItems }, to);
		}

		return true;
	}

	/**
	 * Swaps bars between two locations in the same location.
	 */
	swapBarPosition(
		fromId: string | number,
		position: BarTransferLocation,
		toId: string | number
	): boolean {
		if (position === 'floating') {
			return false;
		}

		const bars = this.#bars(position);
		const fromIndex =
			typeof fromId === 'string' ? bars.findIndex((bar) => bar.id === fromId) : fromId;
		const toIndex = typeof toId === 'string' ? bars.findIndex((bar) => bar.id === toId) : toId;

		if (fromIndex === -1 || fromIndex >= bars.length || toIndex < 0 || toIndex >= bars.length) {
			return false;
		}

		// @ts-expect-error: The type of array doesn't matter.
		swap(bars, fromIndex, toIndex);
		return true;
	}

	isBarLocation(val: string): val is BarTransferLocation {
		return (
			val === HorizontalBarPosition.WindowBlockEnd ||
			val === HorizontalBarPosition.WindowBlockStart ||
			val === VerticalBarPosition.InlineEnd ||
			val === VerticalBarPosition.InlineStart ||
			val === 'floating'
		);
	}
}

const TransferHandler = new BarTransferHandler();
export default TransferHandler;
