import { Lifetime, Styles } from './lifetimes.js';
import { createResourceProbe } from './resource-probe.js';
import { encodedFixtures, unknownBytes } from './fixture-data.js';
import { assertResponsePair, canonicalSnapshotBase } from './response-checks.js';
import { checkJavaScriptEvaluation } from './evaluation-probe.js';

const config = window.__RESOURCE_PROTOTYPE__ ?? {};
// Post-close probes own their request lifetime and remain usable after initial cleanup.
window.__RESOURCE_PROTOTYPE_PROBE__ = createResourceProbe(config, 'main');
const report = {
	ok: false,
	role: 'main',
	stage: 'initial',
	mode: String(config.mode ?? 'unknown').slice(0, 80),
	observations: {
		documentOrigin: location.origin,
		secureContext: isSecureContext,
		userAgent: String(navigator.userAgent).slice(0, 512),
		moduleUnloading: 'Not promised: cleanup cannot unload ES modules or reset their state.',
	},
	cases: [],
};
const resources = new Lifetime();
const styles = new Styles();
const violations = [];
const observeCsp = (event) => {
	if (violations.length < 12) {
		violations.push({
			directive: event.effectiveDirective,
			blocked: String(event.blockedURI).slice(0, 180),
		});
	}
};
window.addEventListener('securitypolicyviolation', observeCsp);
resources.own(() => window.removeEventListener('securitypolicyviolation', observeCsp));
report.observations.cspViolations = violations;
let finished = false;
const status = document.querySelector('#status');
const fixtureTarget = document.querySelector('#fixture');
const detail = (error) => String(error instanceof Error ? error.message : error).slice(0, 400);
function assert(value, message) {
	if (!value) {
		throw new Error(message);
	}
}
function bounded(promise, milliseconds = 2400) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`Timed out after ${milliseconds}ms`)),
				milliseconds,
			);
		}),
	]).finally(() => clearTimeout(timer));
}
async function finish() {
	if (finished) {
		return;
	}
	finished = true;
	clearTimeout(deadline);
	resources.close();
	report.ok = report.cases.length > 0 && report.cases.every((item) => item.ok);
	status.textContent = report.ok
		? 'Prototype checks passed.'
		: 'Prototype checks failed. See the native report.';
	if (new TextEncoder().encode(JSON.stringify(report)).length >= 64000) {
		report.ok = false;
		report.observations = { error: 'Report exceeded byte budget' };
	}
	try {
		await window.__TAURI_INTERNALS__.invoke('finish', { report });
	} catch (error) {
		console.error('Native finish failed:', detail(error));
	}
}
const deadline = setTimeout(() => {
	report.cases.push({
		name: 'frontend deadline',
		ok: false,
		detail: 'Exceeded 23 second test budget',
	});
	void finish();
}, 23000);
async function test(name, run, milliseconds = 2400) {
	if (finished) {
		return;
	}
	try {
		await bounded(Promise.resolve().then(run), milliseconds);
		if (!finished) {
			report.cases.push({ name, ok: true });
		}
	} catch (error) {
		if (!finished) {
			report.cases.push({ name, ok: false, detail: detail(error) });
		}
	}
}
async function fetchResource(url, options) {
	const controller = new AbortController();
	const release = resources.own(() => controller.abort());
	try {
		const response = await bounded(fetch(url, { ...options, signal: controller.signal }));
		const bytes = await bounded(response.arrayBuffer());
		return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
			status: response.status,
			headers: response.headers,
		});
	} finally {
		release();
	}
}
async function checkedBytes(url, mime) {
	const response = await fetchResource(url);
	assert(response.ok, `Resource status ${response.status}`);
	assert(
		mime.test(response.headers.get('content-type') ?? ''),
		`Wrong MIME for ${new URL(url).pathname}`,
	);
	return response.arrayBuffer();
}

