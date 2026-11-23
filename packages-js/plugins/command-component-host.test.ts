import { describe, expect, it, vi } from 'vitest';
import { CommandComponentHost } from './command-component-host';
import type { CommandContext, ComponentDescriptor } from './command-component-model';
import { type CommandInvoker } from './commands';
import { createCommandReservationLedger } from './command-reservations';

import {
	contract,
	declaration,
	dependency,
	descriptor,
	provider,
	publish,
	consumer,
	execute,
	available,
	deferred,
	flush,
} from './command-component-fixture';

describe('internal command component host', () => {
	it('activates provider-first with a narrow frozen context and dispatches copied values', async () => {
		const host = new CommandComponentHost();
		const order: string[] = [];
		host.register(
			provider((context) => {
				order.push('provider');
				expect(Object.keys(context).sort()).toEqual([
					'apis',
					'commands',
					'contributions',
					'identity',
					'own',
					'signal',
				]);
				expect(Object.isFrozen(context)).toBe(true);
				publish(context);
			}),
		);
		let commands!: CommandInvoker;
		host.register(
			descriptor(
				'consumer',
				(context) => {
					order.push('consumer');
					commands = context.commands;
				},
				{ dependencies: [dependency()] },
			),
		);
		host.activate('consumer');
		expect(order).toEqual(['provider', 'consumer']);
		const value = { text: 'hello' };
		expect(await execute(commands, value)).toEqual(value);
		expect(await execute(commands, value)).not.toBe(value);
		host.dispose();
	});

	it.each([
		'missing',
		'undeclared',
		'duplicate',
		'contract',
		'major',
		'capability',
		'disposed',
		'caught',
	])('rolls back %s publication failures', (failure) => {
		const host = new CommandComponentHost();
		const cleanup = vi.fn();
		let context!: CommandContext;
		const implementation = (value: CommandContext) => {
			context = value;
			value.own(cleanup);
			if (failure === 'missing') {
				return;
			}
			if (failure === 'duplicate') {
				publish(value);
				publish(value);
				return;
			}
			if (failure === 'disposed') {
				publish(value)();
				return;
			}
			if (failure === 'caught') {
				try {
					value.contributions.command({
						id: 'wrong',
						name: 'Wrong',
						contract,
						execute: () => undefined,
					});
				} catch {
					/* Test sticky setup failure. */
				}
				publish(value);
				return;
			}
			value.contributions.command({
				id: failure === 'undeclared' ? 'wrong' : declaration.id,
				name: 'Run',
				contract: {
					...contract,
					id: failure === 'contract' ? 'wrong' : contract.id,
					major: failure === 'major' ? 2 : 1,
				},
				execute: () => undefined,
			});
		};
		const input = provider(implementation);
		host.register(failure === 'capability' ? { ...input, capabilities: [] } : input);
		const caller = consumer(host);
		expect(() => host.activate('consumer')).toThrow();
		expect(host.get('provider')?.status).toBe('failed');
		expect(host.get('consumer')?.status).toBe('failed');
		expect(context.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(caller.context).toBeUndefined();
		host.dispose();
	});

	it('rejects late publication and never resurrects an old registration or invoker', async () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		let release!: () => void;
		host.register(
			provider((value) => {
				context = value;
				release = publish(value);
			}),
		);
		const caller = consumer(host);
		host.activate('consumer');
		const old = caller.commands;
		const first = host.get('consumer')!.instanceId;
		expect(() => publish(context)).toThrow('synchronous activation');
		host.deactivate('provider', { cascade: true });
		release();
		host.activate('consumer');
		expect(host.get('consumer')!.instanceId).not.toBe(first);
		await expect(execute(old)).rejects.toMatchObject({ code: 'revoked' });
		expect(await execute(caller.commands, 7)).toBe(7);
		host.dispose();
	});

	it('stages publications until successful setup and preserves healthy providers after consumer failure', () => {
		const host = new CommandComponentHost();
		const optional = consumer(host, true);
		host.activate('consumer');
		const events: boolean[] = [];
		optional.commands.subscribeAvailability('analysis', 'run', contract, (value) =>
			events.push(value),
		);
		host.register(
			provider((context) => {
				publish(context);
				expect(available(optional.commands)).toBe(false);
			}),
		);
		host.activate('provider');
		expect(events).toEqual([false, true]);
		host.register(
			descriptor(
				'broken',
				() => {
					throw new Error('consumer failed');
				},
				{ dependencies: [dependency()] },
			),
		);
		expect(() => host.activate('broken')).toThrow('consumer failed');
		expect(host.get('provider')?.status).toBe('active');
		expect(host.get('consumer')?.status).toBe('active');
		host.dispose();
	});

	it.each(['missing', 'incompatible', 'cycle'])(
		'preflights the full required graph: %s',
		(kind) => {
			const host = new CommandComponentHost();
			const callback = vi.fn();
			host.register(
				provider((context) => {
					callback();
					publish(context);
				}),
			);
			const badDependency =
				kind === 'missing'
					? dependency('absent')
					: kind === 'incompatible'
						? { ...dependency(), commands: [{ ...declaration, alias: 'run', major: 2 }] }
						: { ...dependency('root'), commands: [] };
			host.register(descriptor('bad', callback, { dependencies: [badDependency] }));
			host.register(
				descriptor('root', callback, {
					dependencies: [dependency(), { alias: 'bad', providerSlot: 'bad', commands: [] }],
				}),
			);
			expect(() => host.activate('root')).toThrow(
				kind === 'cycle' ? /root.*bad.*root/ : /missing or incompatible/,
			);
			expect(callback).not.toHaveBeenCalled();
			expect(host.get('provider')?.status).toBe('disabled');
			host.dispose();
		},
	);

	it('does not activate optional providers and permits optional cycles', () => {
		const host = new CommandComponentHost();
		host.register(
			descriptor('a', () => undefined, {
				dependencies: [{ alias: 'b', providerSlot: 'b', optional: true, commands: [] }],
			}),
		);
		host.register(
			descriptor('b', () => undefined, {
				dependencies: [{ alias: 'a', providerSlot: 'a', optional: true, commands: [] }],
			}),
		);
		host.activate('a');
		expect(host.get('b')?.status).toBe('disabled');
		host.activate('b');
		expect(host.list().every((entry) => entry.status === 'active')).toBe(true);
		host.dispose();
	});

	it('routes repeated local IDs only to exact host-selected slots', async () => {
		const host = new CommandComponentHost();
		host.register(
			provider((context) => {
				publish(context, () => 'project-a');
			}, 'project-a'),
		);
		host.register(
			provider((context) => {
				publish(context, () => 'project-b');
			}, 'project-b'),
		);
		const a = consumer(host, false, 'a', 'project-a');
		const b = consumer(host, false, 'b', 'project-b');
		host.activate('b');
		host.activate('a');
		expect(await execute(a.commands)).toBe('project-a');
		expect(await execute(b.commands)).toBe('project-b');
		host.dispose();
	});

	it('guards cascades and cleans up required consumers before providers', () => {
		const host = new CommandComponentHost();
		const order: string[] = [];
		host.register(
			provider((context) => {
				publish(context);
				return () => {
					order.push('provider');
				};
			}),
		);
		host.register(
			descriptor(
				'middle',
				() => () => {
					order.push('middle');
				},
				{ dependencies: [dependency()] },
			),
		);
		host.register(
			descriptor(
				'leaf',
				() => () => {
					order.push('leaf');
				},
				{ dependencies: [{ alias: 'middle', providerSlot: 'middle', commands: [] }] },
			),
		);
		const optional = consumer(host, true);
		host.activate('leaf');
		host.activate('consumer');
		const plan = host.planDeactivation('provider');
		expect(plan).toEqual(['leaf', 'middle', 'provider']);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(() => host.deactivate('provider')).toThrow('cascade');
		expect(() => host.unregister('provider')).toThrow('cascade');
		expect(order).toEqual([]);
		const snapshots = host.deactivate('provider', { cascade: true });
		expect(Object.isFrozen(snapshots)).toBe(true);
		expect(order).toEqual(['leaf', 'middle', 'provider']);
		expect(host.get('consumer')?.status).toBe('active');
		expect(available(optional.commands)).toBe(false);
		host.dispose();
	});

	it('stops required consumers on author-owned publication loss without stopping optional peers or provider', async () => {
		const host = new CommandComponentHost();
		let release!: () => void;
		host.register(
			provider((context) => {
				release = publish(context);
			}),
		);
		const required = consumer(host);
		const optional = consumer(host, true, 'optional');
		host.activate('consumer');
		host.activate('optional');
		const old = required.commands;
		release();
		release();
		expect(host.get('provider')?.status).toBe('active');
		expect(host.get('provider')?.errors).toContain('command-publication-lost');
		expect(host.get('consumer')?.status).toBe('disabled');
		expect(host.get('optional')?.status).toBe('active');
		expect(available(optional.commands)).toBe(false);
		await expect(execute(old)).rejects.toMatchObject({ code: 'revoked' });
		expect(() => host.activate('consumer')).toThrow('publication');
		host.dispose();
	});

	it('delivers optional transitions to all invokers and releases caller subscriptions', () => {
		const host = new CommandComponentHost();
		const a = consumer(host, true, 'a');
		const b = consumer(host, true, 'b');
		host.activate('a');
		host.activate('b');
		const eventsA: boolean[] = [],
			eventsB: boolean[] = [];
		const unsubscribe = a.commands.subscribeAvailability('analysis', 'run', contract, (value) =>
			eventsA.push(value),
		);
		b.commands.subscribeAvailability('analysis', 'run', contract, (value) => eventsB.push(value));
		host.register(provider());
		host.activate('provider');
		unsubscribe();
		host.deactivate('provider');
		host.activate('provider');
		expect(eventsA).toEqual([false, true]);
		expect(eventsB).toEqual([false, true, false, true]);
		host.deactivate('b');
		const count = eventsB.length;
		host.deactivate('provider');
		host.activate('provider');
		expect(eventsB).toHaveLength(count);
		host.dispose();
	});

	it('owns idempotent early releases and reverses cleanup after revocation, including errors and late own', () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		const events: string[] = [];
		host.register(
			descriptor('owned', (value) => {
				context = value;
				const early = value.own(() => {
					events.push('early');
				});
				early();
				early();
				value.own(() => {
					expect(value.signal.aborted).toBe(true);
					events.push('first');
				});
				value.own(() => {
					events.push('throw');
					throw new Error('cleanup');
				});
				return () => {
					events.push('returned');
				};
			}),
		);
		host.activate('owned');
		host.deactivate('owned');
		context.own(() => {
			events.push('late');
		});
		expect(events).toEqual(['early', 'returned', 'throw', 'first', 'late']);
		expect(host.get('owned')?.errors).toEqual(['cleanup-failed']);
		host.dispose();
	});

	it.each([false, true])(
		'rejects asynchronous activation and observes late rejection (thenable: %s)',
		async (thenable) => {
			const host = new CommandComponentHost();
			const late = deferred();
			const cleanup = vi.fn();
			let context!: CommandContext;
			host.register(
				provider(((value: CommandContext) => {
					context = value;
					value.own(cleanup);
					publish(value);
					return thenable ? { then: late.promise.then.bind(late.promise) } : late.promise;
				}) as unknown as ComponentDescriptor['activate']),
			);
			expect(() => host.activate('provider')).toThrow('synchronous');
			expect(context.signal.aborted).toBe(true);
			expect(cleanup).toHaveBeenCalledOnce();
			late.reject(new Error('late failure'));
			await flush();
			expect(() => publish(context)).toThrow();
			host.dispose();
		},
	);

	it('revokes pending calls on unregister and keeps retained work charged until settlement', async () => {
		const ledger = createCommandReservationLedger();
		const host = new CommandComponentHost({ ledger });
		const pending = deferred();
		host.register(
			provider((context) => {
				publish(context, () => pending.promise);
			}),
		);
		const caller = consumer(host, true);
		host.activate('consumer');
		host.activate('provider');
		const call = execute(caller.commands);
		await flush();
		expect(ledger.snapshot().pending).toBe(1);
		host.unregister('provider');
		await expect(call).rejects.toMatchObject({ code: 'revoked' });
		expect(ledger.snapshot().pending).toBe(1);
		host.register(provider());
		host.activate('provider');
		expect(await execute(caller.commands, 42)).toBe(42);
		pending.reject(new Error('late provider failure'));
		await flush();
		expect(ledger.snapshot().pending).toBe(0);
		host.dispose();
	});

	it('rejects lifecycle reentry in setup, cleanup, initial subscriptions and availability notifications', () => {
		const host = new CommandComponentHost();
		const assertBusy = () => {
			expect(() => host.register(descriptor('intruder'))).toThrow('busy');
			expect(() => host.activate('provider')).toThrow('busy');
			expect(() => host.dispose()).toThrow('busy');
		};
		host.register(
			provider((context) => {
				assertBusy();
				publish(context);
				return assertBusy;
			}),
		);
		const caller = consumer(host, true);
		host.activate('consumer');
		const listener = vi.fn(assertBusy);
		caller.commands.subscribeAvailability('analysis', 'run', contract, listener);
		host.subscribe(assertBusy);
		host.activate('provider');
		host.deactivate('provider');
		expect(listener).toHaveBeenCalledTimes(3);
		expect(host.get('intruder')).toBeUndefined();
		host.dispose();
	});

	it('revokes every endpoint before any whole-host cleanup and preserves unrelated siblings on failure', () => {
		const host = new CommandComponentHost();
		const signals: AbortSignal[] = [];
		for (const id of ['a', 'b']) {
			host.register(
				descriptor(id, (context) => {
					signals.push(context.signal);
					return () => {
						expect(signals.every((signal) => signal.aborted)).toBe(true);
					};
				}),
			);
			host.activate(id);
		}
		host.register(
			provider(() => {
				throw new Error('broken');
			}),
		);
		expect(() => host.activate('provider')).toThrow('broken');
		expect(host.get('a')?.status).toBe('active');
		expect(host.get('b')?.status).toBe('active');
		host.dispose();
		host.dispose();
	});

	it('captures frozen declarations and returns defensive snapshots', () => {
		const host = new CommandComponentHost();
		const commands = [{ ...declaration }];
		const input = { ...provider(), commands };
		host.register(input);
		commands[0].major = 2;
		commands.length = 0;
		host.activate('provider');
		const snapshot = host.get('provider')!;
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.errors)).toBe(true);
		expect(Object.isFrozen(host.list())).toBe(true);
		host.deactivate('provider');
		expect(snapshot.status).toBe('active');
		host.dispose();
	});

	it.each([
		{ commands: [declaration, declaration] },
		{ commands: [{ ...declaration, id: ' ' }] },
		{ commands: [{ ...declaration, id: 'é'.repeat(129) }] },
		{ commands: [{ ...declaration, contractId: 'x'.repeat(257) }] },
		{ commands: [{ ...declaration, major: 1.5 }] },
		{ commands: [{ ...declaration, major: Number.MAX_SAFE_INTEGER + 1 }] },
		{ commands: Array.from({ length: 33 }, (_, index) => ({ ...declaration, id: String(index) })) },
		{ dependencies: [dependency(), dependency()] },
		{ dependencies: [dependency(), { ...dependency(), alias: 'other' }] },
		{ dependencies: [{ ...dependency(), alias: 'Bad_alias' }] },
		{ dependencies: [{ ...dependency(), providerSlot: 'invalid' }] },
		{
			dependencies: [
				{
					...dependency(),
					commands: [
						{ ...declaration, alias: 'x' },
						{ ...declaration, alias: 'x' },
					],
				},
			],
		},
		{
			dependencies: [
				{
					...dependency(),
					commands: Array.from({ length: 33 }, (_, index) => ({
						...declaration,
						alias: String(index),
					})),
				},
			],
		},
		{
			dependencies: Array.from({ length: 65 }, (_, index) => ({
				...dependency(String(index)),
				alias: `dep-${index}`,
			})),
		},
	])('rejects invalid declarations atomically: %#', (extra) => {
		const host = new CommandComponentHost();
		host.register(descriptor('existing'));
		expect(() => host.register(descriptor('invalid', () => undefined, extra))).toThrow();
		expect(host.list().map((entry) => entry.slotId)).toEqual(['existing']);
		host.dispose();
	});

	it('accepts exact 256-byte command identities and exact safe-integer majors', () => {
		const host = new CommandComponentHost();
		const wide = {
			id: 'é'.repeat(128),
			contractId: 'x'.repeat(256),
			major: Number.MAX_SAFE_INTEGER,
		};
		host.register(descriptor('wide', () => undefined, { commands: [wide] }));
		expect(host.get('wide')?.status).toBe('disabled');
		expect(() => host.register(descriptor('wide'))).toThrow('already registered');
		host.dispose();
	});
});
