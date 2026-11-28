import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { compile } from 'svelte/compiler';
import { encodedFixtures, unknownBytes } from './frontend/fixture-data.js';

const root = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(root, 'frontend');
const dist = resolve(root, 'dist');
const files = new Map();
const runtime = {
	svelte: 'export { mount, unmount, tick } from "svelte";',
	'svelte/internal/client': 'export * from "svelte/internal/client";',
	'prosemirror-model': 'export * from "prosemirror-model";',
	'prosemirror-state': 'export * from "prosemirror-state";',
	'prosemirror-transform': 'export * from "prosemirror-transform";',
};
const names = Object.fromEntries(Object.keys(runtime).map((id) => [id, id.replaceAll('/', '-')]));

async function bundle(options) {
	const result = await build({
		configFile: false,
		root: frontend,
		publicDir: false,
		logLevel: 'warn',
		resolve: { conditions: ['browser', 'production'], dedupe: ['svelte'] },
		...options,
		build: {
			write: false,
			minify: false,
			sourcemap: false,
			target: 'es2022',
			modulePreload: false,
			...options.build,
			rolldownOptions: { preserveEntrySignatures: 'strict', ...options.build?.rolldownOptions },
		},
	});
	if (Array.isArray(result)) {
		throw new Error('Expected one ES-module output');
	}
	return result.output;
}

function collect(output) {
	for (const item of output) {
		if (files.has(item.fileName)) {
			throw new Error(`Duplicate output: ${item.fileName}`);
		}
		files.set(item.fileName, Buffer.from(item.type === 'chunk' ? item.code : item.source));
	}
}

collect(
	await bundle({
		plugins: [
			{
				name: 'fixture-runtime-entries',
				resolveId(id) {
					if (id.startsWith('prototype-runtime:')) {
						return `\0${id}`;
					}
				},
				load(id) {
					if (id.startsWith('\0prototype-runtime:')) {
						return runtime[id.slice('\0prototype-runtime:'.length)];
					}
				},
			},
		],
		build: {
			rolldownOptions: {
				input: Object.fromEntries(
					Object.entries(names).map(([id, name]) => [name, `prototype-runtime:${id}`]),
				),
				output: {
					format: 'es',
					entryFileNames: 'runtime/[name].js',
					chunkFileNames: 'runtime/chunks/[name]-[hash].js',
				},
			},
		},
	}),
);

collect(
	await bundle({
		plugins: [
			{
				name: 'fixture-svelte-production-client',
				async transform(_code, id) {
					if (id.endsWith('.svelte')) {
						const source = await readFile(id, 'utf8');
						return {
							code: compile(source, {
								filename: id,
								generate: 'client',
								dev: false,
								runes: true,
								discloseVersion: false,
								css: 'external',
							}).js.code,
							map: null,
						};
					}
				},
			},
		],
		build: {
			rolldownOptions: {
				input: { plugin: resolve(frontend, 'plugin.js'), child: resolve(frontend, 'child.js') },
				external: Object.keys(runtime),
				output: {
					format: 'es',
					entryFileNames: 'fixture/[name].js',
					chunkFileNames: 'fixture/chunks/[name]-[hash].js',
				},
			},
		},
	}),
);
const worker = await bundle({
	build: {
		rolldownOptions: {
			input: resolve(frontend, 'worker.js'),
			output: { format: 'es', entryFileNames: 'fixture/worker.js', codeSplitting: false },
		},
	},
});
if (
	worker.length !== 1 ||
	worker[0].type !== 'chunk' ||
	worker[0].imports.length ||
	worker[0].dynamicImports.length
) {
	throw new Error('Worker must be a single self-contained ES module');
}
collect(worker);
for (const [name, content] of encodedFixtures) {
	files.set(`fixture/${name}`, Buffer.from(content));
}
files.set('fixture/unknown.dat', Buffer.from(unknownBytes));
files.set(
	'fixture/script.dat',
	Buffer.from(
		'globalThis.__RESOURCE_DAT_EXECUTED__ = true;\nexport const validJavaScript = true;\n',
	),
);
// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
// Fixed precompiled Wasm bytes; no compiler dependency or runtime source generation.
files.set(
	'fixture/add.wasm',
	Buffer.from([
		0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100,
		100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
	]),
);
for (const name of ['plugin.css', 'icon.svg']) {
	files.set(`fixture/${name}`, await readFile(resolve(frontend, name)));
}
// Nunito Sans, from the existing Storybook dependency. Keep its OFL provenance with this fixture.
const font = resolve(root, '../../node_modules/storybook/assets/browser/nunito-sans-regular.woff2');
files.set('fixture/font.woff2', await readFile(font));
const fontLicense = await readFile(resolve(root, 'OFL.txt'));
files.set('fixture/OFL.txt', fontLicense);
files.set(
	'runtime-map.json',
	Buffer.from(
		JSON.stringify(
			{
				imports: Object.fromEntries(
					Object.entries(names).map(([id, name]) => [id, `runtime/${name}.js`]),
				),
			},
			null,
			2,
		) + '\n',
	),
);

