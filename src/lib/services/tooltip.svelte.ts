import { Debouncer } from '@/utils/debounce';
import { type Snippet } from 'svelte';

export type TooltipData = {
	data: string | Snippet;
	target: HTMLElement;
	calibrateFor: 'vertical' | 'horizontal';
};
export class TooltipState {
	open = $state(false);
	tooltip = $state<TooltipData | null>(null);
	tooltipEl: HTMLElement | null = null;
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
	set(
		tooltip: TooltipData['data'],
		calibrateFor: TooltipData['calibrateFor'],
		target: HTMLElement
	) {
		this.tooltipDebouncer.update(true);
		if (this.tooltip?.target === target) {
			return;
		}

		this.dismiss();
		this.tooltip = { data: tooltip, target, calibrateFor };
	}

	show() {
		if (!this.tooltip) {
			return;
		}

		this.open = true;
		this.tooltip.target.setAttribute('aria-describedby', this.TOOLTIP_ID);
		this.attemptCalibration();
	}

	MAX_RETRIES = 10;
	attemptCalibration(attempts = 0) {
		requestAnimationFrame(() => {
			if (!this.tooltip || !this.tooltipEl) {
				if (attempts > this.MAX_RETRIES) {
					return;
				}
				return this.attemptCalibration(attempts + 1);
			}
			this.calibratePosition(this.tooltip.calibrateFor, this.tooltip.target, this.tooltipEl);
		});
	}

	calibratePosition(
		calibrateFor: TooltipData['calibrateFor'],
		hostEl: HTMLElement,
		tooltipEl: HTMLElement
	) {
		// TODO: Add the pointer to the tooltip.
		if (calibrateFor === 'vertical') {
			this.#calibrateVerticalPosition(hostEl, tooltipEl);
		} else {
			this.#calibrateHorizontalPosition(hostEl, tooltipEl);
		}

		tooltipEl.style.visibility = 'visible';
	}

	MARGIN = 15;
	#calibrateHorizontalPosition(hostEl: HTMLElement, tooltipEl: HTMLElement) {
		const hostRect = hostEl.getBoundingClientRect();
		let tooltipRect = tooltipEl.getBoundingClientRect();

		tooltipEl.style.left = `${hostRect.left - tooltipRect.width - this.MARGIN}px`;
		tooltipEl.style.top = `${hostRect.top + hostRect.height / 2}px`;
		const tooltipArrow = tooltipEl.querySelector('.arrow') as HTMLElement;
		tooltipArrow.style.top = '50%';

		tooltipRect = tooltipEl.getBoundingClientRect();
		if (tooltipRect.left <= this.MARGIN * 2) {
			tooltipEl.style.left = `${hostRect.right + this.MARGIN}px`;
			tooltipArrow.style.transform = 'translateY(-50%) rotate(-90deg)';
			tooltipArrow.style.right = 'calc(100% + 2px)';
		} else {
			tooltipArrow.style.transform = 'translateY(-50%) rotate(90deg)';
			tooltipArrow.style.left = 'calc(100% + 2px)';
		}

		tooltipEl.style.transform = 'translateY(-50%)';
	}

	#calibrateVerticalPosition(hostEl: HTMLElement, tooltipEl: HTMLElement) {
		const hostRect = hostEl.getBoundingClientRect();
		const tooltipArrow = tooltipEl.querySelector('.arrow') as HTMLElement;
		let tooltipRect = tooltipEl.getBoundingClientRect();

		tooltipEl.style.top = `${hostRect.top - tooltipRect.height - this.MARGIN}px`;
		tooltipEl.style.left = `${hostRect.left + hostRect.width / 2}px`;

		tooltipArrow.style.left = '50%';

		tooltipRect = tooltipEl.getBoundingClientRect();
		if (tooltipRect.top <= this.MARGIN * 2) {
			tooltipEl.style.top = `${hostRect.bottom + this.MARGIN}px`;
			tooltipArrow.style.transform = 'translateX(-50%) rotate(0deg)';
			tooltipArrow.style.bottom = 'calc(100% + 2px)';
		} else {
			tooltipArrow.style.transform = 'translateX(-50%) rotate(180deg)';
			tooltipArrow.style.top = 'calc(100% + 2px)';
		}

		tooltipEl.style.transform = 'translateX(-50%)';
	}

	dismiss() {
		this.tooltip?.target.removeAttribute('aria-describedby');
		this.open = false;
		this.tooltip = null;
	}
}

const TooltipManager = new TooltipState();
export default TooltipManager;
