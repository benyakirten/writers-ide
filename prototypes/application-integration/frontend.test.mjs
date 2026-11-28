import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { JSDOM } from 'jsdom';
import { assertManagerGraph, assertShutdownGraph, buildFixture, directory } from './build.mjs';
import { mountShutdown, forceWarning } from './frontend/shutdown-model.mjs';
import * as wire from './frontend/wire.mjs';
import { createManagerModel } from './frontend/manager-model.mjs';

// Bundle the existing TypeScript client and ledger, rather than replace either with a mock.
const bundled = await build({
	configFile: false,
	logLevel: 'silent',
	build: {
		ssr: path.join(directory, 'frontend/workspace-transport.mjs'),
		write: false,
		minify: false,
		rollupOptions: { output: { codeSplitting: false } },
	},
});
const { createWorkspaceTransport } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.output.find((output) => output.type === 'chunk').code).toString('base64')}`
);
const epoch = 'a'.repeat(32);
const attachment = 'b'.repeat(32);
const session = 'c'.repeat(32);
const state = (revision = '7', settings = wire.defaults) => ({ epoch, revision, settings });
const message = (sequence = '1', revision = '7', settings = wire.defaults) => ({
	kind: 'snapshot',
	version: 1,
	epoch,
	attachment,
	sequence,
	revision,
	settings,
});
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function flush() {
	for (let index = 0; index < 24; index++) {
		await Promise.resolve();
	}
}
function fixture(t, options = {}) {
	let clock = 0;
	let callback;
	let tick;
	let schedules = 0;
	let clears = 0;
	let challenge = 0;
	const calls = [];
	const invoke = async (command, args) => {
		const dto = args?.payload ? JSON.parse(args.payload) : undefined;
		calls.push({ command, dto, args });
		assert.equal(dto.session, session);
		assert.equal(dto.version, 1);
		if (options.invoke) {
			const override = options.invoke(command, dto, args);
			if (override !== undefined) {
				return override;
			}
		}
		if (command === 'settings_attach') {
			if (options.early) {
				for (const value of options.early) {
					callback(value);
				}
			}
			return { version: 1, epoch, attachment, challenge: dto.challenge };
		}
		if (command === 'settings_attachment_read') {
			return state();
		}
		if (command === 'settings_renew') {
			return { version: 1, epoch, attachment, challenge: dto.challenge, valid: true };
		}
		return true;
	};
	const transport = createWorkspaceTransport({
		session,
		invoke,
		channel(receive) {
			callback = receive;
			return { fixtureChannel: true };
		},
		now: () => clock,
		schedule(fn) {
			schedules++;
			tick = fn;
			return 123;
		},
		unschedule(id) {
			assert.equal(id, 123);
			clears++;
		},
		challenge: () => `challenge-${++challenge}`,
	});
	t.after(() => transport.dispose());
	return {
		transport,
		calls,
		get schedules() {
			return schedules;
		},
		get clears() {
			return clears;
		},
		get receiver() {
			return callback;
		},
		set time(value) {
			clock = value;
		},
		tick: () => tick(),
		send: (value) => callback(value),
		async ready() {
			await transport.reattach();
			callback(message());
			await flush();
			assert.equal(transport.client.status, 'ready');
		},
		count: (command) => calls.filter((call) => call.command === command).length,
	};
}

test('static build emits four HTML entries and audits manager and shutdown source and emitted closures', async () => {
	const { result, graphs } = await buildFixture({ write: false });
	const output = result.output;
	for (const role of ['manager', 'workspace', 'probe', 'shutdown']) {
		const html = output.find((entry) => entry.fileName === `${role}.html`);
		assert(html, `Missing ${role} HTML`);
		assert.match(html.source, /script-src 'self'/);
		assert.match(html.source, /worker-src 'none'/);
		assert.doesNotMatch(html.source, /unsafe-inline|unsafe-eval|https:\/\//);
	}
	const manager = Object.keys(graphs).find((name) => graphs[name].entry?.endsWith('/manager.html'));
	const seen = new Set();
	function visit(name) {
		if (seen.has(name)) {
			return;
		}
		seen.add(name);
		assertManagerGraph(graphs[name].modules);
		graphs[name].imports.forEach(visit);
	}
	visit(manager);
	const shutdownSeen = new Set();
	function visitShutdown(name) {
		if (shutdownSeen.has(name)) {
			return;
		}
		shutdownSeen.add(name);
		assertShutdownGraph(graphs[name].modules);
		graphs[name].imports.forEach(visitShutdown);
	}
	visitShutdown(Object.keys(graphs).find((name) => graphs[name].entry?.endsWith('/shutdown.html')));
	for (const role of ['manager', 'shutdown']) {
		const source = JSON.parse(
			output.find((entry) => entry.fileName === `${role}-source-graph.json`).source,
		);
		(role === 'shutdown' ? assertShutdownGraph : assertManagerGraph)(source);
		assert(source.some((id) => id.endsWith(`/${role}.mjs`)));
	}
	for (const forbidden of [
		'/repo/prototypes/application-integration/frontend/ui.mjs',
		'/repo/prototypes/application-integration/frontend/wire.mjs',
		'/repo/prototypes/application-integration/frontend/manager.mjs',
		'/repo/prototypes/application-integration/frontend/manager-model.mjs',
		'/repo/prototypes/application-integration/frontend/workspace.mjs',
		'/repo/prototypes/application-integration/frontend/workspace-transport.mjs',
		'/repo/settings/init.mjs',
		'/repo/src/lib/plugins/init.ts',
		'/repo/packages-js/plugins/index.ts',
	]) {
		assert.throws(() => assertShutdownGraph([forbidden]));
	}
	assert(
		Object.values(graphs).some((graph) =>
			graph.modules.some((name) => name.endsWith('/application-component-host.svelte.ts')),
		),
	);
	assert(
		Object.values(graphs).some((graph) =>
			graph.modules.some((name) => name.endsWith('/command-resource-settings.ts')),
		),
	);
	for (const forbidden of [
		'/repo/packages-js/plugins/index.ts',
		'/repo/src/lib/editor/state/test.ts',
		'/repo/src/lib/plugins/test.ts',
	]) {
		assert.throws(() => assertManagerGraph([forbidden]));
	}
});

test('strict wire rejects unknown fields, malformed IDs, oversized errors, invalid limits and noncanonical i64', () => {
	assert.equal(
		wire.handshake({ version: 1, session, role: 'workspace', nextSaveSequence: '1' }).session,
		session,
	);
	for (const value of ['01', '-1', '9223372036854775808', '1.0', 1]) {
		assert.throws(() => wire.decimal(value));
	}
	for (const value of [
		message('0'),
		{ ...message(), role: 'workspace' },
		{ ...message(), epoch: crypto.randomUUID() },
		{ ...message(), version: 2 },
		{ ...message(), settings: { ...wire.defaults, maxWindowPending: 0 } },
		{ kind: 'closed', version: 1, epoch, attachment, reason: 'x'.repeat(1025) },
	]) {
		assert.throws(() => wire.event(value));
	}
	assert.throws(() => wire.diagnostic({ code: 'failure', message: 'x'.repeat(1024) }));
	assert.deepEqual(wire.payload({ version: 1, session }), {
		payload: JSON.stringify({ version: 1, session }),
	});
});

test('no admission before initial application and native acknowledgment; ack observes applied ledger', async (t) => {
	const ack = deferred();
	let f;
	f = fixture(t, {
		invoke(command) {
			if (command === 'settings_ack') {
				const r = f.transport.client.ledger.snapshot();
				assert.equal(r.pending, 0);
				assert.equal(f.transport.revision, '7');
				return ack.promise;
			}
		},
	});
	assert.throws(() => f.transport.client.ledger.admit('c', 'p'));
	await f.transport.reattach();
	assert.throws(() => f.transport.client.ledger.admit('c', 'p'));
	f.send(message());
	await flush();
	assert.equal(f.transport.client.status, 'connecting');
	assert.throws(() => f.transport.client.ledger.admit('c', 'p'));
	ack.resolve(true);
	await flush();
	const reservation = f.transport.client.ledger.admit('c', 'p');
	assert.deepEqual(reservation.limits, wire.defaults);
	reservation.release();
	assert.throws(() => f.transport.client.ledger.updateLimits(wire.defaults));
});

test('monotonic admission gate catches missed timers and preserves counters across explicit reattachment', async (t) => {
	const f = fixture(t);
	await f.ready();
	const held = f.transport.client.ledger.admit('caller', 'provider');
	held.retain('held data');
	const before = f.transport.client.ledger.snapshot();
	f.time = 30_000;
	assert.throws(() => f.transport.client.ledger.admit('caller', 'provider'), /expired/);
	assert.equal(f.transport.client.status, 'stale');
	assert.deepEqual(f.transport.client.ledger.snapshot(), before);
	f.tick();
	await flush();
	assert.equal(f.count('settings_attach'), 1);
	await f.transport.reattach();
	f.send(message('1', '2'));
	await flush();
	assert.equal(f.transport.client.status, 'ready');
	assert.deepEqual(f.transport.client.ledger.snapshot(), before);
	assert.equal(f.schedules, 1);
	held.release();
	assert.equal(f.transport.client.ledger.snapshot().pending, 0);
});

test('renewal is single-flight; delayed valid response uses send time, not receive time', async (t) => {
	const renewal = deferred();
	const f = fixture(t, {
		invoke: (command) => (command === 'settings_renew' ? renewal.promise : undefined),
	});
	await f.ready();
	f.time = 10_000;
	f.tick();
	await flush();
	f.tick();
	f.tick();
	await flush();
	assert.equal(f.count('settings_renew'), 1);
	const token = f.calls.find((call) => call.command === 'settings_renew').dto.challenge;
	f.time = 14_999;
	renewal.resolve({ version: 1, epoch, attachment, challenge: token, valid: true });
	await flush();
	f.time = 40_000;
	assert.throws(() => f.transport.client.ledger.admit('c', 'p'), /expired/);
});

for (const kind of ['late', 'invalid', 'rejected']) {
	test(`renewal ${kind} response closes without retry or resetting reservations`, async (t) => {
		const renewal = deferred();
		const f = fixture(t, {
			invoke: (command) => (command === 'settings_renew' ? renewal.promise : undefined),
		});
		await f.ready();
		const held = f.transport.client.ledger.admit('c', 'p');
		f.time = 10_000;
		f.tick();
		await flush();
		if (kind === 'late') {
			f.time = 15_000;
			f.tick();
			renewal.resolve({ version: 1, epoch, attachment, challenge: 'challenge-2', valid: true });
		} else if (kind === 'invalid') {
			renewal.resolve({ version: 1, epoch, attachment, challenge: 'wrong', valid: true });
		} else {
			renewal.reject(new Error('native unavailable'));
		}
		await flush();
		assert.equal(f.transport.client.status, 'stale');
		assert.equal(f.transport.client.ledger.snapshot().pending, 1);
		f.time = 60_000;
		f.tick();
		await flush();
		assert.equal(f.count('settings_renew'), 1);
		held.release();
	});
}

test('early snapshot applies after handshake, terminal replaces it, and second distinct early delivery fails closed', async (t) => {
	const early = fixture(t, { early: [message()] });
	await early.transport.reattach();
	await flush();
	assert.equal(early.transport.client.status, 'ready');
	const terminal = fixture(t, {
		early: [message(), { kind: 'closed', version: 1, epoch, attachment, reason: 'closed' }],
	});
	await terminal.transport.reattach();
	await flush();
	assert.equal(terminal.transport.client.status, 'stale');
	assert.equal(terminal.count('settings_ack'), 0);
	const excess = fixture(t, { early: [message(), message('2', '8')] });
	await assert.rejects(excess.transport.reattach());
	await flush();
	assert.equal(excess.transport.client.status, 'stale');
	assert.equal(excess.count('settings_detach'), 1);
});

test('duplicates and repeated revisions are acknowledged; revision jumps are not sequence gaps', async (t) => {
	const f = fixture(t);
	await f.ready();
	f.send(message());
	await flush();
	assert.equal(f.count('settings_ack'), 2);
	f.send(message('2', '7'));
	await flush();
	assert.equal(f.count('settings_ack'), 3);
	f.send(message('3', '100'));
	await flush();
	assert.equal(f.transport.revision, '100');
	assert.equal(f.transport.client.status, 'ready');
});

for (const [name, value] of [
	['gap', message('3', '8')],
	['changed duplicate', message('1', '8')],
	['inconsistent revision', message('2', '7', { ...wire.defaults, maxWindowPending: 1 })],
	['regression', message('2', '6')],
	['foreign attachment', { ...message('2', '8'), attachment: 'd'.repeat(32) }],
	['malformed message', { ...message(), extra: true }],
]) {
	test(`${name} makes workspace stale without implicit attach`, async (t) => {
		const f = fixture(t);
		await f.ready();
		f.send(value);
		await flush();
		assert.equal(f.transport.client.status, 'stale');
		assert.equal(f.count('settings_attach'), 1);
		assert.equal(f.count('settings_detach'), 1);
	});
}

test('lowered settings preserve old reservations and block new calls', async (t) => {
	const f = fixture(t);
	await f.ready();
	const held = f.transport.client.ledger.admit('c', 'p');
	held.retain('old payload');
	const before = f.transport.client.ledger.snapshot();
	f.send(
		message('2', '8', {
			payload: { maxBytes: 1, maxDepth: 1, maxEntries: 1 },
			maxComponentBytes: 1,
			maxWindowBytes: 1,
			maxCallerPending: 1,
			maxProviderPending: 1,
			maxWindowPending: 1,
		}),
	);
	await flush();
	assert.deepEqual(f.transport.client.ledger.snapshot(), before);
	assert.equal(held.limits.maxWindowPending, 256);
	assert.throws(() => f.transport.client.ledger.admit('c', 'p'));
	held.release();
});

test('next channel snapshot may precede previous ack response without losing its ack', async (t) => {
	const ack = deferred();
	let acknowledgments = 0;
	const f = fixture(t, {
		invoke(command) {
			if (command === 'settings_ack' && ++acknowledgments === 1) {
				return ack.promise;
			}
		},
	});
	await f.transport.reattach();
	f.send(message());
	await flush();
	f.send(message('2', '8'));
	await flush();
	assert.equal(f.count('settings_ack'), 1);
	ack.resolve(true);
	await flush();
	assert.equal(f.count('settings_ack'), 2);
	assert.equal(f.transport.revision, '8');
	assert.equal(f.transport.client.status, 'ready');
});

test('attach, missing snapshot and ack deadlines clean up; late attachment is detached', async (t) => {
	const attach = deferred();
	const f = fixture(t, {
		invoke: (command) => (command === 'settings_attach' ? attach.promise : undefined),
	});
	const attaching = f.transport.reattach();
	const rejected = assert.rejects(attaching);
	await flush();
	f.time = 10_000;
	f.tick();
	await rejected;
	attach.resolve({ version: 1, epoch, attachment, challenge: 'challenge-1' });
	await flush();
	assert.equal(f.count('settings_detach'), 1);
	const missing = fixture(t);
	await missing.transport.reattach();
	missing.time = 10_000;
	missing.tick();
	assert.equal(missing.transport.client.status, 'stale');
	const ack = deferred();
	const a = fixture(t, {
		invoke: (command) => (command === 'settings_ack' ? ack.promise : undefined),
	});
	await a.transport.reattach();
	a.send(message());
	await flush();
	a.time = 10_000;
	assert.throws(() => a.transport.client.ledger.admit('c', 'p'));
	assert.equal(a.transport.client.status, 'stale');
	ack.resolve(true);
	await flush();
});

test('dispose stops one lifetime scheduler; old channel cannot retarget new attachment', async (t) => {
	const f = fixture(t);
	await f.ready();
	const oldReceiver = f.receiver;
	f.send({ kind: 'closed', version: 1, epoch, attachment, reason: 'native service closed' });
	await flush();
	assert.equal(f.transport.client.status, 'stale');
	await f.transport.reattach();
	f.send(message());
	await flush();
	oldReceiver(message('2', '100'));
	assert.equal(f.transport.revision, '7');
	assert.equal(f.transport.client.status, 'ready');
	f.transport.dispose();
	f.transport.dispose();
	await flush();
	assert.equal(f.clears, 1);
	assert.equal(f.count('settings_detach'), 2);
	oldReceiver(message('2', '100'));
	assert.equal(f.transport.revision, '7');
	f.send(message('2', '9'));
	assert.equal(f.transport.client.status, 'disposed');
	await assert.rejects(f.transport.reattach(), /disposed/);
});

test('early snapshot acknowledgment deadline starts at receipt, not delayed handshake completion', async (t) => {
	const attach = deferred();
	const ack = deferred();
	const f = fixture(t, {
		invoke: (command) =>
			command === 'settings_attach'
				? attach.promise
				: command === 'settings_ack'
					? ack.promise
					: undefined,
	});
	const attaching = f.transport.reattach();
	await flush();
	f.send(message());
	f.time = 9000;
	attach.resolve({ version: 1, epoch, attachment, challenge: 'challenge-1' });
	await attaching;
	await flush();
	f.time = 10_000;
	assert.throws(() => f.transport.client.ledger.admit('c', 'p'));
	assert.equal(f.transport.client.status, 'stale');
	ack.resolve(true);
	await flush();
});

test('manager saves full config with expected revision and keeps draft on conflict', async () => {
	const calls = [];
	const invoke = async (command, args) => {
		const dto = JSON.parse(args.payload);
		calls.push({ command, dto });
		if (command === 'settings_read') {
			return state();
		}
		if (command === 'settings_save') {
			return {
				kind: 'conflict',
				requestId: '12',
				current: state('8'),
				readError: null,
				error: { code: 'conflict', message: 'stale revision' },
			};
		}
	};
	const model = createManagerModel({ session, nextSaveSequence: '12' }, invoke);
	await model.read();
	model.draft.maxWindowPending = 3;
	await model.save();
	assert.equal(model.draft.maxWindowPending, 3);
	assert.equal(model.current.revision, '8');
	assert.match(model.message, /Draft retained/);
	assert.deepEqual(calls[1].dto, {
		version: 1,
		session,
		requestId: '12',
		expectedRevision: '7',
		settings: { ...wire.defaults, maxWindowPending: 3 },
	});
});

test('transport timeout stays unconfirmed and reconciliation never resubmits a save', async () => {
	let saves = 0;
	const invoke = async (command) => {
		if (command === 'settings_read') {
			return state();
		}
		if (command === 'settings_save') {
			saves++;
			throw { code: 'transport-timeout', message: 'timeout' };
		}
		if (command === 'settings_result') {
			return { kind: 'saved', requestId: '1', snapshot: state('8') };
		}
	};
	const model = createManagerModel({ session, nextSaveSequence: '1' }, invoke);
	await model.read();
	await model.save();
	assert.match(model.message, /unconfirmed/);
	await assert.rejects(model.save());
	await model.reconcile();
	assert.equal(saves, 1);
	assert.equal(model.current.revision, '8');
	assert.equal(model.pending, null);
});

test('native uncertainty is distinct; expired exact result reads without claiming earlier commit', async () => {
	const calls = [];
	const invoke = async (command) => {
		calls.push(command);
		if (command === 'settings_read') {
			return state('9');
		}
		if (command === 'settings_save') {
			throw { code: 'outcome-unknown', message: 'native transaction result unknown' };
		}
		if (command === 'settings_result') {
			throw { code: 'result-expired', message: 'expired' };
		}
		if (command === 'session_handshake') {
			return { version: 1, session, role: 'manager', nextSaveSequence: '2' };
		}
	};
	const model = createManagerModel({ session, nextSaveSequence: '1' }, invoke);
	await model.read();
	model.draft.maxWindowPending = 4;
	await model.save();
	assert.match(model.message, /Native save error/);
	await model.reconcile();
	assert.match(model.message, /does not prove/);
	assert.equal(model.draft.maxWindowPending, 4);
	assert.equal(calls.filter((value) => value === 'settings_save').length, 1);
});

test('busy refusal only releases manager save gating when handshake confirms unused sequence', async () => {
	for (const nextSaveSequence of ['1', '2']) {
		let saves = 0;
		const invoke = async (command) => {
			if (command === 'settings_read') {
				return state();
			}
			if (command === 'settings_save') {
				saves++;
				throw { code: 'busy', message: 'capacity exhausted' };
			}
			if (command === 'session_handshake') {
				return { version: 1, session, role: 'manager', nextSaveSequence };
			}
		};
		const model = createManagerModel({ session, nextSaveSequence: '1' }, invoke);
		await model.read();
		await model.save();
		assert.equal(model.pending === null, nextSaveSequence === '1');
		assert.equal(saves, 1);
	}
});

test('compiled workspace UI runs actual host commands and retains unfinished cancellation accounting', async (t) => {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		url: 'http://fixture.localhost/workspace.html?role=manager',
	});
	const previousWindow = globalThis.window;
	const previousDocument = globalThis.document;
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	let channel;
	const nativeCalls = [];
	globalThis.__applicationFixtureInvoke = async (command, args) => {
		nativeCalls.push({ command, args });
		if (command === 'session_handshake') {
			assert.equal(args, undefined);
			return { version: 1, session, role: 'workspace', nextSaveSequence: '1' };
		}
		if (command === 'bootstrap_status') {
			assert.deepEqual(args, { payload: JSON.stringify({ version: 1, session }) });
			return { state: 'Ready' };
		}
		const dto = JSON.parse(args.payload);
		if (command === 'settings_attach') {
			channel = args.events;
			channel.onmessage(message());
			return { version: 1, epoch, attachment, challenge: dto.challenge };
		}
		if (command === 'settings_attachment_read') {
			return state();
		}
		return true;
	};
	t.after(() => {
		dom.window.dispatchEvent(new dom.window.Event('pagehide'));
		dom.window.close();
		globalThis.window = previousWindow;
		globalThis.document = previousDocument;
		delete globalThis.__applicationFixtureInvoke;
	});
	const built = await build({
		configFile: false,
		logLevel: 'silent',
		publicDir: false,
		resolve: { alias: { $lib: path.resolve(directory, '../../src/lib') } },
		plugins: [
			svelte({ configFile: false }),
			{
				name: 'fixture-test-native-boundary',
				enforce: 'pre',
				resolveId(id) {
					if (id === '@tauri-apps/api/core') {
						return '\u0000fixture-native';
					}
				},
				load(id) {
					if (id === '\u0000fixture-native') {
						return 'export const invoke = (...args) => globalThis.__applicationFixtureInvoke(...args); export class Channel {}';
					}
				},
			},
		],
		build: {
			write: false,
			minify: false,
			target: 'es2022',
			rollupOptions: {
				input: path.join(directory, 'frontend/workspace.mjs'),
				output: { codeSplitting: false },
			},
		},
	});
	await import(
		`data:text/javascript;base64,${Buffer.from(built.output.find((output) => output.type === 'chunk').code).toString('base64')}`
	);
	await flush();
	await flush();
	const document = dom.window.document;
	assert.match(document.querySelector('#status').textContent, /Settings ready/);
	assert.equal(
		nativeCalls.some((call) => call.command === 'settings_save'),
		false,
	);
	const counters = () => JSON.parse(document.querySelector('#counters').textContent);
	const click = async (id) => {
		document.querySelector(`#${id}`).click();
		await flush();
		await flush();
	};
	await click('start-command');
	assert.equal(counters().started, 1);
	const before = counters().reservations;
	assert.equal(before.pending, 1);
	assert(before.bytes > 0);
	await click('cancel-command');
	assert.deepEqual(counters().reservations, before);
	assert.equal(counters().calls[0].cancelled, true);
	await click('report');
	const report = JSON.parse(
		nativeCalls.findLast((call) => call.command === 'fixture_report').args.payload,
	);
	assert.deepEqual(Object.keys(report).sort(), ['cases', 'session', 'version']);
	assert(
		report.cases.find((entry) => entry.name === 'workspace-cancelled-unfinished-retains-accounting')
			.ok,
	);
	channel.onmessage(message('2', '8', { ...wire.defaults, maxWindowPending: 1 }));
	await flush();
	assert.deepEqual(counters().reservations, before);
	await click('start-command');
	assert.equal(counters().started, 1);
	await click('detach');
	await click('reattach');
	assert.deepEqual(counters().reservations, before);
	// Advance the monotonic clock during the synchronous freeze, without waiting 31 seconds.
	const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
	let fakeTime = performance.now();
	Object.defineProperty(performance, 'now', {
		configurable: true,
		value: () => {
			fakeTime += 16_000;
			return fakeTime;
		},
	});
	try {
		await click('freeze');
	} finally {
		if (nowDescriptor) {
			Object.defineProperty(performance, 'now', nowDescriptor);
		} else {
			delete performance.now;
		}
	}
	assert.match(document.querySelector('#status').textContent, /Settings stale/);
	assert.deepEqual(counters().reservations, before);
	await click('report');
	const frozenReport = JSON.parse(
		nativeCalls.findLast((call) => call.command === 'fixture_report').args.payload,
	);
	assert(
		frozenReport.cases.find(
			(entry) => entry.name === 'workspace-frozen-synchronous-admission-rejected',
		).ok,
	);
	await click('finish-command');
	assert.deepEqual(counters().reservations, { bytes: 0, pending: 0, components: [] });
});

