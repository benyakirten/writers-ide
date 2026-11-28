import {
	BarTransferHandler as LayoutTransferHandler,
	type Bar as LayoutBar,
} from '@writers-ide/layout';
import type { BarItemSection } from './bar-item-registry.svelte';
import { workbench } from './workbench.svelte';

export type {
	PossibleSlot,
	BarTransferLocation,
	DockDragSource,
	DockDropTarget,
	BarTransfer,
	MenuTransferInProgress,
	BarTransferInProgress,
} from '@writers-ide/layout';
export type Bar = LayoutBar<BarItemSection>;
export type Bars = Bar[];

export class BarTransferHandler extends LayoutTransferHandler<BarItemSection> {
	constructor(deleteBarIfEmpty = true) {
		super(workbench.transferServices, deleteBarIfEmpty);
	}
}

export default workbench.transfer;
