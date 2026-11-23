export type PayloadLimits = {
	maxBytes: number;
	maxDepth: number;
	maxEntries: number;
};

export const DEFAULT_PAYLOAD_LIMITS: Readonly<PayloadLimits> = Object.freeze({
	maxBytes: 8 * 1024 * 1024,
	maxDepth: 64,
	maxEntries: 100_000,
});

export type PayloadInspection = {
	readonly bytes: number;
	readonly depth: number;
	readonly entries: number;
	readonly allocations: ReadonlyMap<object, number>;
	readonly scalarBytes: number;
};

const payloadErrors = new WeakSet<object>();

export class PayloadError extends Error {
	readonly code: 'invalid-payload' | 'limit-exceeded';

	constructor(code: 'invalid-payload' | 'limit-exceeded') {
		super(
			code === 'invalid-payload'
				? 'Command payload contains unsupported data.'
				: 'Command payload exceeds its resource limits.',
		);
		this.name = 'PayloadError';
		this.code = code;
	}
}

type Kind = 'record' | 'array' | 'date' | 'map' | 'set' | 'buffer' | 'view';
type Edge = { value: unknown; key?: string; level: number };
type Node = {
	source: object;
	kind: Kind;
	edges: Edge[];
	height: number;
	complete: boolean;
	length: number;
	offset: number;
	time: number;
	nullPrototype: boolean;
	viewName: string;
};
type Scan = { inspection: PayloadInspection; nodes: Map<object, Node> };

const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const getter = (prototype: object, name: string): ((this: unknown) => unknown) =>
	Object.getOwnPropertyDescriptor(prototype, name)!.get!;
const bufferLength = getter(ArrayBuffer.prototype, 'byteLength');
const typedBuffer = getter(typedPrototype, 'buffer');
const typedLength = getter(typedPrototype, 'length');
const typedOffset = getter(typedPrototype, 'byteOffset');
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)!.get!;
const dataBuffer = getter(DataView.prototype, 'buffer');
const dataLength = getter(DataView.prototype, 'byteLength');
const dataOffset = getter(DataView.prototype, 'byteOffset');
const mapSize = getter(Map.prototype, 'size');
const setSize = getter(Set.prototype, 'size');
const viewConstructors: Record<string, ViewConstructor> = {
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
	DataView,
};
interface ViewConstructor {
	new (buffer: ArrayBuffer, offset: number, length: number): ArrayBufferView;
}
// Float16Array is newer than the SDK's TypeScript library target.
const float16 = Object.getOwnPropertyDescriptor(globalThis, 'Float16Array')?.value;
if (typeof float16 === 'function') {
	viewConstructors.Float16Array = float16;
}

function invalid(): never {
	const error = new PayloadError('invalid-payload');
	payloadErrors.add(error);
	throw error;
}

function exceeded(): never {
	const error = new PayloadError('limit-exceeded');
	payloadErrors.add(error);
	throw error;
}

// Compare native constructors without reading sender-controlled constructor properties.
function hasPrototype(value: object, constructor: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	if (prototype === null) {
		return false;
	}
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
	return (
		descriptor !== undefined &&
		'value' in descriptor &&
		typeof descriptor.value === 'function' &&
		Object.getOwnPropertyDescriptor(descriptor.value, 'prototype')?.value === prototype &&
		Function.prototype.toString.call(descriptor.value) ===
			Function.prototype.toString.call(constructor)
	);
}

function primitiveBytes(value: unknown, remaining: number): number {
	switch (typeof value) {
		case 'undefined':
		case 'boolean':
		case 'number':
			return 8;
		case 'string':
			return 16 + 2 * value.length;
		case 'bigint': {
			// Bound temporary bigints before negating or stringifying an arbitrary magnitude.
			// Exponential probes avoid allocating a maxBytes-sized threshold for small values.
			const capacity = Math.max(0, Math.floor(remaining - 16));
			if (value === 0n) {
				return 16;
			}
			if (capacity === 0) {
				exceeded();
			}
			let probe = 1;
			let threshold = 256n;
			while (value >= threshold || value <= -threshold) {
				if (probe === capacity) {
					exceeded();
				}
				probe = Math.min(probe * 2, capacity);
				threshold = 1n << (BigInt(probe) * 8n);
			}
			const magnitude = value < 0n ? -value : value;
			return 16 + Math.ceil(magnitude.toString(16).length / 2);
		}
		case 'object':
			if (value === null) {
				return 8;
			}
			return 0;
		default:
			return invalid();
	}
}

