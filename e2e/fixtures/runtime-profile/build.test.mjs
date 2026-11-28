import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { checkImport, files, output } from './build.mjs';
import { moduleSpecifiers } from '../../../tooling/plugin-profile/build.mjs';

const sharedProseMirror = [
	'prosemirror-model',
	'prosemirror-state',
	'prosemirror-view',
	'prosemirror-transform',
];
const exact = new Set([
	'svelte',
	'svelte/internal/client',
	'@writers-ide/plugins',
	'@dnd-kit-svelte/core',
	...sharedProseMirror,
]);
test('shared runtime roots externalize exactly and unsupported core subpaths fail', () => {
	for (const id of exact) {
		assert.equal(checkImport(id, exact), 'external');
	}
	for (const id of [
		'svelte/compiler',
		'svelte/internal/flags/async',
		'@writers-ide/plugins/host',
		'@writers-ide/tasks/worker',
		'@writers-ide/layout/private',
		...sharedProseMirror.flatMap((id) => [`${id}/private`, `${id}/dist/index.js`, `${id}?raw`]),
		'@dnd-kit-svelte/core/private',
		'@dnd-kit-svelte/core?raw',
	]) {
		assert.throws(() => checkImport(id, exact), /Unsupported shared import/);
	}
});
test('nonshared ProseMirror and DnD dependencies may bundle privately', () => {
	for (const id of [
		'prosemirror-commands',
		'prosemirror-history',
		'prosemirror-keymap',
		'prosemirror-inputrules',
		'prosemirror-schema-basic',
		'@dnd-kit-svelte/sortable',
		'@dnd-kit-svelte/utilities',
	]) {
		assert.equal(checkImport(id, exact), 'bundle');
	}
	for (const id of sharedProseMirror.concat('@dnd-kit-svelte/core')) {
		assert.throws(() => checkImport(id, new Set()), /Unsupported shared import/);
	}
});
test('production plugin bundles private commands while all shared ProseMirror roots remain bare imports', async () => {
	const result = await build({
		configFile: false,
		publicDir: false,
		logLevel: 'silent',
		plugins: [
			{
				name: 'private-dependency-profile-test',
				enforce: 'pre',
				resolveId(id, importer) {
					if (id === 'virtual:private-commands') {
						return '\0private-commands';
					}
					if (checkImport(id, exact, importer) === 'external') {
						return { id, external: true };
					}
				},
				load(id) {
					if (id === '\0private-commands') {
						return 'export { toggleMark } from "prosemirror-commands"; export { EditorView } from "prosemirror-view";';
					}
				},
			},
		],
		build: {
			write: false,
			minify: false,
			rolldownOptions: {
				input: 'virtual:private-commands',
				preserveEntrySignatures: 'strict',
				output: { format: 'es' },
			},
		},
	});
	assert.ok('output' in result);
	const chunks = result.output.filter((entry) => entry.type === 'chunk');
	assert.equal(chunks.length, 1);
	const chunk = chunks[0];
	assert.match(chunk.code, /function toggleMark\(/);
	assert.ok(chunk.exports.includes('toggleMark'));
	assert.deepEqual(
		moduleSpecifiers(chunk.code).sort(),
		[...sharedProseMirror].sort(),
		chunk.code.slice(0, 1200),
	);
	const modules = Object.keys(chunk.modules);
	assert.ok(modules.some((id) => id.includes('/prosemirror-commands/')));
	for (const shared of sharedProseMirror) {
		assert.ok(!modules.some((id) => id.includes(`/${shared}/`)), `${shared} must not be bundled`);
	}
});
test('dock colors are an exact build-time CSS input, never a mapped module', () => {
	assert.equal(checkImport('@writers-ide/layout/dock-colors.css', exact), 'bundle');
	for (const id of [
		'@writers-ide/layout/dock-colors.css/private',
		'@writers-ide/layout/dock-colors.css?raw',
		'@writers-ide/layout/other.css',
	]) {
		assert.throws(() => checkImport(id, exact), /Unsupported shared import/);
	}
});
test('relative and absolute private setup imports are rejected', () => {
	assert.throws(
		() =>
			checkImport(
				'../../../packages-js/plugins/command-component-host.ts',
				exact,
				path.resolve('e2e/fixtures/runtime-profile/host.ts'),
			),
		/Private setup source import/,
	);
	assert.throws(
		() => checkImport(path.resolve('src/lib/plugins/PluginPresentation.svelte'), exact),
		/Private setup source import/,
	);
});
test('unknown bare dependency fails a production build', async () => {
	await assert.rejects(
		build({
			configFile: false,
			logLevel: 'silent',
			build: { write: false, rolldownOptions: { input: 'virtual:unknown' } },
			plugins: [
				{
					name: 'unknown-import-test',
					resolveId(id) {
						if (id === 'virtual:unknown') {
							return '\0unknown';
						}
					},
					load(id) {
						if (id === '\0unknown') {
							return 'import "not-an-installed-profile-package";';
						}
					},
				},
			],
		}),
		/resolve|not-an-installed-profile-package/,
	);
});
test('snapshot record covers every filename and byte, independent of creation order', async () => {
	await mkdir(output, { recursive: true });
	const directory = await mkdtemp(path.join(output, 'record-test-'));
	try {
		await writeFile(path.join(directory, 'b.css'), 'body {}');
		await writeFile(path.join(directory, 'a.js'), 'export {};');
		const before = await files(directory);
		assert.deepEqual(Object.keys(before), ['a.js', 'b.css']);
		assert.match(before['a.js'], /^[a-f0-9]{64}$/);
		await writeFile(path.join(directory, 'a.js'), 'export const tampered = true;');
		assert.notEqual((await files(directory))['a.js'], before['a.js']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
