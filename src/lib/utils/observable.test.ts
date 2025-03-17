import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';

import { Observable } from './observable.js';
import { RequiredObservable } from './observable.js';

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

describe('RequiredObservable', () => {
	it('should call subscribers as soon as they are registered with the current data', () => {
		const initialData = 10;
		const observable = new RequiredObservable<number>(initialData);
		const callback = vi.fn();

		const unsubscribe = observable.subscribe(callback);

		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith(initialData);
		unsubscribe();
	});

	it('should update data and notify subscribers when the data is changed', () => {
		const initialData = 10;
		const observable = new RequiredObservable<number>(initialData);
		const callback = vi.fn();

		const unsubscribe = observable.subscribe(callback);
		observable.data = 20;

		expect(callback).toHaveBeenCalledWith(20);
		unsubscribe();

		observable.data = 30;
		expect(callback).toHaveBeenCalledTimes(2);
	});

	it("should only call the new subscriber's callback with the current data when they subscribe", () => {
		const initialData = 10;
		const observable = new RequiredObservable<number>(initialData);
		const callback1 = vi.fn();

		const unsubscribe = observable.subscribe(callback1);
		expect(callback1).toHaveBeenCalledOnce();

		const callback2 = vi.fn();
		const unsubscribe2 = observable.subscribe(callback2);
		expect(callback1).toHaveBeenCalledOnce();
		expect(callback2).toHaveBeenCalledOnce();

		unsubscribe();
		unsubscribe2();
	});

	it("should get the current value's data without calling subscribers if the current value is accessed", () => {
		const initialData = 10;
		const observable = new RequiredObservable<number>(initialData);
		const callback = vi.fn();

		const unsubscribe = observable.subscribe(callback);
		expect(callback).toHaveBeenCalledTimes(1);

		const data = observable.data;
		expect(data).toBe(initialData);
		expect(callback).toHaveBeenCalledTimes(1);

		unsubscribe();
	});
});
