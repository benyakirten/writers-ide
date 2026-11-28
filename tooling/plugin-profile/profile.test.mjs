import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import { JSDOM } from 'jsdom';
import {
	assertRelativeImports,
	baseline,
	buildRuntimeProfile,
	compilerOptions,
	facadeFiles,
	moduleSpecifiers,
	normalizeSourcePath,
	sourceModuleId,
	publicSvelteSpecifiers,
	verifyBaseline,
} from './build.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const names = (value) => value.split(/\s+/).filter(Boolean).sort();
const approved = {
	'@writers-ide/plugins': {
		runtime: names(
			'definePluginApi definePluginCommand CommandInvocationError isCommandInvocationError',
		),
		types:
			names(`PluginApi PluginApiIdentity Dispose PluginApiConnection FrontendContext FrontendEntry
			FrontendContributions CommandInvoker PluginCommand CommandRegistration CommandInvocationErrorCode
			ToolbarContribution ViewContribution PluginCapability ComponentIdentity ActivationIdentity
			ProjectReference ProjectConnections ProjectApiConnection ComponentApis ComponentApiConnection
			LocaleSnapshot PluginLocale`),
	},
	'@writers-ide/plugins/svelte': {
		runtime: names('defineSveltePresentation'),
		types: names(
			'SveltePresentation SvelteToolbarContribution SvelteViewContribution SvelteFrontendContext SvelteFrontendEntry',
		),
	},
	'@writers-ide/plugins/native': {
		runtime: names('isNativeServiceError'),
		types: names(
			'NativeRequestOptions FileIndexEntry FileIndexStatus FileIndexQueryOptions FileIndexPage ProjectFiles ExternalLinks NativeServices NativeErrorCode NativeServiceError',
		),
	},
	'@writers-ide/word-processing': {
		runtime: names('wordProcessingApi createWordProcessingService createWordProcessingConnection'),
		types: names(`WordProcessingApi EditorTarget EditorSnapshot WordProcessingSnapshot EditorContext
			EditorReadOptions EditorEditOptions EditorResult EditorFailureReason EditorCommandRegistration
			EditorCommandSnapshot EditorBehaviorContext EditorBehaviorRegistration EditorBehaviorSnapshot
			EditorRendererContext EditorNodeViewRegistration EditorMarkViewRegistration WordProcessingSources
			WordProcessingService EditorBehaviorFailure`),
	},
	'@writers-ide/word-processing/svelte': {
		runtime: names('defineSvelteNodeView defineSvelteMarkView'),
		types: names('SvelteContentDOM SvelteNodeViewProps SvelteMarkViewProps SvelteViewOptions'),
	},
	'@writers-ide/word-processing/structure': {
		runtime: names('groupSelectedBlocks identifyBlockGroup'),
		types: names('BlockReference SelectedBlockGroup'),
	},
	'@writers-ide/tasks': {
		runtime: names('WorkQueue createTaskService'),
		types: names(`TaskService AdvancedTaskService WorkerTaskOptions WorkerFactoryTaskOptions
					TaskOutcome TaskHandle CooperativeTaskHandle TaskContext TaskOptions
			CooperativeTaskOptions ForEachTaskOptions AsyncTaskOptions WorkPriority WorkProgress WorkStatus
			WorkOptions WorkHandle TaskServiceOptions TaskFailure`),
	},
	'@writers-ide/components': {
		runtime: names(
			'IconButton Tooltip TooltipProvider TooltipState Pointer getTooltipManager provideTooltipManager',
		),
		types: names('TooltipData'),
	},
	'@writers-ide/layout': {
		runtime: names(`BarItemRegistry BarItems BarTransferHandler HorizontalBarState VerticalBarState
			FloaterBarState createWorkbench DockDraggable DockTarget getDockColor`),
		types:
			names(`BarItemSection BarItem BarItemData BarMetadata PossibleSlot BarTransferLocation Bar Bars
			DockDragSource DockDropTarget BarTransfer MenuTransferInProgress BarTransferInProgress TransferServices
			HorizontalBar VerticalBar FloatingPosition FloatingBar LayoutServices WorkbenchOptions DockColor DockController`),
	},
};
let outDir;
let manifest;
let importMap;

