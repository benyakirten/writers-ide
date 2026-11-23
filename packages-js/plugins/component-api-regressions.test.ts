import { describe, expect, it, vi } from 'vitest';
import { CommandComponentHost } from './command-component-host';
import type { CommandContext } from './command-component-model';
import type { ComponentApiConnection } from './frontend';
import {
	available,
	contract,
	execute,
	declaration,
	dependency,
	descriptor,
	publish,
} from './command-component-fixture';
import { api, apiConsumer, apiProvider } from './component-api-fixture';
import { CommandInvocationError } from './commands';

describe('component API callback and revocation regressions', () => {
	it('rejects reentrant get but defers factory-created subscriptions until the cached facade is ready', () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		const events: unknown[] = [];
		const factory = vi.fn(() => {
			expect(() => context.apis.get('service', api)).toThrow('Reentrant');
			context.apis.subscribe('service', api, (value) => events.push(value));
			expect(events).toEqual([]);
			return { read: () => 1 };
		});
		host.register(apiProvider(factory));
		const consumer = apiConsumer(host, false, 'consumer', 'provider', (value) => {
			context = value;
		});
		host.activate('consumer');
		const facade = consumer.api;
		expect(events).toEqual([facade]);
		expect(factory).toHaveBeenCalledTimes(1);
		host.dispose();
	});

	it('delivers pending factory-created subscriptions on successful retry after failed construction', () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		const events: unknown[] = [];
		let attempts = 0;
		const cleanup = vi.fn();
		host.register(
			apiProvider((connection) => {
				attempts++;
				connection.own(cleanup);
				if (attempts === 1) {
					context.apis.subscribe('service', api, (value) => events.push(value));
					throw new Error('failed first attempt');
				}
				return { read: () => 1 };
			}),
		);
		const consumer = apiConsumer(host, false, 'consumer', 'provider', (value) => {
			context = value;
		});
		host.activate('consumer');
		expect(() => consumer.api).toThrow('first attempt');
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
		const facade = consumer.api;
		expect(events).toEqual([facade]);
		expect(attempts).toBe(2);
		host.dispose();
		expect(cleanup).toHaveBeenCalledTimes(2);
	});

	it.each(['get', 'lifecycle'])(
		'bounds persistent subscription-initiated factory failures and supports a later %s retry',
		(retry) => {
			const host = new CommandComponentHost();
			let context!: CommandContext;
			let attempts = 0;
			let failing = true;
			const cleanup = vi.fn();
			const events: unknown[] = [];
			host.register(
				apiProvider((connection) => {
					attempts++;
					connection.own(cleanup);
					if (failing) {
						// Bound the old broken path too, so a regression fails instead of hanging the runner.
						if (attempts <= 8) {
							context.apis.subscribe('service', api, (value) => events.push(value));
						}
						throw new Error('persistent factory failure');
					}
					return { read: () => 'ready' };
				}),
			);
			apiConsumer(host, false, 'consumer', 'provider', (value) => {
				context = value;
			});
			host.activate('consumer');
			context.apis.subscribe('service', api, (value) => events.push(value));
			expect(attempts).toBe(1);
			expect(cleanup).toHaveBeenCalledTimes(1);
			expect(events).toEqual([]);
			host.register(descriptor('unrelated'));
			host.activate('unrelated');
			expect(attempts).toBe(2);
			expect(cleanup).toHaveBeenCalledTimes(2);
			expect(events).toEqual([]);
			failing = false;
			if (retry === 'get') {
				context.apis.get('service', api);
			} else {
				host.deactivate('unrelated');
			}
			const facade = context.apis.get('service', api)!;
			expect(attempts).toBe(3);
			expect(facade.read()).toBe('ready');
			expect(events).toEqual([facade, facade, facade]);
			host.dispose();
			expect(cleanup).toHaveBeenCalledTimes(3);
		},
	);

	it('serializes self-subscription during initial resolution without recursion or duplicate notifications', () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		const outer: unknown[] = [];
		const inner: unknown[] = [];
		const factory = vi.fn(() => {
			context.apis.subscribe('service', api, (value) => inner.push(value));
			return { read: () => 1 };
		});
		host.register(apiProvider(factory));
		apiConsumer(host, false, 'consumer', 'provider', (value) => {
			context = value;
			value.apis.subscribe('service', api, (facade) => outer.push(facade));
		});
		host.activate('consumer');
		expect(factory).toHaveBeenCalledTimes(1);
		expect(outer).toHaveLength(1);
		expect(inner).toEqual(outer);
		host.dispose();
	});

	it('preserves subscriptions after listener failure and cached connections after early unsubscribe', () => {
		const host = new CommandComponentHost();
		const cleanup = vi.fn();
		host.register(
			apiProvider((connection) => {
				connection.own(cleanup);
				return { read: () => 1 };
			}),
		);
		const consumer = apiConsumer(host, true);
		host.activate('consumer');
		const bad = vi
			.fn((_value: unknown) => undefined)
			.mockImplementationOnce(() => {
				throw new Error('private listener source');
			});
		const stopBad = consumer.context.apis.subscribe('service', api, bad);
		const events: unknown[] = [];
		consumer.context.apis.subscribe('service', api, (value) => events.push(value));
		host.activate('provider');
		const facade = consumer.api!;
		const stop = consumer.context.apis.subscribe('service', api, () => undefined);
		stop();
		stop();
		expect(facade.read()).toBe(1);
		expect(cleanup).not.toHaveBeenCalled();
		host.deactivate('provider');
		host.activate('provider');
		expect(bad.mock.calls.map(([value]) => value)).toEqual([null, facade, null, consumer.api]);
		expect(events).toHaveLength(4);
		stopBad();
		stopBad();
		host.deactivate('provider');
		expect(bad).toHaveBeenCalledTimes(4);
		expect(host.get('consumer')!.errors).toContain('api-listener-failed');
		expect(host.get('provider')!.errors).toEqual([]);
		host.dispose();
		expect(cleanup).toHaveBeenCalledTimes(2);
	});

	it('blocks lifecycle mutation in runtime factories, notifications and early/late connection cleanup', () => {
		const host = new CommandComponentHost();
		let connection!: ComponentApiConnection;
		const assertBusy = () => {
			expect(() => host.register(descriptor('intruder'))).toThrow('busy');
			expect(() => host.activate('provider')).toThrow('busy');
			expect(() => host.deactivate('consumer')).toThrow('busy');
			expect(() => host.dispose()).toThrow('busy');
		};
		host.register(
			apiProvider((value) => {
				connection = value;
				assertBusy();
				const release = value.own(assertBusy);
				release();
				value.own(assertBusy);
				return { read: () => 1 };
			}),
		);
		const consumer = apiConsumer(host);
		host.activate('consumer');
		consumer.context.apis.subscribe('service', api, assertBusy);
		host.deactivate('consumer');
		connection.own(assertBusy);
		host.dispose();
	});

	it('revokes every API and command endpoint before any connection-owned or activation-owned cleanup', () => {
		const host = new CommandComponentHost();
		const contexts: CommandContext[] = [];
		const facades: { read(): unknown }[] = [];
		const signals: AbortSignal[] = [];
		const events: string[] = [];
		const assertDead = () => {
			for (const context of contexts) {
				expect(() => available(context.commands)).toThrow();
			}
			for (const facade of facades) {
				expect(() => facade.read()).toThrow('revoked');
			}
		};
		for (const suffix of ['a', 'b']) {
			host.register(
				apiProvider(
					(connection) => {
						signals.push(connection.signal);
						connection.own(() => {
							assertDead();
							expect(signals.every((signal) => signal.aborted)).toBe(true);
							events.push('connection');
						});
						return { read: () => 1 };
					},
					'provider-' + suffix,
					{
						commands: [declaration],
						capabilities: ['contributions.command'],
						activate: (context) => {
							publish(context);
							context.apis.provide(api, (connection) => {
								signals.push(connection.signal);
								connection.own(() => {
									assertDead();
									expect(signals.every((signal) => signal.aborted)).toBe(true);
									events.push('connection');
								});
								return { read: () => 1 };
							});
							context.own(() => {
								assertDead();
								events.push('activation');
							});
						},
					},
				),
			);
			host.register(
				descriptor(
					'consumer-' + suffix,
					(context) => {
						contexts.push(context);
						facades.push(context.apis.get('analysis', api)!);
						context.own(() => {
							assertDead();
							events.push('activation');
						});
					},
					{ dependencies: [{ ...dependency('provider-' + suffix), apis: [api] }] },
				),
			);
			host.activate('consumer-' + suffix);
		}
		host.dispose();
		expect(events).toEqual([
			'connection',
			'connection',
			'activation',
			'activation',
			'activation',
			'activation',
		]);
	});

	it('revokes sibling invokers and API guards before the first batch abort listener runs', async () => {
		const host = new CommandComponentHost();
		let a!: CommandContext;
		let b!: CommandContext;
		let guarded!: () => unknown;
		const callback = vi.fn();
		host.register(
			apiProvider(undefined, 'provider', {
				commands: [declaration],
				capabilities: ['contributions.command'],
				activate: (context) => {
					publish(context);
					context.apis.provide(api, (connection) => {
						guarded = connection.guard(callback);
						return { read: () => 'live' };
					});
				},
			}),
		);
		host.register(
			descriptor('a', (context) => {
				a = context;
			}),
		);
		host.register(
			descriptor(
				'b',
				(context) => {
					b = context;
				},
				{
					dependencies: [{ ...dependency(), apis: [api] }],
				},
			),
		);
		host.activate('a');
		host.activate('b');
		const facade = b.apis.get('analysis', api)!;
		const availability: boolean[] = [];
		b.commands.subscribeAvailability('analysis', 'run', contract, (value) =>
			availability.push(value),
		);
		const capture = (operation: () => unknown) => {
			try {
				operation();
			} catch (error) {
				return error;
			}
			return undefined;
		};
		let siblingAborted: boolean | undefined;
		let lookupError: unknown;
		let subscriptionError: unknown;
		let facadeError: unknown;
		let guardResult: unknown = 'not called';
		let execution!: Promise<unknown>;
		a.signal.addEventListener('abort', () => {
			siblingAborted = b.signal.aborted;
			lookupError = capture(() => available(b.commands));
			subscriptionError = capture(() =>
				b.commands.subscribeAvailability('analysis', 'run', contract, () => undefined),
			);
			execution = execute(b.commands).then(
				() => 'unexpected success',
				(error: unknown) => error,
			);
			facadeError = capture(() => facade.read());
			guardResult = guarded();
		});
		host.dispose();
		// AbortSignal events remain sequential; handle liveness does not depend on their flags.
		expect(siblingAborted).toBe(false);
		for (const error of [lookupError, subscriptionError, await execution]) {
			expect(error).toBeInstanceOf(CommandInvocationError);
			expect(error).toMatchObject({ code: 'revoked', diagnosticId: expect.any(String) });
		}
		expect(facadeError).toBeInstanceOf(Error);
		expect((facadeError as Error).message).toContain('revoked');
		expect(guardResult).toBeUndefined();
		expect(callback).not.toHaveBeenCalled();
		expect(availability).toEqual([true]);
		expect(b.signal.aborted).toBe(true);
	});

	it('cleans resources from a failed factory without blaming or disabling an unrelated component', () => {
		const host = new CommandComponentHost();
		const cleanups: string[] = [];
		host.register(
			apiProvider((connection) => {
				connection.own(() => {
					cleanups.push('first');
				});
				connection.own(() => {
					cleanups.push('second');
					throw new Error('private cleanup');
				});
				throw new Error('private factory');
			}),
		);
		const consumer = apiConsumer(host);
		host.register(descriptor('unrelated'));
		host.activate('unrelated');
		host.activate('consumer');
		expect(() => consumer.api).toThrow('private factory');
		expect(cleanups).toEqual(['second', 'first']);
		expect(host.get('provider')!.errors).toEqual(['api-cleanup-failed', 'api-factory-failed']);
		expect(host.get('consumer')!.errors).toEqual(['api-resolution-failed']);
		expect(host.get('unrelated')!.errors).toEqual([]);
		expect(host.get('unrelated')!.status).toBe('active');
		host.dispose();
	});
});
