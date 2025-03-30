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

	#findNextAvailableSlot(bars: Bars, from: number, id: string, direction: -1 | 1): number {
		if (direction === 1) {
			for (let i = from + 1; i < bars.length; i++) {
				const bar = bars[i];
				if (bar.data.canFit(id)) {
					return i;
				}
			}
		} else {
			for (let i = from - 1; i >= 0; i--) {
				const bar = bars[i];
				if (bar.data.canFit(id)) {
					return i;
				}
			}
		}

		return -1;
	}

	#locateTransfer(transfer: BarTransfer) {
		if (transfer.location === 'floating') {
			return null;
		}

		const bars = this.#bars(transfer.location);
		const barIndex =
			typeof transfer.barId === 'string'
				? bars.findIndex((bar) => bar.id === transfer.barId)
				: transfer.barId;
		const bar = bars[barIndex];

		if (!bar || !bar.data.has(transfer.itemId) || bars.length < 2) {
			return null;
		}

		return { bars, barIndex, bar };
	}

	/**
	 * Remove the item from the origin bar and add it to the destination bars.
	 * It will append the item to the last bar. If there are no bars or
	 * the item can't fit in the last bar, it will create a new bar.
	 */
	moveItemToBar(from: BarTransfer, to: BarTransferLocation): boolean {
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

	nudge(from: BarTransfer, direction: 1 | -1): boolean {
		const transferLocation = this.#locateTransfer(from);
		if (!transferLocation) {
			return false;
		}

		const { bars, barIndex, bar } = transferLocation;

		// Making this into a separate if check to make it a little cleaner - checking for invalid movement types.
		if ((barIndex === 0 && direction === -1) || (barIndex === bars.length - 1 && direction === 1)) {
			return false;
		}

		let slot = this.#findNextAvailableSlot(bars, barIndex, from.itemId, direction);
		if (slot === -1) {
			// If we can't find a slot, we need to create one - move one bar over.
			const state =
				from.location === HorizontalBarPosition.WindowBlockStart ||
				from.location === HorizontalBarPosition.WindowBlockEnd
					? HorizontalBarState
					: VerticalBarState;
			slot = clamp(barIndex + 2 * direction, 0, bars.length - 1);
			// @ts-expect-error: The location should b appropriate to the state
			state.add({}, from.location, slot);
		}

		const nextBar = bars.at(slot);
		if (!nextBar) {
			return false;
		}

		if (!bar.data.remove(from.itemId)) {
			return false;
		}
		return nextBar.data.append(from.itemId);
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

		return items.remove(itemId);
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
