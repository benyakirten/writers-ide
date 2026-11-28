import { readFile, writeFile, mkdir, readdir, realpath, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';
import { compile, compileModule } from 'svelte/compiler';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';

/**
 * @typedef {{ runtime: string[], types: string[] }} FacadeInventory
 * @typedef {{ name: string, version: string, directory: string }} PackageMetadata
 * @typedef {{ imports: string[], dynamicImports: string[] }} SourceGraphEntry
 * @typedef {{ imports: string[], dynamicImports: string[], exports: string[], modules: string[] }} ChunkGraphEntry
 * @typedef {{ artifact: string, visibility: 'author' | 'compiler-internal', exports: string[] }} RuntimeModule
 * @typedef {{ name: string, version: string, visibility: 'private-implementation' }} Dependency
 * @typedef {{ outDir: string, hostEntries?: Record<string, string> }} BuildRuntimeProfileOptions
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(here, '../..');

export const profileId = 'writers-ide.frontend/1';
/** @type {Readonly<Record<string, string>>} */
export const baseline = Object.freeze({
	svelte: '5.57.3',
	'prosemirror-model': '1.25.13',
	'prosemirror-state': '1.4.4',
	'prosemirror-view': '1.42.9',
	'prosemirror-transform': '1.12.5',
	'@dnd-kit-svelte/core': '0.0.11',
});
/** @type {Readonly<import('svelte/compiler').CompileOptions>} */
export const compilerOptions = Object.freeze({
	generate: 'client',
	dev: false,
	experimental: Object.freeze({ async: false }),
});
export const publicSvelteSpecifiers = Object.freeze([
	'svelte',
	'svelte/store',
	'svelte/reactivity',
	'svelte/reactivity/window',
	'svelte/transition',
	'svelte/motion',
	'svelte/easing',
	'svelte/attachments',
	'svelte/events',
	'svelte/legacy',
]);
/** @type {Readonly<Record<string, string>>} */
export const facadeFiles = Object.freeze({
	'@writers-ide/plugins': 'plugins.ts',
	'@writers-ide/plugins/svelte': 'plugins-svelte.ts',
	'@writers-ide/plugins/native': 'plugins-native.ts',
	'@writers-ide/word-processing': 'word-processing.ts',
	'@writers-ide/word-processing/svelte': 'word-processing-svelte.ts',
	'@writers-ide/word-processing/structure': 'word-processing-structure.ts',
	'@writers-ide/components': 'components.ts',
	'@writers-ide/tasks': 'tasks.ts',
	'@writers-ide/layout': 'layout.ts',
});

/** @param {Iterable<string>} values */
function sorted(values) {
	return [...values].sort();
}

/** @param {string} value */
export function normalizeSourcePath(value) {
	return value.replaceAll('\\', '/');
}

/**
 * @param {string} id
 * @param {string} projectRoot
 */
export function sourceModuleId(id, projectRoot) {
	const prefix = `${normalizeSourcePath(projectRoot).replace(/\/$/, '')}/`;
	return normalizeSourcePath(id).replaceAll(prefix, '<project>/').replaceAll('\0', '<virtual>');
}

/** @param {string} code */
export function moduleSpecifiers(code) {
	const source = ts.createSourceFile(
		'module.js',
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	/** @type {Set<string>} */
	const found = new Set();
	/** @param {import('typescript').Node} node */
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.add(node.moduleSpecifier.text);
		}
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const argument = node.arguments[0];
			if (!argument || !ts.isStringLiteral(argument)) {
				throw new Error('Runtime profile contains a nonliteral dynamic import');
			}
			found.add(argument.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return sorted(found);
}

/** @param {string} code */
export function assertRelativeImports(code) {
	for (const specifier of moduleSpecifiers(code)) {
		if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
			throw new Error(`Unresolved runtime profile import: ${specifier}`);
		}
	}
}

/**
 * @param {string} filename
 * @returns {Promise<PackageMetadata>}
 */
async function packageMetadata(filename) {
	let directory = path.dirname(await realpath(filename));
	while (directory !== path.dirname(directory)) {
		try {
			/** @type {unknown} */
			const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
			if (
				metadata &&
				typeof metadata === 'object' &&
				'name' in metadata &&
				typeof metadata.name === 'string' &&
				metadata.name &&
				'version' in metadata &&
				typeof metadata.version === 'string' &&
				metadata.version
			) {
				return { name: metadata.name, version: metadata.version, directory };
			}
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
				throw error;
			}
		}
		directory = path.dirname(directory);
	}
	throw new Error(`No package metadata for ${filename}`);
}

