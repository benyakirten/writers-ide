import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskHandle } from '@writers-ide/tasks';
import {
	consumer,
	contract,
	createHost,
	declaration,
	deferred,
	descriptor,
	execute,
	flush,
	provider,
} from './command-component-fixture';
import { api, apiConsumer, apiProvider } from './component-api-fixture';
import { frames } from './component-tasks-fixture';
import { CommandInvocationError } from './commands';

describe('component task continuations', () => {
	let frame: () => void;
	beforeEach(() => {
		frame = frames();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('lets command implementations await tasks and keeps cancelled results out of dispatch', async () => {
		const host = createHost();
		const pending = deferred();
		let task!: TaskHandle<unknown>;
		host.register(
			provider((context) => {
				context.contributions.command({
					id: declaration.id,
					name: 'Background command',
					contract,
					execute: async (_args, invocation) => {
						task = context.tasks.async({
							key: 'lookup',
							label: 'Lookup',
							signal: invocation.signal,
							run: () => pending.promise,
						});
						const outcome = await task.result;
						// Even an implementation returning a value after cancellation must not publish it.
						return outcome.status === 'completed' ? outcome.value : 'cancelled fallback';
					},
				});
			}),
		);
		const caller = consumer(host);
		host.activate('consumer');
		const result = execute(caller.commands);
		const rejection = expect(result).rejects.toBeInstanceOf(CommandInvocationError);
		await flush();
		expect(task.status).toBe('running');
		host.deactivate('consumer');
		expect(await task.result).toEqual({ status: 'cancelled' });
		pending.resolve('late private result');
		await rejection;
		await flush();
		expect(host.get('provider')).toMatchObject({ status: 'active', errors: [] });
		host.dispose();
	});

	it('returns completed task values through the existing command dispatcher', async () => {
		const host = createHost();
		host.register(
			provider((context) => {
				context.contributions.command({
					id: declaration.id,
					name: 'Task result',
					contract,
					execute: async () => {
						const outcome = await context.tasks.async({
							key: 'compute',
							label: 'Compute',
							run: () => ({ count: 3 }),
						}).result;
						return outcome.status === 'completed' ? outcome.value : null;
					},
				});
			}),
		);
		const caller = consumer(host);
		host.activate('consumer');
		expect(await execute(caller.commands)).toEqual({ count: 3 });
		host.dispose();
	});

	it('supports API-owned task work with connection cancellation and an author-checked continuation', async () => {
		const host = createHost();
		const pending = deferred();
		const dispatch = vi.fn();
		let task!: TaskHandle<unknown>;
		host.register(
			apiProvider(undefined, 'provider', {
				activate: (context) =>
					context.apis.provide(api, (connection) => ({
						read: async () => {
							task = context.tasks.async({
								key: 'read',
								label: 'Read',
								signal: connection.signal,
								run: async ({ signal }) => {
									const value = await pending.promise;
									if (!signal.aborted) {
										dispatch(value);
									}
									return value;
								},
							});
							return task.result;
						},
					})),
			}),
		);
		const caller = apiConsumer(host);
		host.activate('consumer');
		const result = caller.api!.read();

		const settled = Promise.resolve(result).catch((error: unknown) => error);
		host.deactivate('consumer');
		expect(await task.result).toEqual({ status: 'cancelled' });
		pending.resolve('late');
		await settled;
		await flush();
		expect(dispatch).not.toHaveBeenCalled();
		expect(host.get('provider')!.status).toBe('active');
		host.dispose();
	});

	it('attributes generator cleanup failure to the stopped activation, not its replacement or peers', async () => {
		const host = createHost();
		let cleanup!: () => void;
		let task!: TaskHandle<void>;

		host.register(
			descriptor('one', (context) => {
				cleanup = () => {
					throw new Error('Private cleanup failure');
				};
				task = context.tasks.cooperative({
					key: 'scan',
					label: 'Scan',
					create: function* () {
						try {
							while (true) {
								yield;
							}
						} finally {
							cleanup();
						}
					},
				});
			}),
		);
		host.register(descriptor('peer'));
		host.activate('peer');
		host.activate('one');
		frame();
		const old = task;
		host.deactivate('one');
		expect(await old.result).toEqual({ status: 'cancelled' });
		expect(host.get('one')!.errors).toEqual(['task-failed']);
		expect(host.get('peer')!.errors).toEqual([]);
		host.activate('one');
		expect(host.get('one')!.errors).toEqual([]);
		host.dispose();
	});
});
