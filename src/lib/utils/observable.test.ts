import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';

import { Observable } from './observable.js';

describe('Observable', () => {
	beforeAll(() => {
		vi.useFakeTimers();
	});

	afterAll(() => {
		vi.useRealTimers();
	});

	it('should allow subscribers to receive updates', () => {
		const observable = new Observable<number>();
		const callback = vi.fn();

		const unsubscribe = observable.subscribe(callback);
		observable.update(42);

		expect(callback).toHaveBeenCalledWith(42);

		unsubscribe();
		observable.update(100);

		expect(callback).toHaveBeenCalledTimes(1);
	});

	it('should allow multiple subscribers to receive updates', () => {
		const observable = new Observable<number>();
		const callback1 = vi.fn();
		const callback2 = vi.fn();

		const unsubscribe1 = observable.subscribe(callback1);
		const unsubscribe2 = observable.subscribe(callback2);
		observable.update(42);

		expect(callback1).toHaveBeenCalledWith(42);
		expect(callback2).toHaveBeenCalledWith(42);

		unsubscribe1();
		observable.update(100);

		expect(callback1).toHaveBeenCalledTimes(1);
		expect(callback2).toHaveBeenCalledWith(100);

		unsubscribe2();
		observable.update(200);

		expect(callback2).toHaveBeenCalledTimes(2);
	});

	it('should handle async subscribers', async () => {
		const observable = new Observable<number>();
		const mock = vi.fn();
		const callback = async (data: number) => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			mock(data);
		};

		const unsubscribe = observable.subscribe(callback);
		observable.update(42);

		await vi.runAllTimersAsync();
		expect(mock).toHaveBeenCalledOnce();
		expect(mock).toHaveBeenCalledWith(42);

		unsubscribe();

		observable.update(100);
		expect(mock).toHaveBeenCalledTimes(1);
	});
});
