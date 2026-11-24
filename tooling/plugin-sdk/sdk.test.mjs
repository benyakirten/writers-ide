import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { svelte2tsx } from 'svelte2tsx';
import { buildSdkDeclarations, declarationReferences } from './build.mjs';
import { facadeFiles } from '../plugin-profile/build.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (filename) => JSON.parse(await readFile(filename, 'utf8'));

async function installedDirectory(name) {
	let directory = path.dirname(require.resolve(name));
	for (;;) {
		try {
			if ((await readJson(path.join(directory, 'package.json'))).name === name) {
				return directory;
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
		const parent = path.dirname(directory);
		assert.notEqual(parent, directory, `Cannot locate ${name}`);
		directory = parent;
	}
}

function compile(filename, extra = []) {
	const program = ts.createProgram([filename, ...extra], {
		strict: true,
		skipLibCheck: false,
		noEmit: true,
		target: ts.ScriptTarget.ES2023,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		types: [],
	});
	return { program, diagnostics: ts.getPreEmitDiagnostics(program) };
}

function assertClean(diagnostics) {
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCurrentDirectory: () => root,
			getCanonicalFileName: (name) => name,
			getNewLine: () => '\n',
		}),
	);
}

test(
	'portable SDK packages preserve exact inventories and inferred public types',
	{ timeout: 120000 },
	async (t) => {
		const temporary = await mkdtemp(path.join(os.tmpdir(), 'writers-sdk-'));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		const output = path.join(temporary, 'artifacts');
		const result = await buildSdkDeclarations({ outDir: output });
		assert.deepEqual(await readJson(path.join(output, 'index.json')), result);
		assert.deepEqual(
			Object.keys(result.packages).sort(),
			['components', 'layout', 'plugins', 'tasks', 'word-processing']
				.map((name) => `@writers-ide/${name}`)
				.sort(),
		);
		assert.deepEqual(
			Object.keys(result.entries).sort(),
			[...Object.keys(facadeFiles), '@writers-ide/tasks/worker'].sort(),
		);

		// Relocate the packages outside the checkout. Only real external dependencies are linked.
		const consumer = path.join(temporary, 'consumer');
		const modules = path.join(consumer, 'node_modules');
		await mkdir(path.join(modules, '@writers-ide'), { recursive: true });
		await writeFile(path.join(consumer, 'package.json'), '{"type":"module"}');
		for (const [name, relative] of Object.entries(result.packages)) {
			const destination = path.join(modules, name);
			await cp(path.join(output, relative), destination, { recursive: true });
			const manifest = await readJson(path.join(destination, 'package.json'));
			assert.equal(manifest.version, '0.1.0');
			assert.equal(manifest.private, true);
			assert.equal(manifest.exports['./*'], undefined);
			assert.equal(manifest.exports['./host'], undefined);
			assert.equal(manifest.exports['./internal'], undefined);
			const expected = Object.keys(result.entries)
				.filter((entry) => entry === name || entry.startsWith(`${name}/`))
				.map((entry) => (entry === name ? '.' : `.${entry.slice(name.length)}`));
			if (name === '@writers-ide/layout') {
				expected.push('./dock-colors.css');
			}
			assert.deepEqual(Object.keys(manifest.exports).sort(), expected.sort());
		}
		for (const name of Object.keys(result.dependencies)) {
			const destination = path.join(modules, name);
			await mkdir(path.dirname(destination), { recursive: true });
			await symlink(await installedDirectory(name), destination, 'dir');
		}

		await t.test(
			'AST declaration audit closes links within packages and declares external dependencies',
			async () => {
				const declared = new Set(result.declarations);
				const observed = new Set();
				for (const filename of result.declarations) {
					assert.ok(filename.endsWith('.d.ts'));
					const text = await readFile(path.join(output, filename), 'utf8');
					assert.doesNotMatch(
						text,
						/svelte2tsx|__sveltets_|\/Users\/|writers-ide\/packages-js|\.svelte["']|\.ts["']/,
					);
					const packageName = `@writers-ide/${filename.split('/')[1]}`;
					const manifest = await readJson(
						path.join(output, result.packages[packageName], 'package.json'),
					);
					for (const { specifier } of declarationReferences(text, filename)) {
						assert.ok(!path.isAbsolute(specifier) && !specifier.includes('\\'));
						if (specifier.startsWith('.')) {
							const target = path.posix.normalize(
								path.posix.join(path.posix.dirname(filename), specifier.replace(/\.js$/, '.d.ts')),
							);
							assert.ok(target.startsWith(`${result.packages[packageName]}/`));
							assert.ok(declared.has(target), `${filename}: missing ${target}`);
						} else if (specifier.startsWith('@writers-ide/')) {
							assert.ok(result.entries[specifier], `Private SDK link: ${specifier}`);
							const dependency = specifier.split('/').slice(0, 2).join('/');
							if (dependency !== packageName) {
								assert.equal(manifest.peerDependencies[dependency], '0.1.0');
							}
						} else {
							const dependency = specifier.startsWith('svelte/') ? 'svelte' : specifier;
							observed.add(dependency);
							assert.equal(manifest.peerDependencies[dependency], result.dependencies[dependency]);
							assert.ok(result.dependencies[dependency], `Unlisted dependency ${specifier}`);
						}
					}
				}
				assert.deepEqual([...observed].sort(), Object.keys(result.dependencies).sort());
				assert.equal(
					await readFile(path.join(output, result.assets[0]), 'utf8'),
					await readFile(path.join(root, 'packages-js/layout/src/dock-colors.css'), 'utf8'),
				);
			},
		);

		await t.test(
			'all exact root and subpath exports resolve without workspace source',
			async () => {
				const filename = path.join(consumer, 'inventory.ts');
				await writeFile(
					filename,
					Object.keys(result.entries)
						.map((specifier, index) => `import * as surface${index} from '${specifier}';`)
						.join('\n'),
				);
				const { program, diagnostics } = compile(filename);
				assertClean(diagnostics);
				const checker = program.getTypeChecker();
				const source = program.getSourceFile(filename);
				for (const [index, statement] of source.statements.entries()) {
					const specifier = statement.moduleSpecifier.text;
					const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
					assert.ok(symbol, specifier);
					const exports = checker
						.getExportsOfModule(symbol)
						.map((entry) => entry.name)
						.sort();
					assert.deepEqual(
						exports,
						[...result.inventory[specifier].runtime, ...result.inventory[specifier].types].sort(),
						`surface${index}`,
					);
				}
				for (const sourceFile of program.getSourceFiles()) {
					assert.ok(!sourceFile.fileName.includes('/packages-js/'), sourceFile.fileName);
					assert.ok(!sourceFile.fileName.includes('/plugin-sdk/.build-'), sourceFile.fileName);
				}
			},
		);

		await t.test(
			'props, snippets, generics and four command type roles are not erased',
			async () => {
				const filename = path.join(consumer, 'types.ts');
				await writeFile(
					filename,
					`
import { IconButton, Tooltip } from '@writers-ide/components';
import { DockDraggable, BarItems } from '@writers-ide/layout';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import { definePluginCommand, type FrontendContext, type PluginCommand } from '@writers-ide/plugins';
import { defineTaskWorker } from '@writers-ide/tasks/worker';
import type { ComponentProps, Snippet } from 'svelte';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Label = Assert<Equal<ComponentProps<typeof IconButton>['label'], string>>;
type Icon = Assert<Equal<ComponentProps<typeof IconButton>['icon'], Snippet>>;
type Children = Assert<Equal<ComponentProps<typeof DockDraggable>['children'], Snippet<[Snippet]>>>;
declare const icon: Snippet;
defineSveltePresentation(IconButton, { label: 'Test', icon, onclick() {}, tooltipDirection: 'vertical' });
// @ts-expect-error label is required
defineSveltePresentation(IconButton, { icon, onclick() {}, tooltipDirection: 'vertical' });
// @ts-expect-error snippets are callable, not text
defineSveltePresentation(IconButton, { label: 'Test', icon: 'bad', onclick() {}, tooltipDirection: 'vertical' });
// @ts-expect-error tooltip is string or a Svelte snippet, not a number
const tooltip: ComponentProps<typeof Tooltip>['tooltip'] = 4;
function schema<I, O>(output: O) {
  return { '~standard': { version: 1 as const, vendor: 'fixture', types: undefined as { input: I; output: O } | undefined, validate: (_value: unknown) => ({ value: output }) } };
}
const command = definePluginCommand({ id: 'test.roles', major: 1, args: schema<string, number>(1), result: schema<boolean, Date>(new Date()) });
type Roles = Assert<Equal<typeof command, PluginCommand<string, number, boolean, Date>>>;
declare const context: FrontendContext<unknown>;
context.contributions.command({ id: 'test', name: 'Test', contract: command, execute(args) {
  type Argument = Assert<Equal<typeof args, number>>;
  return args > 0;
} });
// @ts-expect-error implementation returns result input, not output
context.contributions.command({ id: 'bad', name: 'Bad', contract: command, execute: () => new Date() });
const result = context.commands.execute('provider', 'command', command, 'input');
type Result = Assert<Equal<typeof result, Promise<Date>>>;
// @ts-expect-error caller supplies argument input, not output
context.commands.execute('provider', 'command', command, 123);
defineTaskWorker({ postMessage() {}, addEventListener() {}, removeEventListener() {} }, (input: string) => input.length);
`,
				);
				assertClean(compile(filename).diagnostics);
			},
		);

		await t.test('ordinary generic Svelte presentations retain prop inference', async () => {
			const generic = `<script lang="ts" generics="T extends { id: string }">
import type { Snippet } from 'svelte';
let { value, render }: { value: T; render: Snippet<[T]> } = $props();
</script>{@render render(value)}`;
			const filename = path.join(consumer, 'Generic.svelte.ts');
			await writeFile(
				filename,
				svelte2tsx(generic, { filename: 'Generic.svelte', isTsFile: true, mode: 'dts' }).code,
			);
			const entry = path.join(consumer, 'generic.ts');
			await writeFile(
				entry,
				`import Generic from './Generic.svelte.js';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import type { Snippet } from 'svelte';
declare const render: Snippet<[{ id: string; count: number }]>;
defineSveltePresentation(Generic<{ id: string; count: number }>, { value: { id: 'one', count: 2 }, render });
// @ts-expect-error generic prop shape must be preserved
defineSveltePresentation(Generic<{ id: string; count: number }>, { value: { id: 'one', count: 'bad' }, render });
// @ts-expect-error generic constraint must be preserved
const Invalid = Generic<number>;
`,
			);
			assertClean(compile(entry, [require.resolve('svelte2tsx/svelte-shims-v4.d.ts')]).diagnostics);
		});

		await t.test('private exports and deep paths are rejected by package exports', async () => {
			const filename = path.join(consumer, 'private.ts');
			await writeFile(
				filename,
				`
import type { PluginHost, PluginContext, PluginRegistries, PluginManagementService, BundledPlugin } from '@writers-ide/plugins';
import type { SveltePluginContext } from '@writers-ide/plugins/svelte';
import { WORD_PROCESSING_PLUGIN_ID } from '@writers-ide/word-processing';
import { createWorkbench } from '@writers-ide/layout/internal/index.js';
import { PluginHost as Host } from '@writers-ide/plugins/host';
import { defineTaskWorker } from '@writers-ide/tasks/worker.ts';
`,
			);
			const diagnostics = compile(filename).diagnostics;
			assert.equal(
				diagnostics.length,
				10,
				diagnostics
					.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
					.join('\n'),
			);
			assert.ok(diagnostics.every((item) => [2305, 2307].includes(item.code)));
		});

		await t.test('declaration errors are checked rather than hidden by skipLibCheck', async () => {
			const declaration = path.join(modules, '@writers-ide/components/index.d.ts');
			const text = await readFile(declaration, 'utf8');
			await writeFile(
				declaration,
				`${text}\nexport declare const broken: MissingDeclarationType;\n`,
			);
			try {
				const diagnostics = compile(path.join(consumer, 'inventory.ts')).diagnostics;
				assert.equal(diagnostics.length, 1);
				assert.equal(diagnostics[0].code, 2304);
				assert.equal(diagnostics[0].file.fileName, declaration);
			} finally {
				await writeFile(declaration, text);
			}
		});

		await t.test('rebuilds are stable and replace only generated packages', async () => {
			const before = await Promise.all(
				result.declarations.map((name) => readFile(path.join(output, name), 'utf8')),
			);
			await writeFile(path.join(output, 'keep.txt'), 'caller-owned');
			await writeFile(path.join(output, 'packages/components/stale.d.ts'), 'stale');
			assert.deepEqual(await buildSdkDeclarations({ outDir: output }), result);
			assert.deepEqual(
				await Promise.all(
					result.declarations.map((name) => readFile(path.join(output, name), 'utf8')),
				),
				before,
			);
			assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'caller-owned');
			await assert.rejects(readFile(path.join(output, 'packages/components/stale.d.ts')), {
				code: 'ENOENT',
			});
		});
	},
);

test('declaration reference audit rejects ambient dependency directives', () => {
	for (const text of [
		'/// <reference types="svelte2tsx" />',
		'/// <reference path="/private/repo/file.ts" />',
	]) {
		assert.throws(() => declarationReferences(text), /triple-slash/);
	}
	assert.deepEqual(
		declarationReferences('export type T = import("svelte").Snippet;').map(
			(item) => item.specifier,
		),
		['svelte'],
	);
});
