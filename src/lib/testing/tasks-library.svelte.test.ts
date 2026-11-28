import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTaskService,
	WorkQueue,
	type AdvancedTaskService,
	type CooperativeTaskHandle,
} from '../../../packages-js/tasks';

class MockWorker extends EventTarget {
	postMessage = vi.fn();
	terminate = vi.fn();
	respond(data: unknown) {
		this.dispatchEvent(new MessageEvent('message', { data }));
	}
}

describe('tasks library', () => {
	let queue: WorkQueue;
	let owner: AbortController;
	let service: AdvancedTaskService;
	let frames: Map<number, FrameRequestCallback>;
	let now: number;
	let id: number;
	const onError = vi.fn();
	function frame() {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) {
			callback(now);
		}
	}
	function deferred<T>() {
		let resolve!: (value: T) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<T>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		return { promise, resolve, reject };
	}
	function workerOptions(worker = new MockWorker()) {
		return {
			key: 'work',
			label: 'Worker',
			input: [1],
			createWorker: () => worker as unknown as Worker,
		};
	}
	beforeEach(() => {
		queue = new WorkQueue();
		owner = new AbortController();
		frames = new Map();
		now = 0;
		id = 0;
		onError.mockReset();
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			id++;
			frames.set(id, callback);
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
		service = createTaskService({ queue, ownerId: 'plugin', signal: owner.signal, onError });
	});
	afterEach(() => {
		service.dispose();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('iterates lazily with bounded units, reactive progress, pause/resume, and automatic leases', async () => {
		const run = vi.fn((_item: number) => {
			now += 8;
		});
		const handle = service.forEach({ key: 'each', label: 'Each', items: [1, 2], run });
		const row = $derived(`${handle.status}:${handle.progress.completed ?? 0}`);
		const read = () => row;
		expect(read()).toBe('queued:0');
		expect(run).not.toHaveBeenCalled();
		frame();
		expect(read()).toBe('running:1');
		handle.pause();
		expect(read()).toBe('paused:1');
		expect(frames.size).toBe(0);
		handle.resume();
		frame();
		frame();
		expect(await handle.result).toEqual({ status: 'completed', value: undefined });
		expect(handle.progress).toEqual({ completed: 2, total: 2 });
		expect(run.mock.calls.map((call) => call[0])).toEqual([1, 2]);
		expect(queue.jobs).toEqual([]);
		expect(frames.size).toBe(0);
	});

	it('returns generator results and handles empty and non-array iterables', async () => {
		const advanced = service.cooperative({
			key: 'gen',
			label: 'Gen',
			create: function* () {
				yield { message: 'Scanning' };
				return 42;
			},
		});
		const each = service.forEach({ key: 'set', label: 'Set', items: new Set([1]), run: () => {} });
		const empty = service.forEach({
			key: 'empty',
			label: 'Empty',
			items: [],
			run: () => {
				throw new Error('unreachable');
			},
		});
		frame();
		expect(await advanced.result).toEqual({ status: 'completed', value: 42 });
		expect((await each.result).status).toBe('completed');
		expect((await empty.result).status).toBe('completed');
	});

	it('namespaces services and activations, replaces across modes, and leaves raw queue jobs alone', async () => {
		const other = createTaskService({ queue, ownerId: 'plugin', signal: owner.signal });
		const raw = queue.enqueue({
			key: 'same',
			label: 'Pagination',
			create: function* () {
				while (true) {
					now += 8;
					yield;
				}
			},
		});
		const first = service.cooperative({
			key: 'same',
			label: 'First',
			create: function* () {
				yield;
			},
		});
		const peer = other.cooperative({
			key: 'same',
			label: 'Peer',
			create: function* () {
				yield;
			},
		});
		const pending = deferred<number>();
		const replacement = service.async({ key: 'same', label: 'Async', run: () => pending.promise });
		expect(await first.result).toEqual({ status: 'cancelled' });
		service.dispose();
		expect(await replacement.result).toEqual({ status: 'cancelled' });
		expect(peer.status).toBe('queued');
		expect(raw.status).toBe('queued');
		other.dispose();
		raw.cancel();
	});

	it('links optional cancellation, skips pre-aborted tasks, removes listeners, and revokes all methods', async () => {
		const caller = new AbortController();
		const remove = vi.spyOn(caller.signal, 'removeEventListener');
		const run = vi.fn();
		caller.abort();
		const skipped = service.async({ key: 'skip', label: 'Skip', run, signal: caller.signal });
		expect(await skipped.result).toEqual({ status: 'cancelled' });
		expect(run).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalled();
		const liveCaller = new AbortController();
		const live = service.async({
			key: 'live',
			label: 'Live',
			signal: liveCaller.signal,
			run: () => new Promise(() => {}),
		});
		liveCaller.abort();
		expect(live.signal.aborted).toBe(true);
		const independent = service.async({
			key: 'independent',
			label: 'Independent',
			run: () => new Promise(() => {}),
		});
		expect(independent.signal.aborted).toBe(false);
		owner.abort();
		service.dispose();
		service.dispose();
		expect(await independent.result).toEqual({ status: 'cancelled' });
		expect(() => service.async({ key: '', label: '', run })).toThrow('disposed');
		expect(() => service.forEach({ key: '', label: '', items: [], run })).toThrow('disposed');
		expect(() => service.cooperative({ key: '', label: '', create: function* () {} })).toThrow(
			'disposed',
		);
		expect(() => service.worker(workerOptions())).toThrow('disposed');
		const revoked = createTaskService({ queue, ownerId: 'dead', signal: owner.signal });
		expect(() => revoked.async({ key: '', label: '', run })).toThrow('disposed');
	});

	it('observes synchronous async returns/throws and ignores late resolution/rejection', async () => {
		const error = new Error('sync');
		const good = service.async({ key: 'good', label: 'Good', run: () => 7 });
		const bad = service.async({
			key: 'bad',
			label: 'Bad',
			run: () => {
				throw error;
			},
		});
		expect(await good.result).toEqual({ status: 'completed', value: 7 });
		expect(await bad.result).toEqual({ status: 'failed', error });
		expect(onError).toHaveBeenCalledWith({ ownerId: 'plugin', key: 'bad', label: 'Bad', error });
		for (const reject of [false, true]) {
			const pending = deferred<number>();
			const late = service.async({ key: 'late', label: 'Late', run: () => pending.promise });
			late.cancel();
			if (reject) {
				pending.reject(error);
			} else {
				pending.resolve(99);
			}
			await Promise.resolve();
			expect(await late.result).toEqual({ status: 'cancelled' });
			expect(late.error).toBeUndefined();
		}
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it('defers generator cleanup on self-cancel, ignores progress, and isolates cleanup errors', async () => {
		const error = new Error('cleanup');
		const cleanup = vi.fn(() => {
			throw error;
		});
		const handle: CooperativeTaskHandle<void> = service.cooperative({
			key: 'self',
			label: 'Self',
			create: function* ({ signal }) {
				try {
					handle.cancel();
					expect(signal.aborted).toBe(true);
					expect(cleanup).not.toHaveBeenCalled();
					yield { completed: 99 };
				} finally {
					cleanup();
				}
			},
		});
		const healthy = service.forEach({
			key: 'healthy',
			label: 'Healthy',
			items: [1],
			run: () => {},
		});
		frame();
		frame();
		expect(await handle.result).toEqual({ status: 'cancelled' });
		expect(handle.progress).toEqual({});
		expect(handle.error).toBe(error);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(1);
		expect((await healthy.result).status).toBe('completed');
	});

	it('isolates factory/next failures and throwing error observers', async () => {
		onError.mockImplementation(() => {
			throw new Error('observer');
		});
		const error = new Error('factory');
		const factory = service.cooperative({
			key: 'factory',
			label: 'Factory',
			create: () => {
				throw error;
			},
		});
		const step = service.cooperative({
			key: 'step',
			label: 'Step',
			create: function* () {
				yield;
				throw error;
			},
		});
		const healthy = service.async({ key: 'good', label: 'Good', run: () => 1 });
		expect(() => frame()).not.toThrow();
		expect(await factory.result).toEqual({ status: 'failed', error });
		expect(await step.result).toEqual({ status: 'failed', error });
		expect((await healthy.result).status).toBe('completed');
		expect(frames.size).toBe(0);
	});

	it('retains work and iterator cleanup errors without leaking scheduler leases', async () => {
		const workError = new Error('next');
		const cleanupError = new Error('return');
		const close = vi.fn(() => {
			throw cleanupError;
		});
		const task = service.cooperative({
			key: 'both',
			label: 'Both',
			create: () =>
				({
					next() {
						throw workError;
					},
					return: close,
				}) as unknown as Generator<void, void, unknown>,
		});
		frame();
		expect(await task.result).toEqual({ status: 'failed', error: workError });
		expect(task.error).toBeInstanceOf(AggregateError);
		expect((task.error as AggregateError).errors).toEqual([workError, cleanupError]);
		expect(close).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(2);
		expect(queue.jobs).toEqual([]);
		expect(frames.size).toBe(0);
	});

	it('cancels queued iteration without consuming items and closes running iterables', async () => {
		const cleanup = vi.fn();
		function* items() {
			try {
				yield 1;
				yield 2;
			} finally {
				cleanup();
			}
		}
		const run = vi.fn(() => {
			now += 8;
		});
		const skipped = service.forEach({ key: 'skipped', label: 'Skipped', items: items(), run });
		skipped.cancel();
		frame();
		expect(run).not.toHaveBeenCalled();
		expect(cleanup).not.toHaveBeenCalled();
		const running = service.forEach({ key: 'running', label: 'Running', items: items(), run });
		frame();
		running.cancel();
		running.cancel();
		expect((await running.result).status).toBe('cancelled');
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(frames.size).toBe(0);
	});

	it('ignores an async callback return after it replaces itself', async () => {
		const first = service.async({
			key: 'self',
			label: 'First',
			run: () => {
				service.async({ key: 'self', label: 'Second', run: () => 2 });
				return 1;
			},
		});
		expect(await first.result).toEqual({ status: 'cancelled' });
		await Promise.resolve();
		expect(first.error).toBeUndefined();
		expect(onError).not.toHaveBeenCalled();
	});

	it('keeps raw shared work leased until the last managed cooperative task ends', () => {
		const raw = queue.enqueue({
			key: 'raw',
			label: 'Raw',
			create: function* () {
				while (true) {
					now += 8;
					yield;
				}
			},
		});
		const first = service.cooperative({
			key: 'one',
			label: 'One',
			create: function* () {
				yield;
			},
		});
		const second = service.cooperative({
			key: 'two',
			label: 'Two',
			create: function* () {
				yield;
			},
		});
		first.cancel();
		expect(frames.size).toBe(1);
		second.cancel();
		expect(frames.size).toBe(0);
		expect(raw.status).toBe('queued');
		const release = queue.start();
		frame();
		expect(raw.status).toBe('running');
		release();
		raw.cancel();
	});

	it('lets cleanup-created replacements supersede the operation that triggered cleanup', async () => {
		let newest: ReturnType<AdvancedTaskService['async']> | undefined;
		const original = service.cooperative({
			key: 'same',
			label: 'Old',
			create: function* () {
				try {
					now += 8;
					yield;
				} finally {
					newest = service.async({ key: 'same', label: 'Newest', run: () => 3 });
				}
			},
		});
		frame();
		const run = vi.fn(() => 2);
		const middle = service.async({ key: 'same', label: 'Middle', run });
		expect((await original.result).status).toBe('cancelled');
		expect((await middle.result).status).toBe('cancelled');
		expect(run).not.toHaveBeenCalled();
		expect(await newest?.result).toEqual({ status: 'completed', value: 3 });
	});

	it('cleans up a factory that cancels during creation without advancing its iterator', async () => {
		const next = vi.fn();
		const close = vi.fn(() => ({ done: true, value: undefined }));
		const task = service.cooperative({
			key: 'factory',
			label: 'Factory',
			create: () => {
				owner.abort();
				return { next, return: close } as unknown as Generator<void, void, unknown>;
			},
		});
		frame();
		expect((await task.result).status).toBe('cancelled');
		expect(next).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])(
		'settles managed tasks cancelled through the queue (started: %s)',
		async (started) => {
			const close = vi.fn();
			const task = service.cooperative({
				key: 'queue-cancel',
				label: 'Queue cancellation',
				create: function* () {
					try {
						now += 8;
						yield;
					} finally {
						close();
					}
				},
			});
			if (started) {
				frame();
			}
			queue.jobs[0].cancel();
			expect(task.status).toBe('cancelled');
			expect(task.signal.aborted).toBe(true);
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(close).toHaveBeenCalledTimes(started ? 1 : 0);
			queue.enqueue({
				key: 'raw',
				label: 'Raw',
				create: function* () {
					yield;
				},
			});
			expect(frames.size).toBe(0);
		},
	);

	it('reflects pause and resume through the shared queue on managed handles', async () => {
		const task = service.forEach({ key: 'pause', label: 'Pause', items: [1], run: () => {} });
		const row = $derived(task.status);
		const read = () => row;
		const work = queue.jobs[0];
		work.pause();
		expect(read()).toBe('paused');
		expect(frames.size).toBe(0);
		work.resume();
		expect(read()).toBe('queued');
		frame();
		expect(await task.result).toEqual({ status: 'completed', value: undefined });
		expect(read()).toBe('completed');
	});

	it.each(['cancel', 'replace', 'dispose'])(
		'does not complete after %s inside worker apply',
		async (action) => {
			const worker = new MockWorker();
			const apply = vi.fn(() => {
				if (action === 'cancel') {
					task.cancel();
				} else if (action === 'replace') {
					service.async({ key: 'work', label: 'New', run: () => 2 });
				} else {
					service.dispose();
				}
			});
			const task = service.worker({ ...workerOptions(worker), apply });
			worker.respond({ type: 'tasks:result', value: 1 });
			worker.respond({ type: 'tasks:result', value: 3 });
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(apply).toHaveBeenCalledTimes(1);
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		},
	);

	it('claims the worker response before calling reentrant apply', async () => {
		const worker = new MockWorker();
		const apply = vi.fn(() => {
			if (apply.mock.calls.length === 1) {
				worker.respond({ type: 'tasks:result', value: 2 });
			}
		});
		const task = service.worker({ ...workerOptions(worker), apply });
		worker.respond({ type: 'tasks:result', value: 1 });
		expect(apply).toHaveBeenCalledTimes(1);
		expect(await task.result).toEqual({ status: 'completed', value: 1 });
	});

	it.each([
		{ type: 'tasks:result' },
		{ type: 'tasks:error', error: {} },
		{ type: 'tasks:error', error: { name: 1, message: 'bad' } },
		{ type: 'tasks:error', error: { name: 'Error', message: 'bad', stack: 1 } },
	])('rejects malformed worker envelopes: %j', async (data) => {
		const worker = new MockWorker();
		const apply = vi.fn();
		const task = service.worker({ ...workerOptions(worker), apply });
		worker.respond(data);
		expect(await task.result).toMatchObject({
			status: 'failed',
			error: { message: 'Invalid task worker response' },
		});
		expect(apply).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('attempts every worker cleanup operation even when listener removal throws', async () => {
		const worker = new MockWorker();
		const failure = new Error('remove');
		const remove = vi.spyOn(worker, 'removeEventListener').mockImplementationOnce(() => {
			throw failure;
		});
		const task = service.worker(workerOptions(worker));
		expect(() => task.cancel()).not.toThrow();
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(remove).toHaveBeenCalledTimes(3);
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(task.error).toBe(failure);
	});

	it('retains all cleanup failures without preventing other tasks from being disposed', async () => {
		const worker = new MockWorker();
		const removeError = new Error('remove');
		const terminateError = new Error('terminate');
		vi.spyOn(worker, 'removeEventListener').mockImplementation(() => {
			throw removeError;
		});
		worker.terminate.mockImplementation(() => {
			throw terminateError;
		});
		onError.mockImplementation(() => {
			throw new Error('observer');
		});
		const task = service.worker(workerOptions(worker));
		const other = service.async({ key: 'other', label: 'Other', run: () => new Promise(() => {}) });
		expect(() => service.dispose()).not.toThrow();
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(await other.result).toEqual({ status: 'cancelled' });
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(task.error).toBeInstanceOf(AggregateError);
		expect(onError.mock.calls.map(([failure]) => failure.error)).toEqual([
			removeError,
			removeError,
			removeError,
			terminateError,
		]);
	});

	it('attributes cleanup errors for workers cancelled inside their factory', async () => {
		const worker = new MockWorker();
		const failure = new Error('terminate');
		worker.terminate.mockImplementation(() => {
			throw failure;
		});
		const task = service.worker({
			...workerOptions(worker),
			createWorker: () => {
				owner.abort();
				return worker as unknown as Worker;
			},
		});
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(task.error).toBe(failure);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
	});

	it('posts worker input/transfers, applies one result, detaches listeners and terminates', async () => {
		const worker = new MockWorker();
		const remove = vi.spyOn(worker, 'removeEventListener');
		const apply = vi.fn();
		const buffer = new ArrayBuffer(4);
		const task = service.worker<number[], number>({
			...workerOptions(worker),
			transfer: [buffer],
			apply,
		});
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'tasks:run', input: [1] }, [buffer]);
		worker.respond({ type: 'tasks:result', value: 12 });
		worker.respond({ type: 'tasks:result', value: 13 });
		expect(await task.result).toEqual({ status: 'completed', value: 12 });
		expect(apply).toHaveBeenCalledTimes(1);
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledTimes(3);
	});

	it('ignores already-queued worker callbacks after replacement and cancellation', async () => {
		const worker = new MockWorker();
		const add = vi.spyOn(worker, 'addEventListener');
		const apply = vi.fn();
		const task = service.worker({ ...workerOptions(worker), apply });
		const listener = add.mock.calls.find(([type]) => type === 'message')?.[1] as EventListener;
		service.async({ key: 'work', label: 'Replacement', run: () => 1 });
		listener(new MessageEvent('message', { data: { type: 'tasks:result', value: 9 } }));
		expect((await task.result).status).toBe('cancelled');
		expect(apply).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it.each(['factory', 'post', 'remote', 'error', 'messageerror', 'malformed', 'apply'])(
		'attributes worker %s failures and cleans up',
		async (kind) => {
			const worker = new MockWorker();
			const failure = new Error(kind);
			if (kind === 'post') {
				worker.postMessage.mockImplementation(() => {
					throw failure;
				});
			}
			const task = service.worker({
				...workerOptions(worker),
				createWorker: () => {
					if (kind === 'factory') {
						throw failure;
					}
					return worker as unknown as Worker;
				},
				apply: () => {
					if (kind === 'apply') {
						throw failure;
					}
				},
			});
			if (kind === 'remote') {
				worker.respond({ type: 'tasks:error', error: { name: 'TypeError', message: 'remote' } });
			}
			if (kind === 'error') {
				worker.dispatchEvent(new ErrorEvent('error', { error: failure, message: kind }));
			}
			if (kind === 'messageerror') {
				worker.dispatchEvent(new MessageEvent('messageerror'));
			}
			if (kind === 'malformed') {
				worker.respond(null);
			}
			if (kind === 'apply') {
				worker.respond({ type: 'tasks:result', value: 1 });
			}
			expect((await task.result).status).toBe('failed');
			expect(task.error).toBeInstanceOf(Error);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ ownerId: 'plugin', key: 'work', label: 'Worker' }),
			);
			expect(worker.terminate).toHaveBeenCalledTimes(kind === 'factory' ? 0 : 1);
		},
	);

	it('terminates workers cancelled inside their factory and skips apply after owner revocation', async () => {
		const worker = new MockWorker();
		const task = service.worker({
			...workerOptions(worker),
			createWorker: () => {
				owner.abort();
				return worker as unknown as Worker;
			},
		});
		expect((await task.result).status).toBe('cancelled');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(worker.postMessage).not.toHaveBeenCalled();
	});
});
