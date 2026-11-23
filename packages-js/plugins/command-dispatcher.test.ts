import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
	createCommandDispatcher,
	type CommandConsumerSource,
	type CommandDiagnostic,
	type CommandProviderBinding,
} from './command-dispatcher';
import { CommandInvocationError, definePluginCommand, type PluginCommand } from './commands';
import { PayloadError, inspectCommandPayload } from './command-payload';
import * as payloadModule from './command-payload';
import {
	createCommandReservationLedger,
	DEFAULT_RESERVATION_LIMITS,
	type ReservationLimits,
} from './command-reservations';

type Schema = PluginCommand<unknown, unknown, unknown, unknown>['args'];
function schema(validate: Schema['~standard']['validate'] = (value) => ({ value })): Schema {
	return { '~standard': { version: 1, vendor: 'test', validate } };
}
function deferred<T = unknown>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function flush() {
	for (let index = 0; index < 12; index++) {
		await Promise.resolve();
	}
}
function setup(
	options: {
		args?: Schema;
		result?: Schema;
		execute?: (value: unknown, context: { signal: AbortSignal }) => unknown;
		limits?: ReservationLimits;
		diagnostics?: (metadata: CommandDiagnostic) => void;
		inspectError?: (error: unknown, metadata: CommandDiagnostic) => void;
		now?: () => number;
	} = {},
) {
	const caller = new AbortController();
	const provider = new AbortController();
	const registration = new AbortController();
	const contract = definePluginCommand({
		id: 'test.contract',
		major: 1,
		args: options.args ?? schema(),
		result: options.result ?? schema(),
	});
	const implementation = vi.fn(options.execute ?? ((value: unknown) => value));
	let binding: CommandProviderBinding | undefined = {
		instanceId: 'provider:project:activation-2',
		signal: provider.signal,
		registrationSignal: registration.signal,
		registration: { id: 'local.command', name: 'Command', contract, execute: implementation },
	};
	const notifications = new Set<() => void>();
	const source: CommandConsumerSource = {
		instanceId: 'caller:project:activation-1',
		signal: caller.signal,
		declarations: [
			{
				dependencyAlias: 'dependency',
				commandAlias: 'command',
				commandId: 'local.command',
				contractId: contract.id,
				major: 1,
				resolve: () => binding,
			},
		],
		subscribeBindings(listener) {
			notifications.add(listener);
			return () => notifications.delete(listener);
		},
	};
	const ledger = createCommandReservationLedger(options.limits);
	const diagnostics: CommandDiagnostic[] = [];
	const dispatcher = createCommandDispatcher({
		ledger,
		now: options.now,
		inspectError: options.inspectError,
		diagnostics(data) {
			diagnostics.push(data);
			return options.diagnostics?.(data);
		},
	});
	const invoker = dispatcher.createInvoker(source);
	return {
		caller,
		provider,
		registration,
		contract,
		implementation,
		ledger,
		diagnostics,
		dispatcher,
		invoker,
		source,
		get binding() {
			return binding;
		},
		bind(next: CommandProviderBinding | undefined) {
			binding = next;
			for (const notify of Array.from(notifications)) {
				notify();
			}
		},
		execute(value: unknown = { text: 'hello' }, signal?: AbortSignal) {
			return invoker.execute('dependency', 'command', contract, value, { signal });
		},
		available() {
			return invoker.isAvailable('dependency', 'command', contract);
		},
		subscribe(listener: (value: boolean) => void) {
			return invoker.subscribeAvailability('dependency', 'command', contract, listener);
		},
	};
}
const limits = (values: Partial<ReservationLimits>): ReservationLimits => ({
	...DEFAULT_RESERVATION_LIMITS,
	...values,
});