const shutdownAttempt = 'd'.repeat(32);
const shutdownSnapshot = (overrides = {}) => ({
	version: 1,
	attempt: shutdownAttempt,
	phase: 'draining',
	stage: 'settings',
	message: 'Waiting for admitted work',
	failure: null,
	forceEligible: true,
	...overrides,
});
function shutdownFixture(t, options = {}) {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	const document = dom.window.document;
	const events = {};
	const calls = [];
	let clock = 0;
	let expiry;
	// jsdom does not implement modal display or native Escape handling.
	dom.window.HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	dom.window.HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new dom.window.Event('close'));
	};
	const ui = mountShutdown({
		document,
		channel: () => events,
		now: () => clock,
		schedule(fn) {
			expiry = fn;
			return 1;
		},
		unschedule() {
			expiry = undefined;
		},
		async invoke(command, args) {
			const dto = JSON.parse(args.payload);
			calls.push({ command, dto });
			if (command === 'shutdown_connect') {
				assert.deepEqual(dto, { version: 1 });
				assert.equal(args.events, events);
			} else {
				assert.equal(dto.version, 1);
				assert.equal(dto.session, session);
				assert.equal(dto.attempt, shutdownAttempt);
				assert.deepEqual(
					Object.keys(dto).sort(),
					(command === 'shutdown_confirm_force_quit'
						? ['version', 'session', 'attempt', 'confirmation']
						: ['version', 'session', 'attempt']
					).sort(),
				);
			}
			if (options.invoke) {
				const result = options.invoke(command, args);
				if (result !== undefined) {
					return result;
				}
			}
			if (command === 'shutdown_connect') {
				return { version: 1, session, attempt: shutdownAttempt, snapshot: shutdownSnapshot() };
			}
			if (command === 'shutdown_prepare_force_quit') {
				return { version: 1, confirmation: 'e'.repeat(32), expiresInMs: 30000 };
			}
			assert(['shutdown_cancel_force_quit', 'shutdown_confirm_force_quit'].includes(command));
			return true;
		},
	});
	t.after(() => {
		ui.dispose();
		dom.window.close();
	});
	const node = (id) => document.getElementById(id);
	return {
		ui,
		dom,
		document,
		events,
		calls,
		node,
		async click(id) {
			node(id).click();
			await flush();
		},
		count: (command) => calls.filter((call) => call.command === command).length,
		expire() {
			clock = 30000;
			expiry?.();
		},
	};
}

