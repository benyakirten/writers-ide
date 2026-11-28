import { describe, expect, it, vi } from 'vitest';
import {
	definePluginApi,
	type BundledPlugin,
	type Dispose,
	type PluginApiConnection,
	type PluginContext,
	type PluginDependency,
	type PluginManifest,
} from '@writers-ide/plugins';

import { PluginHost } from './plugin-host';

interface ValueApi {
	read(): string;
}
const valueApi = definePluginApi<ValueApi>({ id: 'test.value', major: 1 });
const v2 = definePluginApi<ValueApi>({ id: 'test.value', major: 2 });
const dependency = (provider = 'provider', optional = false): PluginDependency => ({
	provider,
	api: valueApi.id,
	major: valueApi.major,
	optional,
});

function plugin(
	id: string,
	activate: BundledPlugin<string>['activate'] = () => {},
	metadata: Partial<Pick<PluginManifest, 'provides' | 'dependencies'>> = {},
): BundledPlugin<string> {
	return {
		manifest: {
			id,
			version: '1',
			apiVersion: 1,
			name: id,
			description: id,
			capabilities: [],
			...metadata,
		},
		activate,
	};
}

function setup() {
	const register = vi.fn(() => () => {});
	const host = new PluginHost<string>({
		registries: { toolbar: { register }, view: { register }, command: { register } },
	});
	const contexts = new Map<string, PluginContext<string>>();
	const provider = (
		id = 'provider',
		factory: (connection: PluginApiConnection) => ValueApi = () => ({ read: () => id }),
	) => {
		host.register(
			plugin(
				id,
				(context) => {
					contexts.set(id, context);
					context.apis.provide(valueApi, factory);
				},
				{ provides: [valueApi] },
			),
		);
	};
	const consumer = (
		id = 'consumer',
		dependencies = [dependency()],
		activate?: BundledPlugin<string>['activate'],
	) => {
		host.register(
			plugin(
				id,
				(context) => {
					contexts.set(id, context);
					return activate?.(context);
				},
				{ dependencies },
			),
		);
	};
	return { host, contexts, provider, consumer };
}

