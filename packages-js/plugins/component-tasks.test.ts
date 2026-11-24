import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkQueue, type TaskHandle } from '@writers-ide/tasks';
import { createHost, deferred, descriptor, flush, provider } from './command-component-fixture';
import type { CommandContext } from './command-component-model';
import {
	activate,
	fakeWorker,
	frames,
	moduleWorkers,
	workerModule,
} from './component-tasks-fixture';

describe('activation-owned component tasks', () => {
	let frame: () => void;
	beforeEach(() => {
		frame = frames();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('starts async work during setup without delaying synchronous activation', async () => {
		const host = createHost();
		const pending = deferred();
		const run = vi.fn(() => pending.promise);
		let task!: TaskHandle<unknown>;
		host.register(
			descriptor('one', (context) => {
				task = context.tasks.async({ key: 'fetch', label: 'Fetch', run });
				expect(run).toHaveBeenCalledOnce();
				expect(task.status).toBe('running');
			}),
		);
		expect(host.activate('one').status).toBe('active');
		pending.resolve(42);
		expect(await task.result).toEqual({ status: 'completed', value: 42 });
		host.dispose();
	});

	it('shares a supplied queue with peer work while isolating activation keys and cancellation', async () => {
		const workQueue = new WorkQueue();
		const host = createHost({ workQueue });
		const one = activate(host);
		const two = activate(host, 'two');
		const run = vi.fn();
		const first = one.tasks.forEach({ key: 'scan', label: 'One', items: [1], run });
		const second = two.tasks.cooperative({
			key: 'scan',
			label: 'Two',
			create: function* () {
				yield;
				return 2;
			},
		});
		const peer = vi.fn();
		// A non-task queue owner must keep its own scheduling lease.
		const releasePeer = workQueue.start();
		const peerJob = workQueue.enqueue({
			key: 'pagination',
			label: 'Peer',
			create: function* () {
				peer();
				yield;
			},
		});
		expect(workQueue.jobs).toHaveLength(3);
		expect(new Set(workQueue.jobs.map((job) => job.key)).size).toBe(3);
		host.deactivate('one');
		expect(await first.result).toEqual({ status: 'cancelled' });
		frame();
		expect(await second.result).toEqual({ status: 'completed', value: 2 });
		expect(run).not.toHaveBeenCalled();
		expect(peer).toHaveBeenCalledOnce();
		expect(peerJob.status).toBe('completed');
		expect(workQueue.jobs).toHaveLength(0);
		releasePeer();
		host.dispose();
	});

	it('creates one private queue per standalone host, shared by its activations', async () => {
		const enqueue = vi.spyOn(WorkQueue.prototype, 'enqueue');
		const first = createHost();
		const second = createHost();
		const contexts = [activate(first), activate(first, 'two'), activate(second)];
		const tasks = contexts.map((context) =>
			context.tasks.forEach({
				key: 'scan',
				label: 'Scan',
				items: [1, 2],
				run: () => undefined,
			}),
		);
		expect(enqueue.mock.contexts[0]).toBe(enqueue.mock.contexts[1]);
		expect(enqueue.mock.contexts[0]).not.toBe(enqueue.mock.contexts[2]);
		first.dispose();
		frame();
		expect(await tasks[0].result).toEqual({ status: 'cancelled' });
		expect(await tasks[1].result).toEqual({ status: 'cancelled' });
		expect(await tasks[2].result).toEqual({ status: 'completed', value: undefined });
		second.dispose();
	});

	it('preserves cooperative pause/resume and same-key replacement across task modes', async () => {
		const host = createHost();
		const context = activate(host);
		const run = vi.fn();
		const task = context.tasks.forEach({ key: 'scan', label: 'Scan', items: [1, 2], run });
		task.pause();
		frame();
		expect(run).not.toHaveBeenCalled();
		task.resume();
		frame();
		expect(await task.result).toEqual({ status: 'completed', value: undefined });
		expect(run).toHaveBeenCalledTimes(2);
		const old = context.tasks.cooperative({
			key: 'scan',
			label: 'Old',
			create: function* () {
				yield;
			},
		});
		const replacement = context.tasks.async({ key: 'scan', label: 'New', run: () => 7 });
		expect(await old.result).toEqual({ status: 'cancelled' });
		expect(await replacement.result).toEqual({ status: 'completed', value: 7 });
		host.dispose();
	});

	it.each(['throw', 'publication'])(
		'rolls back queued tasks on %s failure before author cleanup',
		async (failure) => {
			const workQueue = new WorkQueue();
			const host = createHost({ workQueue });
			const run = vi.fn();
			let context!: CommandContext;
			let task!: TaskHandle<void>;
			host.register(
				provider((value) => {
					context = value;
					task = value.tasks.forEach({ key: 'scan', label: 'Scan', items: [1], run });
					value.own(() => {
						expect(task.signal.aborted).toBe(true);
						expect(() => value.tasks.async({ key: 'late', label: 'Late', run })).toThrow(
							'disposed',
						);
					});
					if (failure === 'throw') {
						throw new Error('Setup failed');
					}
				}),
			);
			expect(() => host.activate('provider')).toThrow();
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(workQueue.jobs).toHaveLength(0);
			frame();
			expect(run).not.toHaveBeenCalled();
			expect(context.signal.aborted).toBe(true);
			expect(host.get('provider')!.errors).not.toContain('cleanup-failed');
			host.dispose();
		},
	);

	it('reports only safe task-failed codes without disabling the originating component', async () => {
		const host = createHost();
		const one = activate(host);
		activate(host, 'two');
		const error = {
			privatePayload: 'manuscript',
			toString: () => {
				throw new Error('Do not inspect');
			},
		};
		const task = one.tasks.async({
			key: 'secret-key',
			label: 'Secret label',
			run: () => {
				throw error;
			},
		});
		expect(await task.result).toEqual({ status: 'failed', error });
		expect(host.get('one')).toMatchObject({ status: 'active', errors: ['task-failed'] });
		expect(host.get('two')!.errors).toEqual([]);
		expect(JSON.stringify(host.list())).not.toMatch(/manuscript|secret-key|Secret label/);
		host.dispose();
	});

	it.each(['resolve', 'reject'] as const)(
		'ignores late async %s and revokes all old submission methods after reactivation',
		async (settle) => {
			const host = createHost();
			const pending = deferred();
			let context!: CommandContext;
			host.register(
				descriptor('one', (value) => {
					context = value;
				}),
			);
			host.activate('one');
			const old = context;
			const task = old.tasks.async({ key: 'scan', label: 'Old', run: () => pending.promise });
			host.deactivate('one');
			host.activate('one');
			expect(context.identity.activationId).not.toBe(old.identity.activationId);
			const fresh = context.tasks.async({ key: 'scan', label: 'Fresh', run: () => 9 });
			const run = vi.fn();
			expect(() => old.tasks.async({ key: 'x', label: 'X', run })).toThrow('disposed');
			expect(() => old.tasks.forEach({ key: 'x', label: 'X', items: [1], run })).toThrow(
				'disposed',
			);
			expect(() =>
				old.tasks.cooperative({
					key: 'x',
					label: 'X',
					create: function* () {
						run();
						yield;
					},
				}),
			).toThrow('disposed');
			expect(() =>
				old.tasks.worker({ key: 'x', label: 'X', input: null, module: workerModule }),
			).toThrow('disposed');
			pending[settle](new Error('Late private outcome'));
			await flush();
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(await fresh.result).toEqual({ status: 'completed', value: 9 });
			expect(host.get('one')!.errors).toEqual([]);
			expect(run).not.toHaveBeenCalled();
			host.dispose();
		},
	);

	it('terminates workers and suppresses apply after disposal', async () => {
		const { fake, workerModules } = moduleWorkers();
		const host = createHost({ workerModules });
		const context = activate(host);
		const apply = vi.fn();
		const task = context.tasks.worker({
			key: 'worker',
			label: 'Worker',
			input: null,
			module: workerModule,
			apply,
		});
		await flush();
		host.dispose();
		fake.result(42);
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(fake.terminate).toHaveBeenCalledOnce();
		expect(apply).not.toHaveBeenCalled();
	});

	it.each(['create', 'apply'])('preserves cancellation during worker %s', async (stage) => {
		const fake = fakeWorker();
		const { workerModules } = moduleWorkers(fake, () => {
			if (stage === 'create') {
				host.deactivate('one');
			}
		});
		const host = createHost({ workerModules });
		const context = activate(host);
		const task = context.tasks.worker({
			key: 'worker',
			label: 'Worker',
			input: null,
			module: workerModule,
			apply: () => {
				host.deactivate('one');
			},
		});
		await flush();
		if (stage === 'apply') {
			fake.result(42);
		}
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(fake.terminate).toHaveBeenCalledOnce();
		expect(host.get('one')!.errors).toEqual([]);
		host.dispose();
	});

	it('revokes the complete stop batch before sequential abort callbacks can submit or apply', async () => {
		const { fake, workerModules } = moduleWorkers();
		const host = createHost({ workerModules });
		const one = activate(host);
		const two = activate(host, 'two');
		const apply = vi.fn();
		const task = two.tasks.worker({
			key: 'worker',
			label: 'Worker',
			input: null,
			module: workerModule,
			apply,
		});
		await flush();
		const run = vi.fn();
		let checked = false;
		one.signal.addEventListener('abort', () => {
			// Both phases are stopped, but the second activation's signal is not yet aborted.
			expect(two.signal.aborted).toBe(false);
			expect(() => two.tasks.async({ key: 'late', label: 'Late', run })).toThrow('disposed');
			fake.result(42);
			checked = true;
		});
		host.dispose();
		expect(checked).toBe(true);
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(apply).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(fake.terminate).toHaveBeenCalledOnce();
	});
});
