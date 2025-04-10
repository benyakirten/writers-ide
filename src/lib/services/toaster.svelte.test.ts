import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

import { Toast } from './toaster.svelte';

beforeAll(() => {
	vi.useFakeTimers();
});

afterAll(() => {
	vi.useRealTimers();
});
describe('Toast', () => {
	const dismissMock = vi.fn();

	afterEach(() => {
		dismissMock.mockClear();
		vi.runAllTimers();
	});

	describe('constructor', () => {
		it('should initialize with the correct properties and start an interval that reduces the timeLeft property if the duration is greater than 0', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			const toast = new Toast(
				{ dismissable: true, duration: toastDuration, message: 'Message' },
				'test-id',
				dismissMock
			);

			expect(toast.duration).toBe(toastDuration);
			expect(toast.dismissable).toBe(true);
			expect(toast.message).toBe('Message');
			expect(toast.id).toBe('test-id');
			expect(toast.timeLeft).toBe(toastDuration);

			await vi.runAllTimersAsync();
			expect(dismissMock).toHaveBeenCalled();
			expect(toast.timeLeft).toBeLessThanOrEqual(0);
		});

		it('should not start an interval if the duration is 0', async () => {
			const toast = new Toast(
				{ dismissable: true, duration: 0, message: 'Message' },
				'test-id',
				dismissMock
			);

			expect(toast.duration).toBe(0);

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(0);
		});

		it('should not start an interval if the duration is undefined', async () => {
			const toast = new Toast({ dismissable: true, message: 'Message' }, 'test-id', dismissMock);

			expect(toast.duration).toBe(null);

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(null);
		});
	});

	describe('start', () => {
		it('should start an interval that reduces the timeLeft property', async () => {
			const toastDuration = 1000;
			const toast = new Toast({ dismissable: true, message: 'Message' }, 'test-id', dismissMock);

			toast.duration = toastDuration;
			toast.timeLeft = toastDuration;

			toast.start();

			// Advanced by almost the full timer.
			await vi.advanceTimersByTimeAsync(toastDuration - Toast.INTERVAL_DELAY);
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(Toast.INTERVAL_DELAY);

			// Advance timer by the remaining time + the interval delay for the check
			await vi.advanceTimersByTimeAsync(Toast.INTERVAL_DELAY * 2);
			expect(dismissMock).toHaveBeenCalled();
			expect(toast.timeLeft).toBeLessThanOrEqual(0);
		});
	});

	describe('stop', () => {
		it('should return false if there is no interval', async () => {
			const toast = new Toast({ dismissable: true, message: 'Message' }, 'test-id', dismissMock);
			const got = toast.stop();
			expect(got).toBe(false);

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
		});

		it('should return true and stop the interval if the interval exists', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 2;
			const toast = new Toast(
				{ dismissable: true, message: 'Message', duration: toastDuration },
				'test-id',
				dismissMock
			);
			vi.advanceTimersByTime(toastDuration / 2);

			const got = toast.stop();
			expect(got).toBe(true);
			expect(toast.timeLeft).toBe(toastDuration / 2);

			expect(dismissMock).not.toHaveBeenCalled();
			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
		});
	});

	describe('reset', () => {
		it('should return false if the duration is not valid and not restart the timer', async () => {
			const toast = new Toast({ dismissable: true, message: 'Message' }, 'test-id', dismissMock);
			const got = toast.reset();

			expect(got).toBe(false);
			expect(dismissMock).not.toHaveBeenCalled();

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
		});

		it('should cancel the timeout and restart it with the initial duration', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;

			const toast = new Toast(
				{ dismissable: true, message: 'Message', duration: toastDuration },
				'test-id',
				dismissMock
			);

			vi.advanceTimersByTime(toastDuration / 2);
			expect(toast.timeLeft).toBe(toastDuration / 2);

			const got = toast.reset();
			expect(got).toBe(true);
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(toastDuration);

			await vi.runAllTimersAsync();
			expect(dismissMock).toHaveBeenCalled();
			expect(toast.timeLeft).toBeLessThanOrEqual(0);
		});
	});
});