describe('plugin dependency graph', () => {
	it('resolves required providers independent of registration order and publishes frozen metadata', () => {
		const { host, consumer, provider, contexts } = setup();
		consumer();
		expect(host.get('consumer')?.dependencies[0].status).toBe('missing');
		provider();
		expect(host.get('consumer')?.dependencies[0].status).toBe('inactive');
		expect(host.get('provider')?.providers).toEqual([]);
		expect(host.activate('consumer').status).toBe('active');
		expect(contexts.get('consumer')!.apis.get('provider', valueApi)!.read()).toBe('provider');
		const info = host.get('consumer')!;
		expect(info.dependencies).toEqual([{ ...dependency(), status: 'available' }]);
		expect(Object.isFrozen(info.dependencies)).toBe(true);
		expect(Object.isFrozen(info.dependencies[0])).toBe(true);
		expect(Object.isFrozen(host.get('provider')!.providers)).toBe(true);
		expect(host.get('provider')!.providers).toEqual([valueApi]);
	});

	it('preflights the whole graph before activating any provider', () => {
		const { host, consumer, provider } = setup();
		provider();
		consumer('consumer', [dependency(), dependency('absent')]);
		const info = host.activate('consumer');
		expect(info.status).toBe('failed');
		expect(info.errors).toEqual([
			{ phase: 'dependency', message: expect.stringContaining('absent/test.value@1 is missing') },
		]);
		expect(host.get('provider')?.status).toBe('disabled');
	});

	it('requires the explicit owner and exact major, without selecting a different provider', () => {
		const { host, consumer, provider } = setup();
		provider('other');
		host.register(plugin('provider', () => {}, { provides: [v2] }));
		consumer();
		const info = host.activate('consumer');
		expect(info.dependencies[0].status).toBe('incompatible');
		expect(info.errors[0]).toEqual({
			phase: 'dependency',
			message: expect.stringContaining('provider/test.value@1 is incompatible'),
		});
		expect(host.get('other')?.status).toBe('disabled');
	});

	it('rejects required cycles with their complete path', () => {
		const { host } = setup();
		for (const [id, next] of [
			['a', 'b'],
			['b', 'c'],
			['c', 'a'],
		]) {
			host.register(
				plugin(id, () => {}, { provides: [valueApi], dependencies: [dependency(next)] }),
			);
		}
		expect(host.activate('a').errors[0].message).toContain('a -> b -> c -> a');
		expect(host.get('b')?.status).toBe('disabled');
	});

	it('allows optional cycles and never auto-activates optional providers', () => {
		const { host } = setup();
		for (const [id, next] of [
			['a', 'b'],
			['b', 'a'],
		]) {
			host.register(
				plugin(id, (context) => context.apis.provide(valueApi, () => ({ read: () => id })), {
					provides: [valueApi],
					dependencies: [dependency(next, true)],
				}),
			);
		}
		expect(host.activate('a').status).toBe('active');
		expect(host.get('b')?.status).toBe('disabled');
		expect(host.activate('b').status).toBe('active');
		expect(host.deactivate('a').status).toBe('disabled');
		expect(host.get('b')?.status).toBe('active');
	});

	it('allows missing and incompatible optional dependencies to return null', () => {
		const { host, consumer, contexts } = setup();
		consumer('consumer', [dependency('missing', true), dependency('wrong', true)]);
		host.register(plugin('wrong', () => {}, { provides: [v2] }));
		expect(host.activate('consumer').status).toBe('active');
		const apis = contexts.get('consumer')!.apis;
		expect(apis.get('missing', valueApi)).toBeNull();
		expect(apis.get('wrong', valueApi)).toBeNull();
		expect(host.get('wrong')?.status).toBe('disabled');
	});

	it('keeps newly activated and already-active unrelated providers after consumer failure', () => {
		const { host, provider, consumer } = setup();
		provider();
		provider('unrelated');
		host.activate('unrelated');
		consumer('consumer', [dependency()], () => {
			throw new Error('consumer failed');
		});
		expect(host.activate('consumer').status).toBe('failed');
		expect(host.get('provider')?.status).toBe('active');
		expect(host.get('unrelated')?.status).toBe('active');
	});

	it('rolls back a provider that did not publish all declared APIs and does not activate its consumer', () => {
		const { host, consumer } = setup();
		const cleanup = vi.fn();
		const activate = vi.fn();
		host.register(
			plugin(
				'provider',
				(context) => {
					context.own(cleanup);
				},
				{ provides: [valueApi] },
			),
		);
		consumer('consumer', [dependency()], activate);
		expect(host.activate('consumer').errors[0].phase).toBe('dependency');
		expect(host.get('provider')?.errors[0].message).toContain('Declared API not published');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(activate).not.toHaveBeenCalled();
	});

	it('plans only active required transitive dependents, and refuses cascade without consent', () => {
		const { host, provider, consumer } = setup();
		provider();
		host.register(
			plugin(
				'middle',
				(context) => context.apis.provide(valueApi, () => ({ read: () => 'middle' })),
				{ provides: [valueApi], dependencies: [dependency()] },
			),
		);
		consumer('leaf', [dependency('middle')]);
		consumer('optional', [dependency('provider', true)]);
		consumer('disabled');
		host.activate('leaf');
		host.activate('optional');
		const plan = host.planDeactivation('provider');
		expect(plan).toEqual(['leaf', 'middle', 'provider']);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(() => host.deactivate('provider')).toThrow('cascade consent required');
		expect(host.get('leaf')?.status).toBe('active');
		expect(host.deactivate('provider', { cascade: true }).status).toBe('disabled');
		expect(host.get('leaf')?.status).toBe('disabled');
		expect(host.get('middle')?.status).toBe('disabled');
		expect(host.get('optional')?.status).toBe('active');
	});

	it('cleans up dependent-first while leaving the provider callable until dependent teardown begins', () => {
		const { host, provider, contexts } = setup();
		const order: string[] = [];
		let incoming!: ValueApi;
		provider('provider', (connection) => {
			connection.own(() => order.push('connection'));
			return { read: () => 'live' };
		});
		host.register(
			plugin(
				'middle',
				(context) => {
					contexts.set('middle', context);
					incoming = context.apis.get('provider', valueApi)!;
					context.apis.provide(valueApi, () => ({ read: () => incoming.read() }));
					context.own(() => {
						expect(() => incoming.read()).toThrow('revoked');
						order.push('middle');
					});
				},
				{ provides: [valueApi], dependencies: [dependency()] },
			),
		);
		host.register(
			plugin(
				'leaf',
				(context) => {
					context.own(() => {
						expect(incoming.read()).toBe('live');
						order.push('leaf');
					});
				},
				{ dependencies: [dependency('middle')] },
			),
		);
		host.activate('leaf');
		contexts.get('provider')!.own(() => order.push('provider'));

		contexts.get('middle')!.own(() => {
			expect(contexts.get('provider')!.signal.aborted).toBe(false);
		});
		host.deactivate('provider', { cascade: true });
		expect(order).toEqual(['leaf', 'connection', 'middle', 'provider']);
		expect(host.get('leaf')?.errors).toEqual([]);
		expect(host.get('middle')?.errors).toEqual([]);
	});

	it('serializes activation and cascade changes without changing ordinary per-entry registry reentrancy', () => {
		const { host, provider, consumer, contexts } = setup();
		provider('other');
		provider();
		consumer('consumer', [dependency()], (context) => {
			expect(() => host.deactivate('provider')).toThrow('busy');
			expect(() => host.activate('other')).toThrow('busy');
			expect(() => host.register(plugin('late'))).toThrow('busy');
			context.own(() => {
				expect(() => host.activate('other')).toThrow('busy');
			});
		});
		host.activate('consumer');
		host.deactivate('provider', { cascade: true });
		expect(contexts.get('consumer')!.signal.aborted).toBe(true);
		expect(host.get('other')?.status).toBe('disabled');
		expect(host.get('consumer')?.errors).toEqual([]);
	});

	it('deduplicates a diamond cascade and attempts remaining cleanups after a dependent fails', () => {
		const { host, provider } = setup();
		provider();
		const order: string[] = [];
		for (const id of ['left', 'right']) {
			host.register(
				plugin(
					id,
					(context) => {
						context.apis.provide(valueApi, () => ({ read: () => id }));
						context.own(() => {
							order.push(id);
							if (id === 'left') {
								throw new Error('left cleanup failed');
							}
						});
					},
					{ provides: [valueApi], dependencies: [dependency()] },
				),
			);
		}
		host.register(
			plugin(
				'leaf',
				(context) => {
					context.own(() => {
						order.push('leaf');
					});
				},
				{
					dependencies: [dependency('left'), dependency('right')],
				},
			),
		);
		host.activate('leaf');
		expect(host.planDeactivation('provider')).toEqual(['leaf', 'left', 'right', 'provider']);
		expect(host.deactivate('provider', { cascade: true }).status).toBe('disabled');
		expect(order).toEqual(['leaf', 'left', 'right']);
		expect(host.get('left')?.status).toBe('failed');
		expect(host.get('right')?.status).toBe('disabled');
	});

	it('allows a mixed cycle whose optional edge is not part of required resolution', () => {
		const { host } = setup();
		const seen: (ValueApi | null)[] = [];
		host.register(
			plugin(
				'a',
				(context) => {
					context.apis.provide(valueApi, () => ({ read: () => 'a' }));
					expect(context.apis.get('b', valueApi)!.read()).toBe('b');
				},
				{ provides: [valueApi], dependencies: [dependency('b')] },
			),
		);
		host.register(
			plugin(
				'b',
				(context) => {
					context.apis.provide(valueApi, () => ({ read: () => 'b' }));
					context.apis.subscribe('a', valueApi, (api) => seen.push(api));
				},
				{ provides: [valueApi], dependencies: [dependency('a', true)] },
			),
		);
		expect(host.activate('a').status).toBe('active');
		expect(seen[0]).toBeNull();
		expect(seen[1]!.read()).toBe('a');
		expect(host.deactivate('b', { cascade: true }).status).toBe('disabled');
		expect(seen[2]).toBeNull();
	});
});