function enforcedCspViolation(owner, directive, matchesBlockedUri) {
	return new Promise((resolve) => {
		const listener = (event) => {
			if (
				event.disposition === 'enforce' &&
				event.effectiveDirective.startsWith(directive) &&
				matchesBlockedUri(event.blockedURI)
			) {
				resolve({
					directive: event.effectiveDirective,
					blocked: event.blockedURI,
					disposition: event.disposition,
				});
			}
		};
		window.addEventListener('securitypolicyviolation', listener);
		owner.own(() => window.removeEventListener('securitypolicyviolation', listener));
	});
}

async function negativeCspProbes() {
	report.observations.cspNegativeProbes = {};
	report.observations.cspViolationNote =
		'Expected enforced violations include local negative probes, JavaScript string evaluation and reserved-origin executable sources.';
	await test('CSP blocks harmless inline script without nonce', async () => {
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		const script = document.createElement('script');
		script.textContent = "document.currentScript.dataset.resourcePrototypeExecuted = 'yes';";
		owner.own(() => script.remove());
		try {
			const violation = enforcedCspViolation(owner, 'script-src', (uri) => uri === 'inline');
			document.head.append(script);
			const evidence = await bounded(violation, 1200);
			assert(
				script.dataset.resourcePrototypeExecuted !== 'yes',
				'Nonce-less inline script executed',
			);
			report.observations.cspNegativeProbes.inlineScript = { ...evidence, executed: false };
		} finally {
			release();
		}
	});
	await test('CSP blocks harmless data image', async () => {
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		const image = new Image();
		owner.own(() => {
			image.onload = null;
			image.onerror = null;
			image.removeAttribute('src');
		});
		try {
			const violation = enforcedCspViolation(owner, 'img-src', (uri) => /^data(?::|$)/.test(uri));
			const failed = new Promise((resolve) => {
				image.onload = () => resolve(false);
				image.onerror = () => resolve(true);
			});
			image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
			const [evidence, blocked] = await bounded(Promise.all([violation, failed]), 1200);
			assert(blocked && image.naturalWidth === 0, 'Data image was not blocked');
			report.observations.cspNegativeProbes.dataImage = {
				...evidence,
				loadFailed: true,
				naturalWidth: image.naturalWidth,
			};
		} finally {
			release();
		}
	});
}

async function executableSourceProbes() {
	await test('CSP blocks JavaScript eval and new Function', async () => {
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		try {
			const violation = enforcedCspViolation(owner, 'script-src', (uri) => uri === 'eval');
			const evaluation = checkJavaScriptEvaluation();
			assert(
				evaluation.eval.blocked && evaluation.newFunction.blocked,
				'JavaScript string evaluation was not CSP-blocked',
			);
			report.observations.javaScriptEvaluation = {
				...evaluation,
				violation: await bounded(violation, 1200),
			};
		} finally {
			release();
		}
	});
	await test('CSP blocks reserved remote script and module import', async () => {
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		const remote = 'https://resource-prototype.invalid';
		const matchesRemote = (uri) => uri === remote || uri.startsWith(`${remote}/`);
		const script = document.createElement('script');
		owner.own(() => script.remove());
		try {
			const scriptViolation = enforcedCspViolation(owner, 'script-src', matchesRemote);
			const scriptFailed = new Promise((resolve) => {
				script.onload = () => resolve(false);
				script.onerror = () => resolve(true);
			});
			script.src = `${remote}/blocked-script.js`;
			document.head.append(script);
			const [scriptEvidence, failed] = await bounded(
				Promise.all([scriptViolation, scriptFailed]),
				1000,
			);
			assert(failed, 'Reserved remote script unexpectedly loaded');
			const importViolation = enforcedCspViolation(owner, 'script-src', matchesRemote);
			const imported = import(/* @vite-ignore */ `${remote}/blocked-module.js`).then(
				() => false,
				() => true,
			);
			const [importEvidence, rejected] = await bounded(
				Promise.all([importViolation, imported]),
				1000,
			);
			assert(rejected, 'Reserved remote module unexpectedly imported');
			report.observations.remoteJavaScript = {
				script: scriptEvidence,
				module: importEvidence,
				evidence:
					'Enforced CSP violations for a remote script and a direct dynamic import from the actual bootstrap module graph, not network failure alone.',
			};
		} finally {
			release();
		}
	});
}