test('shutdown defaults to Keep waiting and requires a separate exact-warning confirmation', async (t) => {
	const f = shutdownFixture(t);
	assert.equal(f.document.activeElement, f.node('keep-waiting'));
	assert.equal(f.node('force-quit').disabled, true);
	await f.ui.ready;
	assert.equal(f.document.activeElement, f.node('keep-waiting'));
	await f.click('keep-waiting');
	assert.equal(f.calls.length, 1);
	await f.click('force-quit');
	assert.equal(f.node('force-dialog').open, true);
	assert.equal(f.document.activeElement, f.node('cancel-force'));
	assert.equal(
		f.node('force-warning').textContent,
		'Unfinished changes may not be saved. A transaction may already have committed without a delivered response.',
	);
	assert.equal(f.node('force-warning').textContent, forceWarning);
	assert.equal(f.count('shutdown_prepare_force_quit'), 1);
	assert.equal(f.count('shutdown_confirm_force_quit'), 0);
	await f.click('confirm-force');
	await f.click('confirm-force');
	assert.equal(f.count('shutdown_confirm_force_quit'), 1);
	assert.equal(f.calls.at(-1).dto.confirmation, 'e'.repeat(32));
});

for (const dismissal of ['cancel', 'escape', 'close']) {
	test(`shutdown ${dismissal} dismisses confirmation, cancels once and restores Keep waiting focus`, async (t) => {
		const f = shutdownFixture(t);
		await f.ui.ready;
		await f.click('force-quit');
		if (dismissal === 'cancel') {
			await f.click('cancel-force');
		} else if (dismissal === 'escape') {
			const event = new f.dom.window.Event('cancel', { cancelable: true });
			f.node('force-dialog').dispatchEvent(event);
			assert.equal(event.defaultPrevented, true);
		} else {
			f.node('force-dialog').close();
		}
		await flush();
		assert.equal(f.node('force-dialog').open, false);
		assert.equal(f.document.activeElement, f.node('keep-waiting'));
		assert.equal(f.count('shutdown_cancel_force_quit'), 1);
		await f.click('confirm-force');
		assert.equal(f.count('shutdown_confirm_force_quit'), 0);
		assert.equal(f.count('shutdown_prepare_force_quit'), 1);
	});
}

