import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, rm, rename, readdir, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { prepareSample, checkSample, buildSample } from './sample.mjs';
import { normalizePath, fileImportSpecifier } from './sample-paths.mjs';
import { buildRuntimeProfile, moduleSpecifiers } from '../../../tooling/plugin-profile/build.mjs';

/** @param {string} directory @returns {Promise<void>} */
async function assertCopied(directory) {
	for (const name of await readdir(directory)) {
		const filename = path.join(directory, name);
		const stat = await lstat(filename);
		assert.equal(stat.isSymbolicLink(), false, filename);
		if (stat.isDirectory()) {
			await assertCopied(filename);
		}
	}
}
/** @param {readonly string[]} sources */
function assertResolutionSources(sources) {
	const normalized = sources.map(normalizePath);
	assert.ok(normalized.some((name) => name.endsWith('/src/Presentation.svelte')));
	assert.ok(normalized.some((name) => name.endsWith('/src/Card.svelte')));
	assert.ok(normalized.some((name) => name.includes('/typescript/lib/lib.')));
	assert.ok(normalized.some((name) => name.includes('/@writers-ide/plugins/index.d.ts')));
}
/** @param {string} project */
async function audit(project) {
	/** @type {{programs: number, sources: string[]}} */
	const result = JSON.parse(await readFile(path.join(project, 'resolution-audit.json'), 'utf8'));
	assert.ok(result.programs > 0, 'The actual Svelte language-service program must be inspected');
	assertResolutionSources(result.sources);
	const root = normalizePath(await realpath(project));
	for (const filename of result.sources.map(normalizePath)) {
		assert.ok(filename.startsWith(root + '/'), filename);
		assert.doesNotMatch(filename, /packages-js|plugin-sdk\/\.build-/);
	}
	return result;
}

test('audit filenames and filesystem import specifiers support POSIX and Windows paths', () => {
	/** @type {[string, typeof path.posix][]} */
	const platforms = [
		['/tmp/sample', path.posix],
		['C:\\temp\\sample', path.win32],
	];
	for (const [root, paths] of platforms) {
		assertResolutionSources([
			paths.join(root, 'src', 'Presentation.svelte'),
			paths.join(root, 'src', 'Card.svelte'),
			paths.join(root, 'node_modules', 'typescript', 'lib', 'lib.es2023.d.ts'),
			paths.join(root, 'node_modules', '@writers-ide', 'plugins', 'index.d.ts'),
		]);
	}
	assert.equal(
		fileImportSpecifier(new URL('file:///C:/sample%20project/contracts.ts'), { windows: true }),
		'C:/sample project/contracts.ts',
	);
	assert.equal(
		fileImportSpecifier(new URL('file:///tmp/sample%20project/contracts.ts'), { windows: false }),
		'/tmp/sample project/contracts.ts',
	);
	assert.equal(
		fileImportSpecifier(new URL('file://server/share/sample%20project/contracts.ts'), {
			windows: true,
		}),
		'//server/share/sample project/contracts.ts',
	);
});

