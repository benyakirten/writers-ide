import { Debouncer } from '@/utils/debounce';
import { type Snippet } from 'svelte';

export type TooltipData = {
	data: string | Snippet;
	target: HTMLElement;
};
export class TooltipState {
	open: boolean = false;
	tooltip = $state<TooltipData | null>(null);
	tooltipElement: HTMLElement | null = null;
	TIMEOUT_DURATION = 200;
	tooltipDebouncer = new Debouncer<boolean>(
		(val) => {
			if (val) {
				this.show();
			} else {
				this.dismiss();
			}
		},
		{ delay: this.TIMEOUT_DURATION }
	);
	TOOLTIP_ID = 'builtin-tooltip';
	set(tooltip: TooltipData['data'], target: HTMLElement) {
		this.tooltip = { data: tooltip, target };
	}

	show() {
		if (!this.tooltip) {
			return;
		}

		this.open = true;
		this.tooltip.target.setAttribute('aria-describedby', this.TOOLTIP_ID);
	}

	dismiss() {
		this.tooltip?.target.removeAttribute('aria-describedby');
		this.open = false;
		this.tooltip = null;
	}
}

const TooltipManager = new TooltipState();
export default TooltipManager;