async function nativeOpenerAvailability() {
	await test('raw opener command unavailable or ACL-denied', async () => {
		let outcome = 'unexpected-success';
		try {
			// A non-openable scheme avoids a real OS URL even if native ACL setup regresses.
			await bounded(
				window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', {
					url: 'resource-prototype-denied://must-not-open',
					with: null,
				}),
			);
		} catch (error) {
			const reason = detail(error);
			if (/not found|unknown command|command.*(?:unavailable|not registered)/i.test(reason)) {
				outcome = 'command-unavailable';
			} else if (/not allowed|denied|forbidden|permission/i.test(reason)) {
				outcome = 'acl-denied';
			} else {
				outcome = 'other-error';
			}
			report.observations.openerCommand = { outcome, detail: reason };
		}
		report.observations.openerCommand ??= { outcome };
		assert(
			outcome === 'command-unavailable' || outcome === 'acl-denied',
			'Expected an unavailable command or ACL denial, not URL validation or success',
		);
	});
	report.observations.openerGlobalNames = Object.getOwnPropertyNames(window)
		.filter((name) => /opener/i.test(name))
		.slice(0, 12);
	report.observations.openerEvidenceLimit =
		'An unavailable command is not ACL enforcement evidence. Global names do not establish automatic listener presence or absence. No real URL clicked.';
}

