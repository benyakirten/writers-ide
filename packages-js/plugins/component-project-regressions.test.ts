import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkQueue, type TaskHandle } from '@writers-ide/tasks';
import { createHost, descriptor, publish } from './command-component-fixture';
import { frames } from './component-tasks-fixture';
import { api } from './component-api-fixture';
import { application, projectProvider, selected, target } from './component-project-fixture';
import type { CommandContext } from './command-component-model';
import type { ProjectApiConnection } from './frontend';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('project connection regression boundaries', () => {
	it('rejects an application target for selected-project declarations in either registration order', () => {
		for (const targetFirst of [true, false]) {
			const host = createHost();
			const provider = descriptor('provider', undefined, {
				identity: { ...target, projectOpeningId: null },
			});
			if (targetFirst) {
				host.register(provider);
				expect(() => application(host)).toThrow(/project scoped/);
			} else {
				application(host);
				expect(() => host.register(provider)).toThrow(/project scoped/);
			}
			host.dispose();
		}
	});

	it.each(['throw', 'publication'])(
		'rolls back tasks, root APIs, leases and selectors together on %s failure',
		async (failure) => {
			frames();
			const queue = new WorkQueue();
			const host = createHost({ workQueue: queue });
			const ref = host.openProject('id', 'Name');
			host.register(projectProvider(ref));
			host.activate('provider');
			let task!: TaskHandle<void>;
			let context!: CommandContext;
			let lease!: ProjectApiConnection;
			let handle!: { read(): unknown };
			const selections = vi.fn();
			const cleanupStates: boolean[] = [];
			host.register(
				descriptor(
					'broken',
					(value) => {
						context = value;
						lease = value.projects!.connect(ref);
						handle = lease.get('project-service', api)!;
						value.projects!.subscribeSelected(selections);
						task = value.tasks.forEach({
							key: 'scan',
							label: 'Scan',
							items: [1],
							run: () => undefined,
						});
						value.apis.provide(api, () => ({ read: () => 1 }));
						value.own(() => {
							cleanupStates.push(lease.signal.aborted && task.signal.aborted);
						});
						if (failure === 'throw') {
							throw new Error('setup failed');
						}
					},
					{
						provides: [api],
						commands: [{ id: 'missing', contractId: 'missing', major: 1 }],
						dependencies: [selected()],
					},
				),
			);
			expect(() => host.activate('broken')).toThrow();
			expect(context.signal.aborted).toBe(true);
			expect(lease.signal.aborted).toBe(true);
			expect(() => handle.read()).toThrow(/revoked/);
			expect(await task.result).toEqual({ status: 'cancelled' });
			expect(queue.jobs).toHaveLength(0);
			expect(cleanupStates).toEqual([true]);
			host.selectProject(ref);
			expect(selections).toHaveBeenCalledTimes(1);
			expect(host.get('provider')!.status).toBe('active');
			host.dispose();
		},
	);

	it('does not automatically cancel owner tasks when a lease ends; explicit signal wiring does', async () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const app = application(host);
		const lease = app.projects.connect(ref);
		let resolve!: (value: number) => void;
		const task = app.tasks.async({
			key: 'independent',
			label: 'Independent',
			run: () =>
				new Promise<number>((done) => {
					resolve = done;
				}),
		});
		let explicitResolve!: (value: number) => void;
		const explicit = app.tasks.async({
			key: 'explicit',
			label: 'Explicit',
			signal: lease.signal,
			run: () =>
				new Promise<number>((done) => {
					explicitResolve = done;
				}),
		});
		await Promise.resolve();
		lease.dispose();
		expect(task.signal.aborted).toBe(false);
		expect(explicit.signal.aborted).toBe(true);
		resolve(7);
		explicitResolve(8);
		expect(await task.result).toEqual({ status: 'completed', value: 7 });
		expect(await explicit.result).toEqual({ status: 'cancelled' });
		host.dispose();
	});

	it('preserves construction deferral and nested subscription delivery within a lease cache', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const app = application(host);
		const lease = app.projects.connect(ref);
		const nested = vi.fn();
		const factory = vi.fn(() => {
			lease.subscribe('project-service', api, nested);
			return { read: () => 1 };
		});
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, factory);
				publish(context);
			}),
		);
		const events = vi.fn();
		lease.subscribe('project-service', api, events);
		host.activate('provider');
		expect(factory).toHaveBeenCalledTimes(1);
		expect(nested).toHaveBeenCalledTimes(1);
		expect(nested).toHaveBeenLastCalledWith(lease.get('project-service', api));
		expect(events).toHaveBeenCalledTimes(2);
		host.dispose();
	});

	it('bounds failed nested factory notifications independently for sibling leases', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const app = application(host);
		const one = app.projects.connect(ref);
		const two = app.projects.connect(ref);
		const listeners = [vi.fn(), vi.fn()];
		one.subscribe('project-service', api, listeners[0]);
		two.subscribe('project-service', api, listeners[1]);
		const cleanups = vi.fn();
		const factory = vi.fn((connection) => {
			connection.own(cleanups);
			one.subscribe('project-service', api, vi.fn());
			throw new Error('factory failed');
		});
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, factory);
				publish(context);
			}),
		);
		host.activate('provider');
		expect(factory).toHaveBeenCalledTimes(2);
		expect(cleanups).toHaveBeenCalledTimes(2);
		expect(one.signal.aborted).toBe(false);
		expect(two.signal.aborted).toBe(false);
		expect(() => one.get('project-service', api)).toThrow('factory failed');
		expect(host.get('provider')!.status).toBe('active');
		host.dispose();
	});
});
