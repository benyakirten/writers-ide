import type {
	BarTransferLocation,
	DockDragSource,
	DockDropTarget,
} from './bar-transfer-handler.svelte';
import { VerticalBarPosition } from './vertical-bar-state.svelte';

/** The target primitive needs validation/orientation, not access to host state or rendering. */
export type DockController = {
	canDrop: (source: DockDragSource, target: DockDropTarget) => boolean;
	isVertical: (location: BarTransferLocation, barId?: string) => boolean;
};

export type DockColor = 'vertical' | 'horizontal' | 'floating' | 'invalid' | 'none';

export function getDockColor(target: DockDropTarget | null | undefined): DockColor {
	if (!target) {
		return 'none';
	}
	if (target.kind === 'floating' || target.location === 'floating') {
		return 'floating';
	}
	return target.location === VerticalBarPosition.InlineStart ||
		target.location === VerticalBarPosition.InlineEnd
		? 'vertical'
		: 'horizontal';
}
