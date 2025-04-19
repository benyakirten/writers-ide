import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';

import { Toast, ToasterState } from './toaster.svelte';

beforeAll(() => {
	vi.useFakeTimers();
});

afterAll(() => {
	vi.useRealTimers();
});

afterEach(() => {
	vi.runAllTimers();
});

describe('Toast', () => {
	const dismissMock = vi.fn();
	afterEach(() => {
		dismissMock.mockClear();
	});

	describe('constructor', () => {
		it('should initialize with the correct properties and start an interval that reduces the timeLeft property if the duration is greater than 0', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			const toast = new Toast(
				{ duration: toastDuration, message: 'Message' },
				'test-id',
				dismissMock
			);

			expect(toast.duration).toBe(toastDuration);
			expect(toast.message).toBe('Message');
			expect(toast.id).toBe('test-id');
			expect(toast.timeLeft).toBe(toastDuration);

			await vi.runAllTimersAsync();
			expect(dismissMock).toHaveBeenCalled();
			expect(toast.timeLeft).toBeLessThanOrEqual(0);
		});

		it('should not start an interval if the duration is 0', async () => {
			const toast = new Toast({ duration: 0, message: 'Message' }, 'test-id', dismissMock);

			expect(toast.duration).toBe(0);

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(0);
		});

		it('should not start an interval if the duration is undefined', async () => {
			const toast = new Toast({ message: 'Message', duration: null }, 'test-id', dismissMock);

			expect(toast.duration).toBe(null);

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(null);
		});
	});

	describe('start', () => {
		it('should start an interval that reduces the timeLeft property and assign it to the interval property of the toast', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			const toast = new Toast({ message: 'Message', duration: null }, 'test-id', dismissMock);

			toast.duration = toastDuration;
			toast.timeLeft = toastDuration;
			expect(toast.interval).toBe(null);

			toast.start();

			// Advanced by almost the full timer.
			await vi.advanceTimersByTimeAsync(toastDuration - Toast.INTERVAL_DELAY);
			expect(dismissMock).not.toHaveBeenCalled();
			expect(toast.timeLeft).toBe(Toast.INTERVAL_DELAY);

			// Advance timer by the remaining time + the interval delay for the check
			await vi.advanceTimersByTimeAsync(Toast.INTERVAL_DELAY * 2);
			expect(dismissMock).toHaveBeenCalled();
			expect(toast.timeLeft).toBeLessThanOrEqual(0);
			expect(toast.interval).not.toBeNull();
		});
	});

	describe('stop', () => {
		it('should return false if there is no interval', async () => {
			const toast = new Toast({ message: 'Message', duration: null }, 'test-id', dismissMock);
			const got = toast.stop();
			expect(got).toBe(false);

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
		});

		it('should return true and stop the interval if the interval exists', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 2;
			const toast = new Toast(
				{ message: 'Message', duration: toastDuration },
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
			const toast = new Toast({ message: 'Message', duration: null }, 'test-id', dismissMock);
			const got = toast.reset();

			expect(got).toBe(false);
			expect(dismissMock).not.toHaveBeenCalled();

			await vi.runAllTimersAsync();
			expect(dismissMock).not.toHaveBeenCalled();
		});

		it('should cancel the timeout and restart it with the initial duration', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;

			const toast = new Toast(
				{ message: 'Message', duration: toastDuration },
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

describe('ToasterState', () => {
	let state: ToasterState;

	beforeEach(() => {
		state = new ToasterState();
	});

	describe('addToast', () => {
		it("should add a toast to the state with a generated id if an id isn't provided", () => {
			const toastMessage = 'Test Toast';

			const got = state.addToast(toastMessage, null);

			expect(state.toasts.length).toBe(1);
			expect(state.toasts[0].message).toBe(toastMessage);
			expect(state.toasts[0].id).toBe(got);
		});

		it('should set the correct duration for the toast and remove it when the timer is finished', async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			state.addToast('Test Toast', toastDuration);

			expect(state.toasts[0].duration).toBe(toastDuration);
			await vi.advanceTimersByTimeAsync(toastDuration + Toast.INTERVAL_DELAY);
			expect(state.toasts.length).toBe(0);
		});

		it('should return the same ID passed in if an ID is provided', () => {
			const id = 'custom-id';

			const got = state.addToast('Test Toast', null, id);

			expect(got).toBe(state.toasts[0].id);
			expect(state.toasts[0].id).toBe(id);
		});
	});

	describe('removeToast', () => {
		it("should stop the toast's interval, remove it from the toasts and return true if it is found", async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			const id = state.addToast('Message', toastDuration);
			state.addToast('Message2');

			const toast = state.toasts[0];
			expect(toast.message).toEqual('Message');
			await vi.advanceTimersByTimeAsync(toastDuration / 2);

			const got = state.removeToast(id);
			expect(got).toBe(true);
			expect(state.toasts.length).toBe(1);
			expect(toast.timeLeft).toBe(toastDuration / 2);

			expect(state.toasts[0].message).toEqual('Message2');
		});

		it('should return false if the toast is not found', () => {
			state.addToast('Message');

			const got = state.removeToast('non-existent-id');
			expect(got).toBe(false);
			expect(state.toasts.length).toBe(1);
		});
	});

	describe('pauseToast', () => {
		it("should return true and pause the toast's timer if the toast is not found", async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			const id = state.addToast('Message', toastDuration);
			const toast = state.toasts[0];
			await vi.advanceTimersByTimeAsync(toastDuration / 2);

			const got = state.pauseToast(id);

			expect(got).toBe(true);
			expect(toast.timeLeft).toBe(toastDuration / 2);

			await vi.runAllTimersAsync();
			expect(toast.timeLeft).toBe(toastDuration / 2);
			expect(state.toasts.length).toBe(1);
		});

		it("should return false and not pause the toast's timer if the toast is not found", async () => {
			const toastDuration = Toast.INTERVAL_DELAY * 10;
			state.addToast('Message', toastDuration);

			const toast = state.toasts[0];
			await vi.advanceTimersByTimeAsync(toastDuration / 2);
			const got = state.pauseToast('non-existent-id');

			expect(got).toBe(false);
			expect(toast.timeLeft).toBe(toastDuration / 2);

			await vi.runAllTimersAsync();
			expect(toast.timeLeft).toBeLessThanOrEqual(0);
			expect(state.toasts.length).toBe(0);
		});
	});
});
