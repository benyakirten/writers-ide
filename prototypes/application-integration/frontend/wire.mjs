// Fixture wire helpers deliberately have no application, editor or plugin imports.
export const MAX_I64 = 9223372036854775807n;
export const defaults = Object.freeze({
	payload: Object.freeze({ maxBytes: 8 * 1024 * 1024, maxDepth: 64, maxEntries: 100_000 }),
	maxComponentBytes: 32 * 1024 * 1024,
	maxWindowBytes: 128 * 1024 * 1024,
	maxCallerPending: 32,
	maxProviderPending: 64,
	maxWindowPending: 256,
});
export const fields = [
	'payload.maxBytes',
	'payload.maxDepth',
	'payload.maxEntries',
	'maxComponentBytes',
	'maxWindowBytes',
	'maxCallerPending',
	'maxProviderPending',
	'maxWindowPending',
];
export function fail(message = 'Invalid fixture message') {
	throw Object.assign(new Error(message), { code: 'invalid-message' });
}
export function bounded(value, maximum = 4096) {
	if (new TextEncoder().encode(JSON.stringify(value)).length > maximum) {
		fail('Fixture message exceeds its byte limit');
	}
	return value;
}
export function record(value, keys) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key))
	) {
		fail();
	}
	return value;
}
export function decimal(value, positive = false) {
	if (
		typeof value !== 'string' ||
		!/^(0|[1-9][0-9]*)$/.test(value) ||
		value.length > 19 ||
		BigInt(value) > MAX_I64 ||
		(positive && value === '0')
	) {
		fail();
	}
	return value;
}
export function marker(value) {
	if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
		fail();
	}
	return value;
}
export function version(value) {
	if (value.version !== 1) {
		fail();
	}
}
export function limits(value) {
	record(value, ['payload', ...fields.slice(3)]);
	record(value.payload, ['maxBytes', 'maxDepth', 'maxEntries']);
	for (const key of fields) {
		const number = field(value, key);
		if (!Number.isSafeInteger(number) || number <= 0) {
			fail('Limits must be positive safe integers');
		}
	}
	return Object.freeze({ ...value, payload: Object.freeze({ ...value.payload }) });
}
export function field(value, key) {
	return key.startsWith('payload.') ? value.payload[key.slice(8)] : value[key];
}
export function snapshot(value) {
	bounded(value);
	record(value, ['epoch', 'revision', 'settings']);
	return Object.freeze({
		epoch: marker(value.epoch),
		revision: decimal(value.revision),
		settings: limits(value.settings),
	});
}
export function handshake(value) {
	bounded(value);
	record(value, ['version', 'session', 'role', 'nextSaveSequence']);
	version(value);
	marker(value.session);
	decimal(value.nextSaveSequence, true);
	if (!['manager', 'workspace', 'probe'].includes(value.role)) {
		fail();
	}
	return Object.freeze({ ...value });
}
export function attachment(value, challenge) {
	bounded(value);
	record(value, ['version', 'epoch', 'attachment', 'challenge']);
	version(value);
	marker(value.epoch);
	marker(value.attachment);
	if (value.challenge !== challenge) {
		fail();
	}
	return Object.freeze({ ...value });
}
export function event(value) {
	bounded(value);
	if (value?.kind === 'closed') {
		record(value, ['kind', 'version', 'epoch', 'attachment', 'reason']);
		if (typeof value.reason !== 'string') {
			fail();
		}
		bounded(value.reason, 1024);
	} else {
		record(value, ['kind', 'version', 'epoch', 'attachment', 'sequence', 'revision', 'settings']);
		if (value.kind !== 'snapshot') {
			fail();
		}
		decimal(value.sequence, true);
		decimal(value.revision);
		limits(value.settings);
	}
	version(value);
	marker(value.epoch);
	marker(value.attachment);
	return JSON.parse(JSON.stringify(value));
}
export function sameSettings(a, b) {
	return fields.every((key) => field(a, key) === field(b, key));
}
export function diagnostic(value) {
	bounded(value, 1024);
	record(value, ['code', 'message']);
	if (typeof value.code !== 'string' || typeof value.message !== 'string') {
		fail();
	}
	return value;
}
export function saveResult(value, requestId) {
	bounded(value);
	if (value?.requestId !== requestId) {
		fail();
	}
	if (value.kind === 'pending') {
		record(value, ['kind', 'requestId']);
	} else if (value.kind === 'saved') {
		record(value, ['kind', 'requestId', 'snapshot']);
		snapshot(value.snapshot);
	} else if (value.kind === 'conflict') {
		record(value, ['kind', 'requestId', 'current', 'readError', 'error']);
		if (value.current !== null) {
			snapshot(value.current);
		}
		if (value.readError !== null) {
			diagnostic(value.readError);
		}
		diagnostic(value.error);
	} else {
		fail();
	}
	return value;
}
export function applicationStatus(value) {
	bounded(value);
	if (!Array.isArray(value) || value.length > 8) {
		fail();
	}
	for (const row of value) {
		record(row, ['window', 'state', 'revision']);
		if (
			typeof row.window !== 'string' ||
			row.window.length > 128 ||
			!['pending', 'applied', 'stale'].includes(row.state)
		) {
			fail();
		}
		if (row.revision !== null) {
			decimal(row.revision);
		}
	}
	return value;
}
export function payload(dto) {
	return { payload: JSON.stringify(bounded(dto)) };
}
export function errorText(error) {
	try {
		return `${diagnostic(error).code}: ${error.message}`;
	} catch {
		return error instanceof Error ? error.message.slice(0, 512) : 'Transport failed';
	}
}
export function timed(promise, milliseconds = 10_000) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						Object.assign(new Error('Result unconfirmed: transport timeout'), {
							code: 'transport-timeout',
						}),
					),
				milliseconds,
			);
		}),
	]).finally(() => clearTimeout(timer));
}
