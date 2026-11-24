import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createFixtureServer } from './server.mjs';

async function fixture() {
	const directory = await mkdtemp(path.join(tmpdir(), 'runtime-profile-server-'));
	const originals = {
		'assets/icon.svg': '<svg/>',
		'entry.js': 'export const accepted = true;',
		'style.css': 'body { color: blue; }',
	};
	const record = Object.fromEntries(
		Object.entries(originals).map(([name, value]) => [
			name,
			createHash('sha256').update(value).digest('hex'),
		]),
	);
	const snapshot = createHash('sha256').update(JSON.stringify(record)).digest('hex');
	const packageDirectory = path.join(directory, 'snapshots', snapshot);
	await mkdir(path.join(packageDirectory, 'assets'), { recursive: true });
	await mkdir(path.join(directory, 'profile'));
	await writeFile(path.join(directory, 'accepted.json'), JSON.stringify({ snapshot, record }));
	for (const name of ['index.html', 'unknown.js']) {
		await writeFile(path.join(directory, name), 'fixture');
	}
	for (const [name, value] of Object.entries(originals)) {
		await writeFile(path.join(packageDirectory, name), value);
	}
	return { directory, packageDirectory, originals, snapshot };
}
test('second requests serve accepted immutable buffers after package and record disk mutation', async () => {
	const data = await fixture();
	const server = await createFixtureServer(data.directory);
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		const base = `http://127.0.0.1:${address.port}`;
		const accepted = await (await fetch(`${base}/accepted.json`)).text();
		for (const [name, original] of Object.entries(data.originals)) {
			const url = `${base}/snapshots/${data.snapshot}/${name}`;
			assert.equal(await (await fetch(url)).text(), original);
			await writeFile(path.join(data.packageDirectory, name), 'tampered after preload');
			assert.equal(await (await fetch(url)).text(), original);
		}
		await writeFile(path.join(data.directory, 'accepted.json'), '{}');
		assert.equal(await (await fetch(`${base}/accepted.json`)).text(), accepted);
		await rm(data.packageDirectory, { recursive: true });
		assert.equal(
			await (await fetch(`${base}/snapshots/${data.snapshot}/entry.js`)).text(),
			data.originals['entry.js'],
		);
		assert.equal((await fetch(`${base}/snapshots/foreign/entry.js`)).status, 404);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await rm(data.directory, { recursive: true, force: true });
	}
});
for (const mutation of ['changed', 'missing', 'extra', 'record']) {
	test(`startup rejects ${mutation} snapshot data rather than accepting new runtime hashes`, async () => {
		const data = await fixture();
		try {
			if (mutation === 'changed') {
				await writeFile(path.join(data.packageDirectory, 'entry.js'), 'tampered');
			}
			if (mutation === 'missing') {
				await rm(path.join(data.packageDirectory, 'style.css'));
			}
			if (mutation === 'extra') {
				await writeFile(path.join(data.packageDirectory, 'undeclared.js'), 'extra');
			}
			if (mutation === 'record') {
				await writeFile(
					path.join(data.directory, 'accepted.json'),
					JSON.stringify({ snapshot: data.snapshot, record: {} }),
				);
			}
			await assert.rejects(createFixtureServer(data.directory), /snapshot.*mismatch/);
		} finally {
			await rm(data.directory, { recursive: true, force: true });
		}
	});
}