describe('plugin API connections', () => {
	it('supports explicit parallel majors and keeps their factory caches separate', () => {
		const { host, consumer, contexts } = setup();
		host.register(
			plugin(
				'provider',
				(context) => {
					context.apis.provide(valueApi, () => ({ read: () => 'one' }));
					context.apis.provide(v2, () => ({ read: () => 'two' }));
				},
				{ provides: [valueApi, v2] },
			),
		);
		consumer('consumer', [dependency(), { ...dependency(), major: 2 }]);
		expect(host.activate('consumer').status).toBe('active');
		const apis = contexts.get('consumer')!.apis;
		expect(apis.get('provider', valueApi)!.read()).toBe('one');
		expect(apis.get('provider', v2)!.read()).toBe('two');
		expect(apis.get('provider', valueApi)).not.toBe(apis.get('provider', v2));
		expect(host.get('provider')?.providers).toEqual([valueApi, v2]);
	});

	it('returns owned cleanup handles that can be called after facade revocation without reviving late callbacks', () => {
		const events = definePluginApi<{ listen(callback: (value: number) => void): Dispose }>({
			id: 'events',
			major: 1,
		});
		const { host } = setup();
		const callbacks: ((value: number) => void)[] = [];
		const cleanup = vi.fn();
		const listener = vi.fn();
		let release!: Dispose;
		host.register(
			plugin(
				'provider',
				(context) => {
					context.apis.provide(events, (connection) => ({
						listen(callback) {
							callbacks.push(connection.guard(callback));
							return connection.own(cleanup);
						},
					}));
				},
				{ provides: [events] },
			),
		);
		host.register(
			plugin(
				'consumer',
				(context) => {
					const api = context.apis.get('provider', events)!;
					release = context.own(api.listen(listener));
				},
				{ dependencies: [{ provider: 'provider', api: events.id, major: 1 }] },
			),
		);
		host.activate('consumer');
		callbacks[0](1);
		expect(listener).toHaveBeenCalledWith(1);
		host.deactivate('consumer');
		callbacks[0](2);
		release();
		expect(cleanup).toHaveBeenCalledOnce();
		host.activate('consumer');
		callbacks[0](3);
		callbacks[1](4);
		expect(listener.mock.calls).toEqual([[1], [4]]);
		host.deactivate('provider', { cascade: true });
		callbacks[1](5);
		expect(listener).toHaveBeenCalledTimes(2);
		expect(cleanup).toHaveBeenCalledTimes(2);
		expect(host.get('consumer')?.errors).toEqual([]);
	});
	it('caches per consumer and provider activation, binds methods, and revokes both endpoints permanently', () => {
		const { host, provider, consumer, contexts } = setup();
		const factory = vi.fn(() => {
			const implementation: ValueApi = {
				read() {
					return this === implementation ? 'bound' : 'wrong';
				},
			};
			return implementation;
		});
		provider('provider', factory);
		consumer('a', [dependency('provider', true)]);
		consumer('b', [dependency('provider', true)]);
		host.activate('a');
		host.activate('b');
		host.activate('provider');
		const a = contexts.get('a')!.apis;
		const b = contexts.get('b')!.apis;
		const old = a.get('provider', valueApi)!;
		const read = old.read;
		expect(read()).toBe('bound');
		expect(a.get('provider', valueApi)).toBe(old);
		expect(b.get('provider', valueApi)).not.toBe(old);
		expect(factory).toHaveBeenCalledTimes(2);
		expect(Object.isFrozen(old)).toBe(true);
		host.deactivate('provider');
		expect(() => read()).toThrow('revoked');
		host.activate('provider');
		const fresh = a.get('provider', valueApi)!;
		expect(fresh).not.toBe(old);
		expect(() => old.read()).toThrow('revoked');
		host.deactivate('a');
		expect(() => fresh.read()).toThrow('revoked');
		host.activate('a');
		expect(() => a.get('provider', valueApi)).toThrow('revoked');
		expect(contexts.get('a')!.apis.get('provider', valueApi)).not.toBe(fresh);
	});

	it('owns connection resources, permits idempotent early cleanup after revocation, and guards late callbacks', () => {
		const { host, provider, consumer, contexts } = setup();
		const callback = vi.fn((value: number) => value + 1);
		const cleanup = vi.fn();
		let saved!: PluginApiConnection;
		let guarded!: (value: number) => number | undefined;
		let release!: Dispose;
		provider('provider', (connection) => {
			saved = connection;
			guarded = connection.guard(callback);
			release = connection.own(cleanup);
			return { read: () => connection.consumerId };
		});
		consumer();
		host.activate('consumer');
		expect(contexts.get('consumer')!.apis.get('provider', valueApi)!.read()).toBe('consumer');
		expect(guarded(4)).toBe(5);
		host.deactivate('consumer');
		expect(saved.signal.aborted).toBe(true);
		expect(guarded(8)).toBeUndefined();
		expect(callback).toHaveBeenCalledOnce();
		release();
		release();
		expect(cleanup).toHaveBeenCalledOnce();
		const late = vi.fn();
		saved.own(late)();
		expect(late).toHaveBeenCalledOnce();
	});

	it('rolls back factory resources on throw, attributes failures, and can retry the factory', () => {
		const { host, provider, consumer, contexts } = setup();
		const cleanup = vi.fn();
		let fail = true;
		provider('provider', (connection) => {
			connection.own(cleanup);
			if (fail) {
				throw new Error('factory failed');
			}
			return { read: () => 'okay' };
		});
		consumer();
		host.activate('consumer');
		const apis = contexts.get('consumer')!.apis;
		expect(() => apis.get('provider', valueApi)).toThrow('factory failed');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.get('provider')?.errors[0]).toEqual({
			phase: 'provider',
			message: 'factory failed',
		});
		fail = false;
		expect(apis.get('provider', valueApi)!.read()).toBe('okay');
		host.deactivate('consumer');
		expect(cleanup).toHaveBeenCalledTimes(2);
		expect(host.deactivate('provider').status).toBe('disabled');
	});

	it('attempts all connection cleanups and revokes before provider cleanup', () => {
		const { host, provider, consumer, contexts } = setup();
		const order: string[] = [];
		provider('provider', (connection) => {
			connection.own(() => {
				expect(connection.signal.aborted).toBe(true);
				order.push('first');
			});
			connection.own(() => {
				order.push('second');
				throw new Error('cleanup failed');
			});
			return { read: () => 'live' };
		});
		consumer('consumer', [dependency('provider', true)]);
		host.activate('consumer');
		host.activate('provider');
		const api = contexts.get('consumer')!.apis.get('provider', valueApi)!;
		contexts.get('provider')!.own(() => {
			expect(() => api.read()).toThrow('revoked');
			order.push('provider');
		});
		expect(host.deactivate('provider').status).toBe('disabled');
		expect(order).toEqual(['second', 'first', 'provider']);
		expect(host.get('provider')?.errors).toContainEqual({
			phase: 'provider',
			message: 'cleanup failed',
		});
	});

	it('rolls back connections, owned subscriptions and tasks when consumer activation fails', async () => {
		const { host, provider, consumer } = setup();
		const cleanup = vi.fn();
		const notifications = vi.fn();
		let signal!: AbortSignal;
		let result!: Promise<unknown>;
		provider('provider', (connection) => {
			connection.own(cleanup);
			return { read: () => 'value' };
		});
		consumer('consumer', [dependency()], (context) => {
			context.apis.subscribe('provider', valueApi, notifications);
			const task = context.tasks.async({
				key: 'pending',
				label: 'Pending',
				run: async ({ signal: taskSignal }) => {
					signal = taskSignal;
					await new Promise(() => {});
				},
			});
			result = task.result;
			throw new Error('activation failed');
		});
		expect(host.activate('consumer').status).toBe('failed');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(signal.aborted).toBe(true);
		expect(await result).toMatchObject({ status: 'cancelled' });
		host.deactivate('provider');
		host.activate('provider');
		expect(notifications).toHaveBeenCalledOnce();
	});

	it('rejects reentrant factories and cleans up when factory revokes its own endpoint', () => {
		const { host, provider, consumer, contexts } = setup();
		const cleanup = vi.fn();
		let revoke = false;
		provider('provider', (connection) => {
			connection.own(cleanup);
			if (revoke) {
				host.deactivate('consumer');
			} else {
				contexts.get('consumer')!.apis.get('provider', valueApi);
			}
			return { read: () => 'value' };
		});
		consumer();
		host.activate('consumer');
		const apis = contexts.get('consumer')!.apis;
		expect(() => apis.get('provider', valueApi)).toThrow('Reentrant API factory');
		expect(cleanup).toHaveBeenCalledOnce();
		revoke = true;
		expect(() => apis.get('provider', valueApi)).toThrow('revoked during factory');
		expect(cleanup).toHaveBeenCalledTimes(2);
	});

	it.each([
		[
			'accessor',
			() => ({
				get read() {
					throw new Error('must not evaluate accessor');
				},
			}),
		],
		['data', () => ({ read: 'not a method' })],
		['symbol', () => ({ [Symbol('method')]: () => {} })],
		['thenable', () => ({ then: () => {} })],
		['promise', () => Promise.resolve({ read: () => 'async' })],
		['rejected promise', () => Promise.reject(new Error('async factory rejected'))],
		['prototype', () => Object.create({ read: () => 'inherited' })],
		['null', () => null],
	])('rejects %s facades without invoking accessors and rolls back resources', (_label, create) => {
		const { host, provider, consumer, contexts } = setup();
		const cleanup = vi.fn();
		provider('provider', (connection) => {
			connection.own(cleanup);
			return create() as ValueApi;
		});
		consumer();
		host.activate('consumer');
		expect(() => contexts.get('consumer')!.apis.get('provider', valueApi)).toThrow(/facade/);
		expect(cleanup).toHaveBeenCalledOnce();
	});
});