before(async () => {
	outDir = await mkdtemp(path.join(here, '.test-'));
	manifest = await buildRuntimeProfile({
		outDir,
		hostEntries: { 'fixture-host': path.join(here, 'fixtures/host.ts') },
	});
	importMap = JSON.parse(await readFile(path.join(outDir, 'import-map.json'), 'utf8'));
});
after(async () => {
	if (outDir) {
		await rm(outDir, { recursive: true, force: true });
	}
});

test('exact baseline fails closed on missing or upgraded installed packages', () => {
	verifyBaseline(baseline);
	for (const name of Object.keys(baseline)) {
		assert.throws(() => verifyBaseline({ ...baseline, [name]: '999.0.0' }), /baseline mismatch/);
		assert.throws(() => verifyBaseline({ ...baseline, [name]: undefined }), /baseline mismatch/);
	}
});

test('optional host entries share the build without exposing host exports to authors', async () => {
	assert.deepEqual(Object.keys(manifest.hostEntries), ['fixture-host']);
	const artifact = manifest.hostEntries['fixture-host'];
	assert.ok(manifest.graph.chunks[artifact]);
	assert.deepEqual(manifest.graph.chunks[artifact].exports, [
		'CommandInvocationError',
		'definePluginApi',
		'getContext',
		'hostOnly',
	]);
	assert.equal(importMap.imports['fixture-host'], undefined);
	assert.equal(manifest.modules['fixture-host'], undefined);
	assert.equal(manifest.typeSurface.facades['fixture-host'], undefined);
	assert.equal(Object.values(importMap.imports).includes(artifact), false);
	const withoutHost = await buildRuntimeProfile({ outDir: path.join(outDir, 'without-host') });
	assert.deepEqual(withoutHost.hostEntries, {});
	assert.deepEqual(Object.keys(withoutHost.modules).sort(), Object.keys(manifest.modules).sort());
});

test('host entry names cannot collide with generated names and source paths must be absolute', async () => {
	await assert.rejects(
		buildRuntimeProfile({
			outDir,
			hostEntries: { 'profile-entry-0': path.join(here, 'fixtures/host.ts') },
		}),
		/collides with a generated runtime entry/,
	);
	await assert.rejects(
		buildRuntimeProfile({ outDir, hostEntries: { host: 'fixtures/host.ts' } }),
		/absolute path/,
	);
});

test('production compilation disables tracing through explicit dev false', async () => {
	const source = await readFile(path.join(here, 'fixtures/Runes.svelte'), 'utf8');
	const production = compile(source, compilerOptions).js.code;
	const development = compile(source, { ...compilerOptions, dev: true }).js.code;
	assert.equal(compilerOptions.dev, false);
	assert.equal(
		Object.hasOwn(compilerOptions, 'tracing'),
		false,
		'Svelte has no public tracing option',
	);
	assert.equal(moduleSpecifiers(production).includes('svelte/internal/flags/tracing'), false);
	assert.equal(moduleSpecifiers(development).includes('svelte/internal/flags/tracing'), true);
	assert.equal(production.includes('$.trace('), false);
	assert.equal(development.includes('$.trace('), true);
	assert.equal(manifest.compiler.tracing, false);
});

