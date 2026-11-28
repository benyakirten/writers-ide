import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi, type Mock } from 'vitest';
import {
	createTaskService,
	WorkQueue,
	type AdvancedTaskService,
	type TaskService,
	type TaskHandle,
	type TaskServiceOptions,
	type WorkerFactoryTaskOptions,
	type WorkerTaskOptions,
} from '../../../packages-js/tasks';

class MockWorker extends EventTarget {
	postMessage = vi.fn();
	terminate = vi.fn();
	respond(value: unknown) {
		this.dispatchEvent(new MessageEvent('message', { data: { type: 'tasks:result', value } }));
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

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe('module worker tasks', () => {
	let owner: AbortController;
	let services: AdvancedTaskService[];
	let instances: MockWorker[];
	let construct: Mock<(url: string, options: WorkerOptions) => void>;
	let createURL: Mock<(object: Blob | MediaSource) => string>;
	let revokeURL: Mock<(url: string) => void>;
	let fetch: Mock<typeof globalThis.fetch>;
	let onError: Mock<NonNullable<TaskServiceOptions['onError']>>;
	const bytes = new Uint8Array([101, 120, 112, 111, 114, 116, 32, 123, 125]);
	const request = () => ({
		key: 'work',
		label: 'Worker',
		module: new URL('https://packages.test/snapshots/id/count.js'),
		input: [1, 2],
	});
	function service(
		loadWorkerModule?: TaskServiceOptions['loadWorkerModule'],
		isLive?: TaskServiceOptions['isLive'],
	) {
		const tasks = createTaskService({
			queue: new WorkQueue(),
			ownerId: 'activation',
			signal: owner.signal,
			loadWorkerModule,
			isLive,
			onError,
		});
		services.push(tasks);
		return tasks;
	}
	beforeEach(() => {
		owner = new AbortController();
		services = [];
		instances = [];
		construct = vi.fn<(url: string, options: WorkerOptions) => void>();
		createURL = vi.fn((_object: Blob | MediaSource) => 'blob:task');
		revokeURL = vi.fn<(url: string) => void>();
		fetch = vi.fn<typeof globalThis.fetch>();
		onError = vi.fn<NonNullable<TaskServiceOptions['onError']>>();
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal(
			'Worker',
			class {
				constructor(url: string, options: WorkerOptions) {
					construct(url, options);
					const worker = new MockWorker();
					instances.push(worker);
					return worker;
				}
			},
		);
		vi.stubGlobal('Blob', Blob);
		vi.spyOn(URL, 'createObjectURL').mockImplementation(createURL);
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeURL);
	});
	afterEach(() => {
		for (const tasks of services) {
			tasks.dispose();
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('exposes module-only ordinary contracts and synchronous advanced factory contracts', () => {
		expectTypeOf<ReturnType<typeof createTaskService>>().toEqualTypeOf<AdvancedTaskService>();
		expectTypeOf<WorkerFactoryTaskOptions<unknown, unknown>['createWorker']>().toEqualTypeOf<
			() => Worker
		>();
		expectTypeOf<WorkerTaskOptions<unknown, unknown>['module']>().toEqualTypeOf<URL>();
		const tasks = service(() => bytes);
		const ordinary: TaskService = tasks;
		const assertContracts = () => {
			// @ts-expect-error Ordinary services cannot accept a worker factory.
			ordinary.worker({ key: 'x', label: 'x', input: 1, createWorker: () => new Worker('x') });
			// @ts-expect-error Advanced factory callbacks remain synchronous.
			tasks.worker({ key: 'x', label: 'x', input: 1, createWorker: async () => new Worker('x') });
			// @ts-expect-error Module and factory options are mutually exclusive.
			tasks.worker({ ...request(), createWorker: () => new Worker('x') });
		};
		void assertContracts;
		const factory = vi.fn(() => new MockWorker() as unknown as Worker);
		tasks.worker({ key: 'factory', label: 'Factory', input: 1, createWorker: factory });
		expect(factory).toHaveBeenCalledOnce();
	});

	it('loads a copied URL with the task signal and owns a fresh module Blob worker', async () => {
		const loading = deferred<Uint8Array>();
		const load = vi.fn(() => loading.promise);
		const options = request();
		const original = options.module.href;
		const apply = vi.fn();
		const transfer = [new ArrayBuffer(2)];
		const task = service(load).worker({ ...options, transfer, apply });
		options.module.pathname = '/other.js';
		expect(load.mock.calls[0]).toEqual([new URL(original), { signal: task.signal }]);
		expect(construct).not.toHaveBeenCalled();
		loading.resolve(bytes);
		await flush();
		expect(createURL).toHaveBeenCalledWith(expect.any(Blob));
		expect(createURL.mock.calls[0][0]).toMatchObject({ type: 'text/javascript' });
		expect(construct).toHaveBeenCalledWith('blob:task', { type: 'module' });
		expect(instances[0].postMessage).toHaveBeenCalledWith(
			{ type: 'tasks:run', input: [1, 2] },
			transfer,
		);
		instances[0].respond(3);
		instances[0].respond(4);
		expect(await task.result).toEqual({ status: 'completed', value: 3 });
		expect(apply).toHaveBeenCalledExactlyOnceWith(3, { signal: task.signal });
		expect(instances[0].terminate).toHaveBeenCalledOnce();
		expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:task');
		task.cancel();
		expect(revokeURL).toHaveBeenCalledOnce();
		expect(fetch).not.toHaveBeenCalled();
	});

	describe.each(['owner', 'caller', 'replacement'] as const)(
		'%s cancellation from getters',
		(cancellation) => {
			it.each([
				['module', 'module'],
				['href', 'module'],
				['loader', 'module'],
				['factory', 'factory'],
				['input', 'module'],
				['transfer', 'module'],
				['input', 'factory'],
				['transfer', 'factory'],
			] as const)('stops after the %s getter in %s mode', async (stage, mode) => {
				const caller = new AbortController();
				const load = vi.fn(() => bytes);
				const worker = new MockWorker();
				const factory = vi.fn(() => worker as unknown as Worker);
				const apply = vi.fn();
				const configuration: TaskServiceOptions = {
					queue: new WorkQueue(),
					ownerId: 'getters',
					signal: owner.signal,
					loadWorkerModule: load,
					onError,
				};

				let replacement: TaskHandle<number> | undefined;
				const cancel = () => {
					if (cancellation === 'owner') {
						owner.abort();
					} else if (cancellation === 'caller') {
						caller.abort();
					} else {
						replacement = tasks.async({ key: 'work', label: 'Newer', run: () => 7 });
					}
				};
				const module = request().module;
				const href = module.href;
				const options:
					| WorkerTaskOptions<number[], unknown>
					| WorkerFactoryTaskOptions<number[], unknown> =
					mode === 'module'
						? { ...request(), module, signal: caller.signal, apply }
						: {
								key: 'work',
								label: 'Factory',
								input: [1, 2],
								signal: caller.signal,
								createWorker: factory,
								apply,
							};
				const transfer = vi.fn(() => [] as Transferable[]);
				Object.defineProperty(options, 'transfer', { configurable: true, get: transfer });
				const read = vi.fn(() => {
					cancel();
					if (stage === 'module') {
						return module;
					}
					if (stage === 'href') {
						return href;
					}
					if (stage === 'loader') {
						return load;
					}
					if (stage === 'factory') {
						return factory;
					}
					if (stage === 'input') {
						return [1, 2];
					}
					return [];
				});
				const target = stage === 'href' ? module : stage === 'loader' ? configuration : options;
				const property =
					stage === 'loader' ? 'loadWorkerModule' : stage === 'factory' ? 'createWorker' : stage;
				Object.defineProperty(target, property, { configurable: true, get: read });
				const tasks = createTaskService(configuration);
				services.push(tasks);
				const task = tasks.worker(options);
				await flush();
				expect(await task.result).toEqual({ status: 'cancelled' });
				expect(task.signal.aborted).toBe(true);
				expect(read).toHaveBeenCalledOnce();
				expect(apply).not.toHaveBeenCalled();
				if (cancellation === 'replacement') {
					expect(await replacement?.result).toEqual({ status: 'completed', value: 7 });
				}
				if (stage === 'input' || stage === 'transfer') {
					const current = mode === 'module' ? instances[0] : worker;
					expect(current.postMessage).not.toHaveBeenCalled();
					expect(current.terminate).toHaveBeenCalledOnce();
					expect(revokeURL).toHaveBeenCalledTimes(mode === 'module' ? 1 : 0);
					if (stage === 'input') {
						expect(transfer).not.toHaveBeenCalled();
					}
				} else {
					expect(load).not.toHaveBeenCalled();
					expect(factory).not.toHaveBeenCalled();
					expect(createURL).not.toHaveBeenCalled();
					expect(construct).not.toHaveBeenCalled();
				}
				expect(onError).not.toHaveBeenCalled();
			});
		},
	);

	it('reads module, href, and loader once and snapshots the URL before awaiting bytes', async () => {
		const loading = deferred<Uint8Array>();
		const module = request().module;
		const original = module.href;
		const href = vi.fn(() => original);
		Object.defineProperty(module, 'href', { get: href });
		const readModule = vi.fn(() => module);
		const options = request();
		Object.defineProperty(options, 'module', { get: readModule });
		const load = vi.fn((_module: URL) => loading.promise);
		const readLoader = vi.fn(() => load);
		const configuration: TaskServiceOptions = {
			queue: new WorkQueue(),
			ownerId: 'snapshot',
			signal: owner.signal,
			get loadWorkerModule() {
				return readLoader();
			},
		};
		const tasks = createTaskService(configuration);
		services.push(tasks);
		const task = tasks.worker(options);
		expect(readModule).toHaveBeenCalledOnce();
		expect(href).toHaveBeenCalledOnce();
		expect(readLoader).toHaveBeenCalledOnce();
		module.pathname = '/changed.js';
		expect(load.mock.calls[0][0].href).toBe(original);
		expect(load.mock.calls[0][0]).not.toBe(module);
		loading.resolve(bytes);
		await flush();
		instances[0].respond(3);
		expect(await task.result).toEqual({ status: 'completed', value: 3 });
	});

	it('reads input and transfer at posting time rather than at module submission', async () => {
		const loading = deferred<Uint8Array>();
		const options = { ...request(), transfer: [] as Transferable[] };
		const task = service(() => loading.promise).worker(options);
		const input = [9];
		const transfer = [new ArrayBuffer(2)];
		options.input = input;
		options.transfer = transfer;
		loading.resolve(bytes);
		await flush();
		expect(instances[0].postMessage).toHaveBeenCalledExactlyOnceWith(
			{ type: 'tasks:run', input },
			transfer,
		);
		instances[0].respond(9);
		expect(await task.result).toEqual({ status: 'completed', value: 9 });
	});

	it('fails closed without a loader and never fetches', async () => {
		const task = service().worker(request());
		expect(await task.result).toMatchObject({ status: 'failed', error: expect.any(Error) });
		expect(fetch).not.toHaveBeenCalled();
		expect(createURL).not.toHaveBeenCalled();
	});

	it.each([
		{},
		{ module: 'https://packages.test/worker.js' },
		{ module: undefined },
		{ createWorker: undefined },
		{ module: new URL('https://packages.test/worker.js'), createWorker: () => new Worker('x') },
	])('returns a failed outcome for invalid selection %j', async (selection) => {
		const load = vi.fn(() => bytes);
		const { module: _module, ...base } = request();
		const task = service(load).worker({ ...base, ...selection } as unknown as WorkerTaskOptions<
			unknown,
			unknown
		>);
		expect(await task.result).toMatchObject({ status: 'failed' });
		expect(load).not.toHaveBeenCalled();
		expect(construct).not.toHaveBeenCalled();
	});

	it.each(['handle', 'request', 'owner', 'dispose', 'replacement'] as const)(
		'cancels loading through %s and ignores late bytes and rejection',
		async (mode) => {
			for (const reject of [false, true]) {
				owner = new AbortController();
				const loading = deferred<Uint8Array>();
				const caller = new AbortController();
				const tasks = service(() => loading.promise);
				const task = tasks.worker({ ...request(), signal: caller.signal });
				if (mode === 'handle') {
					task.cancel();
				} else if (mode === 'request') {
					caller.abort();
				} else if (mode === 'owner') {
					owner.abort();
				} else if (mode === 'dispose') {
					tasks.dispose();
				} else {
					const replacement = tasks.async({ key: 'work', label: 'Replacement', run: () => 7 });
					expect(await replacement.result).toEqual({ status: 'completed', value: 7 });
				}
				expect(await task.result).toEqual({ status: 'cancelled' });
				expect(task.signal.aborted).toBe(true);
				if (reject) {
					loading.reject(new Error('late'));
				} else {
					loading.resolve(bytes);
				}
				await flush();
			}
			expect(createURL).not.toHaveBeenCalled();
			expect(construct).not.toHaveBeenCalled();
			expect(onError).not.toHaveBeenCalled();
		},
	);

	it('skips a pre-aborted caller and observes loader rejection after synchronous cancellation', async () => {
		const caller = new AbortController();
		caller.abort();
		const load = vi.fn(() => bytes);
		const tasks = service(load);
		expect(await tasks.worker({ ...request(), signal: caller.signal }).result).toEqual({
			status: 'cancelled',
		});
		expect(load).not.toHaveBeenCalled();
		const cancelled = service(() => {
			owner.abort();
			return Promise.reject(new Error('late'));
		}).worker(request());
		expect(await cancelled.result).toEqual({ status: 'cancelled' });
		await flush();
		expect(construct).not.toHaveBeenCalled();
	});

	it.each(['throw', 'reject', 'invalid'] as const)(
		'reports loader %s as task failure',
		async (mode) => {
			const failure = new Error('loader failed');
			const task = service(() => {
				if (mode === 'throw') {
					throw failure;
				}
				if (mode === 'reject') {
					return Promise.reject(failure);
				}
				return 'not bytes' as unknown as Uint8Array;
			}).worker(request());
			expect(await task.result).toMatchObject({ status: 'failed' });
			expect(onError).toHaveBeenCalledOnce();
			expect(createURL).not.toHaveBeenCalled();
		},
	);

	it.each([
		'blob',
		'url',
		'constructor',
		'message-listener',
		'error-listener',
		'messageerror-listener',
		'post',
		'apply',
	] as const)('cleans up after %s failure', async (stage) => {
		const failure = new Error(stage);
		if (stage === 'blob') {
			vi.stubGlobal(
				'Blob',
				class {
					constructor() {
						throw failure;
					}
				},
			);
		} else if (stage === 'url') {
			createURL.mockImplementation(() => {
				throw failure;
			});
		} else if (stage === 'constructor') {
			construct.mockImplementation(() => {
				throw failure;
			});
		} else if (stage.endsWith('-listener')) {
			const add = MockWorker.prototype.addEventListener;
			vi.spyOn(MockWorker.prototype, 'addEventListener').mockImplementation(function (
				this: MockWorker,
				type,
				listener,
				options,
			) {
				if (type === stage.replace('-listener', '')) {
					throw failure;
				}
				return add.call(this, type, listener, options);
			});
		}
		const task = service(() => bytes).worker({
			...request(),
			apply: () => {
				if (stage === 'apply') {
					throw failure;
				}
			},
		});
		if (stage === 'post') {
			vi.spyOn(MockWorker.prototype, 'addEventListener').mockImplementation(function (
				this: MockWorker,
			) {
				this.postMessage.mockImplementation(() => {
					throw failure;
				});
			});
		}
		await flush();
		if (stage === 'apply') {
			instances[0].respond(3);
		}
		expect(await task.result).toEqual({ status: 'failed', error: failure });
		expect(revokeURL).toHaveBeenCalledTimes(['blob', 'url'].includes(stage) ? 0 : 1);
		for (const worker of instances) {
			expect(worker.terminate).toHaveBeenCalledOnce();
		}
	});

	it.each(['url', 'constructor', 'listener', 'post', 'terminate', 'revoke'] as const)(
		'cleans resources exactly once during reentrant %s cancellation',
		async (stage) => {
			const cancel = () => owner.abort();
			if (stage === 'url') {
				createURL.mockImplementation(() => {
					cancel();
					return 'blob:task';
				});
			}
			if (stage === 'constructor') {
				construct.mockImplementation(cancel);
			}
			if (stage === 'revoke') {
				revokeURL.mockImplementation(cancel);
			}
			const add = MockWorker.prototype.addEventListener;
			vi.spyOn(MockWorker.prototype, 'addEventListener').mockImplementation(function (
				this: MockWorker,
				type,
				listener,
				options,
			) {
				if (stage === 'listener') {
					cancel();
				}
				if (stage === 'post') {
					this.postMessage.mockImplementation(cancel);
				}
				if (stage === 'terminate') {
					this.terminate.mockImplementation(cancel);
				}
				return add.call(this, type, listener, options);
			});
			const task = service(() => bytes).worker(request());
			await flush();
			if (stage === 'terminate' || stage === 'revoke') {
				task.cancel();
			}
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(revokeURL).toHaveBeenCalledOnce();
			expect(construct).toHaveBeenCalledTimes(stage === 'url' ? 0 : 1);
			for (const worker of instances) {
				expect(worker.terminate).toHaveBeenCalledOnce();
				worker.respond(99);
			}
		},
	);

	it.each(['handle', 'request', 'owner', 'dispose', 'replacement'] as const)(
		'terminates and revokes a running module worker on %s',
		async (mode) => {
			const caller = new AbortController();
			const apply = vi.fn();
			const tasks = service(() => bytes);
			const task = tasks.worker({ ...request(), signal: caller.signal, apply });
			await flush();
			if (mode === 'handle') {
				task.cancel();
			} else if (mode === 'request') {
				caller.abort();
			} else if (mode === 'owner') {
				owner.abort();
			} else if (mode === 'dispose') {
				tasks.dispose();
			} else {
				tasks.async({ key: 'work', label: 'Replacement', run: () => 7 });
			}
			instances[0].respond(99);
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(apply).not.toHaveBeenCalled();
			expect(instances[0].terminate).toHaveBeenCalledOnce();
			expect(revokeURL).toHaveBeenCalledOnce();
		},
	);

	it.each(['error', 'messageerror', 'protocol'] as const)(
		'terminates and revokes a module worker after %s failure',
		async (mode) => {
			const task = service(() => bytes).worker(request());
			await flush();
			if (mode === 'protocol') {
				instances[0].dispatchEvent(new MessageEvent('message', { data: null }));
			} else if (mode === 'error') {
				instances[0].dispatchEvent(new ErrorEvent('error', { message: 'worker crashed' }));
			} else {
				instances[0].dispatchEvent(new MessageEvent('messageerror'));
			}
			expect(await task.result).toMatchObject({ status: 'failed' });
			expect(instances[0].terminate).toHaveBeenCalledOnce();
			expect(revokeURL).toHaveBeenCalledOnce();
		},
	);

	it('creates a fresh worker and Blob URL for each submission', async () => {
		const tasks = service(() => bytes);
		const first = tasks.worker(request());
		await flush();
		const second = tasks.worker(request());
		await flush();
		expect(await first.result).toEqual({ status: 'cancelled' });
		expect(instances).toHaveLength(2);
		expect(createURL).toHaveBeenCalledTimes(2);
		instances[1].respond(4);
		expect(await second.result).toEqual({ status: 'completed', value: 4 });
		expect(revokeURL).toHaveBeenCalledTimes(2);
		expect(instances[0].terminate).toHaveBeenCalledOnce();
		expect(instances[1].terminate).toHaveBeenCalledOnce();
	});

	describe('trusted host liveness', () => {
		it.each(['module', 'factory'] as const)(
			'cancels %s delivery and failure before owner signals fire',
			async (mode) => {
				for (const event of ['result', 'error', 'messageerror', 'invalid', 'worker-error']) {
					let live = true;
					const apply = vi.fn();
					const worker = new MockWorker();
					const tasks = service(
						() => bytes,
						() => live,
					);
					const task =
						mode === 'module'
							? tasks.worker({ ...request(), apply })
							: tasks.worker({
									key: 'work',
									label: 'Factory',
									input: 1,
									createWorker: () => worker as unknown as Worker,
									apply,
								});
					await flush();
					const current = mode === 'module' ? instances[instances.length - 1] : worker;
					live = false;
					if (event === 'result') {
						current.respond(3);
					} else if (event === 'error') {
						current.dispatchEvent(new ErrorEvent('error', { error: new Error('stale') }));
					} else if (event === 'messageerror') {
						current.dispatchEvent(new MessageEvent('messageerror'));
					} else {
						current.dispatchEvent(
							new MessageEvent('message', {
								data:
									event === 'invalid'
										? null
										: { type: 'tasks:error', error: { name: 'Error', message: 'stale' } },
							}),
						);
					}
					expect(await task.result).toEqual({ status: 'cancelled' });
					expect(task.signal.aborted).toBe(true);
					expect(owner.signal.aborted).toBe(false);
					expect(task.error).toBeUndefined();
					expect(apply).not.toHaveBeenCalled();
					expect(current.terminate).toHaveBeenCalledOnce();
				}
				expect(onError).not.toHaveBeenCalled();
			},
		);

		it.each(['resolve', 'reject'] as const)(
			'cancels late loader %s without starting a worker',
			async (settlement) => {
				let live = true;
				const loading = deferred<Uint8Array>();
				const task = service(
					() => loading.promise,
					() => live,
				).worker(request());
				live = false;
				if (settlement === 'resolve') {
					loading.resolve(bytes);
				} else {
					loading.reject(new Error('stale loader'));
				}
				expect(await task.result).toEqual({ status: 'cancelled' });
				expect(createURL).not.toHaveBeenCalled();
				expect(construct).not.toHaveBeenCalled();
				expect(onError).not.toHaveBeenCalled();
			},
		);

		it.each(['module', 'factory'] as const)(
			'cleans up reentrant %s construction without reporting to a stopped host',
			async (mode) => {
				let live = true;
				const failure = new Error('cleanup');
				const worker = new MockWorker();
				worker.terminate.mockImplementation(() => {
					throw failure;
				});
				construct.mockImplementation(() => {
					live = false;
				});
				vi.spyOn(MockWorker.prototype, 'removeEventListener').mockImplementation(() => {
					throw failure;
				});
				revokeURL.mockImplementation(() => {
					throw failure;
				});
				const tasks = service(
					() => bytes,
					() => live,
				);
				const task =
					mode === 'module'
						? tasks.worker(request())
						: tasks.worker({
								key: 'work',
								label: 'Factory',
								input: 1,
								createWorker() {
									live = false;
									return worker as unknown as Worker;
								},
							});
				expect(await task.result).toEqual({ status: 'cancelled' });
				const current = mode === 'module' ? instances[0] : worker;
				expect(current.postMessage).not.toHaveBeenCalled();
				expect(current.terminate).toHaveBeenCalledOnce();
				expect(revokeURL).toHaveBeenCalledTimes(mode === 'module' ? 1 : 0);
				expect(task.error).toBeInstanceOf(AggregateError);
				expect(onError).not.toHaveBeenCalled();
			},
		);

		it.each(['module', 'input', 'transfer', 'apply'] as const)(
			'checks liveness after the %s getter',
			async (property) => {
				let live = true;
				const load = vi.fn(() => bytes);
				const apply = vi.fn();
				const options = { ...request(), transfer: [] as Transferable[], apply };
				const value = options[property];
				Object.defineProperty(options, property, {
					get() {
						live = false;
						return value;
					},
				});
				const task = service(load, () => live).worker(options);
				await flush();
				if (property === 'apply') {
					instances[0].respond(3);
				}
				expect(await task.result).toEqual({ status: 'cancelled' });
				expect(apply).not.toHaveBeenCalled();
				if (property === 'module') {
					expect(load).not.toHaveBeenCalled();
				} else {
					expect(instances[0].terminate).toHaveBeenCalledOnce();
					if (property !== 'apply') {
						expect(instances[0].postMessage).not.toHaveBeenCalled();
					}
				}
			},
		);

		it('preserves a live failed outcome and retains cleanup errors after reporting stops the host', async () => {
			let live = true;
			const failure = new Error('worker failure');
			const cleanup = new Error('cleanup failure');
			onError.mockImplementation(() => {
				live = false;
			});
			const task = service(
				() => bytes,
				() => live,
			).worker(request());
			await flush();
			instances[0].terminate.mockImplementation(() => {
				throw cleanup;
			});
			instances[0].dispatchEvent(new ErrorEvent('error', { error: failure }));
			expect(await task.result).toEqual({ status: 'failed', error: failure });
			expect(task.error).toBeInstanceOf(AggregateError);
			expect(onError).toHaveBeenCalledOnce();
			expect(revokeURL).toHaveBeenCalledOnce();
		});

		it('does not revoke a completed outcome when the host stops later', async () => {
			let live = true;
			const task = service(
				() => bytes,
				() => live,
			).worker(request());
			await flush();
			instances[0].respond(3);
			expect(await task.result).toEqual({ status: 'completed', value: 3 });
			live = false;
			instances[0].respond(4);
			task.cancel();
			expect(await task.result).toEqual({ status: 'completed', value: 3 });
			expect(task.signal.aborted).toBe(false);
		});

		it('skips all execution modes submitted after the host has stopped', async () => {
			const load = vi.fn(() => bytes);
			const run = vi.fn();
			const create = vi.fn(function* () {
				yield;
			});
			const factory = vi.fn(() => new MockWorker() as unknown as Worker);
			const tasks = service(load, () => false);
			const handles = [
				tasks.worker(request()),
				tasks.worker({ key: 'factory', label: 'Factory', input: 1, createWorker: factory }),
				tasks.async({ key: 'async', label: 'Async', run }),
				tasks.cooperative({ key: 'cooperative', label: 'Cooperative', create }),
				tasks.forEach({ key: 'each', label: 'Each', items: [1], run }),
			];
			for (const task of handles) {
				expect(await task.result).toEqual({ status: 'cancelled' });
			}
			expect(load).not.toHaveBeenCalled();
			expect(run).not.toHaveBeenCalled();
			expect(create).not.toHaveBeenCalled();
			expect(factory).not.toHaveBeenCalled();
		});

		it.each(['resolve', 'reject'] as const)(
			'cancels async %s delivery after the host stops',
			async (settlement) => {
				let live = true;
				const pending = deferred<number>();
				const task = service(undefined, () => live).async({
					key: 'async',
					label: 'Async',
					run: () => pending.promise,
				});
				live = false;
				if (settlement === 'resolve') {
					pending.resolve(7);
				} else {
					pending.reject(new Error('stale'));
				}
				expect(await task.result).toEqual({ status: 'cancelled' });
				expect(onError).not.toHaveBeenCalled();
			},
		);

		it.each(['before-frame', 'in-step'] as const)(
			'stops cooperative work %s without further segments',
			async (stage) => {
				let live = true;
				const frames: FrameRequestCallback[] = [];
				vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
					frames.push(callback);
					return frames.length;
				});
				vi.stubGlobal('cancelAnimationFrame', vi.fn());
				const run = vi.fn(() => {
					live = false;
				});
				const task = service(undefined, () => live).forEach({
					key: 'each',
					label: 'Each',
					items: [1, 2],
					run,
				});
				if (stage === 'before-frame') {
					live = false;
				}
				frames[0](0);
				expect(await task.result).toEqual({ status: 'cancelled' });
				expect(run).toHaveBeenCalledTimes(stage === 'before-frame' ? 0 : 1);
				expect(onError).not.toHaveBeenCalled();
			},
		);

		it('turns a throwing liveness predicate into a failed outcome without starting work', async () => {
			const failure = new Error('liveness failed');
			const load = vi.fn(() => bytes);
			const task = service(load, () => {
				throw failure;
			}).worker(request());
			expect(await task.result).toEqual({ status: 'failed', error: failure });
			expect(task.error).toBe(failure);
			expect(load).not.toHaveBeenCalled();
		});
	});

	it('revokes the URL even if listener removal and termination throw', async () => {
		const task = service(() => bytes).worker(request());
		await flush();
		const failure = new Error('cleanup');
		vi.spyOn(instances[0], 'removeEventListener').mockImplementation(() => {
			throw failure;
		});
		instances[0].terminate.mockImplementation(() => {
			throw failure;
		});
		task.cancel();
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(instances[0].terminate).toHaveBeenCalledOnce();
		expect(revokeURL).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledTimes(4);
	});
});
