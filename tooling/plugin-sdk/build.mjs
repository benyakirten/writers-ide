import { readFile, writeFile, mkdir, readdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { svelte2tsx } from 'svelte2tsx';
import { baseline, facadeFiles, publicSvelteSpecifiers } from '../plugin-profile/build.mjs';

/**
 * @typedef {{runtime: string[], types: string[]}} Inventory
 * @typedef {{name: string, version: string, private: boolean, type: string, exports: Record<string, string | {types: string}>, peerDependencies: Record<string, string>}} Manifest
 * @typedef {{version: string, exports: Record<string, string | {types: string}>}} SourcePackage
 */
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const names = ['plugins', 'word-processing', 'components', 'tasks', 'layout'];
/** @param {string} name */
const canonical = (name) => `@writers-ide/${name}`;
/** @param {string} value */
const slash = (value) => value.split(path.sep).join('/');
/** @param {unknown} value */
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			result.push(...(await files(filename)));
		} else {
			result.push(filename);
		}
	}
	return result.sort();
}

/**
 * Find all declaration module references, including import types and augmentations.
 * @param {string} text
 */
export function declarationReferences(text, filename = 'input.d.ts') {
	const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
	/** @type {ts.Node[]} */
	const references = [];
	/** @param {ts.Node} node */
	function visit(node) {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
			references.push(node.moduleSpecifier);
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			references.push(node.argument.literal);
		} else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
			references.push(node.name);
		} else if (ts.isExternalModuleReference(node) && node.expression) {
			references.push(node.expression);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	if (
		source.referencedFiles.length ||
		source.typeReferenceDirectives.length ||
		source.libReferenceDirectives.length
	) {
		throw new Error(`Unexpected triple-slash reference in ${filename}`);
	}
	return references.map((node) => {
		if (!ts.isStringLiteral(node)) {
			throw new Error(`Nonliteral declaration reference in ${filename}`);
		}
		return { specifier: node.text, start: node.getStart(source), end: node.end };
	});
}

/** @param {readonly ts.Diagnostic[]} diagnostics */
function diagnosticsOrThrow(diagnostics) {
	if (diagnostics.length) {
		throw new Error(
			ts.formatDiagnosticsWithColorAndContext(diagnostics, {
				getCanonicalFileName: (name) => name,
				getCurrentDirectory: () => root,
				getNewLine: () => '\n',
			}),
		);
	}
}

/** @param {string} name @returns {Promise<string>} */
async function installedVersion(name) {
	let directory = path.dirname(require.resolve(name));
	for (;;) {
		try {
			const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
			if (metadata.name === name) {
				return metadata.version;
			}
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
				throw error;
			}
		}
		const parent = path.dirname(directory);
		if (parent === directory) {
			throw new Error(`Cannot locate installed declaration dependency ${name}`);
		}
		directory = parent;
	}
}

/**
 * Emit portable, private, declarations-only SDK packages. Runtime delivery is separate.
 * @param {{outDir: string}} options
 */