test('manifest and import map describe exact approved author and derived compiler entries', async () => {
	assert.equal(manifest.id, 'writers-ide.frontend/1');
	assert.deepEqual(JSON.parse(await readFile(path.join(outDir, 'profile.json'), 'utf8')), manifest);
	assert.deepEqual(manifest.versions, baseline);
	assert.deepEqual(manifest.compiler.options, compilerOptions);
	assert.equal(manifest.compiler.tracing, false);
	assert.equal(manifest.typeSurface.standaloneDeclarations, false);
	const author = [
		...Object.keys(approved),
		...publicSvelteSpecifiers,
		...Object.keys(baseline).filter((name) => name !== 'svelte'),
	].sort();
	assert.deepEqual(
		Object.keys(manifest.modules)
			.filter((key) => manifest.modules[key].visibility === 'author')
			.sort(),
		author,
	);
	assert.deepEqual(manifest.compilerImports.specifiers, [
		'svelte/internal/client',
		'svelte/internal/disclose-version',
		'svelte/internal/flags/legacy',
	]);
	assert.deepEqual(
		Object.keys(importMap.imports).sort(),
		[...author, ...manifest.compilerImports.specifiers].sort(),
	);
	for (const key of [
		'@writers-ide/tasks/worker',
		'@writers-ide/plugins/host',
		'svelte/compiler',
		'svelte/internal/flags/async',
		'svelte/action',
		'svelte/elements',
		'@writers-ide/layout/dock-colors.css',
		'prosemirror-history',
		'@dnd-kit-svelte/sortable',
		'@tauri-apps/api',
	]) {
		assert.equal(importMap.imports[key], undefined, key);
	}
	for (const [specifier, surface] of Object.entries(approved)) {
		assert.deepEqual(manifest.modules[specifier].exports, surface.runtime, specifier);
		assert.deepEqual(manifest.typeSurface.facades[specifier].types, surface.types, specifier);
		assert.deepEqual(manifest.typeSurface.facades[specifier].runtime, surface.runtime, specifier);
	}
	for (const specifier of manifest.compilerImports.specifiers) {
		assert.ok(
			Object.values(manifest.compilerImports.evidence).some((imports) =>
				imports.includes(specifier),
			),
		);
	}
	assert.ok(
		Object.keys(manifest.compilerImports.evidence).some((file) =>
			file.endsWith('fixtures/Runes.svelte'),
		),
	);
	assert.ok(
		Object.keys(manifest.compilerImports.evidence).some((file) =>
			file.endsWith('fixtures/Legacy.svelte'),
		),
	);
	assert.ok(
		Object.keys(manifest.compilerImports.evidence).some((file) =>
			file.endsWith('fixtures/State.svelte.js'),
		),
	);
	assert.ok(manifest.compilerImports.observedInSharedBuild.includes('svelte/internal/client'));
});

test('all emitted module references close over one shared graph; transitive packages stay private', async () => {
	const windowsRoot = 'C:\\work\\writers-ide';
	const windowsSource = `${windowsRoot}\\tooling\\plugin-profile\\facades\\plugins.ts`;
	assert.equal(
		normalizeSourcePath(windowsSource),
		'C:/work/writers-ide/tooling/plugin-profile/facades/plugins.ts',
	);
	assert.deepEqual(
		moduleSpecifiers(`export * from ${JSON.stringify(normalizeSourcePath(windowsSource))};`),
		['C:/work/writers-ide/tooling/plugin-profile/facades/plugins.ts'],
	);
	assert.equal(
		sourceModuleId(windowsSource, windowsRoot),
		'<project>/tooling/plugin-profile/facades/plugins.ts',
	);
	assert.equal(
		sourceModuleId(normalizeSourcePath(windowsSource), windowsRoot),
		'<project>/tooling/plugin-profile/facades/plugins.ts',
	);
	assert.equal(
		sourceModuleId(`\0${windowsSource}`, windowsRoot),
		'<virtual><project>/tooling/plugin-profile/facades/plugins.ts',
	);
	assert.equal(
		sourceModuleId('C:\\work\\writers-ide-other\\index.ts', windowsRoot),
		'C:/work/writers-ide-other/index.ts',
	);
	for (const id of [
		...Object.keys(manifest.graph.sources),
		...Object.keys(manifest.compilerImports.evidence),
	]) {
		assert.equal(id.includes('\\'), false, id);
	}
	for (const [artifact, chunk] of Object.entries(manifest.graph.chunks)) {
		const code = await readFile(path.resolve(outDir, artifact), 'utf8');
		assertRelativeImports(code);
		for (const imported of moduleSpecifiers(code)) {
			const target = `./${normalizeSourcePath(path.relative(outDir, path.resolve(path.dirname(path.resolve(outDir, artifact)), imported)))}`;
			assert.ok(manifest.graph.chunks[target], `${artifact}: ${target}`);
		}
		for (const imported of [...chunk.imports, ...chunk.dynamicImports]) {
			assert.ok(manifest.graph.chunks[imported], imported);
		}
	}
	for (const artifact of manifest.assets) {
		await readFile(path.resolve(outDir, artifact));
	}
	assert.ok(manifest.styles.length > 0, 'shared component CSS is available to fixture hosts');
	const dependencies = Object.values(manifest.graph.dependencies);
	for (const name of [
		'orderedmap',

		'prosemirror-model',
		'prosemirror-state',
		'prosemirror-view',
		'prosemirror-transform',
	]) {
		assert.equal(dependencies.filter((dependency) => dependency.name === name).length, 1, name);
	}
	assert.equal(importMap.imports.orderedmap, undefined);
	assert.equal(importMap.imports['rope-sequence'], undefined);
	// rope-sequence belongs to upstream history, which is not in this runtime graph.
	assert.equal(
		dependencies.some((dependency) => dependency.name === 'rope-sequence'),
		false,
	);
	assert.ok(
		Object.values(manifest.graph.chunks).some(
			(chunk) => chunk.modules.length > 1 && chunk.imports.length > 0,
		),
	);
	assert.throws(() => assertRelativeImports('import "unknown-package";'), /Unresolved/);
	assert.throws(
		() => assertRelativeImports('export * from "svelte/internal/private";'),
		/Unresolved/,
	);
	assert.throws(() => assertRelativeImports('import("https://example.com/code.js")'), /Unresolved/);
	assert.throws(() => assertRelativeImports('import(variable)'), /nonliteral/);
});

