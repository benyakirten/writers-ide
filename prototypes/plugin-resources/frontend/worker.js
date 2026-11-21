self.onmessage = ({ data }) => {
	if (data.kind === 'echo') {
		self.postMessage({ kind: 'echo', value: data.value, url: import.meta.url });
	} else if (data.kind === 'transfer' && data.buffer instanceof ArrayBuffer) {
		const bytes = new Uint8Array(data.buffer);
		bytes[0] += 1;
		self.postMessage({ kind: 'transfer', buffer: data.buffer, url: import.meta.url }, [
			data.buffer,
		]);
	}
};
