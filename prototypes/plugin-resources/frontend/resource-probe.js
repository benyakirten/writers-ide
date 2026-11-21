const MAX_PROBE_MS = 2400;
const errorDetail = (error) => String(error instanceof Error ? error.message : error).slice(0, 400);

function assert(value, message) {
	if (!value) {
		throw new Error(message);
	}
}

export function createResourceProbe(config, role) {
	return async (stage) => {
		const report = {
			ok: false,
			mode: 'normal',
			role,
			stage: String(stage).slice(0, 64),
			cases: [],
			observations: {},
		};
		const controller = new AbortController();
		let timer;
		try {
			const work = async () => {
				assert(
					config.role === role && config.mode === 'normal',
					'Unexpected native probe role/mode',
				);
				assert(
					(role === 'main' && stage === 'after-peer-close') ||
						(role === 'peer' && stage === 'initial') ||
						(role === 'denied' && (stage === 'initial' || stage === 'after-last-close')),
					'Unsupported probe stage for this role',
				);
				assert(
					/^[a-f0-9]{64}$/.test(config.expectedSha256),
					'Missing accepted build-record SHA-256',
				);
				const url = new URL('fixture/plugin.js', config.baseUrl);
				assert(!url.search && !url.hash, 'Probe URL must not contain query or fragment');
				const headers = role === 'denied' ? { 'X-Resource-WebView': 'main' } : {};
				const response = await fetch(url, {
					signal: controller.signal,
					cache: 'no-store',
					headers,
				});
				const bytes = await response.arrayBuffer();
				const observations = {
					status: response.status,
					byteLength: bytes.byteLength,
					spoofedWebViewHeader: role === 'denied' ? 'main' : null,
				};
				if (role === 'denied') {
					return {
						observations,
						ok: response.status === 403 && bytes.byteLength === 0,
						expectation: 'Expected 403 with an empty body despite spoofed WebView header',
					};
				}
				const digest = await crypto.subtle.digest('SHA-256', bytes);
				const sha256 = [...new Uint8Array(digest)]
					.map((byte) => byte.toString(16).padStart(2, '0'))
					.join('');
				return {
					observations: {
						...observations,
						sha256,
						matchesAcceptedSha256: sha256 === config.expectedSha256,
					},
					ok: response.status === 200 && sha256 === config.expectedSha256,
					expectation: 'Expected 200 with bytes matching the accepted build-record SHA-256',
				};
			};
			const result = await Promise.race([
				work(),
				new Promise((_, reject) => {
					timer = setTimeout(() => {
						controller.abort();
						reject(new Error('Resource probe exceeded 2400ms request/body/digest budget'));
					}, MAX_PROBE_MS);
				}),
			]);
			report.observations = result.observations;
			report.cases.push({
				name: 'fixed-stage resource access',
				ok: result.ok,
				...(result.ok ? {} : { detail: result.expectation }),
			});
			report.ok = result.ok;
		} catch (error) {
			report.cases.push({
				name: 'fixed-stage resource access',
				ok: false,
				detail: errorDetail(error),
			});
		} finally {
			clearTimeout(timer);
			controller.abort();
		}
		try {
			await window.__TAURI_INTERNALS__.invoke('finish', { report });
		} catch (error) {
			console.error('Native probe finish failed:', errorDetail(error));
		}
		return report;
	};
}