const host = await bundle({
	build: {
		rolldownOptions: {
			input: resolve(frontend, 'bootstrap.js'),
			external: Object.keys(runtime),
			output: { format: 'es', entryFileNames: 'bootstrap.js', codeSplitting: false },
		},
	},
});
if (host.length !== 1 || host[0].type !== 'chunk' || host[0].imports.length !== 0) {
	throw new Error('Host bootstrap must remain standalone with no static runtime imports');
}
const probe = await bundle({
	build: {
		rolldownOptions: {
			input: resolve(frontend, 'probe.js'),
			external: Object.keys(runtime),
			output: { format: 'es', entryFileNames: 'probe.js', codeSplitting: false },
		},
	},
});
if (
	probe.length !== 1 ||
	probe[0].type !== 'chunk' ||
	probe[0].imports.length !== 0 ||
	probe[0].dynamicImports.length !== 0
) {
	throw new Error('Host probe must remain standalone with no runtime or fixture imports');
}
const html = await readFile(resolve(frontend, 'index.html'));
const probeHtml = await readFile(resolve(frontend, 'probe.html'));

const secondFiles = new Map(files);
secondFiles.set(
	'fixture/plugin.js',
	Buffer.concat([
		Buffer.from('// Second accepted fixture snapshot.\n'),
		files.get('fixture/plugin.js'),
	]),
);
function prepareSnapshot(contents) {
	const sorted = [...contents].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const maxFileBytes = 1024 * 1024;
	const total = sorted.reduce((sum, [, bytes]) => sum + bytes.length, 0);
	if (
		sorted.length > 64 ||
		total > 4 * 1024 * 1024 ||
		sorted.some(
			([path, bytes]) =>
				bytes.length > maxFileBytes ||
				!(
					path === 'runtime-map.json' ||
					path.startsWith('runtime/') ||
					path.startsWith('fixture/')
				) ||
				Buffer.byteLength(path) > 512 ||
				path
					.split('/')
					.some(
						(segment) =>
							!segment ||
							segment === '.' ||
							segment === '..' ||
							/[<>:"\\\\|?*]/u.test(segment) ||
							[...segment].some(
								(character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
							) ||
							/[. ]$/.test(segment) ||
							/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
					),
		)
	) {
		throw new Error('Fixture exceeds its portable file/count/byte budgets');
	}
	const record = {
		format_version: 1,
		files: Object.fromEntries(
			sorted.map(([path, bytes]) => [
				path,
				{ byte_length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
			]),
		),
	};
	return { sorted, record, total };
}
// Validate BOTH snapshots before writing any output. Paths originate only in this build's internal map.
const snapshots = [
	{ directory: 'package', recordName: 'fixture-record.json', ...prepareSnapshot(files) },
	{
		directory: 'package-second',
		recordName: 'fixture-record-second.json',
		...prepareSnapshot(secondFiles),
	},
];
// Acceptance is explicit at BUILD TIME. Loading must never regenerate these trusted records.
await rm(dist, { recursive: true, force: true });
for (const snapshot of snapshots) {
	for (const [path, bytes] of snapshot.sorted) {
		const destination = resolve(dist, snapshot.directory, path);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, bytes);
	}
	await writeFile(
		resolve(dist, snapshot.recordName),
		JSON.stringify(snapshot.record, null, 2) + '\n',
	);
}
await writeFile(resolve(dist, '.gitignore'), '*\n');
await mkdir(resolve(dist, 'host'), { recursive: true });
await writeFile(resolve(dist, 'host/index.html'), html);
await writeFile(resolve(dist, 'host/OFL.txt'), fontLicense);
await writeFile(resolve(dist, 'host/bootstrap.js'), host[0].code);
await writeFile(resolve(dist, 'host/probe.html'), probeHtml);
await writeFile(resolve(dist, 'host/probe.js'), probe[0].code);

for (const snapshot of snapshots) {
	console.log(
		`Built ${snapshot.directory}: ${snapshot.sorted.length} verified files, ${snapshot.total} bytes.`,
	);
}
console.log(
	'Host bootstrap and probe are standalone; trusted records were generated only at build time.',
);
