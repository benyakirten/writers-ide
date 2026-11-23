import { describe, expect, it, vi } from 'vitest';
import { CommandComponentHost } from './command-component-host';
import type { CommandContext } from './command-component-model';
import {
	available,
	declaration,
	dependency,
	descriptor,
	execute,
	publish,
} from './command-component-fixture';
import { api, api2, apiConsumer, apiProvider, requirement } from './component-api-fixture';

describe('shared API and command activation', () => {
	it.each([
		'missing-api',
		'missing-command',
		'duplicate',
		'undeclared',
		'mismatch',
		'malformed',
		'factory-not-function',
		'throw',
	])('rolls back both publication kinds after %s, even if the author catches errors', (failure) => {
		const host = new CommandComponentHost();
		const observer = apiConsumer(host, true);
		host.activate('consumer');
		const events: unknown[] = [];
		observer.context.apis.subscribe('service', api, (value) => events.push(value));
		host.register(
			apiProvider(undefined, 'provider', {
				commands: [declaration],
				capabilities: ['contributions.command'],
				activate: (context) => {
					if (failure !== 'missing-command') {
						publish(context);
					}
					if (failure !== 'missing-api' && failure !== 'factory-not-function') {
						context.apis.provide(api, () => ({ read: () => 1 }));
					}
					try {
						if (failure === 'duplicate') {
							context.apis.provide(api, () => ({ read: () => 2 }));
						}
						if (failure === 'undeclared') {
							context.apis.provide({ id: 'undeclared', major: 1 }, () => ({}));
						}
						if (failure === 'mismatch') {
							context.apis.provide(api2, () => ({ read: () => 2 }));
						}
						if (failure === 'malformed') {
							context.apis.provide({ id: ' ', major: 1 }, () => ({}));
						}
						if (failure === 'factory-not-function') {
							context.apis.provide(api, null as never);
						}
					} catch {
						/* Publication failures remain sticky. */
					}
					if (failure === 'throw') {
						throw new Error('private source text');
					}
				},
			}),
		);
		expect(() => host.activate('provider')).toThrow();
		expect(events).toEqual([null]);
		expect(observer.api).toBeNull();
		expect(host.get('provider')!.status).toBe('failed');
		expect(JSON.stringify(host.list())).not.toContain('private source');
		host.dispose();
	});

	it('publishes both kinds atomically and supports API lookup and commands during consumer setup', async () => {
		const host = new CommandComponentHost();
		const order: string[] = [];
		host.register(
			apiProvider(undefined, 'provider', {
				commands: [declaration],
				capabilities: ['contributions.command'],
				activate: (context) => {
					order.push('provider');
					publish(context);
					context.apis.provide(api, () => ({ read: () => 'ready' }));
				},
			}),
		);
		let context!: CommandContext;
		host.register(
			descriptor(
				'consumer',
				(value) => {
					context = value;
					order.push('consumer');
					expect(value.apis.get('analysis', api)!.read()).toBe('ready');
					expect(available(value.commands)).toBe(true);
				},
				{ dependencies: [{ ...dependency(), apis: [api] }] },
			),
		);
		host.activate('consumer');
		expect(order).toEqual(['provider', 'consumer']);
		expect(await execute(context.commands, 42)).toBe(42);
		host.dispose();
	});

	it('checks command and API compatibility together without discovering another slot', () => {
		const host = new CommandComponentHost();
		const factory = vi.fn(() => ({ read: () => 1 }));
		host.register(apiProvider(factory, 'wrong-slot'));
		host.register(apiProvider(factory));
		const consumer = apiConsumer(host, true, 'consumer', 'provider');
		host.activate('wrong-slot');
		host.activate('consumer');
		expect(consumer.api).toBeNull();
		expect(() => consumer.context.apis.get('wrong-slot', api)).toThrow('Undeclared');
		expect(() =>
			consumer.context.apis.get('service', { ...api, id: api.id.toLowerCase() }),
		).toThrow('Undeclared');
		expect(() => consumer.context.apis.get('service', api2)).toThrow('Undeclared');
		expect(factory).not.toHaveBeenCalled();
		host.dispose();
	});

	it('optional mixed dependencies are unavailable when either declaration is incompatible', () => {
		const host = new CommandComponentHost();
		host.register(apiProvider());
		host.activate('provider');
		let context!: CommandContext;
		host.register(
			descriptor(
				'consumer',
				(value) => {
					context = value;
				},
				{
					dependencies: [{ ...dependency('provider', true), apis: [api] }],
				},
			),
		);
		host.activate('consumer');
		expect(context.apis.get('analysis', api)).toBeNull();
		expect(available(context.commands)).toBe(false);
		host.dispose();
	});

	it('revokes failed consumer connections and commands without failing its healthy provider', async () => {
		const host = new CommandComponentHost();
		const cleanup = vi.fn();
		host.register(
			apiProvider((connection) => {
				connection.own(cleanup);
				return { read: () => 1 };
			}),
		);
		let old!: CommandContext;
		let facade!: { read(): unknown };
		host.register(
			descriptor(
				'consumer',
				(context) => {
					old = context;
					facade = context.apis.get('service', api)!;
					publish(context);
					throw new Error('setup failed');
				},
				{
					dependencies: [requirement()],
					commands: [declaration],
					capabilities: ['contributions.command'],
				},
			),
		);
		expect(() => host.activate('consumer')).toThrow('setup failed');
		expect(old.signal.aborted).toBe(true);
		expect(() => facade.read()).toThrow('revoked');
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(host.get('provider')!.status).toBe('active');
		host.dispose();
	});

	it('uses API-only and mixed required edges for cascades and rejects required cycles before setup', () => {
		const host = new CommandComponentHost();
		host.register(apiProvider());
		apiConsumer(host);
		host.register(
			descriptor(
				'leaf',
				(context) => {
					publish(context);
				},
				{
					dependencies: [{ alias: 'middle', providerSlot: 'consumer', commands: [] }],
					commands: [declaration],
					capabilities: ['contributions.command'],
				},
			),
		);
		host.register(descriptor('last', undefined, { dependencies: [dependency('leaf')] }));
		host.activate('last');
		expect(host.planDeactivation('provider')).toEqual(['last', 'leaf', 'consumer', 'provider']);
		expect(() => host.deactivate('provider')).toThrow('cascade');
		host.deactivate('provider', { cascade: true });
		expect(host.list().every((entry) => entry.status === 'disabled')).toBe(true);
		host.dispose();
		const cycle = new CommandComponentHost();
		const callback = vi.fn();
		for (const [id, target] of [
			['a', 'b'],
			['b', 'a'],
		]) {
			cycle.register(
				apiProvider(undefined, id, { activate: callback, dependencies: [requirement(target)] }),
			);
		}
		expect(() => cycle.activate('a')).toThrow('cycle');
		expect(callback).not.toHaveBeenCalled();
		cycle.dispose();
	});

	it('supports optional cycles and availability transitions without enabling optional peers', () => {
		const host = new CommandComponentHost();
		const events: unknown[] = [];
		let a!: CommandContext;
		host.register(
			apiProvider(undefined, 'a', {
				dependencies: [requirement('b', true)],
				activate: (context) => {
					a = context;
					context.apis.provide(api, () => ({ read: () => 'a' }));
					context.apis.subscribe('service', api, (value) => events.push(value));
				},
			}),
		);
		host.register(
			apiProvider(() => ({ read: () => 'b' }), 'b', { dependencies: [requirement('a', true)] }),
		);
		host.activate('a');
		expect(host.get('b')!.status).toBe('disabled');
		expect(events).toEqual([null]);
		host.activate('b');
		const first = a.apis.get('service', api)!;
		expect(events).toEqual([null, first]);
		host.deactivate('b');
		expect(events).toEqual([null, first, null]);
		expect(() => first.read()).toThrow('revoked');
		host.activate('b');
		const second = a.apis.get('service', api)!;
		expect(second).not.toBe(first);
		expect(events).toEqual([null, first, null, second]);
		host.dispose();
	});

	it('rejects late factories and keeps old contexts dead after replacement', () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		host.register(
			apiProvider(undefined, 'provider', {
				activate: (value) => {
					context = value;
					value.apis.provide(api, () => ({ read: () => 1 }));
				},
			}),
		);
		host.activate('provider');
		const old = context;
		expect(() => old.apis.provide(api, () => ({ read: () => 2 }))).toThrow('synchronous');
		host.deactivate('provider');
		host.activate('provider');
		expect(context.identity.activationId).not.toBe(old.identity.activationId);
		expect(() => old.apis.provide(api, () => ({ read: () => 3 }))).toThrow();
		expect(() => old.apis.get('service', api)).toThrow('revoked');
		expect(host.get('provider')!.errors).toEqual([]);
		host.dispose();
	});
});
