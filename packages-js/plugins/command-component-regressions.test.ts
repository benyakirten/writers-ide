import { describe, expect, it, vi } from 'vitest';
import { CommandComponentHost } from './command-component-host';
import type { CommandContext, ComponentDescriptor } from './command-component-model';
import { createCommandReservationLedger } from './command-reservations';
import {
	available,
	consumer,
	contract,
	declaration,
	deferred,
	dependency,
	descriptor,
	execute,
	flush,
	provider,
	publish,
} from './command-component-fixture';

function rejectsMutation(host: CommandComponentHost) {
	expect(() => host.register(descriptor('intruder'))).toThrow('busy');
	expect(() => host.deactivate('provider', { cascade: true })).toThrow('busy');
}

describe('command component lifetime regressions', () => {
	it('preserves an optional surviving command and its pending call when another publication disappears', async () => {
		const host = new CommandComponentHost();
		const pending = deferred();
		const started = vi.fn(() => pending.promise);
		const second = { ...declaration, id: 'second' };
		let releaseFirst!: () => void;
		host.register({
			...provider((context) => {
				releaseFirst = publish(context);
				context.contributions.command({
					id: second.id,
					name: 'Second',
					contract,
					execute: started,
				});
			}),
			commands: [declaration, second],
		});
		const required = consumer(host);
		let optional!: CommandContext;
		host.register(
			descriptor(
				'optional',
				(context) => {
					optional = context;
				},
				{
					dependencies: [
						{
							...dependency('provider', true),
							commands: [
								{ ...declaration, alias: 'first' },
								{ ...second, alias: 'second' },
							],
						},
					],
				},
			),
		);
		host.activate('consumer');
		host.activate('optional');
		const firstEvents: boolean[] = [],
			secondEvents: boolean[] = [];
		optional.commands.subscribeAvailability('analysis', 'first', contract, (value) =>
			firstEvents.push(value),
		);
		optional.commands.subscribeAvailability('analysis', 'second', contract, (value) =>
			secondEvents.push(value),
		);
		const call = optional.commands.execute('analysis', 'second', contract, 7);
		const outcome = call.then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		await flush();
		expect(started).toHaveBeenCalledOnce();
		releaseFirst();
		expect(required.context.signal.aborted).toBe(true);
		expect(host.get('consumer')?.status).toBe('disabled');
		expect(host.get('optional')?.status).toBe('active');
		expect(optional.commands.isAvailable('analysis', 'first', contract)).toBe(false);
		expect(optional.commands.isAvailable('analysis', 'second', contract)).toBe(true);
		expect(firstEvents).toEqual([true, false]);
		expect(secondEvents).toEqual([true]);
		pending.resolve(9);
		expect(await outcome).toEqual({ value: 9 });
		host.dispose();
	});

	it('does not attribute stale own cleanup failure to a replacement activation', () => {
		const host = new CommandComponentHost();
		const caller = consumer(host, true);
		host.activate('consumer');
		const old = caller.context;
		host.deactivate('consumer');
		host.activate('consumer');
		const current = caller.context;
		const staleCleanup = vi.fn(() => {
			throw new Error('old cleanup');
		});
		old.own(staleCleanup);
		expect(staleCleanup).toHaveBeenCalledOnce();
		expect(host.get('consumer')?.errors).toEqual([]);
		expect(host.get('consumer')?.status).toBe('active');
		expect(current.signal.aborted).toBe(false);
		current.own(() => {
			throw new Error('current cleanup');
		})();
		expect(host.get('consumer')?.errors).toEqual(['cleanup-failed']);
		host.dispose();
	});

	it.each(['availability', 'diagnostic'])(
		'guards staged disposal during immediate %s callbacks without mutating publication',
		(source) => {
			let release!: () => void;
			const failures: string[] = [];
			const attempt = vi.fn(() => {
				try {
					release();
				} catch (error) {
					failures.push((error as Error).message);
				}
			});
			const host = new CommandComponentHost({
				diagnostics: source === 'diagnostic' ? attempt : undefined,
			});
			host.register({
				...provider((context) => {
					release = publish(context);
					if (source === 'availability') {
						context.commands.subscribeAvailability('analysis', 'run', contract, attempt);
					} else {
						try {
							context.commands.isAvailable('missing', 'run', contract);
						} catch {
							/* Trigger a dispatcher diagnostic during setup. */
						}
					}
				}),
				dependencies: [dependency('absent', true)],
			});
			host.activate('provider');
			expect(attempt).toHaveBeenCalledOnce();
			expect(failures).toHaveLength(1);
			expect(failures[0]).toContain('busy');
			expect(host.get('provider')?.status).toBe('active');
			expect(host.get('provider')?.errors).toEqual([]);
			const caller = consumer(host);
			host.activate('consumer');
			expect(available(caller.commands)).toBe(true);
			host.dispose();
		},
	);
	it('guards early and late own cleanup without preventing early owned command disposal', () => {
		const host = new CommandComponentHost();
		let context!: CommandContext;
		let early!: () => void;
		let remove!: () => void;
		const guarded = vi.fn(() => rejectsMutation(host));
		host.register(
			provider((value) => {
				context = value;
				early = value.own(guarded);
				remove = value.own(publish(value));
			}),
		);
		const caller = consumer(host);
		host.activate('consumer');
		early();
		early();
		expect(guarded).toHaveBeenCalledOnce();
		remove();
		remove();
		expect(context.signal.aborted).toBe(false);
		expect(host.get('consumer')?.status).toBe('disabled');
		expect(host.get('provider')?.errors).toEqual(['command-publication-lost']);
		host.deactivate('provider');
		context.own(guarded);
		expect(guarded).toHaveBeenCalledTimes(2);
		expect(caller.context.signal.aborted).toBe(true);
		host.dispose();
	});

	it('does not change stable bindings or revoke pending calls for unrelated registration changes', async () => {
		const host = new CommandComponentHost();
		const pending = deferred();
		host.register(
			provider((context) => {
				publish(context, () => pending.promise);
			}),
		);
		const caller = consumer(host, true);
		host.activate('consumer');
		host.activate('provider');
		const call = execute(caller.commands, 1);
		await flush();
		host.register(descriptor('unrelated'));
		host.activate('unrelated');
		host.deactivate('unrelated');
		host.unregister('unrelated');
		pending.resolve(7);
		expect(await call).toBe(7);
		host.dispose();
	});

	it('revokes pending calls on command removal, observes late work, and permits no re-publication', async () => {
		const ledger = createCommandReservationLedger();
		const host = new CommandComponentHost({ ledger });
		const pending = deferred();
		let context!: CommandContext;
		let release!: () => void;
		host.register(
			provider((value) => {
				context = value;
				release = publish(value, () => pending.promise);
			}),
		);
		const caller = consumer(host, true);
		host.activate('consumer');
		host.activate('provider');
		const call = execute(caller.commands);
		await flush();
		release();
		await expect(call).rejects.toMatchObject({ code: 'revoked' });
		expect(ledger.snapshot().pending).toBe(1);
		expect(available(caller.commands)).toBe(false);
		expect(() => publish(context)).toThrow('synchronous activation');
		pending.resolve(7);
		await flush();
		expect(ledger.snapshot().pending).toBe(0);
		host.dispose();
	});

	it('stops subscriptions on consumer teardown even if the same callback is independently subscribed', () => {
		const host = new CommandComponentHost();
		const caller = consumer(host, true);
		host.activate('consumer');
		const listener = vi.fn();
		const stop = caller.commands.subscribeAvailability('analysis', 'run', contract, listener);
		caller.commands.subscribeAvailability('analysis', 'run', contract, listener);
		expect(listener).toHaveBeenCalledTimes(2);
		stop();
		host.register(provider());
		host.activate('provider');
		expect(listener).toHaveBeenCalledTimes(3);
		host.deactivate('consumer');
		const count = listener.mock.calls.length;
		host.deactivate('provider');
		host.activate('provider');
		expect(listener).toHaveBeenCalledTimes(count);
		host.dispose();
	});

	it('cleans up failed consumer setup without revoking previously active siblings or required providers', () => {
		const host = new CommandComponentHost();
		host.register(provider());
		const sibling = consumer(host);
		host.activate('consumer');
		let failed!: CommandContext;
		const cleanup = vi.fn();
		host.register(
			descriptor(
				'broken',
				(context) => {
					failed = context;
					context.own(cleanup);
					context.commands.subscribeAvailability('analysis', 'run', contract, () => undefined);
					throw new Error('failure');
				},
				{ dependencies: [dependency()] },
			),
		);
		expect(() => host.activate('broken')).toThrow('failure');
		expect(failed.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(available(sibling.commands)).toBe(true);
		expect(host.get('provider')?.status).toBe('active');
		host.dispose();
	});

	it('defensively captures dependency aliases, requirements, capabilities, and activation callbacks', async () => {
		const host = new CommandComponentHost();
		const requirements = [{ ...declaration, alias: 'run' }];
		const dependencies = [{ ...dependency(), commands: requirements }];
		const capabilities: 'contributions.command'[] = ['contributions.command'];
		const input = { ...provider(), capabilities };
		host.register(input);
		input.activate = () => {
			throw new Error('mutated');
		};
		capabilities.length = 0;
		let context!: CommandContext;
		host.register(
			descriptor(
				'consumer',
				(value) => {
					context = value;
				},
				{ dependencies },
			),
		);
		requirements[0].alias = 'changed';
		requirements[0].major = 2;
		dependencies[0].providerSlot = 'missing';
		dependencies.length = 0;
		host.activate('consumer');
		expect(await execute(context.commands, 3)).toBe(3);
		host.dispose();
	});

	it('isolates notification errors, rejects setup reentry, and lets later observers run', () => {
		const host = new CommandComponentHost();
		const caller = consumer(host, true);
		host.activate('consumer');
		const later = vi.fn();
		caller.commands.subscribeAvailability('analysis', 'run', contract, () => {
			rejectsMutation(host);
			throw new Error('listener failure');
		});
		caller.commands.subscribeAvailability('analysis', 'run', contract, later);
		host.subscribe(() => {
			throw new Error('snapshot observer');
		});
		const observer = vi.fn();
		host.subscribe(observer);
		host.register(provider());
		host.activate('provider');
		expect(later.mock.calls).toEqual([[false], [true]]);
		expect(observer.mock.calls.length).toBeGreaterThan(1);
		expect(host.get('provider')?.status).toBe('active');
		host.dispose();
	});

	it('observes async disposer rejection while continuing reverse cleanup', async () => {
		const host = new CommandComponentHost();
		const pending = deferred();
		const cleanup = vi.fn();
		host.register(
			descriptor('async-cleanup', (context) => {
				context.own(cleanup);
				context.own((() => pending.promise) as unknown as () => void);
			}),
		);
		host.activate('async-cleanup');
		host.deactivate('async-cleanup');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.get('async-cleanup')?.errors).toEqual(['cleanup-failed']);
		pending.reject(new Error('late cleanup failure'));
		await flush();
		host.dispose();
	});

	it('keeps command aliases local to each dependency and rejects invalid runtime references', async () => {
		const host = new CommandComponentHost();
		host.register(provider(undefined, 'one'));
		host.register(provider(undefined, 'two'));
		let context!: CommandContext;
		host.register(
			descriptor(
				'consumer',
				(value) => {
					context = value;
				},
				{ dependencies: [dependency('one'), { ...dependency('two'), alias: 'other' }] },
			),
		);
		host.activate('consumer');
		expect(await context.commands.execute('other', 'run', contract, 4)).toBe(4);
		await expect(context.commands.execute('missing', 'run', contract, 4)).rejects.toMatchObject({
			code: 'invalid-reference',
		});
		await expect(
			context.commands.execute('analysis', 'run', { ...contract, major: 2 }, 4),
		).rejects.toMatchObject({ code: 'contract-mismatch' });
		host.dispose();
	});

	it('rolls back a staged command even when duplicate publication was caught after disposal', () => {
		const host = new CommandComponentHost();
		host.register(
			provider((context) => {
				publish(context)();
				try {
					publish(context);
				} catch {
					/* A disposed publication still used its ID. */
				}
			}),
		);
		expect(() => host.activate('provider')).toThrow('publication');
		expect(host.get('provider')?.status).toBe('failed');
		host.dispose();
	});

	it('never exposes failed staged publication to optional consumers', () => {
		const host = new CommandComponentHost();
		const caller = consumer(host, true);
		host.activate('consumer');
		const listener = vi.fn();
		caller.commands.subscribeAvailability('analysis', 'run', contract, listener);
		host.register(
			provider((context) => {
				publish(context);
				expect(available(caller.commands)).toBe(false);
				throw new Error('failed publication');
			}),
		);
		expect(() => host.activate('provider')).toThrow('failed publication');
		expect(listener.mock.calls).toEqual([[false]]);
		expect(host.get('consumer')?.status).toBe('active');
		host.dispose();
	});

	it('rejects reentrant registration disposal during initial availability notification atomically', () => {
		const host = new CommandComponentHost();
		let release!: () => void;
		host.register(
			provider((context) => {
				release = publish(context);
			}),
		);
		const caller = consumer(host, true);
		host.activate('consumer');
		host.activate('provider');
		const failures: string[] = [];
		caller.commands.subscribeAvailability('analysis', 'run', contract, () => {
			try {
				release();
			} catch (error) {
				failures.push((error as Error).message);
			}
		});
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('busy');
		expect(available(caller.commands)).toBe(true);
		release();
		expect(available(caller.commands)).toBe(false);
		expect(host.get('provider')?.errors).toEqual(['command-publication-lost']);
		host.dispose();
	});

	it('never retargets an old consumer after unregister and slot replacement', async () => {
		const host = new CommandComponentHost();
		host.register(provider());
		const first = consumer(host);
		host.activate('consumer');
		const old = first.context;
		const instance = host.get('consumer')!.instanceId;
		host.unregister('consumer');
		const next = consumer(host);
		host.activate('consumer');
		expect(host.get('consumer')!.instanceId).not.toBe(instance);
		expect(old.signal.aborted).toBe(true);
		await expect(execute(old.commands)).rejects.toMatchObject({ code: 'revoked' });
		expect(await execute(next.commands, 8)).toBe(8);
		host.dispose();
	});

	it('accepts manifest count boundaries without enabling optional provider slots', () => {
		const host = new CommandComponentHost();
		const commands = Array.from({ length: 32 }, (_, index) => ({
			...declaration,
			id: `command-${index}`,
		}));
		host.register(
			descriptor(
				'many',
				(context) => {
					for (const command of commands) {
						context.contributions.command({
							id: command.id,
							name: 'Command',
							contract,
							execute: (value) => value,
						});
					}
				},
				{
					commands,
					capabilities: ['contributions.command'],
					dependencies: Array.from({ length: 64 }, (_, index) => ({
						alias: `dependency-${index}`,
						providerSlot: `absent-${index}`,
						optional: true,
						commands: Array.from({ length: 32 }, (_, command) => ({
							...declaration,
							alias: `alias-${command}`,
						})),
					})),
				},
			),
		);
		host.activate('many');
		expect(host.list()).toHaveLength(1);
		expect(host.get('many')?.status).toBe('active');
		host.dispose();
	});

	it('rejects unsupported activation returns without leaking owned resources', () => {
		const host = new CommandComponentHost();
		const cleanup = vi.fn();
		host.register(
			descriptor('invalid', ((context: CommandContext) => {
				context.own(cleanup);
				return {};
			}) as unknown as ComponentDescriptor['activate']),
		);
		expect(() => host.activate('invalid')).toThrow('disposer');
		expect(cleanup).toHaveBeenCalledOnce();
		host.dispose();
	});
});
