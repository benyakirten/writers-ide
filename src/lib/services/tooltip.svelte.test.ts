import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { TooltipState, type TooltipData } from './tooltip.svelte';

describe('TooltipSTate', () => {
	let state: TooltipState;
	let mockTarget: HTMLElement;
	let mockTooltipEl: HTMLElement;
	let mockTooltipArrow: HTMLElement;

	beforeAll(() => {
		vi.useFakeTimers();
	});

	afterAll(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		state = new TooltipState();
		mockTarget = document.createElement('div');
		mockTooltipEl = document.createElement('div');
		mockTooltipArrow = document.createElement('div');
		mockTooltipArrow.classList.add('arrow');
		mockTooltipEl.appendChild(mockTooltipArrow);
		mockTooltipEl.style.visibility = 'hidden';

		document.body.appendChild(mockTarget);
		document.body.appendChild(mockTooltipEl);
		state.tooltipEl = mockTooltipEl;
	});

	describe('set', () => {
		it('should set debounce showing the new tooltip, dismiss the old tooltip and updating the tooltip data if the tooltip is different', async () => {
			state.open = true;
			state.tooltip = {
				data: 'Old Tooltip',
				target: mockTooltipEl,
				calibrateFor: 'horizontal'
			};

			const tooltipData: TooltipData['data'] = 'Test Tooltip';
			const calibrateFor: TooltipData['calibrateFor'] = 'vertical';

			state.set(tooltipData, calibrateFor, mockTarget);

			expect(state.tooltip).toEqual({
				data: tooltipData,
				target: mockTarget,
				calibrateFor
			});

			expect(state.open).toBe(false);
			expect(mockTarget.getAttribute('aria-describedby')).toBeNull();

			await vi.runAllTimersAsync();
			expect(state.open).toBe(true);
			expect(mockTarget.getAttribute('aria-describedby')).toBe(state.TOOLTIP_ID);
		});

		it('should only set the debounce for the target but not dismiss the old tooltip if the parameter is the same element as the current tooltip', async () => {
			state.open = true;
			state.open = true;
			state.tooltip = {
				data: 'Old Tooltip',
				target: mockTarget,
				calibrateFor: 'horizontal'
			};

			mockTarget.setAttribute('aria-describedby', state.TOOLTIP_ID);

			const tooltipData: TooltipData['data'] = 'Test Tooltip';
			const calibrateFor: TooltipData['calibrateFor'] = 'vertical';

			state.set(tooltipData, calibrateFor, mockTarget);

			expect(state.tooltip).toEqual({
				data: 'Old Tooltip',
				target: mockTarget,
				calibrateFor: 'horizontal'
			});

			expect(state.open).toBe(true);
			expect(mockTarget.getAttribute('aria-describedby')).toBe(state.TOOLTIP_ID);

			await vi.runAllTimersAsync();
			expect(state.open).toBe(true);
			expect(mockTarget.getAttribute('aria-describedby')).toBe(state.TOOLTIP_ID);
		});
	});

	describe('show', () => {
		it('should set aria-describedby and open the tooltip if the tooltip exists', () => {
			state.tooltip = {
				data: 'Test Tooltip',
				target: mockTarget,
				calibrateFor: 'vertical'
			};

			state.show();
			expect(state.open).toBe(true);
			expect(mockTarget.getAttribute('aria-describedby')).toBe(state.TOOLTIP_ID);
		});

		it('should not set aria-describedby and open the tooltip if the tooltip does not exist', () => {
			state.show();
			expect(state.open).toBe(false);
			expect(mockTarget.getAttribute('aria-describedby')).toBeNull();
		});
	});

	describe('dismiss', () => {
		it('should remove aria-describedby and close the tooltip', () => {
			state.tooltip = {
				data: 'Test Tooltip',
				target: mockTarget,
				calibrateFor: 'vertical'
			};
			state.open = true;
			mockTarget.setAttribute('aria-describedby', state.TOOLTIP_ID);

			state.dismiss();
			expect(state.open).toBe(false);
			expect(mockTarget.getAttribute('aria-describedby')).toBeNull();
			expect(state.tooltip).toBeNull();
		});

		it('should function correctly even if the tooltip is null', () => {
			state.open = true;

			state.dismiss();
			expect(state.open).toBe(false);
		});
	});

	describe('calibratePosition', () => {
		it("should set the tooltip's position to be on the left if the calibrateFor is horizontal and it does not go offscreen", () => {
			const hostLeft = 200;
			const hostTop = 100;
			const hostHeight = 50;
			// @ts-expect-error Test code
			mockTarget.getBoundingClientRect = vi.fn(() => ({
				top: hostTop,
				left: hostLeft,
				width: 50,
				height: hostHeight,
				right: 250,
				bottom: 150
			}));

			const tooltipWidth = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: 0,
				left: state.MARGIN * 2 + 1,
				width: tooltipWidth,
				height: 50,
				right: 100,
				bottom: 50
			}));

			state.calibratePosition('horizontal', mockTarget, mockTooltipEl);

			expect(mockTooltipEl.style.left).toBe(hostLeft - tooltipWidth - state.MARGIN + 'px');
			expect(mockTooltipEl.style.top).toBe(hostTop + hostHeight / 2 + 'px');
			expect(mockTooltipEl.style.visibility).toBe('visible');

			expect(mockTooltipArrow.style.top).toBe('50%');
			expect(mockTooltipArrow.style.left).toBe('calc(100% + 2px)');
			expect(mockTooltipArrow.style.transform).toBe('translateY(-50%) rotate(90deg)');
		});

		it("should set the tooltip's position to be on the right if the calibrateFor is horizontal and it does go offscreen", () => {
			const hostLeft = 200;
			const hostTop = 100;
			const hostRight = 250;
			const hostHeight = 50;
			// @ts-expect-error Test code
			mockTarget.getBoundingClientRect = vi.fn(() => ({
				top: hostTop,
				left: hostLeft,
				width: 50,
				height: hostHeight,
				right: 250,
				bottom: 150
			}));

			const tooltipWidth = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: 0,
				left: state.MARGIN * 2 - 1,
				width: tooltipWidth,
				height: 50,
				right: 100,
				bottom: 50
			}));

			state.calibratePosition('horizontal', mockTarget, mockTooltipEl);

			expect(mockTooltipEl.style.left).toBe(hostRight + state.MARGIN + 'px');
			expect(mockTooltipEl.style.top).toBe(hostTop + hostHeight / 2 + 'px');
			expect(mockTooltipEl.style.visibility).toBe('visible');

			expect(mockTooltipArrow.style.top).toBe('50%');
			expect(mockTooltipArrow.style.right).toBe('calc(100% + 2px)');
			expect(mockTooltipArrow.style.transform).toBe('translateY(-50%) rotate(-90deg)');
		});

		it("should set the tooltip's position to be on the top if the calibrateFor is vertical and it does not go offscreen", () => {
			const hostLeft = 200;
			const hostTop = 100;
			const hostHeight = 75;
			const hostWidth = 50;
			// @ts-expect-error Test code
			mockTarget.getBoundingClientRect = vi.fn(() => ({
				top: hostTop,
				left: hostLeft,
				width: hostWidth,
				height: hostHeight,
				right: 250,
				bottom: 150
			}));

			const tooltipHeight = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: state.MARGIN * 2 + 1,
				left: 0,
				width: 50,
				height: tooltipHeight,
				right: 50,
				bottom: 100
			}));

			state.calibratePosition('vertical', mockTarget, mockTooltipEl);

			expect(mockTooltipEl.style.left).toBe(hostLeft + hostWidth / 2 + 'px');
			expect(mockTooltipEl.style.top).toBe(hostTop - tooltipHeight - state.MARGIN + 'px');
			expect(mockTooltipEl.style.visibility).toBe('visible');

			expect(mockTooltipArrow.style.left).toBe('50%');
			expect(mockTooltipArrow.style.top).toBe('calc(100% + 2px)');
		});

		it("should set the tooltip's position to be on the bottom if the calibrateFor is vertical and it does go offscreen", () => {
			const hostLeft = 200;
			const hostTop = 100;
			const hostHeight = 75;
			const hostWidth = 50;
			const hostBottom = 150;
			// @ts-expect-error Test code
			mockTarget.getBoundingClientRect = vi.fn(() => ({
				top: hostTop,
				left: hostLeft,
				width: hostWidth,
				height: hostHeight,
				right: 250,
				bottom: hostBottom
			}));

			const tooltipHeight = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: state.MARGIN * 2 - 1,
				left: 0,
				width: 50,
				height: tooltipHeight,
				right: 50,
				bottom: 100
			}));

			state.calibratePosition('vertical', mockTarget, mockTooltipEl);

			expect(mockTooltipEl.style.left).toBe(hostLeft + hostWidth / 2 + 'px');
			expect(mockTooltipEl.style.top).toBe(hostBottom + state.MARGIN + 'px');
			expect(mockTooltipEl.style.visibility).toBe('visible');

			expect(mockTooltipArrow.style.left).toBe('50%');
			expect(mockTooltipArrow.style.bottom).toBe('calc(100% + 2px)');
		});
	});
});
