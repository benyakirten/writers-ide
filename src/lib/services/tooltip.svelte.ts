import { type Snippet } from 'svelte';

type TooltipData = {
	data: string | Snippet;
	target: HTMLElement;
};
export class TooltipState {
	tooltip = $state<TooltipData | null>(null);
	set(tooltip: TooltipData['data'], target: HTMLElement) {
		this.tooltip = { data: tooltip, target };
	}

	dismiss() {
		this.tooltip = null;
	}
}

const TooltipManager = new TooltipState();
export default TooltipManager;
