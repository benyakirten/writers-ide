import { describe, expect, it, vi } from 'vitest';
import {
	createCommandReservationLedger,
	DEFAULT_RESERVATION_LIMITS,
	type ReservationLimits,
} from './command-reservations';
import {
	createCommandResourceSettingsClient,
	createCommandResourceSettingsCoordinator,
	type CommandResourceSettingsObserver,
	type CommandResourceSettingsService,
	type CommandResourceSettingsSnapshot,
	type CommandResourceSettingsSource,
	type CommandResourceSettingsState,
	type CommandResourceSettingsWriteResult,
} from './command-resource-settings';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
// All fixture work uses promise continuations or microtasks, not clocks or polling.
async function flush() {
	for (let index = 0; index < 20; index++) {
		await Promise.resolve();
	}
}
function state(
	revision = '0',
	overrides: Partial<ReservationLimits> = {},
): CommandResourceSettingsState {
	return { revision, settings: { ...DEFAULT_RESERVATION_LIMITS, ...overrides } };
}
function message(
	revision = '0',
	overrides: Partial<ReservationLimits> = {},
	epoch = 'service-a',
): CommandResourceSettingsSnapshot {
	return { ...state(revision, overrides), epoch };
}
function sourceFixture() {
	const reads: ReturnType<typeof deferred<CommandResourceSettingsState>>[] = [];
	const writes: ReturnType<typeof deferred<CommandResourceSettingsWriteResult>>[] = [];
	const source: CommandResourceSettingsSource = {
		read: vi.fn(() => {
			const next = deferred<CommandResourceSettingsState>();
			reads.push(next);
			return next.promise;
		}),
		write: vi.fn(() => {
			const next = deferred<CommandResourceSettingsWriteResult>();
			writes.push(next);
			return next.promise;
		}),
	};
	return { source, reads, writes };
}
function manualService(epoch = 'service-a') {
	const observers: CommandResourceSettingsObserver[] = [];
	const closes = vi.fn();
	const service: CommandResourceSettingsService = {
		epoch,
		read: vi.fn(async () => message('0', {}, epoch)),
		subscribe(observer) {
			observers.push(observer);
			return { close: closes };
		},
	};
	return {
		service,
		observers,
		closes,
		deliver(snapshot: CommandResourceSettingsSnapshot, index = observers.length - 1) {
			const ack = vi.fn();
			observers[index].snapshot(snapshot, ack);
			return ack;
		},
	};
}
function observer(autoAck = false) {
	const deliveries: { snapshot: CommandResourceSettingsSnapshot; ack: () => void }[] = [];
	const closed = vi.fn();
	return {
		deliveries,
		closed,
		snapshot(snapshot: CommandResourceSettingsSnapshot, ack: () => void) {
			deliveries.push({ snapshot, ack });
			if (autoAck) {
				ack();
			}
		},
	};
}

