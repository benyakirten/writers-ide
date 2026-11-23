import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
	copyCommandPayload,
	DEFAULT_PAYLOAD_LIMITS,
	inspectCommandPayload,
	PayloadError,
	type PayloadLimits,
} from './command-payload';

const limits = (overrides: Partial<PayloadLimits> = {}): PayloadLimits => ({
	...DEFAULT_PAYLOAD_LIMITS,
	...overrides,
});

function rejects(value: unknown, code = 'invalid-payload', budget?: PayloadLimits) {
	for (const operation of [inspectCommandPayload, copyCommandPayload]) {
		try {
			operation(value, budget);
			expect.fail('Expected payload rejection');
		} catch (error) {
			expect(error).toBeInstanceOf(PayloadError);
			expect(error).toMatchObject({ code });
		}
	}
}

function boundary(value: unknown, bytes: number, entries: number, depth: number) {
	const inspection = inspectCommandPayload(value);
	expect(inspection).toMatchObject({ bytes, entries, depth });
	expect(
		[...inspection.allocations.values()].reduce(
			(sum, charge) => sum + charge,
			inspection.scalarBytes,
		),
	).toBe(bytes);
	expect(() => copyCommandPayload(value, limits({ maxBytes: bytes }))).not.toThrow();
	rejects(value, 'limit-exceeded', limits({ maxBytes: bytes - 1 }));
	if (entries > 0) {
		expect(() => inspectCommandPayload(value, limits({ maxEntries: entries }))).not.toThrow();
		rejects(value, 'limit-exceeded', limits({ maxEntries: entries - 1 }));
	}
	if (depth > 0) {
		expect(() => inspectCommandPayload(value, limits({ maxDepth: depth }))).not.toThrow();
		rejects(value, 'limit-exceeded', limits({ maxDepth: depth - 1 }));
	}
}

