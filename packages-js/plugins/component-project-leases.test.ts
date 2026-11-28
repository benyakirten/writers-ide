import { describe, expect, it, vi } from 'vitest';
import { createHost, descriptor, publish } from './command-component-fixture';
import { api, api2, apiProvider, requirement } from './component-api-fixture';
import {
	application,
	captureFactory,
	projectProvider,
	selected,
} from './component-project-fixture';
import type { ComponentApiConnection, ProjectApiConnection, ProjectReference } from './frontend';

describe('independent project API leases', () => {
	it('owns separate cached factory resources, frozen actual endpoints and root lifetime', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const endpoints: ComponentApiConnection[] = [];
		const cleanup = vi.fn();
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, (connection) => {
					endpoints.push(connection);
					connection.own(cleanup);
					return { read: () => ref.id };
				});
				publish(context);
			}),
		);
		host.register(apiProvider(undefined, 'root-provider'));
		const app = application(host, undefined, {
			dependencies: [selected(), { ...requirement('root-provider'), alias: 'root' }],
		});
		host.activate('provider');
		const root = app.apis.get('root', api)!;
		const first = app.projects.connect(ref);
		const second = app.projects.connect(ref);
		const a = first.get('project-service', api)!;
		const b = second.get('project-service', api)!;
		expect(a).not.toBe(b);
		expect(first.get('project-service', api)).toBe(a);
		expect(endpoints).toHaveLength(2);
		for (const endpoint of endpoints) {
			expect(endpoint.consumer).toBe(app.identity);
			expect(endpoint.consumerId).toBe(app.identity.activationId);
			expect(endpoint.consumer.projectOpeningId).toBeNull();
			expect(endpoint.provider.projectOpeningId).toBe(ref.openingId);
			for (const value of [endpoint, endpoint.consumer, endpoint.provider]) {
				expect(Object.isFrozen(value)).toBe(true);
			}
		}
		const events = vi.fn();
		const stop = first.subscribe('project-service', api, events);
		stop();
		stop();
		expect(a.read()).toBe('id');
		expect(cleanup).not.toHaveBeenCalled();
		first.dispose();
		first.dispose();
		expect(first.signal.aborted).toBe(true);
		expect(second.signal.aborted).toBe(false);
		expect(() => a.read()).toThrow(/revoked/);
		expect(() => first.get('project-service', api)).toThrow(/revoked/);
		expect(b.read()).toBe('id');
		expect(root.read()).toBe('value');
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(events).toHaveBeenCalledTimes(1);
		expect(host.get('application')!.status).toBe('active');
		host.dispose();
		expect(cleanup).toHaveBeenCalledTimes(2);
		expect(second.signal.aborted).toBe(true);
	});

	it('keeps leases fixed across selection, optional registration, absence and provider reactivation', () => {
		const host = createHost();
		const one = host.openProject('one', 'Same name');
		const two = host.openProject('two', 'Same name');
		const app = application(host);
		const lease = app.projects.connect(two);
		const events: unknown[] = [];
		lease.subscribe('project-service', api, (value) => events.push(value?.read() ?? null));
		host.register(projectProvider(one, 'first'));
		host.activate('first');
		host.selectProject(one);
		expect(lease.get('project-service', api)).toBeNull();
		host.register(projectProvider(two, 'second'));
		expect(host.get('second')!.status).toBe('disabled');
		expect(events).toEqual([null]);
		host.activate('second');
		const old = lease.get('project-service', api)!;
		host.selectProject(null);
		expect(lease.project).toBe(two);
		expect(old.read()).toBe('two');
		host.deactivate('second');
		expect(lease.signal.aborted).toBe(false);
		expect(() => old.read()).toThrow(/revoked/);
		host.activate('second');
		expect(lease.get('project-service', api)).not.toBe(old);
		expect(events).toEqual([null, 'two', null, 'two']);
		host.closeProject(two);
		expect(lease.signal.aborted).toBe(true);
		const reopened = host.openProject('two', 'New');
		host.register(projectProvider(reopened, 'reopened'));
		host.activate('reopened');
		expect(() => lease.get('project-service', api)).toThrow(/revoked/);
		expect(events).toEqual([null, 'two', null, 'two']);
		expect(app.projects.connect(reopened).get('project-service', api)!.read()).toBe('two');
		host.dispose();
	});

	it('delivers immediate and null selection, isolates nested failures and cleans activation subscriptions', () => {
		const host = createHost();
		const one = host.openProject('one', 'One');
		const two = host.openProject('two', 'Two');
		const app = application(host);
		const selections: (ProjectReference | null)[] = [];
		const nested = vi.fn();
		let lease: ProjectApiConnection | undefined;
		app.projects.subscribeSelected(() => {
			throw new Error('observer');
		});
		const release = app.projects.subscribeSelected((project) => {
			selections.push(project);
			lease?.dispose();
			lease = project ? app.projects.connect(project) : undefined;
			if (project === one) {
				app.projects.subscribeSelected(nested);
				expect(() => host.openProject('forbidden', 'No')).toThrow(/busy/);
				expect(() => host.dispose()).toThrow(/busy/);
			}
		});
		expect(selections).toEqual([null]);
		host.selectProject(one);
		const old = lease!;
		expect(nested).toHaveBeenLastCalledWith(one);
		host.selectProject(two);
		expect(old.signal.aborted).toBe(true);
		host.selectProject(null);
		expect(selections).toEqual([null, one, two, null]);
		release();
		release();
		host.selectProject(one);
		expect(selections).toHaveLength(4);
		host.deactivate('application');
		const count = nested.mock.calls.length;
		host.selectProject(two);
		expect(nested).toHaveBeenCalledTimes(count);
		expect(() => app.projects.connect(two)).toThrow(/revoked/);
		host.dispose();
	});

	it('observes async selection failures without blocking siblings or leaking unhandled rejections', async () => {
		const host = createHost();
		const ref = host.openProject('async-selection', 'Async selection');
		const app = application(host);
		const unhandled = vi.fn();
		const sibling = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			app.projects.subscribeSelected(async () => {
				await Promise.resolve();
				throw new Error('async observer failure');
			});
			app.projects.subscribeSelected(sibling);
			host.selectProject(ref);
			host.selectProject(null);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(sibling.mock.calls).toEqual([[null], [ref], [null]]);
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off('unhandledRejection', unhandled);
			host.dispose();
		}
	});

	it('revokes every project handle before aborts, cleanup and selection notices, without cascade consent', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const endpoints: ComponentApiConnection[] = [];
		const callbacks: string[] = [];
		const callbackFailures: unknown[] = [];
		let handles: { read(): unknown }[] = [];
		let leases: ProjectApiConnection[] = [];
		const assertDead = (phase: string) => {
			try {
				for (const handle of handles) {
					expect(() => handle.read()).toThrow(/revoked/);
				}
				for (const lease of leases) {
					expect(() => lease.get('project-service', api)).toThrow(/revoked/);
				}
				callbacks.push(phase);
			} catch (error) {
				callbackFailures.push(error);
			}
		};
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, captureFactory(endpoints));
				publish(context);
				context.signal.addEventListener('abort', () => assertDead('provider-abort'));
				context.own(() => assertDead('provider-cleanup'));
			}),
		);
		host.register(
			descriptor(
				'required',
				(context) => {
					context.own(() => assertDead('required-cleanup'));
				},
				{
					identity: {
						packageId: 'dependent',
						componentId: 'required',
						projectOpeningId: ref.openingId,
					},
					dependencies: [{ ...requirement(), apis: [api] }],
				},
			),
		);
		host.activate('required');
		const app = application(host);
		leases = [app.projects.connect(ref), app.projects.connect(ref)];
		handles = leases.map((lease) => lease.get('project-service', api)!);
		for (const lease of leases) {
			lease.signal.addEventListener('abort', () => assertDead('lease-abort'));
		}
		host.selectProject(ref);
		app.projects.subscribeSelected((project) => {
			if (project === null) {
				assertDead('selection');
				expect(leases.every((lease) => lease.signal.aborted)).toBe(true);
				expect(() => app.projects.connect(ref)).toThrow(/live opening/);
			}
		});
		host.closeProject(ref);
		expect(callbackFailures).toEqual([]);
		expect(callbacks).toContain('provider-cleanup');
		expect(callbacks.at(-1)).toBe('selection');
		expect(host.get('required')!.status).toBe('disabled');
		expect(host.get('provider')!.status).toBe('disabled');
		expect(host.get('application')!.status).toBe('active');
		expect(app.signal.aborted).toBe(false);
		host.dispose();
	});

	it('requires all static declarations but keeps individual runtime APIs available after command loss', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		let remove!: () => void;
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, () => ({ read: () => 1 }));
				remove = publish(context);
			}),
		);
		const app = application(host);
		host.activate('provider');
		const lease = app.projects.connect(ref);
		const handle = lease.get('project-service', api)!;
		remove();
		expect(lease.get('project-service', api)).toBe(handle);
		expect(handle.read()).toBe(1);
		host.dispose();
	});

	it('leaves a lease alive for later compatible publication, not a partial static match', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const app = application(host, undefined, { dependencies: [selected({ apis: [api, api2] })] });
		host.register(projectProvider(ref));
		host.activate('provider');
		const lease = app.projects.connect(ref);
		expect(lease.get('project-service', api)).toBeNull();
		expect(lease.signal.aborted).toBe(false);
		host.unregister('provider');
		host.register(
			projectProvider(
				ref,
				'provider',
				(context) => {
					context.apis.provide(api, () => ({ read: () => 1 }));
					context.apis.provide(api2, () => ({ read: () => 2 }));
					publish(context);
				},
				{ provides: [api, api2] },
			),
		);
		host.activate('provider');
		expect(lease.get('project-service', api)!.read()).toBe(1);
		host.dispose();
	});
});
