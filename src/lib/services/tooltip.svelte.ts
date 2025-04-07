import { Debouncer } from '@/utils/debounce';
import { type Snippet } from 'svelte';

export type TooltipData = {
	data: string | Snippet;
	target: HTMLElement;
};
export class TooltipState {
	tooltip = $state<TooltipData | null>(null);
	tooltipElement: HTMLElement | null = null;
	TIMEOUT_DURATION = 200;
	dismissDebouncer = new Debouncer<boolean>((val) => {
		if (val) {
			this.dismiss();
		}
	}, this.TIMEOUT_DURATION);
	TOOLTIP_ID = 'builtin-tooltip';
	set(tooltip: TooltipData['data'], target: HTMLElement) {
		target.setAttribute('aria-describedby', this.TOOLTIP_ID);
		this.tooltip = { data: tooltip, target };
	}

	dismiss() {
		this.tooltip?.target.removeAttribute('aria-describedby');
		this.tooltip = null;
	}

	initListeners() {
		// TODO: add mouseenter and mouseleave events to the target element
		// And make sure that they are removed when the tooltip is dismissed
	}
}

const TooltipManager = new TooltipState();
export default TooltipManager;
