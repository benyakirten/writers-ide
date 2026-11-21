import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { createResourceProbe } from './frontend/resource-probe.js';

const fixtureBytes = new TextEncoder().encode('export const fixture = true;');
const expectedSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const baseUrl = `https://fixture-resource.localhost/snapshots/${'a'.repeat(64)}/`;
const hostOrigin = 'tauri://localhost';

function setup(t) {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: { origin: hostOrigin },
	});
	const sent = [];
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			__TAURI_INTERNALS__: {
				async invoke(command, args) {
					sent.push({ command, args });
				},
			},
		},
	});
	t.after(() => {
		if (originalLocation) {
			Object.defineProperty(globalThis, 'location', originalLocation);
		} else {
			delete globalThis.location;
		}
		if (originalWindow) {
			Object.defineProperty(globalThis, 'window', originalWindow);
		} else {
			delete globalThis.window;
		}
	});
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) =>
		response(200, options.method === 'HEAD' ? [] : fixtureBytes, {
			'content-length': String(fixtureBytes.byteLength),
		}),
	);
	return { sent, fetch };
}

function response(status, bytes, headers = {}) {
	return {
		status,
		headers: new Headers({
			'content-type': 'text/javascript',
			'content-length': String(bytes.length),
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
			'access-control-allow-origin': hostOrigin,
			...headers,
		}),
		async arrayBuffer() {
			return Uint8Array.from(bytes).buffer;
		},
	};
}

function probe(role) {
	return createResourceProbe({ role, mode: 'normal', baseUrl, expectedSha256 }, role);
}

function assertSent(sent, report, { role, stage, ok }) {
	assert.equal(sent.length, 1);
	assert.equal(sent[0].command, 'finish');
	assert.deepEqual(Object.keys(sent[0].args), ['report']);
	assert.strictEqual(sent[0].args.report, report);
	assert.equal(report.mode, 'normal');
	assert.equal(report.role, role);
	assert.equal(report.stage, stage);
	assert.equal(report.ok, ok);
	assert.equal(report.cases.length, 1);
	assert.equal(report.cases[0].name, 'fixed-stage resource access');
	assert.equal(report.cases[0].ok, ok);
	assert.ok(Buffer.byteLength(JSON.stringify(report)) < 64000);
}

function requestOptions(fetch) {
	assert.ok(fetch.mock.callCount() >= 1 && fetch.mock.callCount() <= 2);
	const [url, options] = fetch.mock.calls[0].arguments;
	assert.equal(String(url), `${baseUrl}fixture/plugin.js`);
	assert.equal(options.cache, 'no-store');
	assert.ok(options.signal instanceof AbortSignal);
	if (fetch.mock.callCount() === 2) {
		const [headUrl, headOptions] = fetch.mock.calls[1].arguments;
		assert.equal(String(headUrl), String(url));
		assert.equal(headOptions.method, 'HEAD');
		assert.equal(headOptions.cache, 'no-store');
		assert.strictEqual(headOptions.signal, options.signal);
		assert.deepEqual(headOptions.headers, options.headers);
	}
	return options;
}