describe('isolated command dispatcher', () => {
	it.each([false, true])(
		'rolls back invoker setup when binding subscription throws (reentrant abort: %s)',
		(abort) => {
			const f = setup();
			const dispatcher = createCommandDispatcher();
			const caller = new AbortController();
			const raw = new Error('host setup failed');
			const source: CommandConsumerSource = {
				...f.source,
				signal: caller.signal,
				subscribeBindings() {
					if (abort) {
						caller.abort();
					}
					throw raw;
				},
			};
			const add = vi.spyOn(AbortSignal.prototype, 'addEventListener');
			try {
				expect(() => dispatcher.createInvoker(source)).toThrow(raw);
				const signals = new Set(
					add.mock.contexts.filter(
						(signal): signal is AbortSignal => signal instanceof AbortSignal,
					),
				);
				expect(signals.size).toBe(2);
				for (const signal of signals) {
					expect(getEventListeners(signal, 'abort')).toHaveLength(0);
				}
				dispatcher.dispose();
				for (const signal of signals) {
					expect(getEventListeners(signal, 'abort')).toHaveLength(0);
				}
			} finally {
				add.mockRestore();
				f.dispatcher.dispose();
			}
		},
	);

	it('does not shut down the dispatcher while rolling back a failed invoker', () => {
		const f = setup();
		const raw = new Error('setup failed');
		expect(() =>
			f.dispatcher.createInvoker({
				...f.source,
				subscribeBindings() {
					throw raw;
				},
			}),
		).toThrow(raw);
		expect(getEventListeners(f.caller.signal, 'abort')).toHaveLength(1);
		expect(f.available()).toBe(true);
		const unsubscribe = vi.fn();
		const invoker = f.dispatcher.createInvoker({
			...f.source,
			subscribeBindings: () => unsubscribe,
		});
		expect(invoker.isAvailable('dependency', 'command', f.contract)).toBe(true);
		f.dispatcher.dispose();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(getEventListeners(f.caller.signal, 'abort')).toHaveLength(0);
	});

	it.each(['available', 'missing', 'incompatible'] as const)(
		'rechecks caller lifetime before interpreting an availability resolver returning %s',
		(returned) => {
			const f = setup();
			const binding =
				returned === 'missing'
					? undefined
					: returned === 'incompatible'
						? {
								...f.binding!,
								registration: { ...f.binding!.registration, contract: { ...f.contract, major: 2 } },
							}
						: f.binding;
			vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
				f.caller.abort();
				return binding;
			});
			expect(() => f.available()).toThrow(expect.objectContaining({ code: 'revoked' }));
			expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
		},
	);

	it.each(['available', 'missing', 'incompatible'] as const)(
		'rechecks invocation caller/cancellation before interpreting a resolver returning %s',
		async (returned) => {
			for (const event of ['caller', 'request', 'both'] as const) {
				const validate = vi.fn((value: unknown) => ({ value }));
				const f = setup({ args: schema(validate) });
				const request = new AbortController();
				const binding =
					returned === 'missing'
						? undefined
						: returned === 'incompatible'
							? {
									...f.binding!,
									registration: {
										...f.binding!.registration,
										contract: { ...f.contract, major: 2 },
									},
								}
							: f.binding;
				vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
					if (event !== 'caller') {
						request.abort();
					}
					if (event !== 'request') {
						f.caller.abort();
					}
					return binding;
				});
				await expect(f.execute({}, request.signal)).rejects.toMatchObject({
					code: event === 'request' ? 'cancelled' : 'revoked',
				});
				expect(validate).not.toHaveBeenCalled();
				expect(f.implementation).not.toHaveBeenCalled();
				expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
			}
		},
	);

	it.each(['caller', 'dispatcher', 'unsubscribe'] as const)(
		'does not reattach availability listeners when a binding update triggers %s teardown',
		(event) => {
			const f = setup();
			const listener = vi.fn();
			const off = f.subscribe(listener);
			const provider = new AbortController();
			const registration = new AbortController();
			const replacement = {
				...f.binding!,
				signal: provider.signal,
				registrationSignal: registration.signal,
			};
			const resolve = vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
				if (event === 'caller') {
					f.caller.abort();
				} else if (event === 'dispatcher') {
					f.dispatcher.dispose();
				} else {
					off();
				}
				return replacement;
			});
			f.bind(replacement);
			expect(listener.mock.calls).toEqual([[true]]);
			for (const signal of [
				f.provider.signal,
				f.registration.signal,
				provider.signal,
				registration.signal,
			]) {
				expect(getEventListeners(signal, 'abort')).toHaveLength(0);
			}
			off();
			f.dispatcher.dispose();
			f.bind(undefined);
			provider.abort();
			registration.abort();
			expect(resolve).toHaveBeenCalledTimes(1);
			expect(listener.mock.calls).toEqual([[true]]);
		},
	);

	it('normalizes throwing initial host resolvers without exposing their thrown values', async () => {
		const raw = new PayloadError('limit-exceeded');
		raw.message = 'private host details';
		const inspectError = vi.fn();
		const f = setup({ inspectError });
		vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
			throw raw;
		});
		expect(() => f.available()).toThrow(expect.objectContaining({ code: 'execution-failed' }));
		expect(() => f.subscribe(() => undefined)).toThrow(
			expect.objectContaining({ code: 'execution-failed' }),
		);
		await expect(f.execute()).rejects.toMatchObject({ code: 'execution-failed' });
		expect(inspectError).toHaveBeenCalledTimes(3);
		expect(JSON.stringify(f.diagnostics)).not.toContain('private host details');
		expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
	});

	it('reports throwing availability-update resolvers and can recover without leaking listeners', () => {
		const inspectError = vi.fn();
		const f = setup({ inspectError });
		const listener = vi.fn();
		const off = f.subscribe(listener);
		const raw = new Error('private host details');
		const resolve = vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
			throw raw;
		});
		f.bind(f.binding);
		expect(listener.mock.calls).toEqual([[true], [false]]);
		expect(f.diagnostics).toContainEqual(
			expect.objectContaining({ phase: 'availability-resolution', code: 'execution-failed' }),
		);
		expect(inspectError).toHaveBeenCalledWith(
			raw,
			expect.objectContaining({ code: 'execution-failed' }),
		);
		expect(JSON.stringify(f.diagnostics)).not.toContain('private host details');
		expect(getEventListeners(f.provider.signal, 'abort')).toHaveLength(0);
		resolve.mockImplementation(() => f.binding);
		f.bind(f.binding);
		expect(listener.mock.calls).toEqual([[true], [false], [true]]);
		off();
		expect(getEventListeners(f.provider.signal, 'abort')).toHaveLength(0);
		expect(getEventListeners(f.registration.signal, 'abort')).toHaveLength(0);
	});

	it('settles running invocations on throwing host notifications while retaining unfinished validator capacity', async () => {
		const work = deferred<{ value: unknown }>();
		const inspectError = vi.fn();
		const f = setup({ args: schema(() => work.promise), inspectError });
		const promise = f.execute({});
		const raw = new Error('host resolution failed');
		vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
			throw raw;
		});
		f.bind(f.binding);
		// Attach an observer before checking prompt settlement; the validator is still pending.
		const outcome = vi.fn();
		void promise.catch(outcome);
		await flush();
		expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ code: 'execution-failed' }));
		expect(f.ledger.snapshot().pending).toBe(1);
		work.resolve({ value: {} });
		await flush();
		await expect(promise).rejects.toMatchObject({ code: 'execution-failed' });
		expect(inspectError).toHaveBeenCalledWith(
			raw,
			expect.objectContaining({ code: 'execution-failed' }),
		);
		expect(f.implementation).not.toHaveBeenCalled();
		expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
	});
	it.each(['caller', 'request'] as const)(
		'preserves the first %s outcome when an admitted resolver then throws',
		async (event) => {
			const work = deferred<{ value: unknown }>();
			const inspectError = vi.fn();
			const f = setup({ args: schema(() => work.promise), inspectError });
			const request = new AbortController();
			const promise = f.execute({}, request.signal);
			const raw = new Error('late host failure');
			vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
				if (event === 'request') {
					request.abort();
				}
				f.caller.abort();
				throw raw;
			});
			f.bind(f.binding);
			await expect(promise).rejects.toMatchObject({
				code: event === 'caller' ? 'revoked' : 'cancelled',
			});
			expect(inspectError).toHaveBeenCalledWith(
				raw,
				expect.objectContaining({ code: 'execution-failed' }),
			);
			expect(f.ledger.snapshot().pending).toBe(1);
			work.resolve({ value: {} });
			await flush();
			expect(f.implementation).not.toHaveBeenCalled();
			expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
		},
	);

	it.each(['arguments', 'result'] as const)(
		'copies only the reserved snapshot when a proxy would switch backing buffers on a later %s scan',
		async (phase) => {
			const small = new ArrayBuffer(8);
			const large = new ArrayBuffer(4096);
			const target = { buffer: small };
			const size = inspectCommandPayload(target).bytes;
			let enumerations = 0;
			const proxy = new Proxy(target, {
				ownKeys(object) {
					enumerations++;
					// Retention and preparation each enumerate twice. A separate copy scan is unsafe.
					if (enumerations > 4) {
						object.buffer = large;
					}
					return Reflect.ownKeys(object);
				},
			});
			const f = setup({
				limits: limits({ maxWindowBytes: size * 2, maxComponentBytes: size * 2 }),
				result: phase === 'result' ? schema(() => ({ value: proxy })) : undefined,
			});
			const prepare = payloadModule.prepareCommandPayload;
			let observedCopies = 0;
			const spy = vi
				.spyOn(payloadModule, 'prepareCommandPayload')
				.mockImplementation((value, payloadLimits) => {
					const prepared = prepare(value, payloadLimits);
					if (value !== proxy) {
						return prepared;
					}
					return {
						inspection: prepared.inspection,
						copy() {
							const reserved = f.ledger.snapshot().bytes;
							expect(reserved).toBe(size * 2);
							const copied = prepared.copy() as typeof target;
							observedCopies++;
							expect(copied.buffer.byteLength).toBe(8);
							expect(inspectCommandPayload(copied).bytes).toBeLessThanOrEqual(reserved - size);
							return copied;
						},
					};
				});
			try {
				const result = (await f.execute(phase === 'arguments' ? proxy : {})) as typeof target;
				expect(result.buffer.byteLength).toBe(8);
				expect(enumerations).toBe(4);
				expect(observedCopies).toBe(1);
				expect(f.ledger.snapshot()).toMatchObject({ bytes: 0, pending: 0 });
			} finally {
				spy.mockRestore();
			}
		},
	);

	it('rejects a larger graph discovered during preparation before allocating its copy', async () => {
		const target = { buffer: new ArrayBuffer(8) };
		const size = inspectCommandPayload(target).bytes;
		const large = new ArrayBuffer(4096);
		let enumerations = 0;
		const proxy = new Proxy(target, {
			ownKeys(object) {
				enumerations++;
				if (enumerations > 2) {
					object.buffer = large;
				}
				return Reflect.ownKeys(object);
			},
		});
		const f = setup({ limits: limits({ maxWindowBytes: size * 2 }) });
		const prepare = payloadModule.prepareCommandPayload;
		const copy = vi.fn();
		const spy = vi
			.spyOn(payloadModule, 'prepareCommandPayload')
			.mockImplementation((value, payloadLimits) => {
				const prepared = prepare(value, payloadLimits);
				return {
					inspection: prepared.inspection,
					copy() {
						copy();
						return prepared.copy();
					},
				};
			});
		try {
			await expect(f.execute(proxy)).rejects.toMatchObject({ code: 'limit-exceeded' });
			expect(enumerations).toBe(4);
			expect(copy).not.toHaveBeenCalled();
			expect(f.implementation).not.toHaveBeenCalled();
			expect(f.ledger.snapshot()).toMatchObject({ bytes: 0, pending: 0 });
		} finally {
			spy.mockRestore();
		}
	});

	it.each(['preparation', 'reservation', 'binding-callback', 'copy'] as const)(
		'rechecks teardown around %s and never advances revoked copy work',
		async (phase) => {
			const f = setup();
			const prepare = payloadModule.prepareCommandPayload;
			const copy = vi.fn();
			let abortOnResolve = false;
			const resolve = f.source.declarations[0].resolve;
			const resolveSpy = vi.spyOn(f.source.declarations[0], 'resolve').mockImplementation(() => {
				if (abortOnResolve) {
					f.caller.abort();
				}
				return resolve();
			});
			const prepareSpy = vi
				.spyOn(payloadModule, 'prepareCommandPayload')
				.mockImplementation((value, payloadLimits) => {
					const prepared = prepare(value, payloadLimits);
					if (phase === 'preparation') {
						f.caller.abort();
					}
					return {
						inspection: prepared.inspection,
						copy() {
							copy();
							const copied = prepared.copy();
							if (phase === 'copy') {
								f.caller.abort();
							}
							return copied;
						},
					};
				});
			const admit = f.ledger.admit;
			const admitSpy = vi.spyOn(f.ledger, 'admit').mockImplementation((caller, provider) => {
				const reservation = admit(caller, provider);
				return {
					...reservation,
					reserveCopy(inspection) {
						const release = reservation.reserveCopy(inspection);
						if (phase === 'reservation') {
							f.caller.abort();
						}
						abortOnResolve = phase === 'binding-callback';
						return release;
					},
				};
			});
			try {
				await expect(f.execute({})).rejects.toMatchObject({ code: 'revoked' });
				expect(copy).toHaveBeenCalledTimes(phase === 'copy' ? 1 : 0);
				expect(f.implementation).not.toHaveBeenCalled();
				expect(f.ledger.snapshot()).toMatchObject({ bytes: 0, pending: 0 });
			} finally {
				prepareSpy.mockRestore();
				admitSpy.mockRestore();
				resolveSpy.mockRestore();
			}
		},
	);
	it('uses provider schemas, applies all four roles, and copies both boundaries', async () => {
		const input = { count: '3' };
		let validated: unknown;
		const f = setup({
			args: schema((value) => {
				validated = value;
				return { value: { count: Number((value as typeof input).count) } };
			}),
			execute(value) {
				expect(value).toEqual({ count: 3 });
				return { total: String((value as { count: number }).count * 2) };
			},
			result: schema((value) => ({ value: new Date(Number((value as { total: string }).total)) })),
		});
		const untrusted = {
			...f.contract,
			args: schema(() => {
				throw new Error('caller schema');
			}),
			result: schema(() => {
				throw new Error('caller schema');
			}),
		};
		const result = await f.invoker.execute('dependency', 'command', untrusted, input);
		expect(result).toEqual(new Date(6));
		expect(validated).not.toBe(input);
		expect(input).toEqual({ count: '3' });
		expect(f.ledger.snapshot()).toMatchObject({ bytes: 0, pending: 0 });
	});

	it('awaits successful asynchronous transforms with distinct argument/result input and output types', async () => {
		const args = schema(async (value) => ({ value: Number(value) }));
		const resultSchema = schema(async (value) => ({ value: String(value) }));
		const f = setup({
			args,
			result: resultSchema,
			execute(value) {
				expect(typeof value).toBe('number');
				return Number(value) * 2;
			},
		});
		const reference = definePluginCommand<string, number, number, string>({
			id: f.contract.id,
			major: 1,
			args: {
				'~standard': {
					version: 1,
					vendor: 'caller',
					validate: (value) => ({ value: Number(value) }),
				},
			},
			result: {
				'~standard': {
					version: 1,
					vendor: 'caller',
					validate: (value) => ({ value: String(value) }),
				},
			},
		});
		const result: string = await f.invoker.execute('dependency', 'command', reference, '4');
		expect(result).toBe('8');
	});

	it('copies binary ranges, containers, and shared noncyclic references independently', async () => {
		const buffer = new ArrayBuffer(32);
		const shared = { n: 1 };
		const value = {
			bytes: new Uint8Array(buffer, 4, 8),
			view: new DataView(buffer, 6, 4),
			a: shared,
			b: shared,
			map: new Map([[shared, new Set([shared])]]),
			date: new Date(10),
		};
		const f = setup();
		const result = (await f.execute(value)) as typeof value;
		expect(result.a).toBe(result.b);
		expect(result.map.keys().next().value).toBe(result.a);
		expect(result.bytes.buffer).toBe(result.view.buffer);
		expect(result.bytes.byteOffset).toBe(4);
		expect(result.view.byteLength).toBe(4);
		expect(result.date).toEqual(value.date);
		result.a.n = 5;
		result.bytes[0] = 9;
		expect(shared.n).toBe(1);
		expect(value.bytes[0]).toBe(0);
		expect(buffer.byteLength).toBe(32);
	});

	it('delivers a copy independent of the provider and result validator', async () => {
		const raw = { nested: { n: 1 } };
		const output = { nested: { n: 2 } };
		const f = setup({ execute: () => raw, result: schema(() => ({ value: output })) });
		const result = (await f.execute()) as typeof output;
		expect(result).not.toBe(output);
		result.nested.n = 99;
		expect(raw.nested.n).toBe(1);
		expect(output.nested.n).toBe(2);
	});

	it.each(['arguments', 'raw-result', 'argument-transform', 'result-transform'] as const)(
		'rejects unsupported nested data in %s',
		async (place) => {
			const validate = vi.fn((value: unknown) => ({ value }));
			const bad = { nested: { callback: () => undefined } };
			const f = setup({
				args: schema(place === 'argument-transform' ? () => ({ value: bad }) : validate),
				result: schema(place === 'result-transform' ? () => ({ value: bad }) : validate),
				execute: place === 'raw-result' ? () => bad : (value) => value,
			});
			await expect(f.execute(place === 'arguments' ? bad : {})).rejects.toMatchObject({
				code: place.startsWith('argument') ? 'invalid-arguments' : 'invalid-result',
			});
			if (place === 'arguments') {
				expect(validate).not.toHaveBeenCalled();
			}
			if (place.startsWith('argument')) {
				expect(f.implementation).not.toHaveBeenCalled();
			}
			expect(f.ledger.snapshot().pending).toBe(0);
		},
	);

	it.each(['args', 'result'] as const)(
		'rejects shared-memory buffers and views in %s',
		async (place) => {
			for (const shared of [new SharedArrayBuffer(8), new Uint8Array(new SharedArrayBuffer(8))]) {
				const value = { nested: shared };
				const f = setup({ execute: place === 'result' ? () => value : undefined });
				await expect(f.execute(place === 'args' ? value : {})).rejects.toMatchObject({
					code: place === 'args' ? 'invalid-arguments' : 'invalid-result',
				});
			}
		},
	);

	it.each(['args', 'result'] as const)('rejects cycles in %s', async (place) => {
		const cycle: { child?: unknown } = {};
		cycle.child = new Map([[1, new Set([cycle])]]);
		const f = setup({ execute: place === 'result' ? () => cycle : undefined });
		await expect(f.execute(place === 'args' ? cycle : {})).rejects.toMatchObject({
			code: place === 'args' ? 'invalid-arguments' : 'invalid-result',
		});
	});

	it('orders revocation, cancellation, declaration, provider, admission, then payload validation', async () => {
		const validate = vi.fn((value: unknown) => ({ value }));
		const f = setup({ args: schema(validate), limits: limits({ maxWindowPending: 1 }) });
		const cancelled = new AbortController();
		cancelled.abort();
		f.caller.abort();
		await expect(
			f.invoker.execute('missing', 'missing', f.contract, () => {}, { signal: cancelled.signal }),
		).rejects.toMatchObject({ code: 'revoked' });
		const g = setup({ args: schema(validate) });
		g.bind(undefined);
		await expect(
			g.invoker.execute('missing', 'command', g.contract, {}, { signal: cancelled.signal }),
		).rejects.toMatchObject({ code: 'cancelled' });
		await expect(g.invoker.execute('missing', 'command', g.contract, {})).rejects.toMatchObject({
			code: 'invalid-reference',
		});
		await expect(g.execute(() => {})).rejects.toMatchObject({ code: 'unavailable' });
		expect(validate).not.toHaveBeenCalled();
	});

	it('validates case-sensitive aliases and exact contract IDs/majors, always returning a promise', async () => {
		const f = setup();
		for (const alias of ['', ' ', 'Dependency', 'é'.repeat(129)]) {
			const promise = f.invoker.execute(alias, 'command', f.contract, {});
			expect(promise).toBeInstanceOf(Promise);
			await expect(promise).rejects.toMatchObject({ code: 'invalid-reference' });
		}
		for (const contract of [
			{ ...f.contract, id: 'Test.contract' },
			{ ...f.contract, major: 2 },
			{ ...f.contract, id: ' '.repeat(2) },
			{ ...f.contract, id: 'é'.repeat(129) },
		]) {
			await expect(f.invoker.execute('dependency', 'command', contract, {})).rejects.toMatchObject({
				code: 'contract-mismatch',
			});
		}
		f.bind({
			...f.binding!,
			registration: { ...f.binding!.registration, contract: { ...f.contract, major: 2 } },
		});
		await expect(f.execute()).rejects.toMatchObject({ code: 'contract-mismatch' });
	});

	it('availability never reserves capacity or validates and subscriptions are lifetime-owned', async () => {
		const validate = vi.fn((value: unknown) => ({ value }));
		const f = setup({ args: schema(validate) });
		const seen: boolean[] = [];
		const off = f.subscribe((value) => seen.push(value));
		expect(seen).toEqual([true]);
		expect(f.available()).toBe(true);
		const binding = f.binding;
		f.bind(undefined);
		f.bind(undefined);
		f.bind(binding);
		expect(seen).toEqual([true, false, true]);
		f.registration.abort();
		expect(seen).toEqual([true, false, true, false]);
		off();
		f.bind(binding);
		f.caller.abort();
		expect(seen).toHaveLength(4);
		expect(validate).not.toHaveBeenCalled();
		expect(f.ledger.snapshot().pending).toBe(0);
		expect(() => f.available()).toThrow(CommandInvocationError);
	});

	it('rejects author errors from availability methods and owns active subscriptions until caller teardown', async () => {
		const f = setup();
		expect(() => f.invoker.isAvailable('Dependency', 'command', f.contract)).toThrow(
			expect.objectContaining({ code: 'invalid-reference' }),
		);
		expect(() =>
			f.invoker.subscribeAvailability(
				'dependency',
				'command',
				{ ...f.contract, major: 2 },
				() => undefined,
			),
		).toThrow(expect.objectContaining({ code: 'contract-mismatch' }));
		const listener = vi.fn();
		f.subscribe(listener);
		expect(f.available()).toBe(true);
		const binding = f.binding;
		f.bind(undefined);
		await expect(f.execute()).rejects.toMatchObject({ code: 'unavailable' });
		f.caller.abort();
		f.bind(binding);
		expect(listener.mock.calls).toEqual([[true], [false]]);
	});

	it('accepts aliases at exactly 256 UTF-8 bytes without trimming or case folding', async () => {
		const f = setup();
		const alias = 'é'.repeat(128);
		const source = {
			...f.source,
			declarations: [{ ...f.source.declarations[0], dependencyAlias: alias, commandAlias: alias }],
		};
		const invoker = f.dispatcher.createInvoker(source);
		expect(invoker.isAvailable(alias, alias, f.contract)).toBe(true);
		await expect(invoker.execute(alias, alias, f.contract, 1)).resolves.toBe(1);
		await expect(invoker.execute(`${alias} `, alias, f.contract, 1)).rejects.toMatchObject({
			code: 'invalid-reference',
		});
	});

	it('isolates throwing availability listeners and removes them on shutdown', () => {
		const f = setup();
		const bad = vi.fn(() => {
			throw new Error('private listener');
		});
		f.subscribe(bad);
		const good = vi.fn();
		f.subscribe(good);
		f.bind(undefined);
		expect(good.mock.calls).toEqual([[true], [false]]);
		f.dispatcher.dispose();
		f.bind(undefined);
		expect(bad).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(f.diagnostics)).not.toContain('private listener');
	});

	it.each(['arguments', 'implementation', 'result'] as const)(
		'retains capacity during cancelled %s work and observes late failure',
		async (place) => {
			const work = deferred<never>();
			const inspect = vi.fn();
			const f = setup({
				args: place === 'arguments' ? schema(() => work.promise) : undefined,
				execute: place === 'implementation' ? () => work.promise : undefined,
				result: place === 'result' ? schema(() => work.promise) : undefined,
				limits: limits({ maxWindowPending: 1 }),
				inspectError: inspect,
			});
			const controller = new AbortController();
			const promise = f.execute({}, controller.signal);
			await flush();
			controller.abort();
			await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
			expect(f.ledger.snapshot().pending).toBe(1);
			await expect(f.execute()).rejects.toMatchObject({ code: 'limit-exceeded' });
			const raw = new Error('late secret');
			work.reject(raw);
			await flush();
			expect(inspect).toHaveBeenCalledWith(
				raw,
				expect.objectContaining({ code: 'execution-failed' }),
			);
			expect(f.ledger.snapshot()).toMatchObject({ bytes: 0, pending: 0 });
			if (place === 'arguments') {
				expect(f.implementation).not.toHaveBeenCalled();
			}
		},
	);

	it.each(['caller', 'provider', 'registration', 'replacement', 'removal', 'dispose'] as const)(
		'revokes pending validation on %s without starting implementation',
		async (event) => {
			const work = deferred<{ value: unknown }>();
			const f = setup({ args: schema(() => work.promise) });
			const promise = f.execute();
			if (event === 'replacement') {
				f.bind({ ...f.binding! });
			} else if (event === 'removal') {
				f.bind(undefined);
			} else if (event === 'dispose') {
				f.dispatcher.dispose();
			} else {
				f[event].abort();
			}
			await expect(promise).rejects.toMatchObject({ code: 'revoked' });
			expect(f.ledger.snapshot().pending).toBe(1);
			work.resolve({ value: {} });
			await flush();
			expect(f.implementation).not.toHaveBeenCalled();
			expect(f.ledger.snapshot().pending).toBe(0);
		},
	);

	it('revokes asynchronous result validation on provider replacement and suppresses late delivery', async () => {
		const work = deferred<{ value: unknown }>();
		const f = setup({ result: schema(() => work.promise) });
		const promise = f.execute();
		await flush();
		f.bind({ ...f.binding! });
		await expect(promise).rejects.toMatchObject({ code: 'revoked' });
		expect(f.ledger.snapshot().pending).toBe(1);
		work.resolve({ value: 'late success' });
		await flush();
		expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
		await expect(promise).rejects.toMatchObject({ code: 'revoked' });
	});

	it('keeps timer-backed cancelled work counted until the timer actually settles', async () => {
		vi.useFakeTimers();
		try {
			const f = setup({
				execute: () =>
					new Promise((resolve) => {
						setTimeout(() => resolve({}), 100);
					}),
			});
			const request = new AbortController();
			const promise = f.execute({}, request.signal);
			await flush();
			request.abort();
			await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
			expect(f.ledger.snapshot().pending).toBe(1);
			await vi.advanceTimersByTimeAsync(100);
			expect(f.ledger.snapshot().pending).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('aborts only the cancelled implementation and preserves the first processed terminal outcome', async () => {
		const work = deferred();
		const signals: AbortSignal[] = [];
		const f = setup({
			execute(_value, context) {
				signals.push(context.signal);
				return work.promise;
			},
		});
		const cancellation = new AbortController();
		const first = f.execute({}, cancellation.signal);
		const second = f.execute();
		await flush();
		cancellation.abort();
		f.provider.abort();
		await expect(first).rejects.toMatchObject({ code: 'cancelled' });
		await expect(second).rejects.toMatchObject({ code: 'revoked' });
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		work.resolve({});
		await flush();
		expect(f.ledger.snapshot().pending).toBe(0);
		const g = setup();
		const result = await g.execute(3);
		g.caller.abort();
		expect(result).toBe(3);
	});

	it.each(['arguments', 'implementation', 'result'] as const)(
		'does not trust plugin-thrown errors in %s',
		async (place) => {
			for (const raw of [
				new PayloadError('limit-exceeded'),
				new CommandInvocationError('revoked', 'secret message', 'forged'),
				{
					get message() {
						throw new Error('must not read');
					},
				},
			]) {
				const inspect = vi.fn();
				const throwing = () => {
					throw raw;
				};
				const f = setup({
					args: place === 'arguments' ? schema(throwing) : undefined,
					execute: place === 'implementation' ? throwing : undefined,
					result: place === 'result' ? schema(throwing) : undefined,
					inspectError: inspect,
				});
				await expect(f.execute()).rejects.toMatchObject({
					code: 'execution-failed',
					message: 'Command execution or validation failed unexpectedly.',
				});
				expect(inspect).toHaveBeenCalledWith(raw, expect.anything());
				expect(JSON.stringify(f.diagnostics)).not.toMatch(/secret|forged/);
			}
		},
	);

	it.each(['arguments', 'result'] as const)(
		'maps reported schema issues in %s without leaking messages',
		async (place) => {
			const failing = schema(() => ({
				issues: [{ message: 'manuscript text', path: ['secret path'] }],
			}));
			const f = setup({
				args: place === 'arguments' ? failing : undefined,
				result: place === 'result' ? failing : undefined,
			});
			await expect(f.execute()).rejects.toMatchObject({
				code: place === 'arguments' ? 'invalid-arguments' : 'invalid-result',
			});
			expect(JSON.stringify(f.diagnostics)).not.toMatch(/manuscript|secret path/);
		},
	);

	it('reserves independent copies before allocation and counts overlapping transformed representations', async () => {
		const input = { buffer: new Uint8Array(128) };
		const size = inspectCommandPayload(input).bytes;
		const validate = vi.fn((value: unknown) => ({ value }));
		const f = setup({ limits: limits({ maxWindowBytes: size * 2 - 1 }), args: schema(validate) });
		await expect(f.execute(input)).rejects.toMatchObject({ code: 'limit-exceeded' });
		expect(validate).not.toHaveBeenCalled();
		expect(f.ledger.snapshot()).toMatchObject({ bytes: 0, pending: 0 });
		const transformed = new Uint8Array(1000);
		const g = setup({
			limits: limits({ maxWindowBytes: 1500 }),
			args: schema(() => ({ value: transformed })),
		});
		await expect(g.execute(new Uint8Array(500))).rejects.toMatchObject({ code: 'limit-exceeded' });
		expect(g.implementation).not.toHaveBeenCalled();
	});

	it('rechecks mutable validator input after await before implementation', async () => {
		const work = deferred<{ value: unknown }>();
		let retained: Record<string, unknown> | undefined;
		const f = setup({
			args: schema((value) => {
				retained = value as Record<string, unknown>;
				return work.promise;
			}),
		});
		const promise = f.execute({});
		retained!.invalid = () => undefined;
		work.resolve({ value: { safe: true } });
		await expect(promise).rejects.toMatchObject({ code: 'invalid-arguments' });
		expect(f.implementation).not.toHaveBeenCalled();
	});

	it('rechecks raw results mutated during async validation', async () => {
		const work = deferred<{ value: unknown }>();
		const raw: Record<string, unknown> = {};
		const f = setup({ execute: () => raw, result: schema(() => work.promise) });
		const promise = f.execute();
		await flush();
		raw.bad = Symbol();
		work.resolve({ value: {} });
		await expect(promise).rejects.toMatchObject({ code: 'invalid-result' });
	});

	it('keeps admitted settings snapshots and applies new limits to subsequent calls', async () => {
		const work = deferred<{ value: unknown }>();
		const f = setup({ args: schema(() => work.promise) });
		const first = f.execute({});
		f.ledger.updateLimits(limits({ payload: { maxBytes: 32, maxEntries: 2, maxDepth: 1 } }));
		await expect(f.execute({})).rejects.toMatchObject({ code: 'limit-exceeded' });
		work.resolve({ value: { text: 'valid under captured settings' } });
		await expect(first).resolves.toEqual({ text: 'valid under captured settings' });
		expect(f.ledger.snapshot().pending).toBe(0);
	});

	it('reports synchronous validator warnings and separate promise elapsed time using an injected clock', async () => {
		let clock = 0;
		const work = deferred<{ value: unknown }>();
		const f = setup({
			now: () => clock,
			args: schema(() => {
				clock = 17;
				return work.promise;
			}),
		});
		const promise = f.execute({});
		expect(f.diagnostics).toContainEqual(
			expect.objectContaining({
				kind: 'validator-sync-warning',
				synchronousMs: 17,
				phase: 'arguments',
			}),
		);
		clock = 100;
		work.resolve({ value: {} });
		await expect(promise).resolves.toEqual({});
		expect(f.diagnostics).toContainEqual(
			expect.objectContaining({ kind: 'validator-elapsed', synchronousMs: 17, elapsedMs: 100 }),
		);
	});

	it('isolates reentrant diagnostic teardown and observer throws before another phase', async () => {
		let clock = 0;
		const f = setup({
			now: () => clock,
			args: schema((value) => {
				clock += 20;
				return { value };
			}),
			diagnostics() {
				f.dispatcher.dispose();
				throw new Error('observer');
			},
		});
		await expect(f.execute()).rejects.toMatchObject({ code: 'revoked' });
		expect(f.implementation).not.toHaveBeenCalled();
		expect(f.ledger.snapshot().pending).toBe(0);
	});

	it.each(['maxCallerPending', 'maxProviderPending', 'maxWindowPending'] as const)(
		'rejects %s overload before validators without queuing',
		async (limit) => {
			const work = deferred();
			const validate = vi.fn((value: unknown) => ({ value }));
			const f = setup({
				args: schema(validate),
				execute: () => work.promise,
				limits: limits({ [limit]: 1 }),
			});
			const first = f.execute({});
			await flush();
			await expect(f.execute(() => undefined)).rejects.toMatchObject({ code: 'limit-exceeded' });
			expect(validate).toHaveBeenCalledTimes(1);
			expect(f.implementation).toHaveBeenCalledTimes(1);
			work.resolve({});
			await first;
			await flush();
			expect(f.implementation).toHaveBeenCalledTimes(1);
			expect(f.ledger.snapshot().pending).toBe(0);
		},
	);

	it('counts nested invocation separately and rejects instead of waiting on its parent', async () => {
		const f = setup({
			limits: limits({ maxWindowPending: 1 }),
			execute: () => f.execute({ nested: true }),
		});
		await expect(f.execute()).rejects.toMatchObject({ code: 'execution-failed' });
		expect(f.diagnostics.some((data) => data.code === 'limit-exceeded')).toBe(true);
		expect(f.implementation).toHaveBeenCalledTimes(1);
		expect(f.ledger.snapshot().pending).toBe(0);
	});

	it.each(['maxComponentBytes', 'maxWindowBytes'] as const)(
		'deduplicates shared backing buffers but counts independent copies against %s',
		async (limit) => {
			const buffer = new ArrayBuffer(256);
			const input = { a: new Uint8Array(buffer, 10, 2), b: new DataView(buffer, 30, 2) };
			const size = inspectCommandPayload(input).bytes;
			const work = deferred();
			const f = setup({ limits: limits({ [limit]: size * 2 }), execute: () => work.promise });
			const promise = f.execute(input);
			await flush();
			expect(f.ledger.snapshot().bytes).toBe(size);
			expect(f.ledger.snapshot().components.map((component) => component.bytes)).toEqual([
				size,
				size,
			]);
			work.resolve(input);
			await expect(promise).resolves.toEqual(input);
			expect(f.ledger.snapshot().bytes).toBe(0);
		},
	);

	it.each(['argument-transform', 'raw-result', 'result-transform'] as const)(
		'checks per-payload limits for %s',
		async (place) => {
			const large = new Uint8Array(new ArrayBuffer(1000), 1, 1);
			const f = setup({
				limits: limits({ payload: { maxBytes: 500, maxEntries: 100, maxDepth: 10 } }),
				args: place === 'argument-transform' ? schema(() => ({ value: large })) : undefined,
				execute: place === 'raw-result' ? () => large : undefined,
				result: place === 'result-transform' ? schema(() => ({ value: large })) : undefined,
			});
			await expect(f.execute({})).rejects.toMatchObject({ code: 'limit-exceeded' });
			expect(f.ledger.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
		},
	);

	it('enforces depth and entry limits before schema execution', async () => {
		const validate = vi.fn((value: unknown) => ({ value }));
		for (const input of [{ nested: { nested: {} } }, new Array(100)]) {
			const f = setup({
				args: schema(validate),
				limits: limits({ payload: { maxBytes: 10000, maxDepth: 2, maxEntries: 10 } }),
			});
			await expect(f.execute(input)).rejects.toMatchObject({ code: 'limit-exceeded' });
		}
		expect(validate).not.toHaveBeenCalled();
	});

	it('isolates asynchronous availability and diagnostic observer failures', async () => {
		const f = setup({
			diagnostics: async () => {
				throw new Error('diagnostic');
			},
		});
		f.subscribe(async () => {
			throw new Error('listener');
		});
		await flush();
		f.bind(undefined);
		await expect(f.execute()).rejects.toMatchObject({ code: 'unavailable' });
		await flush();
		expect(f.diagnostics.some((data) => data.phase === 'availability-listener')).toBe(true);
	});

	it('measures throwing validators and asynchronous rejection without exposing raw messages', async () => {
		let clock = 0;
		const f = setup({
			now: () => clock,
			args: schema(() => {
				clock += 17;
				throw new Error('private');
			}),
		});
		await expect(f.execute()).rejects.toMatchObject({ code: 'execution-failed' });
		expect(f.diagnostics.some((data) => data.kind === 'validator-sync-warning')).toBe(true);
		const work = deferred<never>();
		const g = setup({ now: () => clock, args: schema(() => work.promise) });
		const promise = g.execute();
		clock += 100;
		work.reject(new Error('private'));
		await expect(promise).rejects.toMatchObject({ code: 'execution-failed' });
		expect(g.diagnostics).toContainEqual(
			expect.objectContaining({ kind: 'validator-elapsed', elapsedMs: 100, synchronousMs: 0 }),
		);
	});

	it('does not lose settled success to reentrant cleanup or later cancellation', async () => {
		const f = setup();
		const promise = f.execute({ n: 1 });
		const result = await promise;
		f.dispatcher.dispose();
		await expect(promise).resolves.toBe(result);
	});

	it('correlates safe failure metadata with opaque errors and never falls back to console', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const f = setup({
				execute() {
					throw new Error('secret manuscript');
				},
				diagnostics() {
					throw new Error('observer');
				},
			});
			const error = (await f
				.execute({ manuscript: 'private input' })
				.catch((error: unknown) => error)) as CommandInvocationError;
			expect(error).toBeInstanceOf(CommandInvocationError);
			expect(f.diagnostics[0]).toMatchObject({
				diagnosticId: error.diagnosticId,
				callerInstanceId: f.source.instanceId,
				providerInstanceId: f.binding!.instanceId,
				commandId: 'local.command',
				contractId: f.contract.id,
				major: 1,
				phase: 'implementation',
				code: 'execution-failed',
			});
			expect(JSON.stringify(f.diagnostics)).not.toMatch(
				/secret manuscript|private input|manuscript/,
			);
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});
