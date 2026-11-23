import { describe, expect, it, vi } from 'vitest';
import * as payload from './command-payload';
import { inspectCommandPayload, PayloadError } from './command-payload';
import {
	createCommandReservationLedger,
	DEFAULT_RESERVATION_LIMITS,
	type ReservationLimits,
} from './command-reservations';

const limits = (overrides: Partial<ReservationLimits> = {}): ReservationLimits => ({
	...DEFAULT_RESERVATION_LIMITS,
	...overrides,
});

function exceeded(operation: () => unknown) {
	try {
		operation();
		expect.fail('Expected reservation rejection');
	} catch (error) {
		expect(error).toBeInstanceOf(PayloadError);
		expect(error).toMatchObject({ code: 'limit-exceeded' });
	}
}

function unionBytes(values: unknown[]): number {
	const allocations = new Map<object, number>();
	let bytes = 0;
	for (const value of values) {
		const inspection = inspectCommandPayload(value);
		bytes += inspection.scalarBytes;
		for (const [object, charge] of inspection.allocations) {
			allocations.set(object, Math.max(charge, allocations.get(object) ?? 0));
		}
	}
	for (const charge of allocations.values()) {
		bytes += charge;
	}
	return bytes;
}

describe('internal command reservations', () => {
	it('has frozen approved defaults and independent window ledgers', () => {
		expect(DEFAULT_RESERVATION_LIMITS).toEqual({
			payload: { maxBytes: 8_388_608, maxDepth: 64, maxEntries: 100_000 },
			maxComponentBytes: 33_554_432,
			maxWindowBytes: 134_217_728,
			maxCallerPending: 32,
			maxProviderPending: 64,
			maxWindowPending: 256,
		});
		expect(Object.isFrozen(DEFAULT_RESERVATION_LIMITS)).toBe(true);
		expect(Object.isFrozen(DEFAULT_RESERVATION_LIMITS.payload)).toBe(true);
		const ledger = createCommandReservationLedger();
		ledger.admit('caller', 'provider').retain(null);
		expect(createCommandReservationLedger().snapshot()).toEqual({
			bytes: 0,
			pending: 0,
			components: [],
		});
	});

	const settingNames = [
		'maxComponentBytes',
		'maxWindowBytes',
		'maxCallerPending',
		'maxProviderPending',
		'maxWindowPending',
	] as const;
	const payloadSettingNames = ['maxBytes', 'maxDepth', 'maxEntries'] as const;
	for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		it(`rejects invalid settings atomically: ${value}`, () => {
			const ledger = createCommandReservationLedger();
			const call = ledger.admit('a', 'b');
			call.retain(null);
			const before = ledger.snapshot();
			for (const name of settingNames) {
				const invalid = limits({ [name]: value });
				expect(() => createCommandReservationLedger(invalid)).toThrow(RangeError);
				expect(() => ledger.updateLimits(invalid)).toThrow(RangeError);
			}
			for (const name of payloadSettingNames) {
				const invalid = limits({ payload: { ...limits().payload, [name]: value } });
				expect(() => createCommandReservationLedger(invalid)).toThrow(RangeError);
				expect(() => ledger.updateLimits(invalid)).toThrow(RangeError);
			}
			expect(ledger.snapshot()).toEqual(before);
			expect(ledger.admit('c', 'd').limits).toEqual(DEFAULT_RESERVATION_LIMITS);
		});
	}

	it('accepts safe integer extremes without imposing additional ceilings', () => {
		for (const value of [1, Number.MAX_SAFE_INTEGER]) {
			const config = limits({
				...Object.fromEntries(settingNames.map((name) => [name, value])),
				payload: { maxBytes: value, maxDepth: value, maxEntries: value },
			});
			const ledger = createCommandReservationLedger(config);
			expect(ledger.admit('a', 'b').limits).toEqual(config);
		}
	});

	it('copies and freezes initial and updated settings instead of retaining mutable input', () => {
		const config = { ...limits(), payload: { ...limits().payload } };
		const ledger = createCommandReservationLedger(config);
		config.maxCallerPending = 1;
		config.payload.maxBytes = 1;
		const first = ledger.admit('a', 'b');
		expect(first.limits).toEqual(DEFAULT_RESERVATION_LIMITS);
		expect(Object.isFrozen(first.limits)).toBe(true);
		expect(Object.isFrozen(first.limits.payload)).toBe(true);
		ledger.updateLimits(config);
		config.maxCallerPending = 10;
		config.payload.maxBytes = 100;
		const second = ledger.admit('c', 'd');
		expect(second.limits.maxCallerPending).toBe(1);
		expect(second.limits.payload.maxBytes).toBe(1);
		exceeded(() => second.retain(null));
		first.retain(null);
	});

	it.each([
		['', 'provider'],
		['caller', ''],
		['', ''],
	])('rejects empty identities without admission: %j %j', (caller, provider) => {
		const ledger = createCommandReservationLedger();
		expect(() => ledger.admit(caller, provider)).toThrow(TypeError);
		expect(ledger.snapshot()).toEqual({ bytes: 0, pending: 0, components: [] });
	});

	it.each([
		['maxCallerPending', 'a', 'c'],
		['maxProviderPending', 'c', 'b'],
		['maxWindowPending', 'c', 'd'],
	] as const)('enforces %s and leaves rejected admission atomic', (name, caller, provider) => {
		const ledger = createCommandReservationLedger(limits({ [name]: 1 }));
		const first = ledger.admit('a', 'b');
		const before = ledger.snapshot();
		exceeded(() => ledger.admit(caller, provider));
		expect(ledger.snapshot()).toEqual(before);
		first.release();
		const next = ledger.admit(caller, provider);
		expect(ledger.snapshot().pending).toBe(1);
		next.release();
		expect(ledger.snapshot().components).toEqual([]);
	});

	it('keeps caller/provider pending roles separate, including self calls and nested calls', () => {
		const ledger = createCommandReservationLedger(
			limits({ maxCallerPending: 1, maxProviderPending: 2 }),
		);
		const parent = ledger.admit('a', 'b');
		const nested = ledger.admit('b', 'b');
		expect(ledger.snapshot()).toEqual({
			bytes: 0,
			pending: 2,
			components: [
				{ id: 'a', bytes: 0, callerPending: 1, providerPending: 0 },
				{ id: 'b', bytes: 0, callerPending: 1, providerPending: 2 },
			],
		});
		exceeded(() => ledger.admit('b', 'c'));
		exceeded(() => ledger.admit('c', 'b'));
		nested.release();
		expect(ledger.snapshot().pending).toBe(1);
		parent.release();
		expect(ledger.snapshot().components).toEqual([]);
	});

	it.each(['maxComponentBytes', 'maxWindowBytes'] as const)(
		'enforces exact aggregate %s boundaries and atomic retain failure',
		(name) => {
			const ledger = createCommandReservationLedger(limits({ [name]: 16 }));
			const call = ledger.admit('a', 'b');
			const release = call.retain(null);
			call.retain(false);
			expect(ledger.snapshot().bytes).toBe(16);
			const before = ledger.snapshot();
			exceeded(() => call.retain(1));
			expect(ledger.snapshot()).toEqual(before);
			release();
			call.retain(1);
			call.release();
			expect(ledger.snapshot()).toEqual({ bytes: 0, pending: 0, components: [] });
		},
	);

	it('shares a component byte budget across incoming and outgoing invocations', () => {
		const ledger = createCommandReservationLedger(limits({ maxComponentBytes: 16 }));
		ledger.admit('a', 'b').retain(null);
		ledger.admit('b', 'c').retain(null);
		const call = ledger.admit('d', 'b');
		const before = ledger.snapshot();
		exceeded(() => call.retain(null));
		expect(ledger.snapshot()).toEqual(before);
		expect(ledger.snapshot().components.find(({ id }) => id === 'b')?.bytes).toBe(16);
		// Separate activations of the same component have distinct host-issued IDs.
		ledger.admit('b:project-2', 'e').retain(null);
	});

	it('shares the window budget between unrelated components and charges self calls once', () => {
		const ledger = createCommandReservationLedger(
			limits({ maxComponentBytes: 16, maxWindowBytes: 16 }),
		);
		const self = ledger.admit('a', 'a');
		self.retain(null);
		expect(ledger.snapshot().components).toEqual([
			{ id: 'a', bytes: 8, callerPending: 1, providerPending: 1 },
		]);
		self.retain(false);
		const other = ledger.admit('b', 'c');
		exceeded(() => other.retain(0));
		self.release();
		other.retain(0);
		expect(ledger.snapshot().bytes).toBe(8);
	});

	it('unions shared allocations, full backing buffers and overlapping representations', () => {
		const ledger = createCommandReservationLedger();
		const call = ledger.admit('a', 'b');
		const buffer = new ArrayBuffer(1024);
		const shared = { buffer };
		const first = { shared };
		const second = [shared, new Uint8Array(buffer, 4, 1)];
		const releaseFirst = call.retain(first);
		const releaseSecond = call.retain(second);
		expect(ledger.snapshot().bytes).toBe(unionBytes([first, second]));
		expect(ledger.snapshot().bytes).toBeGreaterThan(1024);
		releaseFirst();
		expect(ledger.snapshot().bytes).toBe(unionBytes([second]));
		releaseFirst();
		expect(ledger.snapshot().bytes).toBe(unionBytes([second]));
		releaseSecond();
		expect(ledger.snapshot().bytes).toBe(0);
		expect(ledger.snapshot().pending).toBe(1);
	});

	it('counts independent copies and separate invocations independently', () => {
		const ledger = createCommandReservationLedger();
		const value = { text: 'hello' };
		const first = ledger.admit('a', 'b');
		const release = first.retain(value);
		first.retain({ ...value });
		const second = ledger.admit('a', 'b');
		second.retain(value);
		const charge = inspectCommandPayload(value).bytes;
		expect(ledger.snapshot().bytes).toBe(3 * charge);
		release();
		expect(ledger.snapshot().bytes).toBe(2 * charge);
		first.release();
		expect(ledger.snapshot().bytes).toBe(charge);
		second.release();
		expect(ledger.snapshot().bytes).toBe(0);
	});

	it('deduplicates repeated object receipts but charges every primitive representation', () => {
		const ledger = createCommandReservationLedger();
		const call = ledger.admit('a', 'b');
		const object = {};
		const first = call.retain(object);
		const second = call.retain(object);
		call.retain('same');
		call.retain('same');
		expect(ledger.snapshot().bytes).toBe(64 + 2 * 24);
		first();
		expect(ledger.snapshot().bytes).toBe(64 + 2 * 24);
		second();
		expect(ledger.snapshot().bytes).toBe(2 * 24);
		call.release();
	});

	it.each([true, false])(
		'keeps maximum mutable allocation charges; largest released first: %s',
		(largestFirst) => {
			const ledger = createCommandReservationLedger();
			const call = ledger.admit('a', 'b');
			const value = { text: 'x' };
			const smallBytes = inspectCommandPayload(value).bytes;
			const small = call.retain(value);
			value.text = 'a larger value';
			const largeBytes = inspectCommandPayload(value).bytes;
			const large = call.retain(value);
			value.text = '';
			const smallestBytes = inspectCommandPayload(value).bytes;
			const smallest = call.retain(value);
			expect(ledger.snapshot().bytes).toBe(largeBytes);
			if (largestFirst) {
				large();
				expect(ledger.snapshot().bytes).toBe(smallBytes);
				small();
			} else {
				small();
				expect(ledger.snapshot().bytes).toBe(largeBytes);
				large();
			}
			expect(ledger.snapshot().bytes).toBe(smallestBytes);
			smallest();
			expect(ledger.snapshot().bytes).toBe(0);
		},
	);

	it('releases allocation sets from each inspection even after graph mutation', () => {
		const ledger = createCommandReservationLedger();
		const call = ledger.admit('a', 'b');
		const firstChild = {};
		const secondChild = {};
		const value = { child: firstChild };
		const first = call.retain(value);
		value.child = secondChild;
		const second = call.retain(value);
		expect(ledger.snapshot().bytes).toBe(inspectCommandPayload(value).bytes + 64);
		first();
		expect(ledger.snapshot().bytes).toBe(inspectCommandPayload(value).bytes);
		second();
		expect(ledger.snapshot().bytes).toBe(0);
	});

	it('does not commit partial charge increases after aggregate rejection', () => {
		const ledger = createCommandReservationLedger(limits({ maxComponentBytes: 200 }));
		const call = ledger.admit('a', 'b');
		const value = { text: '' };
		const release = call.retain(value);
		const before = ledger.snapshot();
		value.text = 'x'.repeat(100);
		exceeded(() => call.retain(value));
		expect(ledger.snapshot()).toEqual(before);
		release();
		expect(ledger.snapshot().bytes).toBe(0);
		call.retain({});
		expect(ledger.snapshot().bytes).toBe(64);
	});

	it('internally inspects bytes, depth, entries, backing buffers and unsupported data atomically', () => {
		const ledger = createCommandReservationLedger(
			limits({ payload: { maxBytes: 200, maxDepth: 1, maxEntries: 2 } }),
		);
		const call = ledger.admit('a', 'b');
		call.retain(null);
		const before = ledger.snapshot();
		for (const value of [
			'x'.repeat(100),
			{ child: {} },
			[1, 2],
			new Uint8Array(new ArrayBuffer(200), 0, 1),
		]) {
			exceeded(() => call.retain(value));
			expect(ledger.snapshot()).toEqual(before);
		}
		expect(() => call.retain(() => {})).toThrow(
			expect.objectContaining({ code: 'invalid-payload' }),
		);
		expect(ledger.snapshot()).toEqual(before);
		call.release();
	});

	it('applies lower limits to new calls, preserves old limits and shares all live counters', () => {
		const ledger = createCommandReservationLedger(limits({ maxCallerPending: 3 }));
		const first = ledger.admit('a', 'b');
		const second = ledger.admit('a', 'b');
		first.retain('x'.repeat(20));
		ledger.updateLimits(limits({ maxCallerPending: 1, maxComponentBytes: 8, maxWindowBytes: 8 }));
		exceeded(() => ledger.admit('a', 'c'));
		exceeded(() => ledger.admit('c', 'd'));
		// Existing invocations can continue under their captured larger budgets.
		second.retain('x'.repeat(20));
		expect(ledger.snapshot().bytes).toBe(112);
		first.release();
		exceeded(() => ledger.admit('a', 'c'));
		second.release();
		const next = ledger.admit('a', 'b');
		next.retain(null);
		exceeded(() => next.retain(null));
	});

	it('uses captured payload limits after both settings increases and decreases', () => {
		const ledger = createCommandReservationLedger(
			limits({ payload: { maxBytes: 8, maxDepth: 1, maxEntries: 1 } }),
		);
		const small = ledger.admit('a', 'b');
		ledger.updateLimits(DEFAULT_RESERVATION_LIMITS);
		const large = ledger.admit('a', 'b');
		exceeded(() => small.retain({}));
		large.retain({});
		ledger.updateLimits(limits({ payload: { maxBytes: 1, maxDepth: 1, maxEntries: 1 } }));
		large.retain({ child: { nested: true } });
		small.retain(null);
		exceeded(() => ledger.admit('c', 'd').retain(null));
	});

	it.each(['maxComponentBytes', 'maxWindowBytes'] as const)(
		'rejects admission above a lowered %s without cancelling existing work',
		(name) => {
			const ledger = createCommandReservationLedger();
			const old = ledger.admit('a', 'b');
			const drop = old.retain('');
			ledger.updateLimits(limits({ [name]: 8 }));
			const before = ledger.snapshot();
			exceeded(() => ledger.admit('a', 'b'));
			expect(ledger.snapshot()).toEqual(before);
			// A different instance is blocked only by a window-wide allowance.
			if (name === 'maxWindowBytes') {
				exceeded(() => ledger.admit('c', 'd'));
			} else {
				ledger.admit('c', 'd').release();
			}
			drop();
			const next = ledger.admit('a', 'b');
			next.retain(null);
			// The old invocation still has its original allowance and shared counters.
			old.retain(null);
			exceeded(() => next.retain(null));
			next.release();
			old.release();
			expect(ledger.snapshot()).toEqual({ bytes: 0, pending: 0, components: [] });
		},
	);

	it('guards near-safe-integer sums without allocating enormous payloads', () => {
		const maximum = Number.MAX_SAFE_INTEGER;
		const ledger = createCommandReservationLedger(
			limits({ maxComponentBytes: maximum, maxWindowBytes: maximum }),
		);
		const first = ledger.admit('a', 'b');
		const second = ledger.admit('c', 'd');
		// Synthetic inspection receipts exercise arithmetic, not the real payload walker.
		const inspect = vi.spyOn(payload, 'inspectCommandPayload');
		try {
			inspect.mockReturnValue({
				bytes: maximum - 8,
				scalarBytes: maximum - 8,
				depth: 0,
				entries: 0,
				allocations: new Map(),
			});
			first.retain(null);
			inspect.mockReturnValue({
				bytes: 8,
				scalarBytes: 8,
				depth: 0,
				entries: 0,
				allocations: new Map(),
			});
			second.retain(null);
			expect(ledger.snapshot().bytes).toBe(maximum);
			const before = ledger.snapshot();
			exceeded(() => second.retain(null));
			expect(ledger.snapshot()).toEqual(before);
			first.release();
			expect(ledger.snapshot().bytes).toBe(8);
			second.release();
			expect(ledger.snapshot().bytes).toBe(0);
		} finally {
			inspect.mockRestore();
		}
	});

	it('returns detached, frozen snapshots without exposing mutable counter records', () => {
		const ledger = createCommandReservationLedger();
		const call = ledger.admit('a', 'b');
		const before = ledger.snapshot();
		expect(Object.isFrozen(before)).toBe(true);
		expect(Object.isFrozen(before.components)).toBe(true);
		expect(before.components.every(Object.isFrozen)).toBe(true);
		call.retain(null);
		expect(before.bytes).toBe(0);
		expect(before.components[0].bytes).toBe(0);
		expect(ledger.snapshot().bytes).toBe(8);
	});

	it('releases all receipts idempotently, rejects later retention and permits reuse of IDs', () => {
		const ledger = createCommandReservationLedger();
		const call = ledger.admit('a', 'a');
		const release = call.retain({});
		call.retain(null);
		call.release();
		const next = ledger.admit('a', 'a');
		next.retain(null);
		release();
		call.release();
		expect(() => call.retain(null)).toThrow('already been released');
		expect(ledger.snapshot().bytes).toBe(8);
		expect(ledger.snapshot().pending).toBe(1);
		next.release();
		expect(ledger.snapshot()).toEqual({ bytes: 0, pending: 0, components: [] });
	});

	it('does not release work autonomously when the caller signals cancellation', async () => {
		const ledger = createCommandReservationLedger(limits({ maxWindowPending: 1 }));
		const call = ledger.admit('a', 'b');
		call.retain({});
		const controller = new AbortController();
		let settle!: () => void;
		const running = new Promise<void>((resolve) => {
			settle = resolve;
		});
		controller.abort();
		await Promise.resolve();
		exceeded(() => ledger.admit('c', 'd'));
		expect(ledger.snapshot()).toMatchObject({ pending: 1, bytes: 64 });
		settle();
		await running;
		// Even settlement alone cannot tell the ledger that host cleanup has finished.
		expect(ledger.snapshot().pending).toBe(1);
		call.release();
		expect(ledger.snapshot()).toEqual({ bytes: 0, pending: 0, components: [] });
	});

	it('rejects retention if inspection reentrantly releases the invocation', () => {
		const ledger = createCommandReservationLedger();
		const call = ledger.admit('a', 'b');
		const value = new Proxy(
			{},
			{
				getPrototypeOf(target) {
					call.release();
					return Reflect.getPrototypeOf(target);
				},
			},
		);
		expect(() => call.retain(value)).toThrow('already been released');
		expect(ledger.snapshot()).toEqual({ bytes: 0, pending: 0, components: [] });
	});
});
