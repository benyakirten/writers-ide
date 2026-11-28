import { checkJavaScriptEvaluation } from './evaluation-probe.js';

self.onmessage = async ({ data }) => {
	if (data.kind === 'echo') {
		self.postMessage({ kind: 'echo', value: data.value, url: import.meta.url });
	} else if (data.kind === 'transfer' && data.buffer instanceof ArrayBuffer) {
		const bytes = new Uint8Array(data.buffer);
		bytes[0] += 1;
		self.postMessage({ kind: 'transfer', buffer: data.buffer, url: import.meta.url }, [
			data.buffer,
		]);
	} else if (data.kind === 'wasm' && data.buffer instanceof ArrayBuffer) {
		try {
			const { instance } = await WebAssembly.instantiate(data.buffer);
			self.postMessage({
				kind: 'wasm',
				sum: instance.exports.add(19, 23),
				evaluation: checkJavaScriptEvaluation(),
				url: import.meta.url,
			});
		} catch (error) {
			self.postMessage({ kind: 'wasm', error: String(error?.message ?? error).slice(0, 300) });
		}
	}
};
