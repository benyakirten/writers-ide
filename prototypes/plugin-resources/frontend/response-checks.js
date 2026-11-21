export function assertResponsePair(get, head, getLength, headLength, origin) {
	if (get.status !== 200 || head.status !== 200 || headLength !== 0) {
		throw new Error('GET/HEAD must both return 200 with an empty HEAD body');
	}
	const type = get.headers.get('content-type');
	if (!type || type !== head.headers.get('content-type')) {
		throw new Error('GET/HEAD Content-Type mismatch');
	}
	for (const response of [get, head]) {
		if (
			getLength <= 0 ||
			response.headers.get('content-length') !== String(getLength) ||
			response.headers.get('cache-control') !== 'no-store' ||
			response.headers.get('x-content-type-options') !== 'nosniff' ||
			response.headers.get('access-control-allow-origin') !== origin
		) {
			throw new Error(
				'GET/HEAD length, no-store, nosniff or exact host-origin CORS metadata mismatch',
			);
		}
	}
}

export function canonicalSnapshotBase(base) {
	const url = new URL(base);
	if (url.search || url.hash || !/^\/snapshots\/[a-f0-9]{64}\/$/.test(url.pathname)) {
		throw new Error('Expected canonical /snapshots/<64-lowercase-hex>/ base URL');
	}
	return url;
}