function scan(value: unknown, limits: PayloadLimits): Scan {
	for (const limit of [limits.maxBytes, limits.maxDepth, limits.maxEntries]) {
		if (!Number.isSafeInteger(limit) || limit <= 0) {
			exceeded();
		}
	}
	let bytes = 0;
	let entries = 0;
	let depth = 0;
	const allocations = new Map<object, number>();
	const nodes = new Map<object, Node>();
	const charge = (amount: number, count: number, owner?: object) => {
		if (amount > limits.maxBytes - bytes || count > limits.maxEntries - entries) {
			exceeded();
		}
		bytes += amount;
		entries += count;
		if (owner !== undefined) {
			allocations.set(owner, (allocations.get(owner) ?? 0) + amount);
		}
	};
	const scalarBytes = primitiveBytes(value, limits.maxBytes);
	charge(scalarBytes, 0);

	function describe(source: object): Node {
		charge(64, 1, source);
		const node: Node = {
			source,
			kind: 'record',
			edges: [],
			height: 1,
			complete: false,
			length: 0,
			offset: 0,
			time: 0,
			nullPrototype: false,
			viewName: '',
		};
		nodes.set(source, node);
		const add = (child: unknown, key?: string, level = 1) => {
			charge(primitiveBytes(child, limits.maxBytes - bytes), 0, source);
			node.edges.push({ value: child, key, level });
		};
		let indexedLength = 0;
		if (Array.isArray(source)) {
			if (!hasPrototype(source, Array)) {
				invalid();
			}
			node.kind = 'array';
			node.length = Object.getOwnPropertyDescriptor(source, 'length')!.value;
			charge(16 * node.length, node.length, source);
			indexedLength = node.length;
		} else if (ArrayBuffer.isView(source)) {
			node.kind = 'view';
			let buffer: unknown;
			const tag = typedTag.call(source);
			if (typeof tag === 'string' && Object.hasOwn(viewConstructors, tag)) {
				node.viewName = tag;
				node.length = typedLength.call(source) as number;
				node.offset = typedOffset.call(source) as number;
				buffer = typedBuffer.call(source);
			} else {
				node.viewName = 'DataView';
				node.length = dataLength.call(source) as number;
				node.offset = dataOffset.call(source) as number;
				buffer = dataBuffer.call(source);
			}
			if (!hasPrototype(source, viewConstructors[node.viewName])) {
				invalid();
			}
			// Account for the full shared allocation once, regardless of the visible range.
			if (!nodes.has(buffer as object)) {
				const backing = describe(buffer as object);
				backing.complete = true;
			}
			add(buffer, undefined, 0);
			if (node.viewName !== 'DataView') {
				// Typed arrays carry binary state only. Enumerating custom properties would
				// also enumerate every numeric index, multiplying work across shared views.
				return node;
			}
		} else if (hasPrototype(source, ArrayBuffer)) {
			node.kind = 'buffer';
			node.length = bufferLength.call(source) as number;
			charge(node.length, 0, source);
			// Detached buffers have byteLength zero too, but cannot be copied.
			new Uint8Array(source as ArrayBuffer, 0, 0);
		} else if (hasPrototype(source, Date)) {
			node.kind = 'date';
			node.time = Date.prototype.getTime.call(source);
		} else if (hasPrototype(source, Map)) {
			node.kind = 'map';
			const size = mapSize.call(source) as number;
			charge(32 * size, 2 * size, source);
			for (const [key, item] of Map.prototype.entries.call(source)) {
				add(key);
				add(item);
			}
		} else if (hasPrototype(source, Set)) {
			node.kind = 'set';
			const size = setSize.call(source) as number;
			charge(16 * size, size, source);
			for (const item of Set.prototype.values.call(source)) {
				add(item);
			}
		} else {
			const prototype = Object.getPrototypeOf(source);
			node.nullPrototype = prototype === null;
			if (
				prototype !== null &&
				(!hasPrototype(source, Object) || Object.getPrototypeOf(prototype) !== null)
			) {
				invalid();
			}
		}

		const property = (key: string) => {
			const descriptor = Object.getOwnPropertyDescriptor(source, key);
			if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
				invalid();
			}
			if (node.kind === 'record') {
				charge(16 + 16 + 2 * key.length, 1, source);
				add(descriptor.value, key);
			} else {
				const index = Number(key);
				if (
					node.kind !== 'array' ||
					!Number.isInteger(index) ||
					index < 0 ||
					index >= indexedLength ||
					String(index) !== key
				) {
					invalid();
				}
				if (node.kind === 'array') {
					add(descriptor.value, key);
				}
			}
		};
		// Charge enumerable records incrementally before requesting an own-key array.
		// JavaScript has no streaming API for non-enumerable or symbol own keys.
		let enumerable = 0;
		for (const key in source) {
			if (Object.hasOwn(source, key)) {
				property(key);
				enumerable++;
			}
		}
		const keys = Reflect.ownKeys(source);
		const expected = enumerable + (node.kind === 'array' ? 1 : 0);
		if (keys.length !== expected || keys.some((key) => typeof key === 'symbol')) {
			invalid();
		}
		return node;
	}

	if (value !== null && typeof value === 'object') {
		if (limits.maxDepth < 1) {
			exceeded();
		}
		const root = describe(value);
		const stack = [{ node: root, index: 0, level: 1 }];
		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			depth = Math.max(depth, frame.level);
			if (frame.index === frame.node.edges.length) {
				frame.node.complete = true;
				stack.pop();
				continue;
			}
			const edge = frame.node.edges[frame.index];
			if (edge.value === null || typeof edge.value !== 'object') {
				frame.index++;
				continue;
			}
			const level = frame.level + edge.level;
			if (level > limits.maxDepth) {
				exceeded();
			}
			let child = nodes.get(edge.value);
			if (child === undefined) {
				child = describe(edge.value);
				stack.push({ node: child, index: 0, level });
				continue;
			}
			if (!child.complete) {
				invalid();
			}
			const pathDepth = level + child.height - 1;
			if (pathDepth > limits.maxDepth) {
				exceeded();
			}
			depth = Math.max(depth, pathDepth);
			frame.node.height = Math.max(frame.node.height, edge.level + child.height);
			frame.index++;
		}
	}
	return { inspection: { bytes, depth, entries, allocations, scalarBytes }, nodes };
}