describe('plugin provider subscriptions', () => {
	it('does not announce a published API until provider activation finishes, and isolates factory failures by consumer', () => {
		const { host, consumer } = setup();
		const cleanup = vi.fn();
		const good = vi.fn();
		consumer('bad', [dependency('provider', true)], (context) => {
			context.apis.subscribe('provider', valueApi, () => {});
		});
		consumer('good', [dependency('provider', true)], (context) => {
			context.apis.subscribe('provider', valueApi, good);
		});
		host.activate('bad');
		host.activate('good');
		host.register(
			plugin(
				'provider',
				(context) => {
					context.apis.provide(valueApi, (connection) => {
						connection.own(cleanup);
						if (connection.consumerId === 'bad') {
							throw new Error('denied');
						}
						return { read: () => 'value' };
					});
					expect(good.mock.calls).toEqual([[null]]);
				},
				{ provides: [valueApi] },
			),
		);
		expect(host.activate('provider').status).toBe('active');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(good.mock.calls[1][0]!.read()).toBe('value');
		expect(host.get('bad')?.status).toBe('active');
		expect(host.get('bad')?.errors[0]).toMatchObject({ phase: 'provider' });
		host.deactivate('provider');
		expect(cleanup).toHaveBeenCalledTimes(2);
		expect(good.mock.calls[2]).toEqual([null]);
	});
	it('delivers immediately and on optional arrival/removal, owns release and never resurrects stale facades', () => {
		const { host, consumer, provider, contexts } = setup();
		const values: (ValueApi | null)[] = [];
		let release!: Dispose;
		consumer('consumer', [dependency('provider', true)], (context) => {
			release = context.apis.subscribe('provider', valueApi, (api) => values.push(api));
		});
		host.activate('consumer');
		expect(values).toEqual([null]);
		provider();
		expect(values).toEqual([null]);
		host.activate('provider');
		const old = values[1]!;
		expect(old.read()).toBe('provider');
		expect(contexts.get('consumer')!.apis.get('provider', valueApi)).toBe(old);
		host.deactivate('provider');
		expect(values).toEqual([null, old, null]);
		expect(() => old.read()).toThrow('revoked');
		host.activate('provider');
		expect(values[3]).not.toBe(old);
		release();
		release();
		host.deactivate('provider');
		expect(values).toHaveLength(4);
	});

	it('isolates observer failures, attributes them and blocks notification-driven graph changes', () => {
		const { host, consumer, provider, contexts } = setup();
		const successful = vi.fn();
		consumer('consumer', [dependency('provider', true)], (context) => {
			context.apis.subscribe('provider', valueApi, () => {
				throw new Error('observer failed');
			});
			context.apis.subscribe('provider', valueApi, () => {
				expect(() => host.activate('provider')).toThrow(/notifying/);
				expect(() => host.deactivate('consumer')).toThrow(/notifying/);
				expect(() => host.register(plugin('new'))).toThrow(/notifying/);
			});
			context.apis.subscribe('provider', valueApi, successful);
		});
		provider();
		expect(host.activate('consumer').status).toBe('active');
		host.activate('provider');
		host.deactivate('provider');
		expect(successful).toHaveBeenCalledTimes(3);
		expect(host.get('consumer')?.errors).toHaveLength(3);
		expect(
			host.get('consumer')?.errors.filter((error) => error.message.includes('observer failed')),
		).toHaveLength(3);
		expect(host.deactivate('consumer').status).toBe('disabled');
		expect(() =>
			contexts.get('consumer')!.apis.subscribe('provider', valueApi, successful),
		).toThrow('revoked');
		host.activate('provider');
		expect(successful).toHaveBeenCalledTimes(3);
	});

	it('retains independent subscriptions for identical callbacks and honors removal during notification', () => {
		const { host, consumer, provider, contexts } = setup();
		consumer('consumer', [dependency('provider', true)]);
		host.activate('consumer');
		provider();
		const apis = contexts.get('consumer')!.apis;
		const listener = vi.fn();
		const release = apis.subscribe('provider', valueApi, listener);
		apis.subscribe('provider', valueApi, listener);
		expect(listener).toHaveBeenCalledTimes(2);
		release();
		let remove: Dispose = () => {};
		apis.subscribe('provider', valueApi, () => remove());
		const skipped = vi.fn();
		remove = apis.subscribe('provider', valueApi, skipped);
		host.activate('provider');
		expect(listener).toHaveBeenCalledTimes(3);
		expect(skipped).toHaveBeenCalledOnce();
	});
});

