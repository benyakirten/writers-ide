import { getContext, setContext } from 'svelte';
import type { TooltipState } from './tooltip-state.svelte';

const tooltipContext = Symbol('writers-ide-tooltip');

/** Call during component initialization. The host owns the supplied manager. */
export function provideTooltipManager(manager: TooltipState) {
	setContext(tooltipContext, manager);
	return manager;
}

/** An explicit manager prop takes precedence over the nearest provider. */
export function getTooltipManager(): TooltipState {
	const manager = getContext<TooltipState | undefined>(tooltipContext);
	if (!manager) {
		throw new Error('Use TooltipProvider or pass a tooltip manager explicitly.');
	}
	return manager;
}
