import { mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildRuntimeProfile, moduleSpecifiers } from '../../../tooling/plugin-profile/build.mjs';
import { prepareSample, checkSample, buildSample } from './sample.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const output = path.resolve(here, '../../../node_modules/.cache/runtime-profile-fixture');
/** @param {string} id @param {Set<string>} exact @param {string} importer */
export function checkImport(id, exact, importer = '') {
	if (id === '@writers-ide/layout/dock-colors.css') {
		return 'bundle';
	}
	if (id.startsWith('.') || path.isAbsolute(id)) {
		const resolved = path.resolve(path.dirname(importer), id).split('?')[0];
		const root = path.resolve(here, '../../..');
		if (
			['src', 'packages-js', 'tooling'].some((directory) =>
				resolved.startsWith(`${path.join(root, directory)}${path.sep}`),
			)
		) {
			throw new Error(`Private setup source import: ${id}`);
		}
	}
	if (exact.has(id)) {
		return 'external';
	}
	// Only shared runtimes must never fall back to private copies. Other
	// compatible dependencies can bundle while their shared imports stay external.
	if (
		/^(svelte(?:[/?#]|$)|prosemirror-(?:model|state|view|transform)(?:[/?#]|$)|@writers-ide\/|@dnd-kit-svelte\/core(?:[/?#]|$))/.test(
			id,
		)
	) {
		throw new Error(`Unsupported shared import: ${id}`);
	}
	return 'bundle';
}
/** @param {string} directory @param {string} prefix @returns {Promise<Record<string, string>>} */
export async function files(directory, prefix = '') {
	/** @type {Record<string, string>} */
	const result = {};
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const name = `${prefix}${entry.name}`;
		if (entry.isDirectory()) {
			Object.assign(result, await files(path.join(directory, entry.name), `${name}/`));
		} else {
			result[name] = createHash('sha256')
				.update(await readFile(path.join(directory, entry.name)))
				.digest('hex');
		}
	}
	return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export async function buildFixture() {
	await mkdir(output, { recursive: true });
	const manifest = await buildRuntimeProfile({
		outDir: path.join(output, 'profile'),
		hostEntries: { host: path.join(here, 'host.ts') },
	});
	const map = JSON.parse(await readFile(path.join(output, 'profile/import-map.json'), 'utf8'));
	if (
		Object.keys(map.imports).length !== 27 ||
		Object.keys(map.imports).some((key) => key.endsWith('/'))
	) {
		throw new Error('Expected 27 exact mappings');
	}
	const exact = new Set(Object.keys(map.imports));
	const stage = path.join(output, 'stage');
	await rm(stage, { recursive: true, force: true });
	await build({
		configFile: false,
		root: here,
		base: './',
		publicDir: false,
		logLevel: 'error',
		plugins: [
			{
				name: 'exact-profile-imports',
				enforce: 'pre',
				resolveId(id, importer) {
					if (checkImport(id, exact, importer) === 'external') {
						return { id, external: true };
					}
				},
			},
			svelte({
				configFile: false,
				compilerOptions: { dev: false, experimental: { async: false } },
			}),
		],
		css: { postcss: { plugins: [] } },
		build: {
			outDir: stage,
			minify: false,
			assetsInlineLimit: 0,
			rolldownOptions: {
				input: path.join(here, 'plugin/entry.ts'),
				preserveEntrySignatures: 'strict',
				output: {
					entryFileNames: 'entry.js',
					chunkFileNames: 'chunks/[name]-[hash].js',
					assetFileNames: 'assets/[name][extname]',
				},
			},
		},
	});
	for (const name of ['task.worker', 'broken-worker', 'duplicate.worker']) {
		await build({
			configFile: false,
			root: here,
			publicDir: false,
			logLevel: 'error',
			build: {
				outDir: stage,
				emptyOutDir: false,
				minify: false,
				rolldownOptions: {
					input: path.join(here, `plugin/${name}.ts`),
					output: { entryFileNames: `${name}.js`, codeSplitting: false },
				},
			},
		});
		if (moduleSpecifiers(await readFile(path.join(stage, `${name}.js`), 'utf8')).length) {
			throw new Error('Worker must be self-contained');
		}
	}
	for (const [name] of Object.entries(await files(stage))) {
		if (name.endsWith('.js')) {
			for (const id of moduleSpecifiers(await readFile(path.join(stage, name), 'utf8'))) {
				if (!id.startsWith('./') && !id.startsWith('../') && !exact.has(id)) {
					throw new Error(`Unknown bare import: ${id}`);
				}
			}
		}
	}
	const styles = Object.keys(await files(stage)).filter((name) => name.endsWith('.css'));
	await writeFile(
		path.join(stage, 'manifest.toml'),
		(await readFile(path.join(here, 'plugin/manifest.toml'), 'utf8')).replace(
			'styles = []',
			`styles = [${styles.map((name) => JSON.stringify(name)).join(', ')}]`,
		),
	);
	const record = await files(stage);
	const snapshot = createHash('sha256').update(JSON.stringify(record)).digest('hex');
	await mkdir(path.join(output, 'snapshots'), { recursive: true });
	await rm(path.join(output, 'snapshots', snapshot), { recursive: true, force: true });
	await rename(stage, path.join(output, 'snapshots', snapshot));
	await writeFile(
		path.join(output, 'accepted.json'),
		JSON.stringify({
			snapshot,
			record,
			styles,
			entry: 'entry.js',
			profile: manifest.id,
			sharedStyles: manifest.styles,
			modules: manifest.modules,
		}),
	);
	const sample = await prepareSample();
	try {
		const checked = checkSample(sample.project);
		if (checked.status !== 0) {
			throw new Error(checked.stdout + checked.stderr);
		}
		const sampleStage = path.join(output, 'sample-stage');
		await buildSample(sample.project, exact, sampleStage);
		const sampleStyles = Object.keys(await files(sampleStage)).filter((name) =>
			name.endsWith('.css'),
		);
		await writeFile(
			path.join(sampleStage, 'manifest.toml'),
			`# Runtime-profile example, not an installable application package\nstyles = ${JSON.stringify(sampleStyles)}\n`,
		);
		const sampleRecord = await files(sampleStage);
		const sampleSnapshot = createHash('sha256').update(JSON.stringify(sampleRecord)).digest('hex');
		await rm(path.join(output, 'snapshots', sampleSnapshot), { recursive: true, force: true });
		await rename(sampleStage, path.join(output, 'snapshots', sampleSnapshot));
		await writeFile(
			path.join(output, 'sample-accepted.json'),
			JSON.stringify({
				snapshot: sampleSnapshot,
				record: sampleRecord,
				styles: sampleStyles,
				entry: 'entry.js',
				profile: manifest.id,
				sharedStyles: manifest.styles,
				modules: manifest.modules,
			}),
		);
	} finally {
		await sample.dispose();
	}
	const imports = Object.fromEntries(
		Object.entries(map.imports).map(([id, artifact]) => [
			id,
			`/profile/${artifact.replace(/^\.\//, '')}`,
		]),
	);
	await writeFile(
		path.join(output, 'index.html'),
		`<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script></head><body><div id="app"></div><script type="module">window.fixtureImport = (url) => import(url); await import('/profile/${manifest.hostEntries.host.replace(/^\.\//, '')}');</script></body></html>`,
	);
	await writeFile(
		path.join(output, 'unknown.js'),
		'import "@writers-ide/plugins/private"; window.unknownImported = true;',
	);
	console.log(
		`Runtime fixture: ${Object.keys(record).length} accepted files, snapshot ${snapshot}`,
	);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await buildFixture();
}
