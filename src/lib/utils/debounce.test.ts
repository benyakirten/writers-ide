import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Debouncer } from './debounce.js';

describe('Debouncer', () => {
	beforeAll(() => {
		vi.useFakeTimers();
	});

	afterAll(() => {
		vi.useRealTimers();
	});

	it('should call the callback after the specified delay after update has been called ', async () => {
		const callback = vi.fn();
		const debouncer = new Debouncer(callback, { delay: 100 });

		debouncer.update('test');
		expect(callback).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();
		expect(callback).toHaveBeenCalledWith('test');
	});

	it('should reset the delay if update is called again before the delay', async () => {
		const callback = vi.fn();
		const debouncer = new Debouncer(callback, { delay: 100 });

		debouncer.update('test1');
		await vi.advanceTimersByTimeAsync(50);
		debouncer.update('test2');

		expect(callback).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();
		expect(callback).toHaveBeenCalledWith('test2');
	});

	it('should handle promises returned by the callback', async () => {
		const callback = vi.fn().mockResolvedValue('resolved');
		const debouncer = new Debouncer(callback, { delay: 100 });

		debouncer.update('test');
		await vi.runAllTimersAsync();

		expect(callback).toHaveBeenCalledWith('test');
	});

	it('should not call the callback if the value is null', async () => {
		const callback = vi.fn();
		const debouncer = new Debouncer(callback, { delay: 100 });

		debouncer.update(null);
		await vi.runAllTimersAsync();

		expect(callback).not.toHaveBeenCalled();
	});

	it("should reset the timer if the value hasn't changed and resetIfSameValue is true", async () => {
		const callback = vi.fn();
		const debouncer = new Debouncer(callback, {
			delay: 100,
			resetIfSameValue: true
		});
		debouncer.update('test');
		await vi.advanceTimersByTimeAsync(50);
		debouncer.update('test'); // Same value, should not reset the timer
		await vi.advanceTimersByTimeAsync(75);
		expect(callback).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(50);
		expect(callback).toHaveBeenCalledOnce();
	});

	it("should not reset the timer if the value hasn't changed and resetIfSameValue is false", async () => {
		const callback = vi.fn();
		const debouncer = new Debouncer(callback, {
			delay: 100,
			resetIfSameValue: false
		});
		debouncer.update('test');
		await vi.advanceTimersByTimeAsync(50);
		debouncer.update('test'); // Same value, should not reset the timer
		await vi.advanceTimersByTimeAsync(75);
		expect(callback).toHaveBeenCalledOnce();
	});
});