test('shutdown serializes pending preparation and cancellation without admitting a stale confirmation', async (t) => {
	const prepare = deferred();
	const cancel = deferred();
	const f = shutdownFixture(t, {
		invoke(command) {
			if (command === 'shutdown_prepare_force_quit') {
				return prepare.promise;
			}
			if (command === 'shutdown_cancel_force_quit') {
				return cancel.promise;
			}
		},
	});
	await f.ui.ready;
	await f.click('force-quit');
	assert.equal(f.node('confirm-force').disabled, true);
	await f.click('force-quit');
	await f.click('cancel-force');
	assert.equal(f.document.activeElement, f.node('keep-waiting'));
	assert.equal(f.count('shutdown_cancel_force_quit'), 0);
	prepare.resolve({ version: 1, confirmation: 'late-token', expiresInMs: 30000 });
	await flush();
	assert.equal(f.count('shutdown_cancel_force_quit'), 1);
	await f.click('force-quit');
	await f.click('confirm-force');
	assert.equal(f.count('shutdown_prepare_force_quit'), 1);
	assert.equal(f.count('shutdown_confirm_force_quit'), 0);
	cancel.resolve(true);
	await flush();
	assert.equal(f.node('force-quit').disabled, false);
});

for (const phase of ['complete', 'forced']) {
	test(`shutdown ${phase} wins over pending preparation and later stale updates`, async (t) => {
		const prepare = deferred();
		const f = shutdownFixture(t, {
			invoke(command) {
				if (command === 'shutdown_prepare_force_quit') {
					return prepare.promise;
				}
			},
		});
		await f.ui.ready;
		await f.click('force-quit');
		f.events.onmessage(shutdownSnapshot({ phase, forceEligible: false }));
		assert.equal(f.node('force-dialog').open, false);
		prepare.resolve({ version: 1, confirmation: 'late-token', expiresInMs: 30000 });
		await flush();
		f.events.onmessage(shutdownSnapshot());
		await f.click('confirm-force');
		await f.click('force-quit');
		assert.match(f.node('shutdown-status').textContent, new RegExp(phase));
		assert.equal(f.count('shutdown_cancel_force_quit'), 1);
		assert.equal(f.count('shutdown_confirm_force_quit'), 0);
		assert.equal(f.count('shutdown_prepare_force_quit'), 1);
	});
}