test('artifact source facades typecheck and reject private runtime and type exports', async () => {
	const consumer = path.join(outDir, 'consumer.ts');
	await writeFile(
		consumer,
		`
		import { definePluginApi, type FrontendContext } from './facades/plugins.ts';
		import { isNativeServiceError, type NativeServices } from './facades/plugins-native.ts';
		import { WorkQueue, type TaskService } from './facades/tasks.ts';
		// @ts-expect-error application management is not an author export
		import type { PluginManagementService } from './facades/plugins.ts';
		// @ts-expect-error legacy bundled contexts are not author exports
		import type { PluginContext } from './facades/plugins.ts';
		// @ts-expect-error bundled descriptors are not author exports
		import type { BundledPlugin } from './facades/plugins.ts';
		// @ts-expect-error bundled provider identity is not an author export
		import { WORD_PROCESSING_PLUGIN_ID } from './facades/word-processing.ts';
		import type { AdvancedTaskService, WorkerTaskOptions, WorkerFactoryTaskOptions } from './facades/tasks.ts';
		// @ts-expect-error legacy Svelte descriptor is not an author export
		import type { SveltePlugin } from './facades/plugins-svelte.ts';
		// @ts-expect-error native contracts do not expose raw invocation
		import { invoke } from './facades/plugins-native.ts';
		void definePluginApi; void isNativeServiceError; void WorkQueue;
	`,
	);
	const program = ts.createProgram(
		[consumer, ...Object.values(facadeFiles).map((file) => path.join(outDir, 'facades', file))],
		{
			target: ts.ScriptTarget.ES2022,
			lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			strict: true,
			skipLibCheck: true,
			noEmit: true,
			allowImportingTsExtensions: true,
			types: ['node', 'svelte'],
		},
	);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCanonicalFileName: (file) => file,
			getCurrentDirectory: () => here,
			getNewLine: () => '\n',
		}),
	);
	const checker = program.getTypeChecker();
	for (const [specifier, filename] of Object.entries(facadeFiles)) {
		const source = program.getSourceFile(path.join(outDir, 'facades', filename));
		const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
		assert.deepEqual(
			exports.map((symbol) => symbol.name).sort(),
			[...approved[specifier].runtime, ...approved[specifier].types].sort(),
		);
	}
});