/** @param {Readonly<Record<string, string | undefined>>} versions */
export function verifyBaseline(versions) {
	for (const [name, expected] of Object.entries(baseline)) {
		if (versions[name] !== expected) {
			throw new Error(
				`Runtime profile baseline mismatch: ${name}: expected ${expected}, installed ${versions[name] ?? 'missing'}`,
			);
		}
	}
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function walk(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(filename)));
		} else if (entry.isFile()) {
			files.push(filename);
		}
	}
	return sorted(files);
}

// This prepass discovers entry specifiers without creating another runtime bundle.
// The actual build below also checks imports emitted by the Svelte Vite plugin.
/** @param {string} dndDirectory */
async function discoverCompilerImports(dndDirectory) {
	const files = await walk(path.join(here, 'fixtures'));
	for (const name of ['components', 'layout', 'word-processing', 'tasks']) {
		files.push(...(await walk(path.join(root, 'packages-js', name, 'src'))));
	}
	files.push(...(await walk(path.join(dndDirectory, 'dist'))));
	/** @type {Record<string, string[]>} */
	const evidence = {};
	for (const filename of files) {
		if (/\.(test|spec)\./.test(filename)) {
			continue;
		}
		let code;
		if (filename.endsWith('.svelte')) {
			code = compile(await readFile(filename, 'utf8'), { ...compilerOptions, filename }).js.code;
		} else if (/\.svelte\.[jt]s$/.test(filename)) {
			const source = ts.transpileModule(await readFile(filename, 'utf8'), {
				compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
			}).outputText;
			code = compileModule(source, { filename, dev: false, experimental: { async: false } }).js
				.code;
		} else if (filename.endsWith('.js') && filename.startsWith(dndDirectory)) {
			code = await readFile(filename, 'utf8');
		} else {
			continue;
		}
		const imports = moduleSpecifiers(code).filter((specifier) =>
			specifier.startsWith('svelte/internal/'),
		);
		if (imports.length) {
			evidence[normalizeSourcePath(path.relative(root, filename))] = imports;
		}
	}
	return { specifiers: sorted(new Set(Object.values(evidence).flat())), evidence };
}

/** @returns {Promise<Record<string, FacadeInventory>>} */
export async function readFacadeInventory() {
	/** @type {Record<string, FacadeInventory>} */
	const inventory = {};
	for (const [specifier, filename] of Object.entries(facadeFiles)) {
		const source = ts.createSourceFile(
			filename,
			await readFile(path.join(here, 'facades', filename), 'utf8'),
			ts.ScriptTarget.Latest,
			true,
		);
		/** @type {string[]} */
		const runtime = [];
		/** @type {string[]} */
		const types = [];
		for (const statement of source.statements) {
			if (
				!ts.isExportDeclaration(statement) ||
				!statement.exportClause ||
				!ts.isNamedExports(statement.exportClause)
			) {
				throw new Error(`Facade must contain only explicit named exports: ${filename}`);
			}
			for (const element of statement.exportClause.elements) {
				(statement.isTypeOnly || element.isTypeOnly ? types : runtime).push(element.name.text);
			}
		}
		inventory[specifier] = { runtime: sorted(runtime), types: sorted(types) };
	}
	return inventory;
}

/**
 * Builds an internal fixture artifact. Both consumers must use this same graph.
 * @param {BuildRuntimeProfileOptions} options
 */