test('shutdown expires confirmation without auto-force, cleanup retry or native retry', async (t) => {
	const f = shutdownFixture(t);
	await f.ui.ready;
	f.events.onmessage(shutdownSnapshot({ phase: 'failed', failure: '<original failure>' }));
	assert.equal(f.node('shutdown-failure').textContent, 'Original failure: <original failure>');
	assert.equal(f.node('shutdown-failure').children.length, 0);
	await f.click('force-quit');
	f.expire();
	assert.equal(f.node('confirm-force').disabled, true);
	await f.click('confirm-force');
	assert.deepEqual(
		f.calls.map((call) => call.command),
		['shutdown_connect', 'shutdown_prepare_force_quit'],
	);
	await f.click('cancel-force');
	assert.equal(f.count('shutdown_cancel_force_quit'), 1);
});

for (const command of [
	'shutdown_connect',
	'shutdown_prepare_force_quit',
	'shutdown_cancel_force_quit',
	'shutdown_confirm_force_quit',
]) {
	test(`shutdown safely reports ${command} rejection without retry`, async (t) => {
		const f = shutdownFixture(t, {
			invoke(name) {
				if (name === command) {
					return Promise.reject(new Error('<unsafe error>'));
				}
			},
		});
		await f.ui.ready;
		if (command !== 'shutdown_connect') {
			await f.click('force-quit');
			if (command === 'shutdown_cancel_force_quit') {
				await f.click('cancel-force');
			} else if (command === 'shutdown_confirm_force_quit') {
				await f.click('confirm-force');
			}
		}
		await flush();
		assert.equal(f.count(command), 1);
		assert.notEqual(f.node('shutdown-error').textContent, '');
		assert.doesNotMatch(f.node('shutdown-error').textContent, /unsafe error/);
		assert.equal(f.node('force-quit').disabled, true);
		assert.equal(f.document.activeElement, f.node('keep-waiting'));
	});
}

