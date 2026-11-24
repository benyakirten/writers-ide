import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskHandle, WorkerTaskOptions } from '@writers-ide/tasks';
import type { ActivationIdentity } from './frontend';
import type { CommandContext } from './command-component-model';
import type { WorkerModuleSource } from './command-component-host';
import { createHost, descriptor, flush } from './command-component-fixture';
import { activate, frames, moduleWorkers, workerModule } from './component-tasks-fixture';

const request = (module = workerModule) => ({
	key: 'worker',
	label: 'Worker',
	input: null,
	module,
});

function pendingBytes() {
	let resolve!: (bytes: Uint8Array) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Uint8Array>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

describe('internal activation-bound worker modules', () => {
	beforeEach(() => frames());
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it.each([
		'https://external.test/worker.js',
		'file:///worker.js',
		'filesystem:https://packages.test/worker.js',
		'data:text/javascript,1',
		'blob:https://packages.test/id',
		'https://packages.test/snapshots/other/worker.js',
		'https://packages.test/snapshots/one/unknown.js',
		'https://packages.test/snapshots/one/../worker.js',
		'https://packages.test/snapshots/one/%2e%2e/worker.js',
		'https://packages.test/snapshots/one/nested%2fworker.js',
		'https://packages.test/snapshots/one/nested%5cworker.js',
		'https://packages.test/snapshots/one/%77orker.js',
		'https://packages.test/snapshots/one/worker.js?x',
		'https://packages.test/snapshots/one/worker.js?',
		'https://packages.test/snapshots/one/worker.js#x',
		'https://packages.test/snapshots/one/worker.js#',
		'https://user:pass@packages.test/snapshots/one/worker.js',
	])('rejects unowned URL %s before reading any bytes', async (url) => {
		const { source } = moduleWorkers();
		const read = vi.spyOn(source, 'read');
		const host = createHost({ workerModules: () => source });
		const task = activate(host).tasks.worker(request(new URL(url)));
		expect(await task.result).toMatchObject({
			status: 'failed',
			error: { message: 'Task worker module is not owned by this activation' },
		});
		expect(read).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
		expect(host.get('one')!.errors).toEqual(['task-failed']);
		host.dispose();
	});

	it.each([undefined, () => null])(
		'fails closed without a configured source',
		async (workerModules) => {
			moduleWorkers();
			const host = createHost({ workerModules });
			const task = activate(host).tasks.worker(request());
			expect(await task.result).toMatchObject({
				status: 'failed',
				error: { message: 'Task worker module source is not configured' },
			});
			expect(Worker).not.toHaveBeenCalled();
			host.dispose();
		},
	);

	it('captures source metadata once and accepts copied canonical URLs without retaining caller URL mutation', async () => {
		const { fake, source } = moduleWorkers();
		const files = ['worker.js', 'nested/é space#%.js', "nested/worker!'().js"];
		source.files = files;
		const read = vi.spyOn(source, 'read');
		const workerModules = vi.fn(() => source);
		const host = createHost({ workerModules });
		const context = activate(host);
		expect(workerModules).toHaveBeenCalledExactlyOnceWith(context.identity);
		expect(Object.isFrozen(context.identity)).toBe(true);
		source.base.pathname = '/snapshots/other/';
		files.splice(0, files.length, 'foreign.js');
		source.read = vi.fn(() => {
			throw new Error('Replaced callback');
		});
		const selected = new URL(workerModule.href);
		const task = context.tasks.worker(request(selected));
		selected.pathname = '/snapshots/other/foreign.js';
		await flush();
		expect(read).toHaveBeenCalledExactlyOnceWith('worker.js', task.signal);
		fake.result(7);
		expect(await task.result).toEqual({ status: 'completed', value: 7 });
		const named = context.tasks.worker(
			request(new URL('nested/%C3%A9%20space%23%25.js', workerModule)),
		);
		await flush();
		expect(read).toHaveBeenLastCalledWith('nested/é space#%.js', named.signal);
		fake.result(8);
		expect(await named.result).toEqual({ status: 'completed', value: 8 });
		const punctuation = context.tasks.worker(
			request(new URL('nested/worker%21%27%28%29.js', workerModule)),
		);
		await flush();
		expect(read).toHaveBeenLastCalledWith("nested/worker!'().js", punctuation.signal);
		fake.result(9);
		expect(await punctuation.result).toEqual({ status: 'completed', value: 9 });
		expect(workerModules).toHaveBeenCalledOnce();
		host.dispose();
	});

	it('supports host-controlled custom resource schemes', async () => {
		const { source, fake } = moduleWorkers();
		source.base = new URL('package-resource://verified/snapshots/one/');
		const host = createHost({ workerModules: () => source });
		const task = activate(host).tasks.worker(request(new URL('worker.js', source.base)));
		await flush();
		fake.result(1);
		expect(await task.result).toEqual({ status: 'completed', value: 1 });
		host.dispose();
	});

	it.each([
		'../worker.js',
		'/worker.js',
		'a//b.js',
		'./worker.js',
		'a/../worker.js',
		'a\\b.js',
		'C:/worker.js',
		'a\u0000.js',
		'a?.js',
		'a:worker.js',
		'a.',
		'CON.js',
	])('rejects invalid source path %s during setup', (path) => {
		const { source } = moduleWorkers();
		source.files = [path];
		const host = createHost({ workerModules: () => source });
		host.register(descriptor('one'));
		expect(() => host.activate('one')).toThrow('Invalid worker module source file path');
		expect(host.get('one')!.status).toBe('failed');
		host.dispose();
	});

	it.each([
		'file:///snapshots/one/',
		'data:text/plain,base/',
		'blob:https://host/id/',
		'https://u:p@host/base/',
		'https://host/base/?x',
		'https://host/base/#x',
		'https://host/base/?',
		'https://host/base/#',
		'https://host/base',
		'https://host/a%2fb/',
	])('rejects invalid source base %s', (base) => {
		const { source } = moduleWorkers();
		source.base = new URL(base);
		const host = createHost({ workerModules: () => source });
		host.register(descriptor('one'));
		expect(() => host.activate('one')).toThrow('Invalid worker module source base URL');
		host.dispose();
	});

	it('does not interpret percent-encoded filenames as decoded paths', async () => {
		const { source } = moduleWorkers();
		source.files = ['%2f.js'];
		const read = vi.spyOn(source, 'read');
		const host = createHost({ workerModules: () => source });
		const context = activate(host);
		const bad = context.tasks.worker(request(new URL('%2f.js', workerModule)));
		expect(await bad.result).toMatchObject({ status: 'failed' });
		expect(read).not.toHaveBeenCalled();
		const exact = context.tasks.worker(request(new URL('%252f.js', workerModule)));
		await flush();
		expect(read).toHaveBeenCalledWith('%2f.js', exact.signal);
		host.dispose();
	});

	it.each([false, true])(
		'rejects cast factory options (module also present: %s) without invoking getters',
		(both) => {
			const { workerModules } = moduleWorkers();
			const host = createHost({ workerModules });
			const context = activate(host);
			const factory = vi.fn();
			const options = {
				key: 'worker',
				label: 'Worker',
				input: null,
				...(both ? { module: workerModule } : {}),
				get createWorker() {
					factory();
					return factory;
				},
			} as unknown as WorkerTaskOptions<null, unknown>;
			expect(() => context.tasks.worker(options)).toThrow('createWorker is not supported');
			expect(factory).not.toHaveBeenCalled();
			expect(Worker).not.toHaveBeenCalled();
			host.dispose();
		},
	);

	it('guards source setup, metadata getters, reads and custom thenables against lifecycle reentry', async () => {
		const { source } = moduleWorkers();

		const reenter = vi.fn(() => expect(() => host.deactivate('one')).toThrow('busy'));
		const guarded: WorkerModuleSource = {
			get base() {
				reenter();
				return source.base;
			},
			get files() {
				reenter();
				return source.files;
			},
			get read() {
				reenter();
				return () => {
					reenter();
					return {
						get then() {
							reenter();
							return (resolve: (bytes: Uint8Array) => unknown) => {
								reenter();
								resolve(new Uint8Array([1]));
							};
						},
					} as PromiseLike<Uint8Array>;
				};
			},
		};
		const host: ReturnType<typeof createHost> = createHost({
			workerModules: () => {
				reenter();
				return guarded;
			},
		});
		const task = activate(host).tasks.worker(request());
		await flush();
		expect(reenter).toHaveBeenCalledTimes(7);
		expect(task.status).toBe('running');
		host.dispose();
		expect(await task.result).toEqual({ status: 'cancelled' });
	});

	it('guards delayed thenable settlement, nested then getters and byte inspection', async () => {
		const { source, fake } = moduleWorkers();
		let settle!: (value: unknown) => void;
		source.read = () =>
			({
				then(resolve: (value: unknown) => void) {
					settle = resolve;
				},
			}) as PromiseLike<Uint8Array>;
		const host = createHost({ workerModules: () => source });
		const context = activate(host);
		const task = context.tasks.worker(request());
		const reenter = vi.fn(() => expect(() => host.deactivate('one')).toThrow('busy'));
		const bytes = new Proxy(new Uint8Array([1, 2]), {
			get(target, key) {
				reenter();
				const value = Reflect.get(target, key, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const nested = {
			get then() {
				reenter();
				return (resolve: (value: unknown) => void) => {
					reenter();
					resolve(bytes);
				};
			},
		};
		await flush();
		settle(nested);
		await flush();
		expect(reenter.mock.calls.length).toBeGreaterThanOrEqual(4);
		expect(host.get('one')).toMatchObject({ status: 'active', errors: [] });
		expect(task.status).toBe('running');
		fake.result(3);
		expect(await task.result).toEqual({ status: 'completed', value: 3 });
		host.dispose();
	});

	it('does not expose resolved adapter bytes to later native Promise assimilation', async () => {
		const { source, fake } = moduleWorkers();
		let settle!: (value: unknown) => void;
		source.read = () =>
			({
				then(resolve: (value: unknown) => void) {
					settle = resolve;
				},
			}) as PromiseLike<Uint8Array>;
		const host = createHost({ workerModules: () => source });
		const task = activate(host).tasks.worker(request());
		const then = vi.fn(() => {
			expect(() => host.deactivate('one')).toThrow('busy');
			return undefined;
		});
		const bytes = Object.defineProperty(new Uint8Array([1]), 'then', { get: then });
		settle(bytes);
		await flush();
		expect(then).toHaveBeenCalledOnce();
		expect(task.status).toBe('running');
		fake.result(1);
		expect(await task.result).toEqual({ status: 'completed', value: 1 });
		host.dispose();
	});

	it.each(['getter', 'reject', 'throw', 'native-reject'] as const)(
		'observes delayed nested %s errors without unhandled native Promise failures',
		async (stage) => {
			const { source } = moduleWorkers();
			let settle!: (value: unknown) => void;
			source.read = () =>
				({
					then(resolve: (value: unknown) => void) {
						settle = resolve;
					},
				}) as PromiseLike<Uint8Array>;
			const host = createHost({ workerModules: () => source });
			const task = activate(host).tasks.worker(request());
			const error = new Error('Read failed');
			const nested =
				stage === 'native-reject'
					? Promise.reject(error)
					: {
							get then() {
								expect(() => host.deactivate('one')).toThrow('busy');
								if (stage === 'getter') {
									throw error;
								}
								return (_resolve: unknown, reject: (error: unknown) => void) => {
									expect(() => host.deactivate('one')).toThrow('busy');
									if (stage === 'throw') {
										throw error;
									}
									reject(error);
								};
							},
						};
			settle(nested);
			expect(await task.result).toEqual({ status: 'failed', error });
			expect(host.get('one')!.errors).toEqual(['task-failed']);
			expect(Worker).not.toHaveBeenCalled();
			host.dispose();
		},
	);

	it.each([false, true])('rejects thenable resolution cycles (delayed: %s)', async (delayed) => {
		const { source } = moduleWorkers();
		let settle!: (value: unknown) => void;
		const cyclic = {
			then(resolve: (value: unknown) => void) {
				if (delayed) {
					settle = resolve;
				} else {
					resolve(cyclic);
				}
			},
		};
		source.read = () => cyclic as PromiseLike<Uint8Array>;
		const host = createHost({ workerModules: () => source });
		const task = activate(host).tasks.worker(request());
		if (delayed) {
			settle({
				then(resolve: (value: unknown) => void) {
					resolve(cyclic);
				},
			});
		}
		expect(await task.result).toMatchObject({
			status: 'failed',
			error: { message: 'Task worker module thenable resolution cycle' },
		});
		expect(Worker).not.toHaveBeenCalled();
		host.dispose();
	});

	it('keeps the first thenable settlement and observes native callback completion', async () => {
		const { source, fake } = moduleWorkers();
		source.read = () =>
			({
				then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
					resolve(Promise.resolve(new Uint8Array([1])));
					reject(new Error('Ignored rejection'));
					resolve(new Uint8Array([2]));
					throw new Error('Ignored throw');
				},
			}) as PromiseLike<Uint8Array>;
		const host = createHost({ workerModules: () => source });
		const task = activate(host).tasks.worker(request());
		await flush();
		fake.result(1);
		expect(await task.result).toEqual({ status: 'completed', value: 1 });
		expect(host.get('one')!.errors).toEqual([]);
		host.dispose();
	});

	it.each(['resolve', 'reject'] as const)(
		'ignores late read %s after disable and re-enable',
		async (settle) => {
			const { source } = moduleWorkers();
			const pending = pendingBytes();
			source.read = () => pending.promise;
			const workerModules = vi.fn(() => source);
			const host = createHost({ workerModules });
			let context!: CommandContext;
			host.register(
				descriptor('one', (value) => {
					context = value;
				}),
			);
			host.activate('one');
			const old = context;
			const task = old.tasks.worker(request());
			host.deactivate('one');
			host.activate('one');
			if (settle === 'resolve') {
				pending.resolve(new Uint8Array([1]));
			} else {
				pending.reject(new Error('Private stale error'));
			}
			await flush();
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(Worker).not.toHaveBeenCalled();
			expect(host.get('one')!.errors).toEqual([]);
			expect(context.identity.activationId).not.toBe(old.identity.activationId);
			expect(workerModules).toHaveBeenCalledTimes(2);
			host.dispose();
		},
	);

	it('skips reads for early cancellation and cancels pending reads on setup rollback', async () => {
		const { source } = moduleWorkers();
		const pending = pendingBytes();
		const read = vi.fn((_path: string, _signal: AbortSignal) => pending.promise);
		source.read = read;
		const host = createHost({ workerModules: () => source });
		let task!: TaskHandle<unknown>;
		host.register(
			descriptor('one', (context) => {
				const controller = new AbortController();
				controller.abort();
				const early = context.tasks.worker({ ...request(), signal: controller.signal });
				expect(early.status).toBe('cancelled');
				expect(read).not.toHaveBeenCalled();
				task = context.tasks.worker(request());
				throw new Error('Rollback');
			}),
		);
		expect(() => host.activate('one')).toThrow('Rollback');
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(read.mock.calls[0][1].aborted).toBe(true);
		pending.resolve(new Uint8Array([1]));
		await flush();
		expect(Worker).not.toHaveBeenCalled();
		expect(host.get('one')!.errors).toEqual([
			'activation-failed',
			'activation-or-dependency-failed',
		]);
		host.dispose();
	});

	it('binds sources to component and project-opening identity, not the selected project', async () => {
		const { source } = moduleWorkers();
		const reads = new Map<string, ReturnType<typeof vi.fn>>();
		const identities: ActivationIdentity[] = [];
		const host = createHost({
			workerModules: (identity) => {
				identities.push(identity);
				const read = vi.fn(() => new Uint8Array([1]));
				reads.set(identity.componentId, read);
				return {
					...source,
					base: new URL(`https://packages.test/snapshots/${identity.projectOpeningId}/`),
					read,
				};
			},
		});
		const first = host.openProject('first', 'First');
		const second = host.openProject('second', 'Second');
		const contexts: CommandContext[] = [];
		for (const [slot, opening] of [
			['one', first],
			['two', second],
		] as const) {
			host.register(
				descriptor(
					slot,
					(context) => {
						contexts.push(context);
					},
					{
						identity: {
							packageId: 'same-package',
							componentId: slot,
							projectOpeningId: opening.openingId,
						},
					},
				),
			);
			host.activate(slot);
		}
		host.selectProject(second);
		const foreign = contexts[0].tasks.worker(
			request(new URL(`https://packages.test/snapshots/${second.openingId}/worker.js`)),
		);
		expect(await foreign.result).toMatchObject({ status: 'failed' });
		expect(reads.get('one')).not.toHaveBeenCalled();
		expect(reads.get('two')).not.toHaveBeenCalled();
		const owned = contexts[0].tasks.worker(
			request(new URL(`https://packages.test/snapshots/${first.openingId}/worker.js`)),
		);
		await flush();
		expect(reads.get('one')).toHaveBeenCalledExactlyOnceWith('worker.js', owned.signal);
		expect(reads.get('two')).not.toHaveBeenCalled();
		expect(identities.map((identity) => identity.projectOpeningId)).toEqual([
			first.openingId,
			second.openingId,
		]);
		host.closeProject(first);
		const reopened = host.openProject('first', 'First reopened');
		expect(reopened.openingId).not.toBe(first.openingId);
		expect(() => host.activate('one')).toThrow('opening is unknown or closed');
		expect(() => contexts[0].tasks.worker(request())).toThrow('disposed');
		expect(identities).toHaveLength(2);
		host.dispose();
	});

	it('shares snapshot bytes without sharing component task lifetimes', async () => {
		const { source, fake } = moduleWorkers();
		const pending = pendingBytes();
		const read = vi.fn((_path: string, _signal: AbortSignal) => pending.promise);
		source.read = read;
		const workerModules = vi.fn(() => source);
		const host = createHost({ workerModules });
		const one = activate(host);
		const two = activate(host, 'two');
		const first = one.tasks.worker(request());
		const second = two.tasks.worker(request());
		expect(read).toHaveBeenCalledTimes(2);
		expect(read.mock.calls[0][1]).not.toBe(read.mock.calls[1][1]);
		host.deactivate('one');
		expect(first.signal.aborted).toBe(true);
		expect(second.signal.aborted).toBe(false);
		pending.resolve(new Uint8Array([1]));
		await flush();
		expect(Worker).toHaveBeenCalledOnce();
		fake.result(2);
		expect(await first.result).toEqual({ status: 'cancelled' });
		expect(await second.result).toEqual({ status: 'completed', value: 2 });
		expect(workerModules).toHaveBeenCalledTimes(2);
		host.dispose();
	});

	it.each([
		'result',
		'tasks:error',
		'error',
		'messageerror',
		'malformed',
		'throwing-data',
	] as const)(
		'cancels revoked workers on %s delivery before their individual abort signal',
		async (delivery) => {
			const { source, fake } = moduleWorkers();
			const host = createHost({ workerModules: () => source });
			const one = activate(host);
			const two = activate(host, 'two');
			const apply = vi.fn();
			const task = two.tasks.worker({ ...request(), apply });
			const completed = two.tasks.async({ key: 'done', label: 'Done', run: () => 42 });
			expect(await completed.result).toEqual({ status: 'completed', value: 42 });
			await flush();
			const inspect = vi.fn(() => {
				throw new Error('Revoked data must not be read');
			});
			fake.terminate.mockImplementation(() => {
				throw new Error('Revoked cleanup error');
			});
			let beforeDelivery: boolean[] = [];
			let afterDelivery: string[] = [];
			one.signal.addEventListener('abort', () => {
				beforeDelivery = [two.signal.aborted, task.signal.aborted];
				if (delivery === 'result') {
					fake.result(1);
				} else if (delivery === 'error') {
					fake.worker.dispatchEvent(
						new ErrorEvent('error', { error: new Error('Worker failed'), cancelable: true }),
					);
				} else if (delivery === 'messageerror') {
					fake.worker.dispatchEvent(new MessageEvent('messageerror'));
				} else {
					const event = new MessageEvent('message', {
						data:
							delivery === 'tasks:error'
								? { type: 'tasks:error', error: { name: 'Error', message: 'Worker failed' } }
								: { type: 'unknown' },
					});
					if (delivery === 'throwing-data') {
						Object.defineProperty(event, 'data', { get: inspect });
					}
					fake.worker.dispatchEvent(event);
				}
				afterDelivery = [task.status, completed.status];
			});
			host.dispose();
			expect(beforeDelivery).toEqual([false, false]);
			expect(afterDelivery).toEqual(['cancelled', 'completed']);
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(apply).not.toHaveBeenCalled();
			expect(inspect).not.toHaveBeenCalled();
			expect(host.get('two')!.errors).toEqual([]);
		},
	);

	it.each(['return', 'throw', 'malformed'] as const)(
		'cancels late Worker constructor %s outcomes without reporting stale errors',
		async (outcome) => {
			const { source, fake } = moduleWorkers();
			const host = createHost({ workerModules: () => source });
			vi.stubGlobal(
				'Worker',
				vi.fn(function () {
					host.dispose();
					if (outcome === 'throw') {
						throw new Error('Late constructor error');
					}
					if (outcome === 'malformed') {
						return {} as Worker;
					}
					fake.terminate.mockImplementation(() => {
						throw new Error('Late termination error');
					});
					return fake.worker;
				}),
			);
			const task = activate(host).tasks.worker(request());
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(host.get('one')!.errors).toEqual([]);
		},
	);

	it('blocks worker reads across the entire stop batch before later signals abort', async () => {
		const { source } = moduleWorkers();
		const pending = pendingBytes();
		const read = vi.fn((_path: string, _signal: AbortSignal) => pending.promise);
		source.read = read;
		const host = createHost({ workerModules: () => source });
		const one = activate(host);
		const two = activate(host, 'two');
		const task = two.tasks.worker(request());
		let checked = false;
		one.signal.addEventListener('abort', () => {
			expect(two.signal.aborted).toBe(false);
			expect(task.signal.aborted).toBe(false);
			expect(() => two.tasks.worker({ ...request(), key: 'late' })).toThrow('disposed');
			pending.resolve(new Uint8Array([1]));
			checked = true;
		});
		host.dispose();
		await flush();
		expect(checked).toBe(true);
		expect(read).toHaveBeenCalledOnce();
		expect(Worker).not.toHaveBeenCalled();
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(host.get('two')!.errors).toEqual([]);
	});
});