describe('plugin API reentrancy regressions', () => {
	it('notifies a failed subscription when an explicit get successfully retries its factory', () => {
		const { host, provider, consumer, contexts } = setup();
		const listener = vi.fn();
		let fail = true;
		provider('provider', () => {
			if (fail) {
				throw new Error('temporarily unavailable');
			}
			return { read: () => 'ready' };
		});
		consumer('consumer', [dependency('provider', true)]);
		host.activate('provider');
		host.activate('consumer');
		const apis = contexts.get('consumer')!.apis;
		apis.subscribe('provider', valueApi, listener);
		expect(listener).not.toHaveBeenCalled();
		fail = false;
		const api = apis.get('provider', valueApi)!;
		expect(listener.mock.calls).toEqual([[api]]);
	});

	it('rejects a facade revoked by reflection reentrancy and cleans up once', () => {
		const { host, provider, consumer, contexts } = setup();
		const cleanup = vi.fn();
		provider('provider', (connection) => {
			connection.own(cleanup);
			return new Proxy(
				{ read: () => 'ready' },
				{
					ownKeys(target) {
						host.deactivate('consumer');
						return Reflect.ownKeys(target);
					},
				},
			);
		});
		consumer();
		host.activate('consumer');
		expect(() => contexts.get('consumer')!.apis.get('provider', valueApi)).toThrow(
			'revoked during factory',
		);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.get('consumer')?.status).toBe('disabled');
	});
	it.each(['consumer', 'provider'])(
		'revokes retained calls when an ordinary method stops the %s',
		(endpoint) => {
			const { host, provider, consumer, contexts } = setup();
			const cleanup = vi.fn();
			const callback = vi.fn();
			let guarded!: () => void;
			provider('provider', (connection) => {
				guarded = connection.guard(callback);
				connection.own(cleanup);
				return {
					read: () => {
						host.deactivate(endpoint);
						guarded();
						return 'in-flight result';
					},
				};
			});
			consumer('consumer', [dependency('provider', true)]);
			host.activate('provider');
			host.activate('consumer');
			const read = contexts.get('consumer')!.apis.get('provider', valueApi)!.read;
			expect(read()).toBe('in-flight result');
			expect(cleanup).toHaveBeenCalledOnce();
			expect(callback).not.toHaveBeenCalled();
			expect(() => read()).toThrow('revoked');
			host.deactivate(endpoint === 'provider' ? 'consumer' : 'provider');
			host.activate('provider');
			host.activate('consumer');
			expect(() => read()).toThrow('revoked');
		},
	);

	it('does not let a required provider stop during consumer activation through an ordinary method', () => {
		const { host, provider, consumer } = setup();
		provider('provider', () => ({
			read: () => {
				expect(() => host.deactivate('provider', { cascade: true })).toThrow('busy');
				return 'still active';
			},
		}));
		consumer('consumer', [dependency()], (context) => {
			expect(context.apis.get('provider', valueApi)!.read()).toBe('still active');
		});
		expect(host.activate('consumer').status).toBe('active');
		expect(host.get('provider')?.status).toBe('active');
	});

	it('delivers a subscription created inside its own factory after construction succeeds', () => {
		const { host, provider, consumer, contexts } = setup();
		const listener = vi.fn();
		const factory = vi.fn(() => {
			contexts.get('consumer')!.apis.subscribe('provider', valueApi, listener);
			return { read: () => 'ready' };
		});
		provider('provider', factory);
		consumer();
		host.activate('consumer');
		const api = contexts.get('consumer')!.apis.get('provider', valueApi)!;
		expect(listener.mock.calls).toEqual([[api]]);
		expect(factory).toHaveBeenCalledOnce();
		expect(host.get('consumer')?.errors).toEqual([]);
		host.deactivate('provider', { cascade: true });
		expect(listener).toHaveBeenCalledOnce();
	});

	it('does not deliver a subscription released by its connection factory', () => {
		const { host, provider, consumer, contexts } = setup();
		const listener = vi.fn();
		provider('provider', () => {
			release();
			return { read: () => 'ready' };
		});
		consumer('consumer', [dependency('provider', true)]);
		host.activate('consumer');
		const release = contexts.get('consumer')!.apis.subscribe('provider', valueApi, listener);
		expect(listener.mock.calls).toEqual([[null]]);
		host.activate('provider');
		expect(listener.mock.calls).toEqual([[null]]);
		host.deactivate('provider');
		expect(listener.mock.calls).toEqual([[null]]);
	});

	it('delivers a deferred factory subscription on a successful retry after rollback', () => {
		const { host, provider, consumer, contexts } = setup();
		const listener = vi.fn();
		const cleanup = vi.fn(() => {
			throw new Error('rollback cleanup failed');
		});
		let first = true;
		provider('provider', (connection) => {
			connection.own(cleanup);
			if (first) {
				first = false;
				contexts.get('consumer')!.apis.subscribe('provider', valueApi, listener);
				throw new Error('factory failed');
			}
			return { read: () => 'ready' };
		});
		consumer();
		host.activate('consumer');
		const apis = contexts.get('consumer')!.apis;
		expect(() => apis.get('provider', valueApi)).toThrow('factory failed');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(listener).not.toHaveBeenCalled();
		const api = apis.get('provider', valueApi)!;
		expect(listener.mock.calls).toEqual([[api]]);
		expect(host.get('provider')?.errors).toEqual(
			expect.arrayContaining([
				{ phase: 'provider', message: 'rollback cleanup failed' },
				{ phase: 'provider', message: 'factory failed' },
			]),
		);
	});
});