test('host and separately compiled plugin use artifact Svelte and ProseMirror instances', async () => {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
	// Namespace inspection needs matchMedia; geometry and media behavior require browser tests.
	dom.window.matchMedia = (media) => ({
		media,
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	});
	const globals = [
		'window',
		'document',
		'navigator',
		'Element',
		'HTMLElement',
		'Node',
		'Text',
		'Comment',
		'Event',
		'CustomEvent',
		'Document',
		'getComputedStyle',
		'requestAnimationFrame',
		'cancelAnimationFrame',
	];
	const originals = new Map(
		globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
	);
	for (const name of globals) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			value:
				typeof dom.window[name] === 'function' && /^[a-z]/.test(name)
					? dom.window[name].bind(dom.window)
					: dom.window[name],
		});
	}
	try {
		const artifactUrl = (specifier) =>
			pathToFileURL(path.resolve(outDir, importMap.imports[specifier])).href;
		const load = (specifier) => import(artifactUrl(specifier));
		for (const [specifier, entry] of Object.entries(manifest.modules)) {
			const namespace = await load(specifier);
			assert.deepEqual(Object.keys(namespace).sort(), entry.exports, specifier);
		}
		const trustedHost = await import(
			pathToFileURL(path.resolve(outDir, manifest.hostEntries['fixture-host'])).href
		);
		const authorSdk = await load('@writers-ide/plugins');
		assert.equal(trustedHost.CommandInvocationError, authorSdk.CommandInvocationError);
		assert.equal(trustedHost.definePluginApi, authorSdk.definePluginApi);
		assert.ok(
			new trustedHost.CommandInvocationError('cancelled', 'cancelled', 'test') instanceof
				authorSdk.CommandInvocationError,
		);
		const hostSvelte = await load('svelte');
		assert.equal(trustedHost.getContext, hostSvelte.getContext);
		const hostModel = await load('prosemirror-model');
		const hostState = await load('prosemirror-state');
		const hostTransform = await load('prosemirror-transform');
		const pluginSource = `
			import { Schema, Node } from 'prosemirror-model';
			import { EditorState } from 'prosemirror-state';
			import { Transform } from 'prosemirror-transform';
			import { getContext, setContext } from 'svelte';
			export { Schema, Node, EditorState, Transform, getContext, setContext };
		`;
		function resolveImports(code) {
			for (const specifier of moduleSpecifiers(code)) {
				assert.ok(importMap.imports[specifier], specifier);
				code = code
					.replaceAll(JSON.stringify(specifier), JSON.stringify(artifactUrl(specifier)))
					.replaceAll(`'${specifier}'`, JSON.stringify(artifactUrl(specifier)));
			}
			return code;
		}
		const plugin = await import(
			`data:text/javascript;base64,${Buffer.from(resolveImports(pluginSource)).toString('base64')}`
		);
		assert.equal(plugin.Schema, hostModel.Schema);
		assert.equal(plugin.Node, hostModel.Node);
		assert.equal(plugin.EditorState, hostState.EditorState);
		assert.equal(plugin.Transform, hostTransform.Transform);
		assert.equal(plugin.getContext, hostSvelte.getContext);
		const schema = new plugin.Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
		const state = plugin.EditorState.create({ schema });
		assert.ok(state.doc instanceof hostModel.Node);
		assert.ok(state.tr instanceof hostTransform.Transform);
		const compiled = compile(
			`<script>
			import { getContext } from 'svelte';
			import { writable } from 'svelte/store';
			let count = $state(0);
			const store = writable('shared');
			const value = getContext('profile-test');
		</script><button onclick={() => count++}>{value} {$store} {count}</button>`,
			compilerOptions,
		).js.code;
		const component = await import(
			`data:text/javascript;base64,${Buffer.from(resolveImports(compiled)).toString('base64')}`
		);
		const target = document.createElement('div');
		document.body.append(target);
		const instance = hostSvelte.mount(component.default, {
			target,
			context: new Map([['profile-test', 'host-context']]),
		});
		hostSvelte.flushSync();
		assert.equal(target.textContent, 'host-context shared 0');
		target.querySelector('button').click();
		hostSvelte.flushSync();
		assert.equal(target.textContent, 'host-context shared 1');
		await hostSvelte.unmount(instance);
		assert.equal(target.textContent, '');
	} finally {
		for (const [name, descriptor] of originals) {
			if (descriptor) {
				Object.defineProperty(globalThis, name, descriptor);
			} else {
				Reflect.deleteProperty(globalThis, name);
			}
		}
		dom.window.close();
	}
});
