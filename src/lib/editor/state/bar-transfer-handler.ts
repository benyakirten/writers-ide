import type { HorizontalBarPosition } from './horizontal-bar-state.svelte.js';
import type { VerticalBarPosition } from './vertical-bar-state.svelte.js';

type BarTransferLocation = HorizontalBarPosition | VerticalBarPosition | 'Floating';
type BarTransfer = {
	location: BarTransferLocation;
	id: string | number;
	slot: 0 | 1 | 2;
};

export class BarTransferHandler {
	move(from: BarTransfer, to: BarTransfer): boolean {
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
}
