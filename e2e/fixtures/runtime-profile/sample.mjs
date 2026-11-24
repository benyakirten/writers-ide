import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, realpath, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { buildSdkDeclarations } from '../../../tooling/plugin-sdk/build.mjs';
import { moduleSpecifiers } from '../../../tooling/plugin-profile/build.mjs';

const checkout = fileURLToPath(new URL('../../../', import.meta.url));
const example = path.join(checkout, 'examples/plugins/portable-sdk');
/**
 * @typedef {{name: string, version: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string>, peerDependencies?: Record<string, string>, optionalDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, {optional?: boolean}>}} PackageMetadata
 */
/** @param {string} filename @returns {Promise<PackageMetadata>} */
const json = async (filename) => JSON.parse(await readFile(filename, 'utf8'));

/** @param {string} name @param {string} from @returns {Promise<string>} */
async function installedDirectory(name, from) {
	const resolver = createRequire(path.join(from, 'package.json'));
	for (const search of resolver.resolve.paths(name) ?? []) {
		const directory = path.join(search, name);
		try {
			if ((await json(path.join(directory, 'package.json'))).name === name) {
				return realpath(directory);
			}
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
				throw error;
			}
		}
	}
	throw new Error(`Cannot locate installed package ${name} from ${from}`);
}

/** Copy actual packages, including their dependency closure. Never copy workspace SDK source. */
export async function prepareSample() {
	const temporary = await mkdtemp(path.join(os.tmpdir(), 'writers-portable-sample-'));
	try {
		assert.ok(!temporary.startsWith(checkout));
		const project = path.join(temporary, 'sample');
		await cp(example, project, { recursive: true });

		const artifacts = path.join(temporary, 'sdk');
		const sdk = await buildSdkDeclarations({ outDir: artifacts });
		const modules = path.join(project, 'node_modules');
		for (const [name, relative] of Object.entries(sdk.packages)) {
			await mkdir(path.dirname(path.join(modules, name)), { recursive: true });
			await cp(path.join(artifacts, relative), path.join(modules, name), { recursive: true });
		}
		/** @type {Map<string, string>} */
		const installed = new Map();
		/** @param {string} name @param {string} from @param {string | undefined} expected @param {string} owner @returns {Promise<void>} */
		async function copyPackage(name, from, expected, owner = project) {
			assert.ok(!name.startsWith('@writers-ide/'), `SDK source requested: ${name}`);
			const source = await installedDirectory(name, from);
			const metadata = await json(path.join(source, 'package.json'));
			if (expected) {
				assert.equal(metadata.version, expected, name);
			}
			const rootDestination = path.join(modules, name);
			if (installed.get(rootDestination) === metadata.version) {
				return;
			}
			const destination = installed.has(rootDestination)
				? path.join(owner, 'node_modules', name)
				: rootDestination;
			if (installed.get(destination) === metadata.version) {
				return;
			}
			assert.ok(!installed.has(destination), `Conflicting dependency ${name}`);
			installed.set(destination, metadata.version);
			await mkdir(path.dirname(destination), { recursive: true });
			await cp(source, destination, {
				recursive: true,
				dereference: true,
				filter: (filename) =>
					!path.relative(source, filename).split(path.sep).includes('node_modules'),
			});
			const dependencies = {
				...metadata.peerDependencies,
				...metadata.dependencies,
				...metadata.optionalDependencies,
			};
			for (const dependency of Object.keys(dependencies)) {
				try {
					await installedDirectory(dependency, source);
				} catch (error) {
					if (
						metadata.optionalDependencies?.[dependency] ||
						metadata.peerDependenciesMeta?.[dependency]?.optional
					) {
						continue;
					}
					throw error;
				}
				await copyPackage(dependency, source, undefined, destination);
			}
		}
		for (const [name, version] of Object.entries(sdk.dependencies)) {
			await copyPackage(name, checkout, version);
		}
		const metadata = await json(path.join(project, 'package.json'));
		for (const [name, version] of Object.entries({
			...metadata.dependencies,
			...metadata.devDependencies,
			svelte2tsx: '0.7.63',
		})) {
			if (!sdk.packages[name]) {
				await copyPackage(name, checkout, version);
			}
		}
		return {
			temporary,
			project,
			sdk,
			installed,
			dispose: () => rm(temporary, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

/** Run the sample's real Svelte/TS checker with compiler-program auditing enabled.
 * @param {string} project
 */
export function checkSample(project) {
	const audit = path.join(project, 'resolution-audit.json');
	const result = spawnSync(
		process.execPath,
		[
			path.join(project, 'node_modules/svelte-check/bin/svelte-check'),
			'--tsconfig',
			'./tsconfig.json',
			'--output',
			'machine',
		],
		{
			cwd: project,
			encoding: 'utf8',
			timeout: 60000,
			env: {
				...process.env,
				NODE_PATH: '',
				NODE_OPTIONS: `--import=${new URL('./sample-audit.mjs', import.meta.url).href}`,
				PORTABLE_SAMPLE_ROOT: project,
				PORTABLE_SAMPLE_AUDIT: audit,
			},
		},
	);
	return result;
}

/** @param {string} project @param {ReadonlySet<string>} exact @param {string} outDir */
export async function buildSample(project, exact, outDir) {
	await writeFile(path.join(project, 'profile-imports.json'), JSON.stringify([...exact]));
	// Execute the sample's own production Vite configuration, not a workspace source build.
	const result = spawnSync(
		process.execPath,
		[path.join(project, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir],
		{
			cwd: project,
			encoding: 'utf8',
			timeout: 60000,
			env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
		},
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	for (const entry of await readdir(outDir, { recursive: true })) {
		if (entry.endsWith('.js')) {
			for (const id of moduleSpecifiers(await readFile(path.join(outDir, entry), 'utf8'))) {
				assert.ok(
					id.startsWith('./') || id.startsWith('../') || exact.has(id),
					`Unknown sample import ${id}`,
				);
			}
		}
	}
	return result.stdout;
}
