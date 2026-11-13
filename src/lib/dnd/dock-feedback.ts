import Handler, {
	type BarTransferLocation,
	type DockDragSource,
	type DockDropTarget,
} from '$lib/editor/state/bar-transfer-handler.svelte';
import Floating from '$lib/editor/state/floater-state.svelte';
import Horizontal, {
	HorizontalBarPosition as H,
} from '$lib/editor/state/horizontal-bar-state.svelte';
import Vertical, { VerticalBarPosition as V } from '$lib/editor/state/vertical-bar-state.svelte';

export type DockColor = 'vertical' | 'horizontal' | 'floating' | 'invalid' | 'none';

/** Destination category only; callers can override it with invalid after canDrop(). */
export function getDockColor(target: DockDropTarget | null | undefined): DockColor {
	if (!target) {
		return 'none';
	}
	if (target.kind === 'floating' || target.location === 'floating') {
		return 'floating';
	}
	return Handler.isVertical(target.location) ? 'vertical' : 'horizontal';
}

function barsAt(location: BarTransferLocation) {
	if (location === 'floating') {
		return Floating.bars;
	}
	if (location === V.InlineStart || location === V.InlineEnd) {
		return Vertical.bars(location);
	}
	return Horizontal.bars(location);
}

function locationLabel(location: BarTransferLocation, rtl: boolean): string {
	switch (location) {
		case H.WindowBlockStart:
			return 'top dock';
		case H.WindowBlockEnd:
			return 'bottom dock';
		case V.InlineStart:
			return rtl ? 'right dock' : 'left dock';
		case V.InlineEnd:
			return rtl ? 'left dock' : 'right dock';
		case 'floating':
			return 'floating';
	}
}

function barLabel(location: BarTransferLocation, barId: string): string {
	const title = Handler.getBar(location, barId)?.title?.trim();
	if (title) {
		return title.length > 32 ? `${title.slice(0, 31)}…` : title;
	}
	return `Toolbar ${barsAt(location).findIndex((bar) => bar.id === barId) + 1}`;
}

export function describeDrop(
	source: DockDragSource,
	target: DockDropTarget | null | undefined,
	rtl = false,
): string {
	if (!target) {
		return 'Release to cancel (outside the workbench).';
	}
	if (!Handler.canDrop(source, target)) {
		return 'Cannot drop here — release will cancel.';
	}

	const sourceBar = Handler.getBar(source.location, source.barId)!;
	if (target.kind === 'bar') {
		const destination = Handler.getBar(target.location, target.barId)!;
		const sameBar = sourceBar === destination;
		const fromIndex = sourceBar.data.index(source.itemId!);
		const index = target.index - (sameBar && fromIndex < target.index ? 1 : 0);
		const label = `${barLabel(target.location, target.barId)} (${locationLabel(target.location, rtl)})`;
		if (sameBar && index === fromIndex) {
			return `Release to leave item order unchanged in ${label}.`;
		}
		return `Release to ${sameBar ? 'reorder' : 'insert'} item at position ${index + 1} in ${label}.`;
	}

	const location = target.kind === 'floating' ? 'floating' : target.location;
	const vertical =
		location === 'floating' ? sourceBar.data.isVertical : Handler.isVertical(location);
	const orientation = vertical ? 'vertical' : 'horizontal';
	const sourceBars = barsAt(source.location);
	const sourceIndex = sourceBars.findIndex((bar) => bar.id === source.barId);
	let placement = '';
	if (target.kind === 'dock') {
		const removesBar = source.kind === 'bar' || sourceBar.data.ids.length === 1;
		const index =
			target.index -
			(source.location === location && removesBar && sourceIndex < target.index ? 1 : 0);
		placement = ` at position ${index + 1}`;
		if (source.kind === 'bar' && source.location === location && index === sourceIndex) {
			return `Release to leave toolbar order unchanged (${locationLabel(location, rtl)}).`;
		}
	}
	if (location === 'floating') {
		if (source.kind === 'item') {
			return `Release to create a new ${orientation} floating toolbar${placement}.`;
		}
		return `Release to ${source.location === 'floating' ? 'reposition' : 'float'} the whole ${orientation} toolbar${placement}.`;
	}
	if (source.kind === 'item') {
		return `Release to create a new ${orientation} toolbar in the ${locationLabel(location, rtl)}${placement}.`;
	}
	return `Release to place the whole toolbar in the ${locationLabel(location, rtl)}${placement} (${orientation}).`;
}
