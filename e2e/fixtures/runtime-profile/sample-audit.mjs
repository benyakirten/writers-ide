// Test-only instrumentation of the real svelte-check TypeScript language service.
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {(request: string, parent: NodeJS.Module | null | undefined, isMain?: boolean) => unknown} ModuleLoader */
// Node does not declare this private hook. Keep its test-only signature local.
const loader = /** @type {typeof Module & {_load: ModuleLoader}} */ (Module);
const originalLoad = loader._load;
const sampleRoot = process.env.PORTABLE_SAMPLE_ROOT;
const auditFile = process.env.PORTABLE_SAMPLE_AUDIT;
if (!sampleRoot || !auditFile) {
	throw new Error('The sample audit requires PORTABLE_SAMPLE_ROOT and PORTABLE_SAMPLE_AUDIT');
}
const root = fs.realpathSync(sampleRoot);
/** @type {Set<string>} */
const sources = new Set();
/** @type {Set<import('typescript').Program>} */
const programs = new Set();
/** @param {import('typescript').Program | undefined} program */
function inspect(program) {
	if (!program) {
		return;
	}
	programs.add(program);
	for (const source of program.getSourceFiles()) {
		// The language service exposes compiled Svelte snapshots under their source names.
		const filename = path.resolve(source.fileName);
		if (!filename.startsWith(root + path.sep)) {
			throw new Error(`Compiler resolved outside clean sample: ${filename}`);
		}
		if (fs.existsSync(filename) && !fs.realpathSync(filename).startsWith(root + path.sep)) {
			throw new Error(`Compiler followed source link: ${filename}`);
		}
		sources.add(filename);
	}
}
/** @param {string} id @param {NodeJS.Module | null | undefined} parent @param {boolean} [isMain] */
function auditedLoad(id, parent, isMain) {
	const loaded = originalLoad.call(loader, id, parent, isMain);
	if (id !== 'typescript') {
		return loaded;
	}
	const ts = /** @type {typeof import('typescript')} */ (loaded);
	return {
		...ts,
		/** @param {Parameters<typeof ts.createLanguageService>} args */
		createLanguageService(...args) {
			const service = ts.createLanguageService(...args);
			return new Proxy(service, {
				get(target, key) {
					const value = /** @type {unknown} */ (Reflect.get(target, key));
					if (typeof value !== 'function') {
						return value;
					}
					/** @param {unknown[]} parameters */
					const invoke = (...parameters) => {
						const result = value.apply(target, parameters);
						if (String(key).includes('Diagnostics') || key === 'getProgram') {
							inspect(target.getProgram());
						}
						return result;
					};
					return invoke;
				},
			});
		},
	};
}
loader._load = auditedLoad;
process.on('exit', () => {
	fs.writeFileSync(
		auditFile,
		JSON.stringify({ programs: programs.size, sources: [...sources].sort() }),
	);
});