describe('plugin contract validation', () => {
	it('creates typed immutable identities and validates major versions', () => {
		expect(Object.isFrozen(valueApi)).toBe(true);
		expect(Object.keys(valueApi)).toEqual(['id', 'major']);
		for (const major of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => definePluginApi({ id: 'api', major })).toThrow('positive safe integer');
		}
		expect(() => definePluginApi({ id: ' ', major: 1 })).toThrow('nonempty');
	});

	it.each([
		{ provides: [{ id: '', major: 1 }] },
		{ provides: [{ id: 'api', major: 0 }] },
		{ provides: [valueApi, valueApi] },
		{ dependencies: [dependency('consumer')] },
		{ dependencies: [dependency(), dependency()] },
		{ dependencies: [{ ...dependency(), major: 1.5 }] },
		{ dependencies: [{ ...dependency(), provider: '' }] },
		{ dependencies: [{ ...dependency(), optional: 'yes' as unknown as boolean }] },
	])('rejects invalid manifests: %j', (metadata) => {
		const { host } = setup();
		expect(() => host.register(plugin('consumer', () => {}, metadata))).toThrow();
	});

	it('copies and freezes declarations without retaining extra authority', () => {
		const { host } = setup();
		const declaration = { ...dependency(), private: () => {} };
		const identity = { id: 'own', major: 1, private: () => {} };
		host.register(
			plugin('consumer', () => {}, { dependencies: [declaration], provides: [identity] }),
		);
		declaration.major = 2;
		identity.major = 2;
		const manifest = host.get('consumer')!.manifest;
		expect(manifest.dependencies).toEqual([dependency()]);
		expect(manifest.provides).toEqual([{ id: 'own', major: 1 }]);
		expect(Object.isFrozen(manifest.dependencies)).toBe(true);
		expect(Object.isFrozen(manifest.dependencies![0])).toBe(true);
		expect(Object.isFrozen(manifest.provides![0])).toBe(true);
	});

	it('exposes only declared dependencies and provides, and forbids publication after activation', () => {
		const { host, provider, consumer, contexts } = setup();
		provider();
		consumer();
		host.activate('consumer');
		const apis = contexts.get('consumer')!.apis;
		expect(() => apis.get('other', valueApi)).toThrow('Undeclared');
		expect(() => apis.get('provider', v2)).toThrow('Undeclared');
		expect(() => apis.subscribe('other', valueApi, () => {})).toThrow('Undeclared');
		expect(() =>
			contexts.get('provider')!.apis.provide(valueApi, () => ({ read: () => '' })),
		).toThrow('during activation');
		host.register(
			plugin('bad', (context) => context.apis.provide(valueApi, () => ({ read: () => '' }))),
		);
		expect(host.activate('bad').errors[0].message).toContain('Undeclared provided API');
		host.register(
			plugin(
				'duplicate',
				(context) => {
					context.apis.provide(valueApi, () => ({ read: () => '' }));
					context.apis.provide(valueApi, () => ({ read: () => '' }));
				},
				{ provides: [valueApi] },
			),
		);
		expect(host.activate('duplicate').errors[0].message).toContain('Duplicate API');
	});
});