test('shutdown retains only latest early snapshot, validates attempt and bounds updates', async (t) => {
	const connect = deferred();
	const f = shutdownFixture(t, {
		invoke(command) {
			if (command === 'shutdown_connect') {
				return connect.promise;
			}
		},
	});
	for (let index = 0; index < 1000; index++) {
		f.events.onmessage(shutdownSnapshot({ message: `Progress ${index}` }));
	}
	connect.resolve({ version: 1, session, attempt: shutdownAttempt, snapshot: shutdownSnapshot() });
	await f.ui.ready;
	assert.match(f.node('shutdown-status').textContent, /Progress 999/);
	assert.equal(f.document.querySelectorAll('#shutdown-status').length, 1);
	f.events.onmessage(shutdownSnapshot({ attempt: 'foreign' }));
	assert.equal(f.node('force-quit').disabled, true);
	assert.match(f.node('shutdown-error').textContent, /unavailable/);
});

for (const invalid of [
	shutdownSnapshot({ message: 'x'.repeat(5000) }),
	shutdownSnapshot({ version: 2 }),
	shutdownSnapshot({ unexpected: true }),
	shutdownSnapshot({ forceEligible: 'yes' }),
]) {
	test('shutdown invalid channel data fails closed', async (t) => {
		const f = shutdownFixture(t);
		await f.ui.ready;
		f.events.onmessage(invalid);
		assert.equal(f.node('force-quit').disabled, true);
		assert.equal(f.calls.length, 1);
	});
}

