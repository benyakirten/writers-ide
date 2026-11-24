import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { output } from './build.mjs';
/** @type {Record<string, string>} */
const mime = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.toml': 'text/plain',
};
/** @param {string} directory @param {string} prefix @returns {Promise<Map<string, Buffer>>} */
async function readTree(directory, prefix = '') {
	const buffers = new Map();
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const name = `${prefix}${entry.name}`;
		if (entry.isDirectory()) {
			for (const [child, bytes] of await readTree(path.join(directory, entry.name), `${name}/`)) {
				buffers.set(child, bytes);
			}
		} else if (entry.isFile()) {
			buffers.set(name, await readFile(path.join(directory, entry.name)));
		} else {
			throw new Error(`Unsupported fixture file: ${name}`);
		}
	}
	return buffers;
}
/** @param {string} directory */
export async function createFixtureServer(directory) {
	const acceptedBytes = await readFile(path.join(directory, 'accepted.json'));
	/** @type {{snapshot: string, record: Record<string, string>}} */
	const accepted = JSON.parse(acceptedBytes.toString());
	const record = Object.fromEntries(
		Object.entries(accepted.record).sort(([a], [b]) => a.localeCompare(b)),
	);
	const snapshot = createHash('sha256').update(JSON.stringify(record)).digest('hex');
	if (snapshot !== accepted.snapshot) {
		throw new Error('Accepted snapshot ID mismatch');
	}
	const packageBuffers = await readTree(path.join(directory, 'snapshots', snapshot));
	if (
		JSON.stringify([...packageBuffers.keys()].sort()) !== JSON.stringify(Object.keys(record).sort())
	) {
		throw new Error('Accepted snapshot file inventory mismatch');
	}
	for (const [name, bytes] of packageBuffers) {
		if (createHash('sha256').update(bytes).digest('hex') !== record[name]) {
			throw new Error(`Accepted snapshot integrity mismatch: ${name}`);
		}
	}
	// These owned buffers are never exposed or reread from disk after startup.
	// Frontend prefetch is only preliminary. Import/link fetches rely on this
	// immutable server and transport; prefetch cannot protect a replaced response.
	/** @type {Map<string, Buffer>} */
	const buffers = new Map([['/accepted.json', acceptedBytes]]);
	for (const name of ['index.html', 'unknown.js']) {
		buffers.set(`/${name}`, await readFile(path.join(directory, name)));
	}
	/** @type {[string, Map<string, Buffer>][]} */
	const trees = [
		['profile', await readTree(path.join(directory, 'profile'))],
		[`snapshots/${snapshot}`, packageBuffers],
	];
	for (const [prefix, tree] of trees) {
		for (const [name, bytes] of tree) {
			buffers.set(`/${prefix}/${name.split('/').map(encodeURIComponent).join('/')}`, bytes);
		}
	}
	return http.createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1:4179');
		if (url.search) {
			response.writeHead(400).end();
			return;
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.writeHead(405).end();
			return;
		}
		const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
		const bytes = buffers.get(pathname);
		if (!bytes) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			'Content-Type': mime[path.extname(pathname)] ?? 'application/octet-stream',
			'Content-Length': bytes.length,
			'Cache-Control': 'no-store',
		});
		response.end(request.method === 'HEAD' ? undefined : bytes);
	});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const server = await createFixtureServer(output);
	server.listen(4179, '127.0.0.1');
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => server.close());
	}
}