describe('fake-source command resource settings coordinator', () => {
	it('queues one coordinator callback during 1000 subscribe/close operations without retaining cancelled deliveries', async () => {
		const coordinator = createCommandResourceSettingsCoordinator(
			{
				read: async () => state(),
				write: async () => ({ kind: 'saved', snapshot: state('1') }),
			},
			{ maxSubscribers: 1 },
		);
		await coordinator.read();
		const callbacks: (() => void)[] = [];
		const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
			callbacks.push(callback);
		});
		try {
			const snapshot = vi.fn();
			const closed = vi.fn();
			for (let index = 0; index < 1000; index++) {
				coordinator.subscribe({ snapshot, closed }).close();
			}
			expect(microtask).toHaveBeenCalledTimes(1);
			expect(callbacks).toHaveLength(1);
			callbacks.shift()!();
			expect(snapshot).not.toHaveBeenCalled();
			expect(callbacks).toHaveLength(0);
			const live = observer(true);
			coordinator.subscribe(live);
			expect(microtask).toHaveBeenCalledTimes(2);
			callbacks.shift()!();
			expect(live.deliveries).toHaveLength(1);
			coordinator.close();
			expect(closed).not.toHaveBeenCalled();
			expect(live.closed).toHaveBeenCalledTimes(1);
			expect(callbacks).toHaveLength(0);
		} finally {
			microtask.mockRestore();
			coordinator.close();
		}
	});

	it('bounds reentrant subscription churn and defers replacement delivery to the next scheduler turn', async () => {
		const coordinator = createCommandResourceSettingsCoordinator(
			{
				read: async () => state(),
				write: async () => ({ kind: 'saved', snapshot: state('1') }),
			},
			{ maxSubscribers: 1 },
		);
		await coordinator.read();
		const callbacks: (() => void)[] = [];
		const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
			callbacks.push(callback);
		});
		try {
			const live = observer(true);
			const cancelled = observer();
			const first = coordinator.subscribe({
				snapshot(_snapshot, ack) {
					ack();
					first.close();
					for (let index = 0; index < 1000; index++) {
						coordinator.subscribe(cancelled).close();
					}
					coordinator.subscribe(live);
					expect(callbacks).toHaveLength(0);
				},
				closed() {},
			});
			callbacks.shift()!();
			expect(live.deliveries).toHaveLength(0);
			expect(callbacks).toHaveLength(1);
			expect(microtask).toHaveBeenCalledTimes(2);
			callbacks.shift()!();
			expect(live.deliveries).toHaveLength(1);
			expect(cancelled.deliveries).toHaveLength(0);
			expect(callbacks).toHaveLength(0);
		} finally {
			microtask.mockRestore();
			coordinator.close();
		}
	});
	it('releases an admission slot before resolving the caller promise', async () => {
		const coordinator = createCommandResourceSettingsCoordinator(
			{
				read: async () => state(),
				write: async () => ({ kind: 'saved', snapshot: state() }),
			},
			{ maxOperations: 1 },
		);
		await coordinator.read();
		await coordinator.read();
		await coordinator.write('0', state().settings);
		await coordinator.read();
	});

	it('does not close an active service when initial subscription admission is full', async () => {
		const { source, reads } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source, { maxOperations: 1 });
		const pending = coordinator.read();
		expect(() => coordinator.subscribe(observer())).toThrow('busy');
		await flush();
		reads[0].resolve(state());
		await pending;
		const window = observer(true);
		coordinator.subscribe(window);
		await flush();
		expect(window.deliveries).toHaveLength(1);
	});

	it('owns abandoned unknown-outcome resynchronization even if recovery then fails', async () => {
		const { source, writes, reads } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		void coordinator.write('0', state().settings);
		await flush();
		writes[0].resolve({ kind: 'outcome-unknown' });
		await flush();
		reads[0].reject(new Error('requires controlled reopen'));
		await flush();
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'closed' });
		expect(source.write).toHaveBeenCalledTimes(1);
	});

	it('drops a queued subscription delivery after unsubscribe and ignores its old ack', async () => {
		const coordinator = createCommandResourceSettingsCoordinator({
			read: async () => state(),
			write: async () => ({ kind: 'saved', snapshot: state('1') }),
		});
		await coordinator.read();
		const queued = observer();
		const subscription = coordinator.subscribe(queued);
		subscription.close();
		await flush();
		expect(queued.deliveries).toHaveLength(0);
		const active = observer();
		const next = coordinator.subscribe(active);
		await flush();
		next.close();
		await coordinator.write('0', state().settings);
		active.deliveries[0].ack();
		await flush();
		expect(active.deliveries).toHaveLength(1);
		expect(active.closed).not.toHaveBeenCalled();
	});

	it('does not emit another change for a no-op with an identical revision', async () => {
		const coordinator = createCommandResourceSettingsCoordinator({
			read: async () => state('9223372036854775807'),
			write: async () => ({ kind: 'saved', snapshot: state('9223372036854775807') }),
		});
		const window = observer(true);
		coordinator.subscribe(window);
		await flush();
		await coordinator.write('9223372036854775807', state().settings);
		await flush();
		expect(window.deliveries).toHaveLength(1);
	});

	it.each([
		{ maxCallerPending: 0 },
		{ maxProviderPending: 0 },
		{ maxWindowPending: 0 },
		{ maxComponentBytes: 0 },
		{ maxWindowBytes: 0 },
		{ payload: { ...DEFAULT_RESERVATION_LIMITS.payload, maxBytes: 0 } },
		{ payload: { ...DEFAULT_RESERVATION_LIMITS.payload, maxDepth: 0 } },
		{ payload: { ...DEFAULT_RESERVATION_LIMITS.payload, maxEntries: 0 } },
	])(
		'validates every field of complete configurations before source mutation: %j',
		async (invalid) => {
			const { source } = sourceFixture();
			const coordinator = createCommandResourceSettingsCoordinator(source);
			await expect(coordinator.write('0', state('0', invalid).settings)).rejects.toMatchObject({
				code: 'invalid-snapshot',
			});
			expect(source.write).not.toHaveBeenCalled();
		},
	);
	it('orders subscription with initialization and a concurrent newer commit', async () => {
		const { source, reads, writes } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const early = observer(true);
		coordinator.subscribe(early);
		const saved = coordinator.write('0', state('1').settings);
		await flush();
		writes[0].resolve({ kind: 'saved', snapshot: state('1', { maxWindowPending: 17 }) });
		await saved;
		const late = observer(true);
		coordinator.subscribe(late);
		reads[0].resolve(state('0'));
		await flush();
		expect(early.deliveries.map((entry) => entry.snapshot.revision)).toEqual(['1']);
		expect(late.deliveries.map((entry) => entry.snapshot.revision)).toEqual(['1']);
		expect(late.deliveries[0].snapshot.settings.maxWindowPending).toBe(17);
	});

	it('reconciles a discarded caller promise and ignores older read/write completions', async () => {
		const { source, reads, writes } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const window = observer(true);
		coordinator.subscribe(window);
		const oldRead = coordinator.read();
		const olderSave = coordinator.write('0', state('1').settings);
		// Deliberately discard this admitted write's returned promise.
		void coordinator.write('1', state('2').settings);
		await flush();
		writes[1].resolve({ kind: 'saved', snapshot: state('2') });
		await flush();
		writes[0].resolve({ kind: 'saved', snapshot: state('1') });
		reads[0].resolve(state('0'));
		reads[1].resolve(state('1'));
		expect((await olderSave).kind).toBe('saved');
		expect((await oldRead).revision).toBe('2');
		await flush();
		expect(window.deliveries.map((entry) => entry.snapshot.revision)).toEqual(['2']);
	});

	it('retains one delivery plus only the latest replacement for each blocked subscriber', async () => {
		const source: CommandResourceSettingsSource = {
			read: async () => state('0'),
			write: async (expected, settings) => ({
				kind: 'saved',
				snapshot: { revision: String(BigInt(expected) + 1n), settings },
			}),
		};
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const slow = observer();
		const fast = observer(true);
		coordinator.subscribe(slow);
		coordinator.subscribe(fast);
		await flush();
		for (let index = 0; index < 50; index++) {
			await coordinator.write(String(index), state().settings);
		}
		expect(slow.deliveries).toHaveLength(1);
		expect(fast.deliveries.at(-1)?.snapshot.revision).toBe('50');
		slow.deliveries[0].ack();
		slow.deliveries[0].ack();
		await flush();
		expect(slow.deliveries.map((entry) => entry.snapshot.revision)).toEqual(['0', '50']);
		slow.deliveries[0].ack();
		await coordinator.write('50', state().settings);
		await flush();
		expect(slow.deliveries).toHaveLength(2);
		slow.deliveries[1].ack();
		await flush();
		expect(slow.deliveries.map((entry) => entry.snapshot.revision)).toEqual(['0', '50', '51']);
	});

	it('resynchronizes an unknown outcome without retrying a write or claiming save success', async () => {
		const { source, reads, writes } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source, { maxOperations: 1 });
		const window = observer(true);
		coordinator.subscribe(window);
		await flush();
		reads[0].resolve(state());
		await flush();
		const save = coordinator.write('0', state().settings);
		await flush();
		writes[0].resolve({ kind: 'outcome-unknown' });
		await flush();
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'busy' });
		expect(source.write).toHaveBeenCalledTimes(1);
		expect(source.read).toHaveBeenCalledTimes(2);
		reads[1].resolve(state('3'));
		await expect(save).resolves.toEqual({ kind: 'outcome-unknown' });
		await flush();
		expect(window.deliveries.at(-1)?.snapshot.revision).toBe('3');
		expect(source.write).toHaveBeenCalledTimes(1);
	});

	it('closes if unknown-outcome resynchronization fails; old handles never retarget', async () => {
		const { source, reads, writes } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const window = observer();
		coordinator.subscribe(window);
		await flush();
		reads[0].resolve(state());
		await flush();
		const save = coordinator.write('0', state().settings);
		const rejected = expect(save).rejects.toMatchObject({ code: 'closed' });
		await flush();
		writes[0].resolve({ kind: 'outcome-unknown' });
		await flush();
		reads[1].reject(new Error('recovery required'));
		await rejected;
		expect(window.closed).toHaveBeenCalledTimes(1);
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'closed' });
		await expect(coordinator.write('0', state().settings)).rejects.toMatchObject({
			code: 'closed',
		});
		expect(() => coordinator.subscribe(observer())).toThrow('closed');
		const replacement = createCommandResourceSettingsCoordinator(source);
		expect(replacement.epoch).not.toBe(coordinator.epoch);
	});

	it('also resynchronizes a rejected source write, without reissuing it', async () => {
		const read = vi.fn(async () => state('4'));
		const write = vi.fn(async () => {
			throw new Error('lost reply');
		});
		const coordinator = createCommandResourceSettingsCoordinator({ read, write });
		await expect(coordinator.write('3', state().settings)).rejects.toThrow('lost reply');
		expect(read).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
		const window = observer(true);
		coordinator.subscribe(window);
		await flush();
		expect(window.deliveries[0].snapshot.revision).toBe('4');
	});

	it('bounds admitted operations and subscriptions, including stalled source work', async () => {
		const { source, reads } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source, {
			maxOperations: 1,
			maxSubscribers: 1,
		});
		const first = coordinator.read();
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'busy' });
		await expect(coordinator.write('0', state().settings)).rejects.toMatchObject({ code: 'busy' });
		await flush();
		expect(source.read).toHaveBeenCalledTimes(1);
		expect(source.write).not.toHaveBeenCalled();
		reads[0].resolve(state());
		await first;
		await flush();
		const subscription = coordinator.subscribe(observer());
		expect(() => coordinator.subscribe(observer())).toThrow('busy');
		subscription.close();
		expect(() => coordinator.subscribe(observer())).not.toThrow();
	});

	it('isolates throwing and rejecting observers and closure callbacks', async () => {
		const coordinator = createCommandResourceSettingsCoordinator({
			read: async () => state(),
			write: async () => ({ kind: 'outcome-unknown' }),
		});
		const badClosed = vi.fn(() => {
			throw new Error('close failure');
		});
		coordinator.subscribe({
			snapshot() {
				throw new Error('sync failure');
			},
			closed: badClosed,
		});
		coordinator.subscribe({
			async snapshot() {
				throw new Error('async failure');
			},
			closed: badClosed,
		});
		const good = observer(true);
		coordinator.subscribe(good);
		await flush();
		expect(good.deliveries).toHaveLength(1);
		expect(badClosed).toHaveBeenCalledTimes(2);
		coordinator.close();
		expect(good.closed).toHaveBeenCalledTimes(1);
		coordinator.close();
		expect(good.closed).toHaveBeenCalledTimes(1);
	});

	it('handles reentrant ack, subscribe, unsubscribe and coordinator close without queued delivery', async () => {
		const coordinator = createCommandResourceSettingsCoordinator({
			read: async () => state(),
			write: async () => ({ kind: 'outcome-unknown' }),
		});
		const queued = observer();
		coordinator.subscribe({
			snapshot(_snapshot, ack) {
				ack();
				ack();
				coordinator.subscribe(queued);
				coordinator.close();
			},
			closed() {},
		});
		await flush();
		expect(queued.deliveries).toHaveLength(0);
		expect(queued.closed).toHaveBeenCalledTimes(1);
	});

	it('rejects pending callers on close and never publishes a late committed write', async () => {
		const { source, writes } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const save = coordinator.write('0', state().settings);
		const rejected = expect(save).rejects.toMatchObject({ code: 'closed' });
		await flush();
		coordinator.close();
		await rejected;
		writes[0].resolve({ kind: 'saved', snapshot: state('1') });
		await flush();
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'closed' });
	});

	it('does not even invoke a source operation if closed before the admitted continuation starts', async () => {
		const { source } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const save = coordinator.write('0', state().settings);
		const rejected = expect(save).rejects.toMatchObject({ code: 'closed' });
		coordinator.close();
		await rejected;
		await flush();
		expect(source.write).not.toHaveBeenCalled();
		expect(source.read).not.toHaveBeenCalled();
	});

	it('captures immutable full snapshots and write inputs before admission', async () => {
		const { source, writes } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const input = { ...state().settings, payload: { ...state().settings.payload } };
		const save = coordinator.write('0', input);
		input.maxCallerPending = 999;
		input.payload.maxBytes = 1;
		await flush();
		const submitted = vi.mocked(source.write).mock.calls[0][1];
		expect(submitted.maxCallerPending).toBe(DEFAULT_RESERVATION_LIMITS.maxCallerPending);
		expect(Object.isFrozen(submitted.payload)).toBe(true);
		const output = { revision: '1', settings: { ...input, payload: { ...input.payload } } };
		writes[0].resolve({ kind: 'saved', snapshot: output });
		const result = await save;
		if (result.kind === 'outcome-unknown') {
			throw new Error('Expected confirmed write');
		}
		output.settings.payload.maxBytes = 10;
		expect(result.snapshot.settings.payload.maxBytes).toBe(1);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.snapshot)).toBe(true);
		expect(Object.isFrozen(result.snapshot.settings)).toBe(true);
	});

	it('publishes conflict state but does not replay or relabel the save', async () => {
		const write = vi.fn(async (): Promise<CommandResourceSettingsWriteResult> => ({
			kind: 'conflict',
			snapshot: state('8'),
		}));
		const coordinator = createCommandResourceSettingsCoordinator({
			read: async () => state('8'),
			write,
		});
		await expect(coordinator.write('2', state().settings)).resolves.toMatchObject({
			kind: 'conflict',
			snapshot: { revision: '8' },
		});
		const window = observer(true);
		coordinator.subscribe(window);
		await flush();
		expect(window.deliveries[0].snapshot.revision).toBe('8');
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('closes on equal-revision inconsistent source completions', async () => {
		let next = state('4');
		const coordinator = createCommandResourceSettingsCoordinator({
			read: async () => next,
			write: async () => ({ kind: 'outcome-unknown' }),
		});
		await coordinator.read();
		next = state('4', { maxWindowPending: 1 });
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'closed' });
		await expect(coordinator.read()).rejects.toMatchObject({ code: 'closed' });
	});

	it.each([
		'',
		'00',
		'01',
		'-1',
		'+1',
		'1.0',
		'1e2',
		' 1',
		'9223372036854775808',
		'99999999999999999999',
	])('rejects noncanonical or out-of-range revision %j before writing', async (invalid) => {
		const { source } = sourceFixture();
		const coordinator = createCommandResourceSettingsCoordinator(source);
		await expect(coordinator.write(invalid, state().settings)).rejects.toMatchObject({
			code: 'invalid-snapshot',
		});
		expect(source.write).not.toHaveBeenCalled();
	});
});