export async function buildSdkDeclarations({ outDir }) {
	if (typeof outDir !== 'string' || !outDir.trim()) {
		throw new Error('outDir must be a nonempty directory path');
	}
	outDir = path.resolve(outDir);
	const temporary = await mkdtemp(path.join(root, 'tooling/plugin-sdk/.build-'));
	try {
		const sourceDir = path.join(temporary, 'source');
		const emittedDir = path.join(temporary, 'emitted');
		const roots = [];
		/** @type {Record<string, string[]>} */
		const paths = {};
		/** @type {Record<string, string>} */
		const entrySources = {};
		/** @type {Record<string, Inventory>} */
		const inventory = {};
		for (const name of names) {
			const original = path.join(root, 'packages-js', name);
			/** @type {SourcePackage} */
			const metadata = JSON.parse(await readFile(path.join(original, 'package.json'), 'utf8'));
			for (const [subpath, target] of Object.entries(metadata.exports)) {
				if (typeof target === 'object') {
					const specifier = canonical(name) + (subpath === '.' ? '' : subpath.slice(1));
					paths[specifier] = [path.join(sourceDir, name, target.types)];
				}
			}
			for (const filename of await files(original)) {
				const relative = path.relative(original, filename);
				if (
					!/\.(ts|svelte)$/.test(filename) ||
					/(^|[/\\])(tests?|__tests__)([/\\]|$)|\.(test|spec|stories)\./.test(relative)
				) {
					continue;
				}
				let text = await readFile(filename, 'utf8');
				let destination = path.join(sourceDir, name, relative);
				if (filename.endsWith('.svelte')) {
					text = svelte2tsx(text, { filename, isTsFile: true, mode: 'dts' }).code;
					destination += '.ts';
				}
				// TypeScript resolves components as generated .svelte.ts modules.
				text = text.replace(/(['"])([^'"\n]+\.svelte)\1/g, '$1$2.js$1');
				await mkdir(path.dirname(destination), { recursive: true });
				await writeFile(destination, text);
			}
		}
		for (const [specifier, facade] of Object.entries(facadeFiles)) {
			const text = await readFile(
				path.join(root, 'tooling/plugin-profile/facades', facade),
				'utf8',
			);
			const source = ts.createSourceFile(facade, text, ts.ScriptTarget.Latest, true);
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
					throw new Error(`Expected explicit curated exports: ${facade}`);
				}
				for (const element of statement.exportClause.elements) {
					(statement.isTypeOnly || element.isTypeOnly ? types : runtime).push(element.name.text);
				}
			}
			inventory[specifier] = { runtime: runtime.sort(), types: types.sort() };
			const filename = path.join(sourceDir, '_facades', facade);
			await mkdir(path.dirname(filename), { recursive: true });
			await writeFile(filename, text);
			roots.push(filename);
			entrySources[specifier] = filename;
		}
		// This build-time entry deliberately has no window runtime mapping.
		entrySources['@writers-ide/tasks/worker'] = paths['@writers-ide/tasks/worker'][0];
		inventory['@writers-ide/tasks/worker'] = {
			runtime: ['defineTaskWorker'],
			types: ['TaskWorkerScope'],
		};
		roots.push(entrySources['@writers-ide/tasks/worker']);
		roots.push(require.resolve('svelte2tsx/svelte-shims-v4.d.ts'));
		roots.push(require.resolve('svelte2tsx/svelte-jsx.d.ts'));
		const cssAmbient = path.join(sourceDir, 'css.d.ts');
		await writeFile(cssAmbient, "declare module '*.css' {}\n");
		roots.push(cssAmbient);
		/** @type {ts.CompilerOptions} */
		const options = {
			target: ts.ScriptTarget.ES2023,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			strict: true,
			skipLibCheck: false,
			declaration: true,
			emitDeclarationOnly: true,
			rootDir: sourceDir,
			outDir: emittedDir,
			paths,
			types: ['svelte', 'node'],
		};
		const program = ts.createProgram(roots, options);
		diagnosticsOrThrow(ts.getPreEmitDiagnostics(program));
		const emitted = program.emit();
		diagnosticsOrThrow(emitted.diagnostics);
		/** @param {string} filename */
		const emittedPath = (filename) =>
			path.join(emittedDir, path.relative(sourceDir, filename).replace(/\.ts$/, '.d.ts'));
		const packages = Object.fromEntries(names.map((name) => [canonical(name), `packages/${name}`]));
		/** @type {Record<string, string>} */
		const entries = {};
		/** @type {Record<string, Manifest>} */
		const manifests = {};
		/** @type {{source: string, destination: string, packageName: string}[]} */
		const pending = [];
		/** @type {Map<string, string>} */
		const outputFiles = new Map();
		for (const name of names) {
			const original = JSON.parse(
				await readFile(path.join(root, 'packages-js', name, 'package.json'), 'utf8'),
			);
			manifests[canonical(name)] = {
				name: canonical(name),
				version: original.version,
				private: true,
				type: 'module',
				exports: {},
				peerDependencies: {},
			};
		}
		for (const [specifier, filename] of Object.entries(entrySources)) {
			const packageName = specifier.split('/').slice(0, 2).join('/');
			const subpath = specifier.slice(packageName.length);
			const relative = `${packages[packageName]}/${subpath ? subpath.slice(1) : 'index'}.d.ts`;
			entries[specifier] = relative;
			manifests[packageName].exports[subpath ? `.${subpath}` : '.'] = {
				types: `./${path.posix.basename(relative)}`,
			};
			pending.push({ source: emittedPath(filename), destination: relative, packageName });
		}
		const allowedExternal = new Set([
			...Object.keys(baseline),
			...publicSvelteSpecifiers,
			'svelte/action',
			'svelte/elements',
		]);
		/** @type {Record<string, string>} */
		const dependencies = {};
		while (pending.length) {
			const next = pending.pop();
			if (!next) {
				break;
			}
			const { source, destination, packageName } = next;
			if (outputFiles.has(destination)) {
				continue;
			}
			let text = await readFile(source, 'utf8');
			text = text.replace(/^import ['"][^'"\n]+\.css['"];?\s*$/gm, '');
			const refs = declarationReferences(text, source);
			for (const ref of refs.reverse()) {
				let replacement = ref.specifier;
				if (
					replacement.startsWith('.') ||
					source.startsWith(path.join(emittedDir, '_facades') + path.sep)
				) {
					const target = paths[replacement]
						? emittedPath(paths[replacement][0])
						: path.resolve(path.dirname(source), replacement.replace(/\.js$/, '') + '.d.ts');
					const relative = path.relative(path.join(emittedDir, packageName.split('/')[1]), target);
					if (relative.startsWith('..') || path.isAbsolute(relative)) {
						throw new Error(`Cross-package relative declaration: ${source} -> ${replacement}`);
					}
					const targetDestination = `${packages[packageName]}/internal/${slash(relative)}`;
					pending.push({ source: target, destination: targetDestination, packageName });
					replacement = slash(path.relative(path.dirname(destination), targetDestination)).replace(
						/\.d\.ts$/,
						'.js',
					);
					if (!replacement.startsWith('.')) {
						replacement = `./${replacement}`;
					}
				} else if (replacement.startsWith('@writers-ide/')) {
					if (!entries[replacement]) {
						throw new Error(`Private SDK dependency: ${replacement}`);
					}
					const dependency = replacement.split('/').slice(0, 2).join('/');
					if (dependency !== packageName) {
						manifests[packageName].peerDependencies[dependency] = manifests[dependency].version;
					}
				} else {
					const dependency = replacement.startsWith('svelte/') ? 'svelte' : replacement;
					if (!allowedExternal.has(replacement)) {
						throw new Error(
							`Unapproved external declaration dependency: ${replacement} in ${source}`,
						);
					}
					if (!dependencies[dependency]) {
						const version = await installedVersion(dependency);
						if (version !== baseline[dependency]) {
							throw new Error(
								`Declaration baseline mismatch: ${dependency} expected ${baseline[dependency]}, installed ${version}`,
							);
						}
						dependencies[dependency] = version;
					}
					manifests[packageName].peerDependencies[dependency] = dependencies[dependency];
				}
				text = text.slice(0, ref.start) + JSON.stringify(replacement) + text.slice(ref.end);
			}
			if (/svelte2tsx|__sveltets_|reference path|[/\\]Users[/\\]|<project>/.test(text)) {
				throw new Error(`Nonportable declaration helpers or paths in ${source}`);
			}
			outputFiles.set(destination, text);
		}
		await mkdir(outDir, { recursive: true });
		for (const name of names) {
			await rm(path.join(outDir, packages[canonical(name)]), { recursive: true, force: true });
		}
		for (const [filename, text] of outputFiles) {
			await mkdir(path.dirname(path.join(outDir, filename)), { recursive: true });
			await writeFile(path.join(outDir, filename), text);
		}
		const css = `${packages['@writers-ide/layout']}/dock-colors.css`;
		await copyFile(
			path.join(root, 'packages-js/layout/src/dock-colors.css'),
			path.join(outDir, css),
		);
		manifests['@writers-ide/layout'].exports['./dock-colors.css'] = './dock-colors.css';
		for (const [name, manifest] of Object.entries(manifests)) {
			await writeFile(path.join(outDir, packages[name], 'package.json'), json(manifest));
		}
		const result = {
			packages,
			entries,
			inventory,
			dependencies,
			assets: [css],
			declarations: [...outputFiles.keys()].sort(),
		};
		await writeFile(path.join(outDir, 'index.json'), json(result));
		return result;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	if (process.argv.length !== 3) {
		throw new Error('Usage: node tooling/plugin-sdk/build.mjs <outDir>');
	}
	await buildSdkDeclarations({ outDir: process.argv[2] });
}
