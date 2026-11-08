import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	WorkQueue,
	workQueue,
	type WorkHandle,
	type WorkOptions,
	type WorkProgress,
} from './work-queue.svelte';

describe('WorkQueue', () => {
	let queue: WorkQueue;
	let frames: Map<number, FrameRequestCallback>;
	let now: number;
	let nextId: number;

	beforeEach(() => {
		queue = new WorkQueue();
		frames = new Map();
		now = 0;
		nextId = 0;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				frames.set(++nextId, callback);
				return nextId;
			}),
		);
		vi.stubGlobal(
			'cancelAnimationFrame',
			vi.fn((id: number) => frames.delete(id)),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function frame() {
		const callbacks = [...frames.values()];
		frames.clear();
		for (const callback of callbacks) callback(now);
	}

	function enqueue(key: string, overrides: Partial<WorkOptions> = {}) {
		return queue.enqueue({
			key,
			label: key,
			create: function* () {
				while (true) {
					now += 8;
					yield;
				}
			},
			...overrides,
		});
	}

	it('exports an inert singleton and retains metadata and progress on completed handles', () => {
		expect(workQueue).toBeInstanceOf(WorkQueue);
		const create = vi.fn(function* () {
			now += 8;
			yield { completed: 1, total: 2 };
			now += 8;
			yield { completed: 2, message: 'Done' };
		});
		const job = enqueue('one', { documentId: 'doc', viewId: 'view', label: 'Index', create });
		expect(job).toMatchObject({
			status: 'queued',
			progress: {},
			documentId: 'doc',
			viewId: 'view',
			label: 'Index',
			priority: 'background',
		});
		expect(queue.jobs).toEqual([job]);
		expect(frames.size).toBe(0);
		expect(create).not.toHaveBeenCalled();
		queue.start();
		frame();
		expect(job.status).toBe('running');
		expect(job.progress).toEqual({ completed: 1, total: 2 });
		frame();
		expect(job.progress).toEqual({ completed: 2, total: 2, message: 'Done' });
		frame();
		expect(job.status).toBe('completed');
		expect(queue.jobs).toEqual([]);
		expect(frames.size).toBe(0);
		job.cancel();
		job.pause();
		job.resume();
		expect(job.status).toBe('completed');
	});

	it('uses an 8ms frame budget and yields to the browser before more work', () => {
		let steps = 0;
		enqueue('budget', {
			create: function* () {
				while (true) {
					steps++;
					now += 3;
					yield;
				}
			},
		});
		queue.start();
		frame();
		expect(steps).toBe(3);
		expect(frames.size).toBe(1);
		frame();
		expect(steps).toBe(6);
	});

	it('round robins within priorities and gives background work every fourth turn', () => {
		const order: string[] = [];
		for (const key of ['i1', 'i2', 'b1', 'b2']) {
			enqueue(key, {
				priority: key.startsWith('i') ? 'interactive' : 'background',
				create: function* () {
					while (true) {
						order.push(key);
						now += 8;
						yield;
					}
				},
			});
		}
		queue.start();
		for (let i = 0; i < 8; i++) frame();
		expect(order).toEqual(['i1', 'i2', 'i1', 'b1', 'i2', 'i1', 'i2', 'b2']);
	});

	it('refcounts start leases, stops on last release, and restarts without cancelling', () => {
		const job = enqueue('one');
		const stopA = queue.start();
		const stopB = queue.start();
		expect(frames.size).toBe(1);
		stopA();
		stopA();
		expect(frames.size).toBe(1);
		frame();
		stopB();
		expect(frames.size).toBe(0);
		expect(job.status).toBe('running');
		const stopC = queue.start();
		expect(frames.size).toBe(1);
		stopC();
		expect(frames.size).toBe(0);
	});

	it('does not spin while paused and resumes queued or previously running work', () => {
		const job = enqueue('one');
		queue.start();
		job.pause();
		expect(job.status).toBe('paused');
		expect(frames.size).toBe(0);
		job.resume();
		expect(job.status).toBe('queued');
		frame();
		job.pause();
		expect(frames.size).toBe(0);
		job.resume();
		expect(job.status).toBe('running');
		expect(frames.size).toBe(1);
	});

	it('cancels queued work without creating it, and aborts and closes running work once', () => {
		const create = vi.fn(function* () {
			yield;
		});
		const queued = enqueue('queued', { create });
		queued.cancel();
		expect(create).not.toHaveBeenCalled();
		let signal: AbortSignal | undefined;
		const cleanup = vi.fn();
		const running = enqueue('running', {
			create: function* (context) {
				signal = context.signal;
				try {
					now += 8;
					yield;
				} finally {
					cleanup(signal.aborted);
				}
			},
		});
		queue.start();
		frame();
		running.pause();
		running.cancel();
		running.cancel();
		expect(signal?.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledWith(true);
		expect(running.status).toBe('cancelled');
		expect(queue.jobs).toEqual([]);
		expect(frames.size).toBe(0);
	});

	it('replaces keyed jobs and cancels only the requested view', () => {
		const old = enqueue('same', { viewId: 'a' });
		const replacement = enqueue('same', { viewId: 'b' });
		const other = enqueue('other', { viewId: 'a' });
		const unscoped = enqueue('unscoped');
		expect(old.status).toBe('cancelled');
		queue.cancelView('a');
		expect(other.status).toBe('cancelled');
		expect(queue.jobs).toEqual([replacement, unscoped]);
	});

	it('defers self-cancellation cleanup until next returns and ignores its progress', () => {
		const cleanup = vi.fn();
		const job = enqueue('self', {
			create: function* ({ signal }) {
				try {
					job.cancel();
					expect(signal.aborted).toBe(true);
					expect(cleanup).not.toHaveBeenCalled();
					yield { completed: 99 };
				} finally {
					cleanup();
				}
			},
		});
		queue.start();
		frame();
		expect(job.status).toBe('cancelled');
		expect(job.error).toBeUndefined();
		expect(job.progress).toEqual({});
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(frames.size).toBe(0);
	});

	it('handles cancellation during create and reentrant keyed replacement during next', () => {
		const close = vi.fn(() => ({ done: true as const, value: undefined }));
		const next = vi.fn(() => ({ done: true as const, value: undefined }));
		const job = enqueue('create', {
			create: () => {
				job.cancel();
				return { next, return: close } as unknown as Generator<WorkProgress | void, void, unknown>;
			},
		});
		queue.start();
		frame();
		expect(next).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
		let replacement: WorkHandle | undefined;
		const old = enqueue('same', {
			create: function* () {
				replacement = enqueue('same');
				yield;
			},
		});
		frame();
		expect(old.status).toBe('cancelled');
		expect(old.error).toBeUndefined();
		expect(queue.jobs).toEqual([replacement]);
	});

	it('isolates factory, iteration, and cancellation cleanup failures', () => {
		const failure = new Error('work failed');
		const cleanupFailure = new Error('cleanup failed');
		const factory = enqueue('factory', {
			create: () => {
				throw failure;
			},
		});
		const iteration = enqueue('iteration', {
			create: () =>
				({
					next() {
						throw failure;
					},
					return() {
						return { done: true, value: undefined };
					},
				}) as unknown as Generator<WorkProgress | void, void, unknown>,
		});
		const badCleanup = enqueue('cleanup', {
			create: function* () {
				try {
					now += 8;
					yield;
				} finally {
					// Deliberately exercise a broken generator cleanup.
					// eslint-disable-next-line no-unsafe-finally
					throw cleanupFailure;
				}
			},
		});
		const healthy = enqueue('healthy', {
			create: function* () {
				yield { completed: 1 };
			},
		});
		queue.start();
		frame();
		expect(factory).toMatchObject({ status: 'failed', error: failure });
		expect(iteration).toMatchObject({ status: 'failed', error: failure });
		expect(() => badCleanup.cancel()).not.toThrow();
		expect(badCleanup).toMatchObject({ status: 'cancelled', error: cleanupFailure });
		frame();
		expect(healthy.status).toBe('completed');
		expect(queue.jobs).toEqual([]);
	});

	it('preserves both iteration and cleanup failures', () => {
		const workError = new Error('next');
		const cleanupError = new Error('return');
		const job = enqueue('both', {
			create: () =>
				({
					next() {
						throw workError;
					},
					return() {
						throw cleanupError;
					},
				}) as unknown as Generator<WorkProgress | void, void, unknown>,
		});
		queue.start();
		frame();
		expect(job.status).toBe('failed');
		expect(job.error).toBeInstanceOf(AggregateError);
		expect((job.error as AggregateError).errors).toEqual([workError, cleanupError]);
		expect(queue.jobs).toEqual([]);
	});

	it('updates derived UI state for membership, status, and progress', () => {
		const rows = $derived(
			queue.jobs.map((job) => `${job.key}:${job.status}:${job.progress.completed ?? 0}`),
		);
		const readRows = () => rows;
		expect(readRows()).toEqual([]);
		const job = enqueue('reactive', {
			create: function* () {
				now += 8;
				yield { completed: 1 };
			},
		});
		expect(readRows()).toEqual(['reactive:queued:0']);
		queue.start();
		frame();
		expect(readRows()).toEqual(['reactive:running:1']);
		job.pause();
		expect(readRows()).toEqual(['reactive:paused:1']);
		job.cancel();
		expect(readRows()).toEqual([]);
	});

	it('honors a pause during next without scheduling more frames', () => {
		const job = enqueue('pause-self', {
			create: function* () {
				job.pause();
				yield { message: 'Paused' };
			},
		});
		queue.start();
		frame();
		expect(job.status).toBe('paused');
		expect(job.progress.message).toBe('Paused');
		expect(frames.size).toBe(0);
		job.resume();
		frame();
		expect(job.status).toBe('completed');
	});

	it('bounds frames even when the clock does not advance', () => {
		const next = vi.fn();
		enqueue('fast', {
			create: function* () {
				while (true) {
					next();
					yield;
				}
			},
		});
		queue.start();
		frame();
		expect(next).toHaveBeenCalledTimes(1000);
		expect(frames.size).toBe(1);
	});
});