// These tests replace browser globals. Keep them serial; t.mock and t.after restore each replacement.
describe('host-owned resource probe reports', { concurrency: false }, () => {
	for (const [role, stage] of [
		['main', 'after-peer-close'],
		['peer', 'initial'],
		['denied', 'initial'],
		['denied', 'after-last-close'],
	]) {
		test(`${role} succeeds at ${stage} with the required status and bytes`, async (t) => {
			const { sent, fetch } = setup(t);
			if (role === 'denied') {
				fetch.mock.mockImplementation(async () => response(403, []));
			}
			const report = await probe(role)(stage);
			assertSent(sent, report, { role, stage, ok: true });
			assert.equal(fetch.mock.callCount(), 2);
			assert.equal(report.observations.headStatus, role === 'denied' ? 403 : 200);
			assert.equal(report.observations.headByteLength, 0);
			assert.equal(
				report.observations.headContentLength,
				role === 'denied' ? '0' : String(fixtureBytes.byteLength),
			);
			const options = requestOptions(fetch);
			assert.equal(options.signal.aborted, true);
			assert.equal(report.observations.status, role === 'denied' ? 403 : 200);
			if (role === 'denied') {
				assert.deepEqual(options.headers, { 'X-Resource-WebView': 'main' });
				assert.equal(report.observations.spoofedWebViewHeader, 'main');
				assert.equal(report.observations.byteLength, 0);
			} else {
				assert.deepEqual(options.headers, {});
				assert.equal(report.observations.sha256, expectedSha256);
				assert.equal(report.observations.matchesAcceptedSha256, true);
				assert.equal(report.observations.byteLength, fixtureBytes.byteLength);
			}
		});
	}

	test('200 with the wrong digest reports failure through finish', async (t) => {
		const { sent, fetch } = setup(t);
		fetch.mock.mockImplementation(async (_url, options) =>
			response(200, options.method === 'HEAD' ? [] : [0], { 'content-length': '1' }),
		);
		const report = await probe('main')('after-peer-close');
		assertSent(sent, report, { role: 'main', stage: 'after-peer-close', ok: false });
		assert.equal(report.observations.status, 200);
		assert.equal(report.observations.matchesAcceptedSha256, false);
		assert.notEqual(report.observations.sha256, expectedSha256);
		assert.match(report.cases[0].detail, /accepted build-record SHA-256/);
		assert.equal(requestOptions(fetch).signal.aborted, true);
	});

	test('403 with a nonempty body reports failure despite the denial status', async (t) => {
		const { sent, fetch } = setup(t);
		fetch.mock.mockImplementation(async () => response(403, [1]));
		const report = await probe('denied')('after-last-close');
		assertSent(sent, report, { role: 'denied', stage: 'after-last-close', ok: false });
		assert.equal(report.observations.status, 403);
		assert.equal(report.observations.byteLength, 1);
		assert.match(report.cases[0].detail, /empty body/);
		assert.deepEqual(requestOptions(fetch).headers, { 'X-Resource-WebView': 'main' });
	});

	test('GET denial cannot reveal the package length while HEAD correctly reports zero', async (t) => {
		const { sent, fetch } = setup(t);
		fetch.mock.mockImplementation(async (_url, options) =>
			response(403, [], {
				'content-length': options.method === 'HEAD' ? '0' : String(fixtureBytes.byteLength),
			}),
		);
		const report = await probe('denied')('initial');
		assertSent(sent, report, { role: 'denied', stage: 'initial', ok: false });
		assert.equal(report.observations.byteLength, 0);
		assert.equal(report.observations.headContentLength, '0');
		assert.equal(report.observations.getContentLength, String(fixtureBytes.byteLength));
	});

	for (const failure of ['request', 'body', 'digest']) {
		test(`${failure} rejection reports failure and cleans up the request`, async (t) => {
			const { sent, fetch } = setup(t);
			const error = new Error(`Expected ${failure} rejection`);
			if (failure === 'request') {
				fetch.mock.mockImplementation(async () => {
					throw error;
				});
			} else if (failure === 'body') {
				fetch.mock.mockImplementation(async () => ({
					status: 200,
					async arrayBuffer() {
						throw error;
					},
				}));
			} else {
				t.mock.method(globalThis.crypto.subtle, 'digest', async () => {
					throw error;
				});
			}
			const report = await probe('peer')('initial');
			assertSent(sent, report, { role: 'peer', stage: 'initial', ok: false });
			assert.equal(report.cases[0].detail, error.message);
			assert.equal(requestOptions(fetch).signal.aborted, true);
		});
	}

	test('a never-settling request is aborted at the 2400ms budget', async (t) => {
		const { sent, fetch } = setup(t);
		fetch.mock.mockImplementation(() => new Promise(() => {}));
		const pending = probe('main')('after-peer-close');
		const options = requestOptions(fetch);
		t.mock.timers.tick(2399);
		assert.equal(options.signal.aborted, false);
		assert.equal(sent.length, 0);
		t.mock.timers.tick(1);
		const report = await pending;
		assertSent(sent, report, { role: 'main', stage: 'after-peer-close', ok: false });
		assert.equal(options.signal.aborted, true);
		assert.match(report.cases[0].detail, /exceeded 2400ms request\/body\/digest budget/);
	});

	test('a never-settling body shares the original 2400ms budget with the request', async (t) => {
		const { sent, fetch } = setup(t);
		let bodyStarted;
		const enteredBody = new Promise((resolve) => {
			bodyStarted = resolve;
		});
		fetch.mock.mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(
						() =>
							resolve({
								status: 200,
								arrayBuffer() {
									bodyStarted();
									return new Promise(() => {});
								},
							}),
						900,
					);
				}),
		);
		const pending = probe('peer')('initial');
		const options = requestOptions(fetch);
		t.mock.timers.tick(900);
		await enteredBody;
		t.mock.timers.tick(1499);
		assert.equal(options.signal.aborted, false);
		assert.equal(sent.length, 0);
		t.mock.timers.tick(1);
		const report = await pending;
		assertSent(sent, report, { role: 'peer', stage: 'initial', ok: false });
		assert.equal(options.signal.aborted, true);
		assert.match(report.cases[0].detail, /exceeded 2400ms request\/body\/digest budget/);
	});

	for (const fault of [
		'status',
		'body',
		'length',
		'type',
		'cache',
		'nosniff',
		'cors',
		'request-rejection',
		'body-rejection',
	]) {
		test(`authorized HEAD ${fault} fails the single stage case`, async (t) => {
			const { sent, fetch } = setup(t);
			fetch.mock.mockImplementation(async (_url, options) => {
				if (options.method !== 'HEAD') {
					return response(200, fixtureBytes);
				}
				if (fault === 'request-rejection') {
					throw new Error('HEAD request rejected');
				}
				if (fault === 'body-rejection') {
					return {
						async arrayBuffer() {
							throw new Error('HEAD body rejected');
						},
					};
				}
				const headers = { 'content-length': String(fixtureBytes.byteLength) };
				if (fault === 'length') {
					headers['content-length'] = '0';
				}
				if (fault === 'type') {
					headers['content-type'] = 'application/octet-stream';
				}
				if (fault === 'cache') {
					headers['cache-control'] = 'public';
				}
				if (fault === 'nosniff') {
					headers['x-content-type-options'] = '';
				}
				if (fault === 'cors') {
					headers['access-control-allow-origin'] = '*';
				}
				return response(fault === 'status' ? 403 : 200, fault === 'body' ? [1] : [], headers);
			});
			const report = await probe('main')('after-peer-close');
			assertSent(sent, report, { role: 'main', stage: 'after-peer-close', ok: false });
			assert.equal(fetch.mock.callCount(), 2);
			assert.equal(requestOptions(fetch).signal.aborted, true);
		});
	}

	for (const fault of ['status', 'body', 'metadata']) {
		test(`unassociated HEAD cannot expose ${fault}`, async (t) => {
			const { sent, fetch } = setup(t);
			fetch.mock.mockImplementation(async (_url, options) => {
				if (options.method !== 'HEAD') {
					return response(403, []);
				}
				return response(fault === 'status' ? 200 : 403, fault === 'body' ? [1] : [], {
					'content-length': fault === 'metadata' ? String(fixtureBytes.byteLength) : '0',
				});
			});
			const report = await probe('denied')('after-last-close');
			assertSent(sent, report, { role: 'denied', stage: 'after-last-close', ok: false });
			assert.equal(fetch.mock.callCount(), 2);
			assert.deepEqual(requestOptions(fetch).headers, { 'X-Resource-WebView': 'main' });
		});
	}

	for (const stalled of ['HEAD request', 'HEAD body']) {
		test(`${stalled} shares the original 2400ms GET/HEAD/digest budget`, async (t) => {
			const { sent, fetch } = setup(t);
			let headStarted;
			const enteredHead = new Promise((resolve) => {
				headStarted = resolve;
			});
			fetch.mock.mockImplementation((_url, options) => {
				if (options.method !== 'HEAD') {
					return new Promise((resolve) => {
						setTimeout(() => resolve(response(200, fixtureBytes)), 900);
					});
				}
				headStarted();
				return stalled === 'HEAD request'
					? new Promise(() => {})
					: Promise.resolve({ arrayBuffer: () => new Promise(() => {}) });
			});
			const pending = probe('peer')('initial');
			t.mock.timers.tick(900);
			await enteredHead;
			const options = requestOptions(fetch);
			t.mock.timers.tick(1499);
			assert.equal(options.signal.aborted, false);
			assert.equal(sent.length, 0);
			t.mock.timers.tick(1);
			const report = await pending;
			assertSent(sent, report, { role: 'peer', stage: 'initial', ok: false });
			assert.equal(options.signal.aborted, true);
			assert.match(report.cases[0].detail, /exceeded 2400ms/);
		});
	}

	for (const [role, stage] of [
		['main', 'initial'],
		['peer', 'after-peer-close'],
		['denied', 'after-peer-close'],
		['main', 'unknown-stage'],
	]) {
		test(`${role} rejects unsupported stage ${stage} without fetching`, async (t) => {
			const { sent, fetch } = setup(t);
			const report = await probe(role)(stage);
			assertSent(sent, report, { role, stage, ok: false });
			assert.equal(fetch.mock.callCount(), 0);
			assert.match(report.cases[0].detail, /Unsupported probe stage/);
		});
	}
});
