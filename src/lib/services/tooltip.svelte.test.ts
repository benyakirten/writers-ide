import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
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

	afterEach(() => {
		vi.runAllTimers();
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
				calibrateFor: 'horizontal',
			};

			const tooltipData: TooltipData['data'] = 'Test Tooltip';
			const calibrateFor: TooltipData['calibrateFor'] = 'vertical';

			state.set(tooltipData, calibrateFor, mockTarget);

			expect(state.tooltip).toEqual({
				data: tooltipData,
				target: mockTarget,
				calibrateFor,
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
				calibrateFor: 'horizontal',
			};

			mockTarget.setAttribute('aria-describedby', state.TOOLTIP_ID);

			const tooltipData: TooltipData['data'] = 'Test Tooltip';
			const calibrateFor: TooltipData['calibrateFor'] = 'vertical';

			state.set(tooltipData, calibrateFor, mockTarget);

			expect(state.tooltip).toEqual({
				data: 'Old Tooltip',
				target: mockTarget,
				calibrateFor: 'horizontal',
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
				calibrateFor: 'vertical',
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
				calibrateFor: 'vertical',
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

	describe('suppress', () => {
		it('immediately dismisses an open tooltip and removes its accessibility association', () => {
			state.set('Open tooltip', 'vertical', mockTarget);
			vi.advanceTimersByTime(state.TIMEOUT_DURATION);
			expect(state.open).toBe(true);
			expect(mockTarget.getAttribute('aria-describedby')).toBe(state.TOOLTIP_ID);

			const release = state.suppress();

			expect(state.suppressed).toBe(true);
			expect(state.open).toBe(false);
			expect(state.tooltip).toBeNull();
			expect(mockTarget.hasAttribute('aria-describedby')).toBe(false);

			release();
			vi.runAllTimers();
			expect(state.open).toBe(false);
			expect(state.tooltip).toBeNull();
		});

		it.each([false, true])(
			'cancels a pending show without replay when released before the deadline: %s',
			(releaseBeforeDeadline) => {
				state.set('Pending tooltip', 'vertical', mockTarget);
				vi.advanceTimersByTime(state.TIMEOUT_DURATION / 2);

				const release = state.suppress();
				expect(state.tooltipDebouncer.value).toBeNull();
				expect(vi.getTimerCount()).toBe(0);
				if (releaseBeforeDeadline) {
					release();
				}

				vi.runAllTimers();
				expect(state.open).toBe(false);
				expect(state.tooltip).toBeNull();
				expect(mockTarget.hasAttribute('aria-describedby')).toBe(false);

				release();
				vi.runAllTimers();
				expect(state.open).toBe(false);
				expect(state.tooltip).toBeNull();
			},
		);

		it('ignores new requests during suppression without scheduling or replaying them', () => {
			const release = state.suppress();

			state.set('Ignored tooltip', 'vertical', mockTarget);
			state.show();
			expect(vi.getTimerCount()).toBe(0);
			expect(state.tooltip).toBeNull();
			expect(state.open).toBe(false);
			expect(mockTarget.hasAttribute('aria-describedby')).toBe(false);

			release();
			vi.runAllTimers();
			expect(state.tooltip).toBeNull();
			expect(state.open).toBe(false);
		});

		it('guards direct and delayed show calls even when tooltip data exists', () => {
			const release = state.suppress();
			state.tooltip = {
				data: 'Tooltip data',
				target: mockTarget,
				calibrateFor: 'vertical',
			};

			state.show();
			expect(state.open).toBe(false);
			state.tooltipDebouncer.update(true);
			vi.runAllTimers();
			expect(state.open).toBe(false);
			expect(mockTarget.hasAttribute('aria-describedby')).toBe(false);

			state.dismiss();
			release();
		});

		it.each([false, true])(
			'keeps nested leases suppressed until all are released, with outer-first release: %s',
			(outerFirst) => {
				const releaseOuter = state.suppress();
				const releaseInner = state.suppress();
				const releaseFirst = outerFirst ? releaseOuter : releaseInner;
				const releaseLast = outerFirst ? releaseInner : releaseOuter;

				releaseFirst();
				releaseFirst();
				expect(state.suppressed).toBe(true);
				state.set('Still suppressed', 'vertical', mockTarget);
				vi.runAllTimers();
				expect(state.tooltip).toBeNull();
				expect(state.open).toBe(false);

				releaseLast();
				releaseLast();
				expect(state.suppressed).toBe(false);

				const releaseNext = state.suppress();
				releaseFirst();
				releaseLast();
				expect(state.suppressed).toBe(true);
				releaseNext();
				expect(state.suppressed).toBe(false);
			},
		);

		it.each([false, true])(
			'allows a fresh delayed request for the same target after releasing an open tooltip: %s',
			(wasOpen) => {
				state.set('Previous tooltip', 'vertical', mockTarget);
				if (wasOpen) {
					vi.advanceTimersByTime(state.TIMEOUT_DURATION);
				}

				const release = state.suppress();
				state.set('Ignored tooltip', 'horizontal', mockTarget);
				release();
				vi.runAllTimers();
				expect(state.open).toBe(false);

				state.set('Fresh tooltip', 'horizontal', mockTarget);
				expect(state.tooltip).toEqual({
					data: 'Fresh tooltip',
					target: mockTarget,
					calibrateFor: 'horizontal',
				});
				vi.advanceTimersByTime(state.TIMEOUT_DURATION - 1);
				expect(state.open).toBe(false);
				vi.advanceTimersByTime(1);
				expect(state.open).toBe(true);
				expect(mockTarget.getAttribute('aria-describedby')).toBe(state.TOOLTIP_ID);
			},
		);
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
				bottom: 150,
			}));

			const tooltipWidth = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: 0,
				left: state.MARGIN * 2 + 1,
				width: tooltipWidth,
				height: 50,
				right: 100,
				bottom: 50,
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
				bottom: 150,
			}));

			const tooltipWidth = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: 0,
				left: state.MARGIN * 2 - 1,
				width: tooltipWidth,
				height: 50,
				right: 100,
				bottom: 50,
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
				bottom: 150,
			}));

			const tooltipHeight = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: state.MARGIN * 2 + 1,
				left: 0,
				width: 50,
				height: tooltipHeight,
				right: 50,
				bottom: 100,
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
				bottom: hostBottom,
			}));

			const tooltipHeight = 20;
			// @ts-expect-error Test code
			mockTooltipEl.getBoundingClientRect = vi.fn(() => ({
				top: state.MARGIN * 2 - 1,
				left: 0,
				width: 50,
				height: tooltipHeight,
				right: 50,
				bottom: 100,
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
