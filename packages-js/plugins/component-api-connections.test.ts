import { describe, expect, it, vi } from 'vitest';
import type { ComponentApiConnection } from './frontend';
import type { CommandContext } from './command-component-model';
import { CommandComponentHost } from './command-component-host';
import { descriptor, flush } from './command-component-fixture';
import { api, api2, apiConsumer, apiProvider, requirement } from './component-api-fixture';

describe('component API connections', () => {
	it('captures actual frozen application/project endpoint identities and caches per activation and exact major', async () => {
		const host = new CommandComponentHost();
		const endpoints: ComponentApiConnection[] = [];

		const result = { mutable: true };
		const promise = Promise.resolve(result);
		host.register(
			apiProvider(undefined, 'project-slot', {
				provides: [api, api2],
				activate: (context) => {
					for (const contract of [api, api2]) {
						context.apis.provide(contract, (connection) => {
							endpoints.push(connection);
							const implementation = {
								read() {
									expect(this).toBe(implementation);
									return promise;
								},
							};
							return implementation;
						});
					}
				},
			}),
		);
		let context!: CommandContext;
		host.register(
			descriptor(
				'application-slot',
				(value) => {
					context = value;
				},
				{
					identity: {
						packageId: 'application',
						componentId: 'coordinator',
						projectOpeningId: null,
					},
					dependencies: [{ ...requirement('project-slot'), apis: [api, api2] }],
				},
			),
		);
		host.activate('application-slot');
		expect(endpoints).toEqual([]);
		const first = context.apis.get('service', api)!;
		expect(context.apis.get('service', api)).toBe(first);
		const notifications: unknown[] = [];
		const stop = context.apis.subscribe('service', api, (value) => notifications.push(value));
		expect(notifications).toEqual([first]);
		stop();
		stop();
		expect(first.read()).toBe(promise);
		expect(await first.read()).toBe(result);

		expect(Object.isFrozen(first)).toBe(true);
		expect(context.apis.get('service', api2)).not.toBe(first);
		expect(endpoints).toHaveLength(2);
		const connection = endpoints[0];
		expect(connection.consumer).toBe(context.identity);
		expect(connection.consumerId).toBe(context.identity.activationId);
		expect(connection.consumer.activationId).toBe(host.get('application-slot')!.instanceId);
		expect(connection.provider.activationId).toBe(host.get('project-slot')!.instanceId);
		expect(connection.provider.packageId).toBe('@providers/service');
		expect(connection.provider.projectOpeningId).toBe('opening / opaque');
		expect(connection.consumer.projectOpeningId).toBeNull();
		for (const value of [
			context,
			context.apis,
			context.identity,
			connection,
			connection.provider,
		]) {
			expect(Object.isFrozen(value)).toBe(true);
		}
		const sibling = apiConsumer(host, false, 'sibling', 'project-slot');
		host.activate('sibling');
		expect(sibling.api).not.toBe(first);
		host.dispose();
		expect(() => first.read()).toThrow('revoked');
	});

	it.each([
		'data',
		'accessor',
		'symbol',
		'class',
		'inherited',
		'then',
		'null',
		'function',
		'async',
	])('attributes invalid %s factory shape to provider without disabling it', async (shape) => {
		const host = new CommandComponentHost();
		const cleanup = vi.fn();
		const getter = vi.fn();
		host.register(
			apiProvider(((connection: ComponentApiConnection) => {
				connection.own(cleanup);
				switch (shape) {
					case 'data':
						return { value: 1 };
					case 'accessor':
						return Object.defineProperty({}, 'read', { get: getter });
					case 'symbol':
						return { [Symbol()]: () => 1 };
					case 'class':
						return new (class {
							read() {
								return 1;
							}
						})();
					case 'inherited':
						return Object.create({ read: () => 1 });
					case 'then':
						return { then: () => undefined };
					case 'null':
						return null;
					case 'function':
						return () => 1;
					default:
						return Promise.reject(new Error('private async source'));
				}
			}) as never),
		);
		const consumer = apiConsumer(host);
		host.activate('consumer');
		expect(() => consumer.api).toThrow();
		await flush();
		expect(getter).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(host.get('provider')!.errors).toContain('api-factory-failed');
		expect(host.get('consumer')!.errors).toContain('api-resolution-failed');
		expect(host.get('provider')!.status).toBe('active');
		expect(JSON.stringify(host.list())).not.toContain('private async');
		host.dispose();
	});

	it('permits null-prototype methods and does not impose a method count cap', () => {
		const host = new CommandComponentHost();
		host.register(
			apiProvider(() =>
				Object.assign(
					Object.create(null),
					Object.fromEntries(
						Array.from({ length: 100 }, (_, index) => ['method' + index, () => index]),
					),
					{ read: () => 100 },
				),
			),
		);
		const consumer = apiConsumer(host);
		host.activate('consumer');
		expect(consumer.api!.read()).toBe(100);
		expect(Object.keys(consumer.api!)).toHaveLength(101);
		host.dispose();
	});

	it('owns reverse/idempotent/late cleanup, guards receiver and arguments, and attributes cleanup to provider', () => {
		const host = new CommandComponentHost();
		const events: string[] = [];
		let connection!: ComponentApiConnection;
		let guard!: (this: { value: number }, increment: number) => number | undefined;
		host.register(
			apiProvider((value) => {
				connection = value;
				const early = value.own(() => {
					events.push('early');
				});
				early();
				early();
				value.own(() => {
					events.push('first');
					expect(() => host.activate('provider')).toThrow('busy');
				});
				value.own(() => {
					events.push('second');
					throw new Error('private cleanup source');
				});
				guard = value.guard(function (this: { value: number }, increment: number) {
					return this.value + increment;
				});
				return { read: () => 1 };
			}),
		);
		const consumer = apiConsumer(host);
		host.activate('consumer');
		const facade = consumer.api!;
		expect(guard.call({ value: 2 }, 3)).toBe(5);
		connection.reportError(new Error('private mediated source'));
		expect(host.get('consumer')!.errors).toContain('api-provider-reported');
		host.deactivate('consumer');
		expect(connection.signal.aborted).toBe(true);
		expect(() => facade.read()).toThrow('revoked');
		expect(guard.call({ value: 2 }, 3)).toBeUndefined();
		connection.own(() => {
			events.push('late');
		});
		expect(events).toEqual(['early', 'second', 'first', 'late']);
		expect(host.get('provider')!.errors).toContain('api-cleanup-failed');
		expect(host.get('consumer')!.errors).not.toContain('api-cleanup-failed');
		expect(host.get('provider')!.status).toBe('active');
		host.activate('consumer');
		connection.reportError(new Error('stale'));
		expect(host.get('consumer')!.errors).toEqual([]);
		host.dispose();
	});

	it('pins aliases to explicit namespace and project slots without choosing by registration order', () => {
		const host = new CommandComponentHost();
		const connections: ComponentApiConnection[] = [];
		for (const [slot, packageId, opening] of [
			['first', '@other/service', 'opening-one'],
			['second', '@wanted/service', 'opening-two'],
			['third', '@wanted/service', 'opening-three'],
		]) {
			host.register(
				apiProvider(
					(connection) => {
						connections.push(connection);
						return { read: () => slot };
					},
					slot,
					{ identity: { packageId, componentId: 'same-component', projectOpeningId: opening } },
				),
			);
			host.activate(slot);
		}
		let context!: CommandContext;
		host.register(
			descriptor(
				'opaque-consumer-slot',
				(value) => {
					context = value;
				},
				{
					identity: {
						packageId: 'consumer',
						componentId: 'project',
						projectOpeningId: 'opening-two',
					},
					dependencies: [requirement('second')],
				},
			),
		);
		host.activate('opaque-consumer-slot');
		expect(context.apis.get('service', api)!.read()).toBe('second');
		expect(connections).toHaveLength(1);
		expect(connections[0].provider.packageId).toBe('@wanted/service');
		expect(connections[0].provider.projectOpeningId).toBe('opening-two');
		expect(connections[0].consumer.projectOpeningId).toBe('opening-two');
		host.dispose();
	});

	it('prevents stale reports from either endpoint targeting replacements and ignores stale cleanup attribution', () => {
		const host = new CommandComponentHost();
		const connections: ComponentApiConnection[] = [];
		host.register(
			apiProvider((connection) => {
				connections.push(connection);
				return { read: () => 1 };
			}),
		);
		const consumer = apiConsumer(host, true);
		host.activate('provider');
		host.activate('consumer');
		void consumer.api;
		host.deactivate('provider');
		host.activate('provider');
		void consumer.api;
		connections[0].reportError(new Error('old provider'));
		expect(host.get('consumer')!.errors).toEqual([]);
		connections[0].own(() => {
			throw new Error('old cleanup');
		});
		expect(host.get('provider')!.errors).toEqual([]);
		connections[1].reportError(new Error('live'));
		expect(host.get('consumer')!.errors).toEqual(['api-provider-reported']);
		host.deactivate('consumer');
		host.activate('consumer');
		connections[1].reportError(new Error('old consumer'));
		expect(host.get('consumer')!.errors).toEqual([]);
		host.dispose();
	});
});