describe('command payload inspection and copying', () => {
	it('has frozen approved defaults', () => {
		expect(DEFAULT_PAYLOAD_LIMITS).toEqual({
			maxBytes: 8_388_608,
			maxDepth: 64,
			maxEntries: 100_000,
		});
		expect(Object.isFrozen(DEFAULT_PAYLOAD_LIMITS)).toBe(true);
	});

	it('charges and copies primitives without coercion', () => {
		for (const value of [null, undefined, false, true, 0, -0, NaN, Infinity, -Infinity]) {
			boundary(value, 8, 0, 0);
			expect(Object.is(copyCommandPayload(value), value)).toBe(true);
		}
		for (const [value, bytes] of [
			['', 16],
			['a😀', 22],
			[0n, 16],
			[1n, 17],
			[-255n, 17],
			[256n, 18],
			[-65536n, 19],
		] as const) {
			boundary(value, bytes, 0, 0);
			expect(copyCommandPayload(value)).toBe(value);
		}
		rejects(1n << 1_000_000n, 'limit-exceeded', limits({ maxBytes: 32 }));
		rejects(-(1n << 1_000_000n), 'limit-exceeded', limits({ maxBytes: 32 }));
	});

	it('uses exact container, slot, key and allocation charges', () => {
		boundary({}, 64, 1, 1);
		boundary({ a: 1 }, 106, 2, 1);
		boundary([1, 'x'], 122, 3, 1);
		boundary(new Date(123), 64, 1, 1);
		boundary(new Map([['a', 1]]), 122, 3, 1);
		boundary(new Set([true, null]), 112, 3, 1);
		const child = { title: 'Chapter one' };
		const value = [child, child];
		boundary(value, 240, 5, 2);
		const inspection = inspectCommandPayload(value);
		expect(inspection.scalarBytes).toBe(0);
		expect(inspection.allocations.get(value)).toBe(96);
		expect(inspection.allocations.get(child)).toBe(144);
	});

	it('exposes allocation charges that can be unioned across retained representations', () => {
		const buffer = new ArrayBuffer(32);
		const shared = { buffer };
		const first = { shared };
		const second = [shared, new Uint8Array(buffer, 4, 2)];
		const a = inspectCommandPayload(first);
		const b = inspectCommandPayload(second);
		const union = new Map([...a.allocations, ...b.allocations]);
		const sum = [...union.values()].reduce((total, charge) => total + charge, 0);
		expect(sum).toBe(a.bytes + b.bytes - a.allocations.get(shared)! - a.allocations.get(buffer)!);
		const independent = inspectCommandPayload(copyCommandPayload(first));
		expect([...independent.allocations.keys()].every((object) => !union.has(object))).toBe(true);
	});

	it('charges holes by declared length while preserving holes', () => {
		const sparse = new Array(4);
		sparse[2] = undefined;
		boundary(sparse, 136, 5, 1);
		const copy = copyCommandPayload(sparse) as unknown[];
		expect(copy.length).toBe(4);
		expect(0 in copy).toBe(false);
		expect(2 in copy).toBe(true);
		rejects(new Array(2 ** 32 - 1), 'limit-exceeded');
		rejects(new Array(100_000), 'limit-exceeded');
		expect(inspectCommandPayload(new Array(99_999)).entries).toBe(100_000);
	});

	it('checks default depth and every path through repeated subtrees', () => {
		let value: unknown = {};
		for (let index = 1; index < 64; index++) {
			value = [value];
		}
		expect(inspectCommandPayload(value).depth).toBe(64);
		rejects([value], 'limit-exceeded');
		const leaf = {};
		const subtree = [leaf];
		const dag = [subtree, [[subtree]]];
		expect(inspectCommandPayload(dag).depth).toBe(5);
		rejects(dag, 'limit-exceeded', limits({ maxDepth: 4 }));
		expect(inspectCommandPayload([[[subtree]], subtree]).depth).toBe(5);
	});

	it('handles long paths iteratively and exponentially many DAG paths once', () => {
		let chain: unknown = null;
		for (let index = 0; index < 10_000; index++) {
			chain = [chain];
		}
		const budget = limits({ maxDepth: 10_000 });
		expect(inspectCommandPayload(chain, budget).depth).toBe(10_000);
		expect(() => copyCommandPayload(chain, budget)).not.toThrow();
		let dag: unknown = {};
		for (let index = 0; index < 60; index++) {
			dag = [dag, dag];
		}
		expect(inspectCommandPayload(dag)).toMatchObject({ depth: 61, entries: 181 });
		expect(() => copyCommandPayload(dag)).not.toThrow();
	});

	it('rejects cycles through records, arrays, maps and sets', () => {
		const record: Record<string, unknown> = {};
		record.self = record;
		const array: unknown[] = [];
		array.push({ parent: array });
		const map = new Map();
		map.set('self', map);
		const keyCycle = new Map();
		keyCycle.set(keyCycle, 1);
		const set = new Set();
		set.add(set);
		for (const value of [record, array, map, keyCycle, set]) {
			rejects(value);
		}
	});

	it('copies dates and shared map keys/values/set members independently', () => {
		const date = new Date(1234);
		const child = { date };
		const value = { child, date, map: new Map([[child, child]]), set: new Set([child]) };
		const copy = copyCommandPayload(value) as typeof value;
		expect(copy.child).not.toBe(child);
		expect(copy.child.date).toBe(copy.date);
		expect(copy.map.get(copy.child)).toBe(copy.child);
		expect(copy.set.has(copy.child)).toBe(true);
		copy.date.setTime(99);
		copy.map.clear();
		copy.set.clear();
		expect(date.getTime()).toBe(1234);
		expect(value.map.size).toBe(1);
		expect(value.set.size).toBe(1);
		expect((copyCommandPayload(new Date(NaN)) as Date).getTime()).toBeNaN();
	});

	it('charges full backing buffers once and does not add a buffer depth level', () => {
		const buffer = new ArrayBuffer(32);
		const view = new Uint8Array(buffer, 12, 2);
		boundary(buffer, 96, 1, 1);
		boundary(view, 160, 2, 1);
		boundary([buffer, view, view], 272, 6, 2);
		const inspection = inspectCommandPayload(view);
		expect(inspection.allocations.get(view)).toBe(64);
		expect(inspection.allocations.get(buffer)).toBe(96);
		rejects(
			new Uint8Array(new ArrayBuffer(1024), 500, 1),
			'limit-exceeded',
			limits({ maxBytes: 200 }),
		);
		rejects(new ArrayBuffer(DEFAULT_PAYLOAD_LIMITS.maxBytes), 'limit-exceeded');
		boundary(
			new ArrayBuffer(DEFAULT_PAYLOAD_LIMITS.maxBytes - 64),
			DEFAULT_PAYLOAD_LIMITS.maxBytes,
			1,
			1,
		);
	});

	it('preserves all standard binary types, ranges and shared backing relationships', () => {
		const buffer = new ArrayBuffer(128);
		new Uint8Array(buffer).set([1, 2, 3, 4, 5]);
		const constructors = [
			Int8Array,
			Uint8Array,
			Uint8ClampedArray,
			Int16Array,
			Uint16Array,
			Int32Array,
			Uint32Array,
			Float32Array,
			Float64Array,
			BigInt64Array,
			BigUint64Array,
		];
		const views = constructors.map((Constructor) => new Constructor(buffer, 16, 3));
		const Float16 = Object.getOwnPropertyDescriptor(globalThis, 'Float16Array')?.value;
		if (typeof Float16 === 'function') {
			const half = new Float16(buffer, 6, 3);
			const halfCopy = copyCommandPayload(half) as ArrayBufferView;
			expect(halfCopy.constructor).toBe(Float16);
			expect(halfCopy.byteOffset).toBe(6);
			expect(halfCopy.byteLength).toBe(6);
			boundary(half, 256, 2, 1);
		}
		const data = new DataView(buffer, 7, 19);
		const value = { buffer, views, data, again: views[0] };
		const copy = copyCommandPayload(value) as typeof value;
		expect(copy.buffer).not.toBe(buffer);
		expect(copy.again).toBe(copy.views[0]);
		for (let index = 0; index < views.length; index++) {
			expect(copy.views[index].constructor).toBe(constructors[index]);
			expect(copy.views[index].buffer).toBe(copy.buffer);
			expect(copy.views[index].byteOffset).toBe(16);
			expect(copy.views[index].length).toBe(3);
		}
		expect(copy.data.buffer).toBe(copy.buffer);
		expect(copy.data.byteOffset).toBe(7);
		expect(copy.data.byteLength).toBe(19);
		expect([...new Uint8Array(copy.buffer)]).toEqual([...new Uint8Array(buffer)]);
		new Uint8Array(copy.buffer)[0] = 99;
		expect(new Uint8Array(buffer)[0]).toBe(1);
		new Uint8Array(buffer)[1] = 88;
		expect(new Uint8Array(copy.buffer)[1]).toBe(2);
		expect(buffer.byteLength).toBe(128);
	});

	it('preserves null prototypes and treats __proto__ as ordinary own data', () => {
		const value = Object.create(null);
		value.__proto__ = { safe: true };
		const copy = copyCommandPayload(value) as typeof value;
		expect(Object.getPrototypeOf(copy)).toBe(null);
		expect(copy.__proto__).toEqual({ safe: true });
		expect(copy.__proto__).not.toBe(value.__proto__);
		const record = JSON.parse('{"__proto__":{"polluted":true}}');
		const recordCopy = copyCommandPayload(record) as typeof record;
		expect(Object.getPrototypeOf(recordCopy)).toBe(Object.prototype);
		expect(Object.hasOwn(recordCopy, '__proto__')).toBe(true);
	});

	it('accepts genuine approved types from another realm', () => {
		const value = runInNewContext(`(() => {
			const buffer = new ArrayBuffer(16);
			const record = { a: [new Date(123), new Map([[1, new Set([2])]])] };
			return { record, buffer, view: new Int16Array(buffer, 4, 2), data: new DataView(buffer, 1, 3) };
		})()`);
		const copy = copyCommandPayload(value) as typeof value;
		expect(copy.record.a[0]).toBeInstanceOf(Date);
		expect(copy.record.a[1]).toBeInstanceOf(Map);
		expect(copy.view).toBeInstanceOf(Int16Array);
		expect(copy.view.buffer).toBe(copy.buffer);
		expect(copy.data.buffer).toBe(copy.buffer);
	});

	it('rejects forbidden data at nested and transformation-like output locations', () => {
		class Custom {
			value = 1;
		}
		class CustomMap extends Map {}
		const forbidden = [
			() => 1,
			Symbol('secret'),
			Promise.resolve(1),
			new Error('secret'),
			/x/,
			new URL('https://example.com'),
			new WeakMap(),
			new WeakSet(),
			new Custom(),
			new CustomMap(),
			new Number(1),
			new String('x'),
			new Boolean(false),
			new SharedArrayBuffer(8),
			new Uint8Array(new SharedArrayBuffer(8)),
			new DataView(new SharedArrayBuffer(8)),
			runInNewContext('new Error("secret")'),
		];
		for (const value of forbidden) {
			rejects(value);
			rejects({ transformed: [value] });
			rejects(new Map([[value, 1]]));
			rejects(new Set([value]));
		}
		const detached = new ArrayBuffer(8);
		structuredClone(detached, { transfer: [detached] });
		rejects(detached);
	});

	it('rejects accessors, symbols, hidden data and custom container properties without calling getters', () => {
		const get = vi.fn(() => {
			throw new Error('secret');
		});
		for (const value of [
			{},
			[],
			new Date(),
			new Map(),
			new Set(),
			new ArrayBuffer(8),
			new Uint8Array(4),
			new DataView(new ArrayBuffer(4)),
		]) {
			const accessor = Object.defineProperty(value, 'secret', { get, enumerable: true });
			rejects(accessor);
		}
		expect(get).not.toHaveBeenCalled();
		rejects(Object.defineProperty({}, 'hidden', { value: 1 }));
		rejects({ [Symbol('secret')]: 1 });
		rejects(Object.assign([], { extra: 1 }));
		rejects(Object.assign(new Date(), { extra: 1 }));
		rejects(Object.defineProperty([1], '0', { enumerable: false }));
		const tag = Object.defineProperty({}, Symbol.toStringTag, { get });
		rejects(tag);
		expect(get).not.toHaveBeenCalled();
	});

	it('stops inspection before traversing over-budget properties or sparse slots', () => {
		const trap = vi.fn(() => {
			throw new Error('should not inspect');
		});
		const nested = new Proxy({}, { getPrototypeOf: trap });
		rejects({ a: nested }, 'limit-exceeded', limits({ maxEntries: 1 }));
		const sparse = new Proxy(new Array(1_000_000), { ownKeys: trap });
		rejects(sparse, 'limit-exceeded');
		expect(trap).not.toHaveBeenCalled();
	});

	it('normalizes reflection failures without exposing payload or thrown messages', () => {
		const get = vi.fn(() => {
			throw new Error('must not read');
		});
		const thrown = Object.defineProperty({}, 'message', { get });
		const value = new Proxy(
			{},
			{
				ownKeys() {
					throw thrown;
				},
			},
		);
		for (const operation of [inspectCommandPayload, copyCommandPayload]) {
			try {
				operation(value);
				expect.fail('Expected rejection');
			} catch (error) {
				expect(error).toMatchObject({
					code: 'invalid-payload',
					message: 'Command payload contains unsupported data.',
				});
				expect(Object.hasOwn(error as object, 'cause')).toBe(false);
			}
		}
		expect(get).not.toHaveBeenCalled();
		const hostileThrown = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error('secret');
				},
			},
		);
		rejects(
			new Proxy(
				{},
				{
					ownKeys() {
						throw hostileThrown;
					},
				},
			),
		);
		const forged = new PayloadError('limit-exceeded');
		forged.message = 'secret sender message';
		const throwing = new Proxy(
			{},
			{
				ownKeys() {
					throw forged;
				},
			},
		);
		rejects(throwing);
		expect(() => inspectCommandPayload(throwing)).toThrow(
			'Command payload contains unsupported data.',
		);
		const { proxy, revoke } = Proxy.revocable({}, {});
		revoke();
		rejects(proxy);
	});

	it('rejects invalid host limit values safely', () => {
		for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			for (const key of ['maxBytes', 'maxDepth', 'maxEntries'] as const) {
				rejects(null, 'limit-exceeded', limits({ [key]: value }));
			}
		}
	});
});