export async function buildRuntimeProfile({ outDir, hostEntries = {} }) {
	if (!outDir || typeof outDir !== 'string') {
		throw new Error('buildRuntimeProfile requires an explicit outDir string');
	}
	outDir = path.resolve(outDir);
	// Never allow Vite to erase source directories. Only modules/ is emptied.
	if (outDir === root || here.startsWith(`${outDir}${path.sep}`) || outDir === here) {
		throw new Error('Runtime profile output must not contain the tooling source');
	}
	/** @type {Record<string, string>} */
	const versions = {};
	/** @type {Record<string, PackageMetadata>} */
	const metadata = {};
	for (const name of Object.keys(baseline)) {
		metadata[name] = await packageMetadata(path.join(root, 'node_modules', name, 'package.json'));
		versions[name] = metadata[name].version;
	}
	verifyBaseline(versions);
	const compilerImports = await discoverCompilerImports(metadata['@dnd-kit-svelte/core'].directory);
	const facadeInventory = await readFacadeInventory();
	const authorSpecifiers = [
		...Object.keys(facadeFiles),
		...publicSvelteSpecifiers,
		...Object.keys(baseline).filter((name) => name !== 'svelte'),
	];
	const specifiers = [...authorSpecifiers, ...compilerImports.specifiers];
	const entries = new Map(
		specifiers.map((specifier, index) => [`profile-entry-${index}`, specifier]),
	);
	if (!hostEntries || typeof hostEntries !== 'object' || Array.isArray(hostEntries)) {
		throw new Error(
			'hostEntries must be a record of trusted entry names and absolute source paths',
		);
	}
	const trustedHostEntries = new Map(Object.entries(hostEntries));
	for (const [name, filename] of trustedHostEntries) {
		if (entries.has(name)) {
			throw new Error(`Host entry name collides with a generated runtime entry: ${name}`);
		}
		if (typeof filename !== 'string' || !path.isAbsolute(filename)) {
			throw new Error(`Host entry source must be an absolute path: ${name}`);
		}
	}
	/** @type {Set<string>} */
	const observedCompilerImports = new Set();
	/** @type {Record<string, SourceGraphEntry>} */
	const sourceGraph = {};
	/** @param {string} id */
	const moduleId = (id) => sourceModuleId(id, root);
	/** @type {Array<import('vite').Rolldown.OutputChunk | import('vite').Rolldown.OutputAsset> | undefined} */
	let output;
	await build({
		configFile: false,
		root,
		mode: 'production',
		publicDir: false,
		logLevel: 'error',
		plugins: [
			{
				name: 'runtime-profile-entries',
				resolveId(id) {
					if (entries.has(id)) {
						return `\0${id}`;
					}
				},
				load(id) {
					const specifier = entries.get(id.slice(1));
					if (!specifier) {
						return;
					}
					if (facadeFiles[specifier]) {
						return `export * from ${JSON.stringify(normalizeSourcePath(path.join(here, 'facades', facadeFiles[specifier])))};`;
					}
					// Preserve side effects for zero-export Svelte flags/disclosure entries.
					return `import ${JSON.stringify(specifier)}; export * from ${JSON.stringify(specifier)};`;
				},
			},
			svelte({
				configFile: false,
				compilerOptions: { dev: false, experimental: { async: false } },
			}),
			{
				name: 'runtime-profile-audit',
				enforce: 'post',
				transform(code, id) {
					if (
						!normalizeSourcePath(id).includes('node_modules/svelte/') &&
						/\.svelte(?:\.[jt]s)?(?:\?|$)/.test(id)
					) {
						for (const specifier of moduleSpecifiers(code)) {
							if (specifier.startsWith('svelte/internal/')) {
								if (!compilerImports.specifiers.includes(specifier)) {
									throw new Error(`Undiscovered compiler import ${specifier} in ${id}`);
								}
								observedCompilerImports.add(specifier);
							}
						}
					}
				},
				generateBundle(_options, bundle) {
					for (const id of this.getModuleIds()) {
						const info = this.getModuleInfo(id);
						if (!info) {
							throw new Error(`Missing runtime profile module information: ${id}`);
						}
						sourceGraph[moduleId(id)] = {
							imports: sorted(info.importedIds.map(moduleId)),
							dynamicImports: sorted(info.dynamicallyImportedIds.map(moduleId)),
						};
					}
					for (const entry of Object.values(sourceGraph)) {
						for (const id of [...entry.imports, ...entry.dynamicImports]) {
							if (!sourceGraph[id]) {
								throw new Error(`Unresolved source dependency in runtime profile: ${id}`);
							}
						}
					}
					output = Object.values(bundle);
					for (const chunk of output) {
						if (chunk.type === 'chunk') {
							assertRelativeImports(chunk.code);
						}
					}
				},
			},
		],
		resolve: { conditions: ['browser', 'module', 'production'], dedupe: Object.keys(baseline) },
		css: { postcss: { plugins: [] } },
		build: {
			outDir: path.join(outDir, 'modules'),
			emptyOutDir: true,
			minify: false,
			target: 'es2022',
			rolldownOptions: {
				input: Object.fromEntries([
					...[...entries.keys()].map((name) => [name, name]),
					...[...trustedHostEntries].map(([name, filename]) => [
						name,
						normalizeSourcePath(filename),
					]),
				]),
				preserveEntrySignatures: 'strict',
				output: {
					format: 'es',
					entryFileNames: '[name]-[hash].js',
					chunkFileNames: 'shared-[hash].js',
				},
			},
		},
	});
	if (!output) {
		throw new Error('Runtime profile build produced no output bundle');
	}
	/** @type {Record<string, string>} */
	const imports = {};
	/** @type {Record<string, RuntimeModule>} */
	const modules = {};
	/** @type {Map<string, string>} */
	const emittedHostEntries = new Map();
	/** @type {Record<string, ChunkGraphEntry>} */
	const chunks = {};
	for (const chunk of output) {
		if (chunk.type !== 'chunk') {
			continue;
		}
		const artifact = `./modules/${chunk.fileName}`;
		chunks[artifact] = {
			imports: chunk.imports.map((name) => `./modules/${name}`),
			dynamicImports: chunk.dynamicImports.map((name) => `./modules/${name}`),
			exports: sorted(chunk.exports),
			modules: sorted(Object.keys(chunk.modules).map(moduleId)),
		};
		if (chunk.isEntry && trustedHostEntries.has(chunk.name)) {
			emittedHostEntries.set(chunk.name, artifact);
		}
		const specifier = chunk.facadeModuleId
			? entries.get(chunk.facadeModuleId.replace(/^\0/, ''))
			: undefined;
		if (specifier) {
			imports[specifier] = artifact;
			modules[specifier] = {
				artifact,
				visibility: authorSpecifiers.includes(specifier) ? 'author' : 'compiler-internal',
				exports: sorted(chunk.exports),
			};
			if (
				facadeInventory[specifier] &&
				JSON.stringify(modules[specifier].exports) !==
					JSON.stringify(facadeInventory[specifier].runtime)
			) {
				throw new Error(`Runtime facade exports differ from approved source: ${specifier}`);
			}
		}
	}
	for (const specifier of specifiers) {
		if (!imports[specifier]) {
			throw new Error(`Missing runtime profile artifact: ${specifier}`);
		}
	}
	for (const name of trustedHostEntries.keys()) {
		if (!emittedHostEntries.has(name)) {
			throw new Error(`Missing trusted host entry artifact: ${name}`);
		}
	}
	/** @type {Record<string, Dependency>} */
	const dependencies = {};
	for (const id of Object.keys(sourceGraph)) {
		if (id.startsWith('<project>/node_modules/')) {
			const filename = path.resolve(root, id.slice('<project>/'.length).split('?')[0]);
			const pkg = await packageMetadata(filename);
			dependencies[`${pkg.name}@${pkg.version}`] = {
				name: pkg.name,
				version: pkg.version,
				visibility: 'private-implementation',
			};
		}
	}
	await mkdir(path.join(outDir, 'facades'), { recursive: true });
	for (const filename of Object.values(facadeFiles)) {
		await copyFile(path.join(here, 'facades', filename), path.join(outDir, 'facades', filename));
	}
	const assets = output
		.filter((entry) => entry.type === 'asset')
		.map((entry) => `./modules/${entry.fileName}`)
		.sort();
	const manifest = {
		id: profileId,
		assets,
		styles: assets.filter((artifact) => artifact.endsWith('.css')),
		versions,
		compiler: {
			name: 'svelte',
			version: versions.svelte,
			options: compilerOptions,
			tracing: false,
			environment: 'production-browser',
		},
		modules,
		hostEntries: Object.fromEntries(emittedHostEntries),
		compilerImports: { ...compilerImports, observedInSharedBuild: sorted(observedCompilerImports) },
		typeSurface: {
			kind: 'workspace-source-facades',
			standaloneDeclarations: false,
			facades: Object.fromEntries(
				Object.entries(facadeFiles).map(([specifier, filename]) => [
					specifier,
					{ source: `./facades/${filename}`, ...facadeInventory[specifier] },
				]),
			),
			svelteTypeOnlySpecifiers: ['svelte/action', 'svelte/elements'],
		},
		graph: { chunks, sources: sourceGraph, dependencies },
	};
	await writeFile(
		path.join(outDir, 'import-map.json'),
		`${JSON.stringify({ imports }, null, 2)}\n`,
	);
	await writeFile(path.join(outDir, 'profile.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	if (process.argv.length !== 3) {
		throw new Error('Usage: node tooling/plugin-profile/build.mjs <outDir>');
	}
	const manifest = await buildRuntimeProfile({ outDir: process.argv[2] });
	console.log(
		`Built ${manifest.id}: ${Object.keys(manifest.modules).length} exact runtime entries`,
	);
}