describe('resource settings client admission and associations', () => {
	it.each(['01', '-1', '9223372036854775808'])(
		'pauses on an invalid delivered revision %j',
		(invalid) => {
			const client = createCommandResourceSettingsClient();
			const service = manualService();
			client.attach(service.service);
			expect(service.deliver(message(invalid))).not.toHaveBeenCalled();
			expect(client.status).toBe('stale');
		},
	);

	it('isolates a throwing acknowledgment by pausing without undoing applied limits', () => {
		const underlying = createCommandReservationLedger();
		const client = createCommandResourceSettingsClient(underlying);
		const service = manualService();
		client.attach(service.service);
		service.observers[0].snapshot(message('0', { maxWindowPending: 7 }), () => {
			throw new Error('transport acknowledgment failed');
		});
		expect(client.status).toBe('stale');
		expect(() => client.ledger.admit('a', 'b')).toThrow('not-ready');
		const direct = underlying.admit('a', 'b');
		expect(direct.limits.maxWindowPending).toBe(7);
		direct.release();
	});
	it('pauses before the first snapshot, wraps the existing ledger and preserves outstanding work', () => {
		const underlying = createCommandReservationLedger();
		const oldCall = underlying.admit('caller', 'provider');
		oldCall.retain('retained payload');
		const before = underlying.snapshot();
		const client = createCommandResourceSettingsClient(underlying);
		const wrapper = client.ledger;
		const service = manualService();
		expect(client.status).toBe('disconnected');
		expect(() => wrapper.admit('caller', 'provider')).toThrow('not-ready');
		client.attach(service.service);
		expect(client.status).toBe('connecting');
		expect(() => wrapper.admit('caller', 'provider')).toThrow('not-ready');
		const ack = service.deliver(message('1', { maxWindowPending: 1, maxWindowBytes: 1 }));
		expect(ack).toHaveBeenCalledTimes(1);
		expect(client.status).toBe('ready');
		expect(client.ledger).toBe(wrapper);
		expect(wrapper.snapshot()).toEqual(before);
		expect(oldCall.limits).toEqual(DEFAULT_RESERVATION_LIMITS);
		expect(() => wrapper.admit('caller', 'provider')).toThrow(
			'Command payload exceeds its resource limits.',
		);
		// Disconnect neither cancels nor releases the admitted work or retained data.
		client.disconnect();
		expect(wrapper.snapshot()).toEqual(before);
		oldCall.retain('still allowed by captured limits');
		oldCall.release();
		expect(wrapper.snapshot()).toMatchObject({ pending: 0, bytes: 0 });
		expect(() => wrapper.updateLimits(DEFAULT_RESERVATION_LIMITS)).toThrow('settings-owned');
	});

	it('acknowledges only after applying all eight values and refuses admission during apply', () => {
		const underlying = createCommandReservationLedger();
		const apply = vi.spyOn(underlying, 'updateLimits');
		const client = createCommandResourceSettingsClient(underlying);
		const service = manualService();
		client.attach(service.service);
		apply.mockImplementation((settings) => {
			expect(() => client.ledger.admit('a', 'b')).toThrow('not-ready');
			expect(settings).toEqual(message('0').settings);
		});
		const ack = vi.fn(() => {
			expect(apply).toHaveBeenCalledTimes(1);
			expect(client.status).toBe('ready');
		});
		service.observers[0].snapshot(message(), ack);
		expect(ack).toHaveBeenCalledTimes(1);
	});

	it('compares decimal revisions numerically and acknowledges only identical duplicates', () => {
		const underlying = createCommandReservationLedger();
		const apply = vi.spyOn(underlying, 'updateLimits');
		const client = createCommandResourceSettingsClient(underlying);
		const service = manualService();
		client.attach(service.service);
		for (const revision of [
			'9',
			'10',
			'9007199254740992',
			'9007199254740993',
			'9223372036854775807',
		]) {
			expect(service.deliver(message(revision))).toHaveBeenCalledTimes(1);
		}
		expect(service.deliver(message('100'))).not.toHaveBeenCalled();
		expect(service.deliver(message('9223372036854775807'))).toHaveBeenCalledTimes(1);
		expect(apply).toHaveBeenCalledTimes(5);
		expect(
			service.deliver(message('9223372036854775807', { maxCallerPending: 1 })),
		).not.toHaveBeenCalled();
		expect(client.status).toBe('stale');
		expect(service.closes).toHaveBeenCalledTimes(1);
		expect(() => client.ledger.admit('a', 'b')).toThrow('not-ready');
	});

	it('ignores queued messages and closure from old subscriptions; accepts lower revisions only on explicit reattach', () => {
		const client = createCommandResourceSettingsClient();
		const first = manualService();
		const replacement = manualService('service-b');
		client.attach(first.service);
		first.deliver(message('50'));
		first.observers[0].closed();
		expect(client.status).toBe('stale');
		expect(first.deliver(message('51'))).not.toHaveBeenCalled();
		client.attach(replacement.service);
		expect(client.status).toBe('connecting');
		expect(first.deliver(message('100'))).not.toHaveBeenCalled();
		expect(
			replacement.deliver(message('0', { maxWindowPending: 3 }, 'service-b')),
		).toHaveBeenCalledTimes(1);
		first.observers[0].closed();
		expect(client.status).toBe('ready');
		const call = client.ledger.admit('a', 'b');
		expect(call.limits.maxWindowPending).toBe(3);
		call.release();
	});

	it('does not accept an unsolicited new epoch', () => {
		const client = createCommandResourceSettingsClient();
		const service = manualService();
		client.attach(service.service);
		service.deliver(message());
		expect(service.deliver(message('1', {}, 'unattached-service'))).not.toHaveBeenCalled();
		expect(client.status).toBe('stale');
	});

	it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'pauses on invalid resource value %s without acknowledgment',
		(value) => {
			const client = createCommandResourceSettingsClient();
			const service = manualService();
			client.attach(service.service);
			service.deliver(message());
			expect(
				service.deliver(
					message('1', { payload: { ...DEFAULT_RESERVATION_LIMITS.payload, maxDepth: value } }),
				),
			).not.toHaveBeenCalled();
			expect(client.status).toBe('stale');
		},
	);

	it('accepts positive safe integer extremes and independent budgets without imposing relationships', () => {
		const client = createCommandResourceSettingsClient();
		const service = manualService();
		client.attach(service.service);
		const ack = service.deliver(
			message('0', {
				maxWindowBytes: 1,
				maxComponentBytes: Number.MAX_SAFE_INTEGER,
				payload: { maxBytes: Number.MAX_SAFE_INTEGER, maxDepth: 1, maxEntries: 1 },
			}),
		);
		expect(ack).toHaveBeenCalledTimes(1);
		expect(client.status).toBe('ready');
	});

	it('does not acknowledge failed apply and ignores messages after disposal', () => {
		const underlying = createCommandReservationLedger();
		vi.spyOn(underlying, 'updateLimits').mockImplementation(() => {
			throw new Error('apply failed');
		});
		const client = createCommandResourceSettingsClient(underlying);
		const service = manualService();
		client.attach(service.service);
		expect(service.deliver(message())).not.toHaveBeenCalled();
		expect(client.status).toBe('stale');
		client.dispose();
		client.disconnect();
		expect(client.status).toBe('disposed');
		expect(service.deliver(message('1'))).not.toHaveBeenCalled();
		expect(() => client.attach(service.service)).toThrow('closed');
	});

	it('does not resurrect a disposed client when prior subscription cleanup reenters dispose', () => {
		const client = createCommandResourceSettingsClient();
		const first = manualService();
		const next = manualService('service-b');
		first.closes.mockImplementation(() => client.dispose());
		client.attach(first.service);
		first.deliver(message());
		client.attach(next.service);
		expect(client.status).toBe('disposed');
		expect(first.closes).toHaveBeenCalledTimes(1);
		expect(next.observers).toHaveLength(0);
		expect(first.deliver(message('1'))).not.toHaveBeenCalled();
		expect(() => client.ledger.admit('a', 'b')).toThrow('not-ready');
		expect(() => client.attach(next.service)).toThrow('closed');
	});

	it('preserves a reentrant replacement attachment instead of overwriting or leaking its subscription', () => {
		const client = createCommandResourceSettingsClient();
		const first = manualService();
		const superseded = manualService('service-b');
		const replacement = manualService('service-c');
		first.closes.mockImplementation(() => {
			client.attach(replacement.service);
			replacement.deliver(message('0', { maxWindowPending: 3 }, 'service-c'));
		});
		client.attach(first.service);
		first.deliver(message());
		client.attach(superseded.service);
		expect(first.closes).toHaveBeenCalledTimes(1);
		expect(superseded.observers).toHaveLength(0);
		expect(replacement.observers).toHaveLength(1);
		expect(replacement.closes).not.toHaveBeenCalled();
		expect(client.status).toBe('ready');
		first.observers[0].closed();
		expect(first.deliver(message('9'))).not.toHaveBeenCalled();
		const call = client.ledger.admit('a', 'b');
		expect(call.limits.maxWindowPending).toBe(3);
		call.release();
		client.dispose();
		expect(replacement.closes).toHaveBeenCalledTimes(1);
		expect(replacement.deliver(message('1', {}, 'service-c'))).not.toHaveBeenCalled();
		expect(client.status).toBe('disposed');
	});

	it('handles synchronous subscribe closure, delivery and disconnect during application', () => {
		const first = manualService();
		const closedClient = createCommandResourceSettingsClient();
		closedClient.attach({
			...first.service,
			subscribe(observer) {
				observer.closed();
				return { close: first.closes };
			},
		});
		expect(closedClient.status).toBe('stale');
		expect(first.closes).toHaveBeenCalledTimes(1);
		const underlying = createCommandReservationLedger();
		const client = createCommandResourceSettingsClient(underlying);
		vi.spyOn(underlying, 'updateLimits').mockImplementation(() => client.disconnect());
		const ack = vi.fn();
		client.attach({
			...first.service,
			subscribe(observer) {
				observer.snapshot(message(), ack);
				return { close: first.closes };
			},
		});
		expect(client.status).toBe('disconnected');
		expect(ack).not.toHaveBeenCalled();
		expect(first.closes).toHaveBeenCalledTimes(2);
	});

	it('allows acknowledgment to reenter with a newer message without regressing applied state', () => {
		const client = createCommandResourceSettingsClient();
		const service = manualService();
		client.attach(service.service);
		service.observers[0].snapshot(message('0'), () => {
			service.deliver(message('1', { maxWindowPending: 2 }));
		});
		expect(client.status).toBe('ready');
		const call = client.ledger.admit('a', 'b');
		expect(call.limits.maxWindowPending).toBe(2);
		call.release();
		expect(service.deliver(message('0'))).not.toHaveBeenCalled();
	});

	it('fails closed on an overlapping reentrant apply instead of regressing limits', () => {
		const underlying = createCommandReservationLedger();
		const client = createCommandResourceSettingsClient(underlying);
		const service = manualService();
		client.attach(service.service);
		vi.spyOn(underlying, 'updateLimits').mockImplementation(() => {
			service.deliver(message('1'));
		});
		expect(service.deliver(message())).not.toHaveBeenCalled();
		expect(client.status).toBe('stale');
	});

	it('integrates independent window ledgers, commit delivery, disconnect and explicit fresh service attachment', async () => {
		let saved = state();
		const source: CommandResourceSettingsSource = {
			read: async () => saved,
			write: async (_expected, settings) => {
				saved = { revision: '1', settings };
				return { kind: 'saved', snapshot: saved };
			},
		};
		const coordinator = createCommandResourceSettingsCoordinator(source);
		const first = createCommandResourceSettingsClient();
		const second = createCommandResourceSettingsClient();
		first.attach(coordinator);
		second.attach(coordinator);
		await flush();
		const call = first.ledger.admit('a', 'b');
		call.retain('ongoing work');
		const before = first.ledger.snapshot();
		await coordinator.write('0', state('1', { maxWindowPending: 1 }).settings);
		await flush();
		expect(first.ledger.snapshot()).toEqual(before);
		expect(second.ledger.snapshot().pending).toBe(0);
		expect(() => first.ledger.admit('a', 'b')).toThrow(
			'Command payload exceeds its resource limits.',
		);
		const other = second.ledger.admit('a', 'b');
		expect(other.limits.maxWindowPending).toBe(1);
		expect(call.limits.maxWindowPending).toBe(256);
		coordinator.close();
		expect(first.status).toBe('stale');
		expect(second.status).toBe('stale');
		expect(first.ledger.snapshot()).toEqual(before);
		saved = state('0');
		const replacement = createCommandResourceSettingsCoordinator(source);
		first.attach(replacement);
		await flush();
		expect(first.status).toBe('ready');
		expect(second.status).toBe('stale');
		expect(first.ledger.snapshot()).toEqual(before);
		call.release();
		other.release();
		first.dispose();
		second.dispose();
	});
});
