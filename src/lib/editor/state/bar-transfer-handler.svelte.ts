import { swap } from '$lib/utils/arrays';
import { clamp } from '$lib/utils/numbers';
import { BarItems } from './bar-items.svelte';
import Registry from './bar-item-registry.svelte';
import FloatingBarState, { type FloatingBar } from './floater-state.svelte';
import HorizontalBarState, {
	HorizontalBarPosition,
	type HorizontalBar,
} from './horizontal-bar-state.svelte';
import VerticalBarState, {
	VerticalBarPosition,
	type VerticalBar,
} from './vertical-bar-state.svelte';

export type PossibleSlot = 0 | 1 | 2;
export type BarTransferLocation = HorizontalBarPosition | VerticalBarPosition | 'floating';
export type Bar = HorizontalBar | VerticalBar | FloatingBar;
export type Bars = Bar[];

export type DockDragSource = {
	kind: 'bar' | 'item';
	location: BarTransferLocation;
	barId: string;
	itemId?: string;
};

export type DockDropTarget =
	| { kind: 'bar'; location: BarTransferLocation; barId: string; index: number }
	| { kind: 'dock'; location: BarTransferLocation; index: number }
	| { kind: 'floating'; left: number; top: number };
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

	getBar(location: BarTransferLocation, id: string | number): Bar | undefined {
		const bars = this.#bars(location);
		return typeof id === 'string' ? bars.find((bar) => bar.id === id) : bars.at(id);
	}

	isVertical(location: BarTransferLocation, barId?: string): boolean {
		if (location === 'floating') {
			return (barId ? this.getBar(location, barId)?.data.isVertical : undefined) ?? true;
		}
		return (
			location === VerticalBarPosition.InlineStart || location === VerticalBarPosition.InlineEnd
		);
	}

	#boundary(index: number, length: number): boolean {
		return Number.isInteger(index) && index >= 0 && index <= length;
	}

	canDrop(source: DockDragSource, target: DockDropTarget): boolean {
		if (!this.isBarLocation(source.location)) {
			return false;
		}
		const bar = this.getBar(source.location, source.barId);
		if (!bar || (source.kind !== 'bar' && source.kind !== 'item')) {
			return false;
		}
		if (source.kind === 'item' && (!source.itemId || !bar.data.has(source.itemId))) {
			return false;
		}
		if (target.kind === 'floating') {
			if (
				source.kind === 'bar' &&
				source.location !== 'floating' &&
				this.getBar('floating', source.barId)
			) {
				return false;
			}
			return (
				Number.isFinite(target.left) &&
				Number.isFinite(target.top) &&
				(source.kind === 'item' || bar.data.canOrient(bar.data.isVertical))
			);
		}
		if (!this.isBarLocation(target.location)) {
			return false;
		}
		if (target.kind === 'bar') {
			const destination = this.getBar(target.location, target.barId);
			if (
				source.kind !== 'item' ||
				!destination ||
				!this.#boundary(target.index, destination.data.ids.length)
			) {
				return false;
			}
			if (bar === destination) {
				return bar.data.canOrient(this.isVertical(target.location, target.barId));
			}
			const vertical = this.isVertical(target.location, target.barId);
			const ids = [...destination.data.ids, source.itemId!];
			return (
				!destination.data.has(source.itemId!) &&
				ids.reduce((total, id) => total + Registry.size(id, vertical), 0) <=
					Math.min(3, destination.data.maxSize)
			);
		}
		if (
			target.kind !== 'dock' ||
			!this.#boundary(target.index, this.#bars(target.location).length)
		) {
			return false;
		}
		if (
			source.location !== target.location &&
			this.getBar(target.location, source.barId) &&
			source.kind === 'bar'
		) {
			return false;
		}
		const vertical =
			target.location === 'floating' ? bar.data.isVertical : this.isVertical(target.location);
		return source.kind === 'item'
			? Registry.size(source.itemId!, vertical) <= 3
			: bar.data.canOrient(vertical);
	}

	#prepareBar(bar: Bar, location: BarTransferLocation): void {
		if (location === 'floating') {
			bar.position ??= {
				...FloatingBarState.determineStartingCoordinates({}),
				...FloatingBarState.determineStartingMeasurements(),
			};
			bar.z ??= FloatingBarState.determineStartingZ();
			bar.title ??= 'New Bar';
			bar.minimized = false;
		} else if (this.isVertical(location)) {
			bar.width ??= VerticalBarState.minSize;
			bar.visible ??= true;
		} else {
			bar.height ??= HorizontalBarState.minSize(location as HorizontalBarPosition);
			bar.visible ??= true;
		}
	}

	/** Boundaries are measured before removal, including same-bar/same-dock moves. */
	drop(source: DockDragSource, target: DockDropTarget): boolean {
		if (!this.canDrop(source, target)) {
			return false;
		}
		const sourceBar = this.getBar(source.location, source.barId)!;
		const sourceBars = this.#bars(source.location);
		const sourceIndex = sourceBars.indexOf(sourceBar);
		if (target.kind === 'bar') {
			const destination = this.getBar(target.location, target.barId)!;
			const itemIndex = sourceBar.data.index(source.itemId!);
			const index = target.index - (sourceBar === destination && itemIndex < target.index ? 1 : 0);
			sourceBar.data.remove(source.itemId!);
			destination.data.insert(source.itemId!, index);
			if (sourceBar !== destination && sourceBar.data.ids.length === 0) {
				sourceBars.splice(sourceIndex, 1);
			}
			if (target.location === 'floating') {
				FloatingBarState.focus(destination.id);
			}
			return true;
		}

		const location = target.kind === 'floating' ? 'floating' : target.location;
		const destinationBars = this.#bars(location);
		let index = target.kind === 'dock' ? target.index : destinationBars.length;
		let bar: Bar;
		if (source.kind === 'bar') {
			bar = sourceBar;
			if (sourceBars === destinationBars && sourceIndex < index) {
				index--;
			}
			sourceBars.splice(sourceIndex, 1);
			if (location !== 'floating') {
				bar.data.setOrientation(this.isVertical(location));
			}
		} else {
			const vertical =
				location === 'floating' ? sourceBar.data.isVertical : this.isVertical(location);
			// Use existing state factories for a fresh bar ID, then insert at the requested gap.
			if (location === 'floating') {
				bar = FloatingBarState.add({ isVertical: vertical });
			} else if (vertical) {
				bar = VerticalBarState.add({}, location as VerticalBarPosition);
			} else {
				bar = HorizontalBarState.add({}, location as HorizontalBarPosition);
			}
			destinationBars.pop();
			bar.data.append(source.itemId!);
			sourceBar.data.remove(source.itemId!);
			if (sourceBar.data.ids.length === 0) {
				if (sourceBars === destinationBars && sourceIndex < index) {
					index--;
				}
				sourceBars.splice(sourceIndex, 1);
			}
		}
		this.#prepareBar(bar, location);
		destinationBars.splice(index, 0, bar);
		if (location === 'floating') {
			if (target.kind === 'floating') {
				FloatingBarState.setPosition(bar.id, target.left, target.top);
			} else {
				FloatingBarState.setPosition(bar.id, bar.position!.left, bar.position!.top);
			}
			FloatingBarState.focus(bar.id);
		}
		return true;
	}

	#items(location: BarTransferLocation, id: string | number): BarItems | undefined {
		return this.getBar(location, id)?.data;
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
		const bar = this.getBar(from.location, from.barId);
		if (!bar) {
			return false;
		}
		const source: DockDragSource = {
			kind: 'item',
			location: from.location,
			barId: bar.id,
			itemId: from.itemId,
		};
		const toBars = this.#bars(to);
		const lastBar = toBars.at(-1);
		if (lastBar) {
			const target: DockDropTarget = {
				kind: 'bar',
				location: to,
				barId: lastBar.id,
				index: lastBar.data.ids.length,
			};
			if (this.canDrop(source, target)) {
				return this.drop(source, target);
			}
		}
		return this.drop(source, { kind: 'dock', location: to, index: toBars.length });
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
		let barIndex =
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
		// Can fit will check if the item already exists in the next bar.
		if (!nextBar || !nextBar.data.canFit(from.itemId)) {
			let newIndex = clamp(barIndex + 2 * direction, 0, bars.length);

			if (direction === -1) {
				// Because of how splice works, if we are going backwards, we actually want the inserted
				// index to be 1 higher than the current index;
				newIndex++;
				// If we insert a new bar, then the index of the item's current bar has increased by 1.
				barIndex++;
			}

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

		if (!this.remove(from.location, barIndex, from.itemId)) {
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

		const bar = this.getBar(from, id);
		if (!bar) {
			return false;
		}
		return this.drop(
			{ kind: 'bar', location: from, barId: bar.id },
			{ kind: 'dock', location: to, index: this.#bars(to).length },
		);
	}

	/**
	 * Swaps bars between two locations in the same location.
	 */
	swapBarPosition(
		fromId: string | number,
		position: BarTransferLocation,
		toId: string | number,
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