function guarded<T>(operation: () => T): T {
	try {
		return operation();
	} catch (error) {
		if (payloadErrors.has(error as object)) {
			throw error;
		}
		// Never read a thrown value's message, stringify it, or retain it as a cause.
		throw new PayloadError('invalid-payload');
	}
}

export function inspectCommandPayload(
	value: unknown,
	limits: PayloadLimits = DEFAULT_PAYLOAD_LIMITS,
): PayloadInspection {
	return guarded(() => scan(value, limits).inspection);
}

export function copyCommandPayload(
	value: unknown,
	limits: PayloadLimits = DEFAULT_PAYLOAD_LIMITS,
): unknown {
	return guarded(() => {
		const { nodes } = scan(value, limits);
		const copies = new Map<object, object>();
		for (const node of nodes.values()) {
			switch (node.kind) {
				case 'record':
					copies.set(node.source, node.nullPrototype ? Object.create(null) : {});
					break;
				case 'array':
					copies.set(node.source, new Array(node.length));
					break;
				case 'date':
					copies.set(node.source, new Date(node.time));
					break;
				case 'map':
					copies.set(node.source, new Map());
					break;
				case 'set':
					copies.set(node.source, new Set());
					break;
				case 'buffer': {
					const buffer = new ArrayBuffer(node.length);
					new Uint8Array(buffer).set(new Uint8Array(node.source as ArrayBuffer));
					copies.set(node.source, buffer);
					break;
				}
			}
		}
		const copied = (item: unknown): unknown =>
			item !== null && typeof item === 'object' ? copies.get(item) : item;
		for (const node of nodes.values()) {
			if (node.kind === 'view') {
				const Constructor = viewConstructors[node.viewName];
				copies.set(
					node.source,
					new Constructor(copied(node.edges[0].value) as ArrayBuffer, node.offset, node.length),
				);
			}
		}
		for (const node of nodes.values()) {
			const target = copies.get(node.source);
			for (let index = 0; index < node.edges.length; index++) {
				const edge = node.edges[index];
				switch (node.kind) {
					case 'record':
					case 'array':
						Object.defineProperty(target, edge.key!, {
							value: copied(edge.value),
							enumerable: true,
							writable: true,
							configurable: true,
						});
						break;
					case 'map':
						(target as Map<unknown, unknown>).set(
							copied(edge.value),
							copied(node.edges[index + 1].value),
						);
						index++;
						break;
					case 'set':
						(target as Set<unknown>).add(copied(edge.value));
						break;
				}
			}
		}
		return copied(value);
	});
}