describe('authenticated connection error reporting', () => {
	it.each(['consumer', 'provider'] as const)(
		'attributes failures only to the connected consumer and ignores reports after %s revocation',
		(endpoint) => {
			const { host, consumer, provider, contexts } = setup();
			let connection!: PluginApiConnection;
			provider('provider', (value) => {
				connection = value;
				return { read: () => 'ok' };
			});
			consumer('consumer', [dependency('provider', true)]);
			host.activate('provider');
			host.activate('consumer');
			contexts.get('consumer')!.apis.get('provider', valueApi);
			const old = connection;
			old.reportError(new Error('Behavior failed'));
			expect(host.get('consumer')).toMatchObject({
				status: 'active',
				errors: [{ phase: 'provider', message: 'Behavior failed' }],
			});
			expect(host.get('provider')!.errors).toEqual([]);
			host.deactivate(endpoint);
			host.activate(endpoint);
			contexts.get('consumer')!.apis.get('provider', valueApi);
			const before = host.get('consumer')!.errors;
			old.reportError(new Error('Late failure'));
			expect(host.get('consumer')!.errors).toEqual(before);
			expect(connection).not.toBe(old);
			connection.reportError(new Error('Fresh failure'));
			expect(host.get('consumer')!.errors.at(-1)?.message).toBe('Fresh failure');
		},
	);
});