test(
	'standalone sample checks and builds using only copied packages',
	{ timeout: 240000 },
	async (t) => {
		const sample = await prepareSample();
		t.after(sample.dispose);
		const { project, sdk } = sample;
		await assertCopied(project);
		const config = JSON.parse(await readFile(path.join(project, 'tsconfig.json'), 'utf8'));
		assert.equal(config.compilerOptions.paths, undefined);
		assert.equal(config.extends, undefined);
		assert.equal(config.compilerOptions.skipLibCheck, false);
		const result = checkSample(project);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		await audit(project);

		await t.test(
			'checking needs no profile inventory but production builds require it',
			async () => {
				const inventory = path.join(project, 'profile-imports.json');
				await assert.rejects(readFile(inventory), { code: 'ENOENT' });
				const runBuild = () =>
					spawnSync(
						process.execPath,
						[path.join(project, 'node_modules/vite/bin/vite.js'), 'build'],
						{
							cwd: project,
							encoding: 'utf8',
							timeout: 60000,
							env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
						},
					);
				const missing = runBuild();
				assert.equal(missing.status, 1, missing.stdout + missing.stderr);
				assert.match(missing.stderr, /ENOENT.*profile-imports\.json/);
				await writeFile(inventory, '[]');
				try {
					const empty = runBuild();
					assert.equal(empty.status, 1, empty.stdout + empty.stderr);
					assert.match(empty.stderr, /nonempty runtime profile import inventory/);
				} finally {
					await rm(inventory);
				}
			},
		);

		await t.test(
			'every exact SDK entry and inventory resolves from generated declarations',
			async () => {
				const localRequire = createRequire(path.join(project, 'package.json'));
				const ts = /** @type {typeof import('typescript')} */ (localRequire('typescript'));
				const filename = path.join(project, 'inventory.ts');
				await writeFile(
					filename,
					Object.keys(sdk.entries)
						.map((name, index) => `import * as surface${index} from '${name}';`)
						.join('\n'),
				);
				const program = ts.createProgram([filename], {
					strict: true,
					skipLibCheck: false,
					noEmit: true,
					types: [],
					module: ts.ModuleKind.ESNext,
					moduleResolution: ts.ModuleResolutionKind.Bundler,
					target: ts.ScriptTarget.ES2023,
				});
				assert.deepEqual(
					ts
						.getPreEmitDiagnostics(program)
						.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
					[],
				);
				for (const source of program.getSourceFiles()) {
					assert.ok(
						normalizePath(await realpath(source.fileName)).startsWith(
							normalizePath(await realpath(project)) + '/',
						),
						source.fileName,
					);
				}
				const checker = program.getTypeChecker();
				const inventory = program.getSourceFile(filename);
				assert.ok(inventory);
				for (const statement of inventory.statements) {
					assert.ok(
						ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier),
					);
					const name = statement.moduleSpecifier.text;
					const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
					assert.ok(symbol);
					assert.deepEqual(
						checker
							.getExportsOfModule(symbol)
							.map((item) => item.name)
							.sort(),
						[...sdk.inventory[name].runtime, ...sdk.inventory[name].types].sort(),
					);
				}
			},
		);

		/** @type {[string, string, string, RegExp][]} */
		const cases = [
			[
				'private export',
				'ts',
				`import { PluginHost } from '@writers-ide/plugins';`,
				/no exported member.*PluginHost/,
			],
			[
				'unsupported SDK path',
				'ts',
				`import { createWorkbench } from '@writers-ide/layout/internal/index.js';`,
				/Cannot find module/,
			],
			[
				'unsupported Svelte path',
				'ts',
				`import type { Missing } from 'svelte/not-public';`,
				/Cannot find module/,
			],
			[
				'provider result',
				'ts',
				`import type { SvelteFrontendContext } from '@writers-ide/plugins/svelte'; import { publishedApi } from './contracts'; export function bad(c: SvelteFrontendContext) { c.apis.provide(publishedApi, () => ({inspect: () => 1})); }`,
				/number.*not assignable.*boolean/,
			],
			[
				'command result input',
				'ts',
				`import type { SvelteFrontendContext } from '@writers-ide/plugins/svelte'; import { fourRoles } from './contracts'; export function bad(c: SvelteFrontendContext) { c.contributions.command({id:'bad', name:'Bad', contract:fourRoles, execute: () => new Date()}); }`,
				/Date.*not assignable/,
			],
			[
				'command argument input',
				'ts',
				`import type { SvelteFrontendContext } from '@writers-ide/plugins/svelte'; import { fourRoles } from './contracts'; export function bad(c: SvelteFrontendContext) { c.commands.execute('host', 'roles', fourRoles, 1); }`,
				/number.*not assignable.*string/,
			],
			[
				'ordinary task worker factory',
				'ts',
				`import type { FrontendContext } from '@writers-ide/plugins'; export function bad(c: FrontendContext<unknown>) { c.tasks.worker({key:'bad', label:'Bad', input:1, createWorker: () => new Worker('worker.js')}); }`,
				/\(\) => Worker.*not assignable/,
			],
			[
				'mixed task worker selections',
				'ts',
				`import { createTaskService, type TaskServiceOptions } from '@writers-ide/tasks'; export function bad(options: TaskServiceOptions) { createTaskService(options).worker({key:'bad', label:'Bad', input:1, module:new URL('https://example.test/worker.js'), createWorker: () => new Worker('worker.js')}); }`,
				/not assignable/,
			],
			[
				'missing task worker module',
				'ts',
				`import type { FrontendContext } from '@writers-ide/plugins'; export function bad(c: FrontendContext<unknown>) { c.tasks.worker({key:'bad', label:'Bad', input:1}); }`,
				/module.*missing/,
			],
			[
				'non-URL task worker module',
				'ts',
				`import type { FrontendContext } from '@writers-ide/plugins'; export function bad(c: FrontendContext<unknown>) { c.tasks.worker({key:'bad', label:'Bad', input:1, module:'./worker.js'}); }`,
				/string.*not assignable.*URL/,
			],
			[
				'required component prop',
				'svelte',
				`<script lang="ts">import { IconButton } from '@writers-ide/components';</script><IconButton tooltipDirection="horizontal" onclick={() => {}}>{#snippet icon()}+{/snippet}</IconButton>`,
				/label.*missing/,
			],
			[
				'snippet prop',
				'svelte',
				`<script lang="ts">import { IconButton } from '@writers-ide/components';</script><IconButton label="Bad" tooltipDirection="horizontal" onclick={() => {}} icon="text" />`,
				/string.*not assignable.*Snippet/,
			],
			[
				'generic presentation prop',
				'ts',
				`import { defineSveltePresentation } from '@writers-ide/plugins/svelte'; import type { Snippet } from 'svelte'; import Card from './Card.svelte'; declare const render: Snippet<[{id: string; count: number}]>; defineSveltePresentation(Card<{id: string; count: number}>, {value: {id:'one', count:'bad'}, render});`,
				/string.*not assignable.*number/,
			],
			[
				'generic constraint',
				'ts',
				`import Card from './Card.svelte'; export const Bad = Card<number>;`,
				/number.*does not satisfy.*constraint/,
			],
			[
				'generic prop and snippet',
				'svelte',
				`<script lang="ts">import Card from './Card.svelte';</script><Card value={{id:'one', count:1}}>{#snippet render(value)}{value.missing}{/snippet}</Card>`,
				/missing.*does not exist/,
			],
		];
		for (const [name, extension, source, expected] of cases) {
			await t.test(`rejects ${name} independently`, async () => {
				const filename = path.join(project, `src/Negative.${extension}`);
				await writeFile(filename, source);
				try {
					const checked = checkSample(project);
					assert.equal(checked.status, 1, checked.stdout + checked.stderr);
					assert.match(checked.stdout, expected);
					assert.match(checked.stdout, /ERROR "src[/\\]+Negative\./);
					await audit(project);
				} finally {
					await rm(filename);
				}
			});
		}
		await t.test('missing dependency cannot fall back to the checkout', async () => {
			const dependency = path.join(project, 'node_modules/prosemirror-view');
			await rename(dependency, dependency + '.held');
			try {
				const checked = checkSample(project);
				assert.equal(checked.status, 1, checked.stdout + checked.stderr);
				assert.match(checked.stdout, /Cannot find module.*prosemirror-view/);
				await audit(project);
			} finally {
				await rename(dependency + '.held', dependency);
			}
		});
		await t.test(
			'production build uses exact shared externals and bundles private dependencies',
			async () => {
				const profile = path.join(sample.temporary, 'profile');
				await buildRuntimeProfile({ outDir: profile });
				const map = JSON.parse(await readFile(path.join(profile, 'import-map.json'), 'utf8'));
				const exact = new Set(Object.keys(map.imports));
				const out = path.join(sample.temporary, 'built');
				await buildSample(project, exact, out);
				const entry = await readFile(path.join(out, 'entry.js'), 'utf8');
				assert.ok(moduleSpecifiers(entry).includes('@writers-ide/plugins/svelte'));
				assert.ok(!moduleSpecifiers(entry).includes('prosemirror-commands'));
				assert.match(entry, /(?:var|const|function) selectAll/);
				const bad = path.join(project, 'src/entry.ts');
				const original = await readFile(bad, 'utf8');
				/** @type {[string, RegExp][]} */
				const forbiddenImports = [
					[`import 'svelte/not-public';`, /Unsupported shared import/],
					[
						`import ${JSON.stringify(fileImportSpecifier(new URL('./plugin/contracts.ts', import.meta.url)))};`,
						/Build resolved outside clean sample/,
					],
				];
				for (const [source, error] of forbiddenImports) {
					await writeFile(bad, original + '\n' + source);
					try {
						await assert.rejects(buildSample(project, exact, out), error);
					} finally {
						await writeFile(bad, original);
					}
				}
			},
		);
	},
);