test('shutdown disposal removes channel handler and ignores late preparation and connection', async (t) => {
	const prepare = deferred();
	const f = shutdownFixture(t, {
		invoke(command) {
			if (command === 'shutdown_prepare_force_quit') {
				return prepare.promise;
			}
		},
	});
	await f.ui.ready;
	await f.click('force-quit');
	const receiver = f.events.onmessage;
	const before = f.document.body.textContent;
	f.ui.dispose();
	f.ui.dispose();
	receiver(shutdownSnapshot({ phase: 'complete', forceEligible: false }));
	f.events.onmessage(shutdownSnapshot());
	prepare.resolve({ version: 1, confirmation: 'late', expiresInMs: 30000 });
	await flush();
	assert.equal(f.document.body.textContent, before);
	assert.equal(f.calls.length, 2);
	const connect = deferred();
	const late = shutdownFixture(t, { invoke: () => connect.promise });
	late.ui.dispose();
	connect.resolve({ version: 1, session, attempt: shutdownAttempt, snapshot: shutdownSnapshot() });
	await late.ui.ready;
	assert.equal(late.node('force-quit').disabled, true);
});

for (const dismissal of ['escape', 'close']) {
	test(`shutdown pending prepare followed by ${dismissal} cancels the late token once`, async (t) => {
		const prepare = deferred();
		const f = shutdownFixture(t, {
			invoke(command) {
				if (command === 'shutdown_prepare_force_quit') {
					return prepare.promise;
				}
			},
		});
		await f.ui.ready;
		await f.click('force-quit');
		if (dismissal === 'escape') {
			f.node('force-dialog').dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true }));
		} else {
			f.node('force-dialog').close();
		}
		assert.equal(f.document.activeElement, f.node('keep-waiting'));
		prepare.resolve({ version: 1, confirmation: 'late', expiresInMs: 30000 });
		await flush();
		await f.click('confirm-force');
		assert.equal(f.count('shutdown_cancel_force_quit'), 1);
		assert.equal(f.count('shutdown_confirm_force_quit'), 0);
	});
}