async function recovery() {
	await test('recovery before any fixture/runtime import', () => {
		assert(!globalThis.__RESOURCE_FIXTURE_EVALUATIONS__, 'Fixture top-level code ran in recovery');
		assert(
			!document.querySelector('script[type="importmap"]'),
			'Recovery unexpectedly installed a runtime map',
		);
		const button = document.createElement('button');
		button.textContent = 'Inspect recovery';
		let clicks = 0;
		button.addEventListener('click', () => {
			clicks += 1;
			status.textContent = 'Host-owned recovery is usable.';
		});
		fixtureTarget.append(button);
		button.click();
		assert(
			clicks === 1 && status.textContent === 'Host-owned recovery is usable.',
			'Recovery UI did not respond',
		);
		const loaded = performance.getEntriesByType('resource').map((entry) => entry.name);
		assert(
			!loaded.some((url) => /\/fixture\/|\/runtime\//.test(url)),
			'Fixture/runtime resources loaded in recovery',
		);
		report.observations.recovery =
			'No import map, runtime fetch, dynamic runtime import or fixture import attempted.';
	});
}

async function exchangeWorker(url, owner, wasmBytes) {
	const worker = new Worker(url, { type: 'module', name: 'resource-prototype' });
	const release = owner.own(() => {
		worker.terminate();
		report.observations.workersTerminated = (report.observations.workersTerminated ?? 0) + 1;
	});
	const request = (data, transfer = []) =>
		bounded(
			new Promise((resolve, reject) => {
				worker.onmessage = ({ data: result }) => resolve(result);
				worker.onerror = (event) => {
					event.preventDefault();
					reject(new Error(event.message || 'Worker module load failed'));
				};
				worker.onmessageerror = () => reject(new Error('Worker message could not be decoded'));
				worker.postMessage(data, transfer);
			}),
			1600,
		);
	try {
		const echo = await request({ kind: 'echo', value: 'fixture-echo' });
		assert(
			echo.kind === 'echo' && echo.value === 'fixture-echo' && echo.url === url,
			'Worker echo/import.meta.url mismatch',
		);
		const buffer = new Uint8Array([41, 7, 9]).buffer;
		const response = request({ kind: 'transfer', buffer }, [buffer]);
		assert(buffer.byteLength === 0, 'Sender buffer was not transferred');
		const result = await response;
		assert(
			result.kind === 'transfer' && result.buffer instanceof ArrayBuffer,
			'Missing transferred response',
		);
		assert(
			new Uint8Array(result.buffer).join(',') === '42,7,9',
			'Worker buffer mutation/return failed',
		);
		if (wasmBytes) {
			const wasm = await request({ kind: 'wasm', buffer: wasmBytes }, [wasmBytes]);
			assert(
				wasm.kind === 'wasm' && wasm.sum === 42 && wasm.url === url,
				`Blob worker Wasm compilation/execution failed: ${wasm.error ?? 'wrong result'}`,
			);
			assert(
				wasm.evaluation?.eval.blocked && wasm.evaluation?.newFunction.blocked,
				'Blob worker permitted JavaScript string evaluation',
			);
			report.observations.blobWorkerWasm = { sum: wasm.sum, evaluation: wasm.evaluation };
		}
		return echo.url;
	} finally {
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		release();
	}
}

async function normal() {
	const base = String(config.baseUrl ?? '');
	const second = String(config.secondBaseUrl ?? '');
	report.observations.baseUrl = base;
	report.observations.secondBaseUrl = second;
	let fixture;
	let host;
	await test('install import map before runtime/fixture imports', async () => {
		assert(
			canonicalSnapshotBase(base).pathname !== canonicalSnapshotBase(second).pathname &&
				canonicalSnapshotBase(base).origin === canonicalSnapshotBase(second).origin,
			'Native snapshot URLs missing or unexpected',
		);
		assert(HTMLScriptElement.supports?.('importmap'), 'Native import maps unsupported');
		const response = await fetchResource(`${base}runtime-map.json`);
		assert(response.ok, `Runtime map status ${response.status}`);
		const map = await response.json();
		const expected = [
			'svelte',
			'svelte/internal/client',
			'prosemirror-state',
			'prosemirror-model',
			'prosemirror-transform',
		];
		assert(Object.keys(map.imports).length === expected.length, 'Unexpected runtime map entries');
		const imports = {};
		for (const specifier of expected) {
			const path = map.imports[specifier];
			assert(
				typeof path === 'string' && /^runtime\/[a-z-]+\.js$/.test(path),
				'Invalid fixture runtime path',
			);
			imports[specifier] = new URL(path, base).href;
		}
		const script = document.createElement('script');
		script.type = 'importmap';
		script.nonce = 'resource-prototype';
		script.textContent = JSON.stringify({ imports });
		document.head.append(script);
		report.observations.runtimeMap = imports;
	});
	await test('load actual shared host runtime and fixture ESM', async () => {
		const [svelte, model, state, transform] = await Promise.all([
			import('svelte'),
			import('prosemirror-model'),
			import('prosemirror-state'),
			import('prosemirror-transform'),
		]);
		host = { ...svelte, ...model, ...state, ...transform };
		fixture = await import(/* @vite-ignore */ `${base}fixture/plugin.js`);
		assert(fixture.childValue === 'relative child evaluated', 'Relative child did not evaluate');
	});
	await test('relative ESM, MIME and module-relative asset', async () => {
		assert(fixture, 'Fixture import failed');
		assert(
			fixture.urls.module === `${base}fixture/plugin.js` &&
				fixture.urls.child === `${base}fixture/child.js`,
			'Module URLs lost snapshot-relative identity',
		);
		assert(
			fixture.urls.icon === `${base}fixture/icon.svg`,
			'import.meta.url asset resolution failed',
		);
		await Promise.all([
			checkedBytes(fixture.urls.module, /(?:text|application)\/javascript/i),
			checkedBytes(fixture.urls.child, /(?:text|application)\/javascript/i),
			checkedBytes(fixture.urls.icon, /image\/svg\+xml/i),
			checkedBytes(`${base}fixture/plugin.css`, /text\/css/i),
			checkedBytes(`${base}fixture/font.woff2`, /font\/woff2|application\/font-woff/i),
		]);
	});
	await test('encoded portable filenames decode exactly once', async () => {
		await Promise.all(
			encodedFixtures.map(async ([name, expected]) => {
				const response = await fetchResource(`${base}fixture/${encodeURIComponent(name)}`);
				assert(
					response.status === 200 && (await response.text()) === expected,
					`Encoded filename lookup failed: ${name}`,
				);
			}),
		);
		report.observations.encodedFilenames = encodedFixtures.map(([name]) => name);
	});
	await test('GET and HEAD preserve exact resource response metadata', async () => {
		const [get, head] = await Promise.all([
			fetchResource(`${base}fixture/plugin.js`),
			fetchResource(`${base}fixture/plugin.js`, { method: 'HEAD' }),
		]);
		const getBytes = await get.arrayBuffer();
		const headBytes = await head.arrayBuffer();
		assertResponsePair(get, head, getBytes.byteLength, headBytes.byteLength, location.origin);
		report.observations.responseMetadata = {
			getLength: getBytes.byteLength,
			headBodyLength: headBytes.byteLength,
			contentType: get.headers.get('content-type'),
			contentLength: head.headers.get('content-length'),
			allowOrigin: get.headers.get('access-control-allow-origin'),
			cacheControl: get.headers.get('cache-control'),
			nosniff: get.headers.get('x-content-type-options'),
		};
	});
	await test('unknown binary MIME and nosniff reject valid JavaScript in dat', async () => {
		const binary = await checkedBytes(
			`${base}fixture/unknown.dat`,
			/^application\/octet-stream\b/i,
		);
		assert(
			[...new Uint8Array(binary)].join(',') === unknownBytes.join(','),
			'Unknown-extension binary bytes changed',
		);
		const response = await fetchResource(`${base}fixture/script.dat`);
		assert(
			response.status === 200 &&
				/^application\/octet-stream\b/i.test(response.headers.get('content-type') ?? '') &&
				response.headers.get('x-content-type-options') === 'nosniff',
			'JavaScript dat file lacks octet-stream/nosniff response',
		);
		assert(
			(await response.text()) ===
				'globalThis.__RESOURCE_DAT_EXECUTED__ = true;\nexport const validJavaScript = true;\n',
			'Dat fixture is not the expected syntactically valid JavaScript',
		);
		assert(!globalThis.__RESOURCE_DAT_EXECUTED__, 'Dat module marker already set');
		let rejected = false;
		try {
			await import(/* @vite-ignore */ `${base}fixture/script.dat`);
		} catch (error) {
			rejected = error instanceof TypeError;
		}
		assert(
			rejected && !globalThis.__RESOURCE_DAT_EXECUTED__,
			'Octet-stream JavaScript module was not blocked before execution',
		);
		report.observations.datModule = {
			status: response.status,
			type: response.headers.get('content-type'),
			rejected: true,
			executed: false,
		};
	});
	await test('verified package WebAssembly compiles and executes under selective CSP', async () => {
		const bytes = await checkedBytes(`${base}fixture/add.wasm`, /^application\/wasm\b/i);
		const { instance } = await WebAssembly.instantiate(bytes);
		assert(instance.exports.add(19, 23) === 42, 'Wasm add returned the wrong value');
		report.observations.webAssembly = {
			sum: instance.exports.add(19, 23),
			byteLength: bytes.byteLength,
		};
	});
	await test('same host/fixture Svelte and PM identity; real Transaction', () => {
		assert(fixture && host, 'Shared runtime/fixture unavailable');
		for (const name of [
			'mount',
			'unmount',
			'tick',
			'Schema',
			'Node',
			'EditorState',
			'Transaction',
			'Plugin',
			'Transform',
		]) {
			assert(fixture.runtime[name] === host[name], `Duplicated runtime identity: ${name}`);
		}
		const transaction = fixture.makeTransaction();
		assert(
			transaction instanceof host.Transaction && transaction instanceof host.Transform,
			'Fixture transaction has foreign constructors',
		);
		assert(
			transaction.doc instanceof host.Node && transaction.doc.textContent === 'fixture',
			'Real PM edit did not produce host-compatible document',
		);
	});
	await test('production Svelte mount/update/destroy through host runtime', async () => {
		assert(fixture && host, 'Svelte runtime/fixture unavailable');
		const target = document.createElement('section');
		target.className = 'resource-prototype-fixture';
		fixtureTarget.append(target);
		const owner = new Lifetime();
		const remove = resources.own(() => {
			owner.close();
			target.remove();
		});
		let component;
		try {
			await styles.acquire(`${base}fixture/plugin.css`, owner);
			assert(
				getComputedStyle(target).getPropertyValue('--resource-prototype-style').trim() ===
					'acquired',
				'Declared stylesheet was not ready at the Svelte activation boundary',
			);
			report.observations.svelteActivationStyleReady = true;
			component = host.mount(fixture.Counter, { target });
			await host.tick();
			const button = target.querySelector('[data-counter]');
			assert(button?.textContent === 'Count: 0', 'Counter did not mount');
			button.click();
			await host.tick();
			assert(button.textContent === 'Count: 1', 'Counter reactivity failed');
		} finally {
			if (component) {
				await host.unmount(component);
			}
			assert(!target.querySelector('[data-counter]'), 'Counter DOM survived destroy');
			remove();
		}
	});
	await test('stylesheet two-owner acquisition and final cleanup', async () => {
		const first = new Lifetime();
		const secondOwner = new Lifetime();
		const release = resources.own(() => {
			first.close();
			secondOwner.close();
		});
		const probe = document.createElement('div');
		probe.className = 'resource-prototype-fixture';
		fixtureTarget.append(probe);
		try {
			await Promise.all([
				styles.acquire(`${base}fixture/plugin.css`, first),
				styles.acquire(`${base}fixture/plugin.css`, secondOwner),
			]);
			assert(
				styles.size === 1 &&
					document.querySelectorAll('link[data-resource-prototype]').length === 1,
				'CSS was duplicated',
			);
			assert(
				getComputedStyle(probe).getPropertyValue('--resource-prototype-style').trim() ===
					'acquired',
				'Declared CSS not applied before activation',
			);
			first.close();
			assert(
				styles.size === 1 &&
					getComputedStyle(probe).getPropertyValue('--resource-prototype-style').trim() ===
						'acquired',
				'First release removed peer CSS',
			);
			secondOwner.close();
			assert(
				styles.size === 0 && !document.querySelector('link[data-resource-prototype]'),
				'Final release leaked CSS',
			);
			assert(
				!getComputedStyle(probe).getPropertyValue('--resource-prototype-style').trim(),
				'Removed CSS still affects probe',
			);
		} finally {
			probe.remove();
			release();
		}
	});
	await test('stylesheet activation-failure cleanup and reacquisition', async () => {
		assert(fixture, 'Fixture unavailable');
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		let expected = false;
		try {
			await styles.acquire(`${base}fixture/plugin.css`, owner);
			fixture.failActivation();
		} catch (error) {
			expected = detail(error) === 'Expected fixture activation failure';
		} finally {
			release();
		}
		assert(
			expected && styles.size === 0 && !document.querySelector('link[data-resource-prototype]'),
			'Activation failure leaked CSS or did not run',
		);
	});
	await test('CSS-relative image and actual font loading/metrics', async () => {
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		const probe = document.createElement('span');
		probe.className = 'resource-prototype-fixture';
		probe.textContent = 'iiiiWWWWmmmm0123456789';
		fixtureTarget.append(probe);
		try {
			await styles.acquire(`${base}fixture/plugin.css`, owner);
			const computed = getComputedStyle(probe);
			assert(
				computed.backgroundImage.includes(`${base}fixture/icon.svg`),
				'CSS-relative image URL escaped snapshot',
			);
			const image = new Image();
			owner.own(() => {
				image.onload = null;
				image.onerror = null;
				image.removeAttribute('src');
			});
			await bounded(
				new Promise((resolve, reject) => {
					image.onload = resolve;
					image.onerror = () => reject(new Error('CSS-relative image failed'));
					image.src = `${base}fixture/icon.svg`;
				}),
			);
			assert(
				image.naturalWidth === 12 && image.naturalHeight === 10,
				'Decoded image dimensions incorrect',
			);
			const loaded = await document.fonts.load('32px ResourcePrototypeNunito', probe.textContent);
			await document.fonts.ready;
			assert(
				loaded.length > 0 && loaded.every((face) => face.status === 'loaded'),
				'Declared font did not load',
			);
			assert(
				document.fonts.check('32px ResourcePrototypeNunito', probe.textContent) &&
					computed.fontFamily.includes('ResourcePrototypeNunito'),
				'Fixture font not selected',
			);
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			assert(context, 'Canvas font metrics unavailable');
			context.font = '32px monospace';
			const fallback = context.measureText(probe.textContent).width;
			context.font = '32px ResourcePrototypeNunito, monospace';
			const actual = context.measureText(probe.textContent).width;
			report.observations.fontMetrics = { actual, fallback };
			assert(
				Math.abs(actual - fallback) > 1,
				'Loaded font metrics indistinguishable from fallback',
			);
		} finally {
			probe.remove();
			release();
		}
	});
	await test('worker direct diagnostic and verified-byte Blob fallback', async () => {
		const owner = new Lifetime();
		const release = resources.own(() => owner.close());
		const url = `${base}fixture/worker.js`;
		report.observations.directWorker = { attempted: true, url };
		try {
			try {
				const workerUrl = await exchangeWorker(url, owner);
				report.observations.directWorker = { attempted: true, ok: true, importMetaUrl: workerUrl };
			} catch (error) {
				report.observations.directWorker = { attempted: true, ok: false, detail: detail(error) };
			}
			// Exercise the fallback even if direct construction works. Bytes come only from the verified native route.
			const bytes = await checkedBytes(url, /(?:text|application)\/javascript/i);
			const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
			const revoke = owner.own(() => {
				URL.revokeObjectURL(blobUrl);
				report.observations.blobRevoked = true;
			});
			try {
				const wasmBytes = await checkedBytes(`${base}fixture/add.wasm`, /application\/wasm/i);
				const workerUrl = await exchangeWorker(blobUrl, owner, wasmBytes);
				report.observations.blobWorker = {
					ok: true,
					importMetaUrl: workerUrl,
					relativeAssets:
						'Not supported by this self-contained worker; Blob changes the module base.',
				};
			} finally {
				revoke();
			}
		} finally {
			release();
		}
		assert(
			report.observations.workersTerminated >= 1 && report.observations.blobRevoked,
			'Worker/Blob lifetime leaked',
		);
	}, 5500);
	await test('distinct immutable snapshot identities after source removal', async () => {
		assert(fixture, 'First snapshot import unavailable');
		assert(
			config.sourceRemoved === true,
			'Native did not confirm source removal after verification',
		);
		const other = await import(/* @vite-ignore */ `${second}fixture/plugin.js`);
		assert(
			other !== fixture && other.identity !== fixture.identity,
			'Snapshots reused module identity',
		);
		assert(
			other.urls.module === `${second}fixture/plugin.js` &&
				other.urls.child === `${second}fixture/child.js`,
			'Second snapshot URLs incorrect',
		);
		const [a, b] = await Promise.all([
			checkedBytes(`${base}fixture/child.js`, /javascript/i),
			checkedBytes(`${second}fixture/child.js`, /javascript/i),
		]);
		assert(
			new TextDecoder().decode(a) === new TextDecoder().decode(b),
			'Snapshots did not retain the same verified child bytes',
		);
		const [primaryPlugin, secondaryPlugin] = await Promise.all([
			checkedBytes(`${base}fixture/plugin.js`, /javascript/i),
			checkedBytes(`${second}fixture/plugin.js`, /javascript/i),
		]);
		const primaryText = new TextDecoder().decode(primaryPlugin);
		const secondaryText = new TextDecoder().decode(secondaryPlugin);
		assert(
			secondaryText === `// Second accepted fixture snapshot.\n${primaryText}`,
			'Second accepted snapshot must differ only by its fixed build comment',
		);
		report.observations.snapshotIds = [
			canonicalSnapshotBase(base).pathname.split('/')[2],
			canonicalSnapshotBase(second).pathname.split('/')[2],
		];
		const cached = await import(/* @vite-ignore */ `${base}fixture/plugin.js`);
		assert(
			cached === fixture && cached.identity === fixture.identity,
			'Same snapshot lost native ESM cache identity',
		);
		report.observations.fixtureEvaluations = globalThis.__RESOURCE_FIXTURE_EVALUATIONS__;
		assert(
			globalThis.__RESOURCE_FIXTURE_EVALUATIONS__ === 2,
			'Unexpected module reevaluation count',
		);
	});
	await test('invalid routes reject without application HTML fallback', async () => {
		const baseUrl = canonicalSnapshotBase(base);
		const origin = base.slice(0, -baseUrl.pathname.length);
		const unknownId = `${baseUrl.pathname.split('/')[2][0] === '0' ? '1' : '0'}${baseUrl.pathname.split('/')[2].slice(1)}`;
		const paths = [
			`/snapshots/${unknownId}/fixture/plugin.js`,
			...[
				'missing.js',
				'fixture/%2e%2e/%2e%2e/index.html',
				'fixture/%2fplugin.js',
				'fixture/%5cplugin.js',
				'fixture/%252e%252e/plugin.js',
				'/etc/passwd',
				'C:/windows/system.ini',
				'fixture/plugin.js?extra=1',
				'fixture/bad%escape',
			].map((path) => `${baseUrl.pathname}${path}`),
		];
		const results = await Promise.all(
			paths.map(async (path) => {
				try {
					const response = await fetchResource(origin + path);
					const body = (await response.text()).slice(0, 256);
					assert(
						!response.ok &&
							!/text\/html/i.test(response.headers.get('content-type') ?? '') &&
							!/<!doctype|<html/i.test(body),
						`Invalid route accepted or HTML fallback: ${path}`,
					);
					return { path, outcome: 'error-response-no-html', status: response.status };
				} catch (error) {
					if (error instanceof TypeError) {
						return { path, outcome: 'browser-or-network-rejection', nativeParserVerified: false };
					}
					throw error;
				}
			}),
		);
		const post = await fetchResource(`${base}fixture/plugin.js`, {
			method: 'POST',
			body: 'reject',
		});
		assert(
			post.status === 405 &&
				post.headers.get('allow') === 'GET, HEAD' &&
				!/text\/html/i.test(post.headers.get('content-type') ?? ''),
			'Unsupported method accepted or HTML fallback',
		);
		report.observations.invalidRoutes = results;
		report.observations.invalidRouteEvidenceLimit =
			'TypeError means browser/network rejection, not native parser proof. Error responses cover browser-normalized URLs; raw native parser validation requires native tests.';
	});
}

async function main() {
	await negativeCspProbes();
	await executableSourceProbes();
	await nativeOpenerAvailability();
	if (config.recovery === true) {
		await recovery();
	} else {
		await normal();
	}
	await finish();
}
void main().catch((error) => {
	report.cases.push({ name: 'bootstrap', ok: false, detail: detail(error) });
	void finish();
});