test('shutdown completion invalidates an already prepared confirmation', async (t) => {
	const f = shutdownFixture(t);
	await f.ui.ready;
	await f.click('force-quit');
	f.events.onmessage(shutdownSnapshot({ phase: 'complete', forceEligible: false }));
	await flush();
	assert.equal(f.node('force-dialog').open, false);
	assert.equal(f.document.activeElement, f.node('keep-waiting'));
	await f.click('confirm-force');
	assert.equal(f.count('shutdown_cancel_force_quit'), 1);
	assert.equal(f.count('shutdown_confirm_force_quit'), 0);
});

test('shutdown in-flight confirmation is single-use even if completion wins natively', async (t) => {
	const confirm = deferred();
	const f = shutdownFixture(t, {
		invoke(command) {
			if (command === 'shutdown_confirm_force_quit') {
				return confirm.promise;
			}
		},
	});
	await f.ui.ready;
	await f.click('force-quit');
	await f.click('confirm-force');
	await f.click('confirm-force');
	f.events.onmessage(shutdownSnapshot({ phase: 'complete', forceEligible: false }));
	confirm.reject(new Error('Completion won'));
	await flush();
	assert.equal(f.node('force-dialog').open, false);
	assert.equal(f.document.activeElement, f.node('keep-waiting'));
	assert.match(f.node('shutdown-status').textContent, /complete/);
	assert.equal(f.count('shutdown_confirm_force_quit'), 1);
	assert.equal(f.count('shutdown_cancel_force_quit'), 0);
	assert.equal(f.node('force-quit').disabled, true);
});

for (const reply of [
	{ version: 1, confirmation: 'token', expiresInMs: 30001 },
	{ version: 1, confirmation: '', expiresInMs: 30000 },
	{ version: 2, confirmation: 'token', expiresInMs: 30000 },
	{ version: 1, confirmation: 'token', expiresInMs: 30000, extra: true },
]) {
	test('shutdown malformed preparation cannot enable confirmation', async (t) => {
		const f = shutdownFixture(t, {
			invoke(command) {
				if (command === 'shutdown_prepare_force_quit') {
					return reply;
				}
			},
		});
		await f.ui.ready;
		await f.click('force-quit');
		await f.click('confirm-force');
		assert.equal(f.node('force-dialog').open, false);
		assert.equal(f.document.activeElement, f.node('keep-waiting'));
		assert.equal(f.count('shutdown_confirm_force_quit'), 0);
		assert.equal(f.count('shutdown_cancel_force_quit'), 1);
	});
}
