import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(directory, '../..');
export function assertManagerGraph(modules) {
	for (const id of modules) {
		assert(
			!/\/packages-js\/|\/src\/lib\/(?:plugins|editor)\/|\/node_modules\/(?:\.pnpm\/)?(?:@writers-ide|prosemirror|svelte)[/+@]/.test(
				id,
			),
			`Manager imports forbidden module: ${id}`,
		);
	}
}
export function assertShutdownGraph(modules) {
	const ids = [...modules];
	assertManagerGraph(ids);
	for (const id of ids) {
		assert(
			!/\/frontend\/(?:ui|wire|manager(?:-model)?|workspace(?:-transport)?|probe)\.(?:mjs|html)(?:\?|$)|(?:^|\/)settings(?:[./-]|$)|command-resource-settings/.test(
				id,
			),
			`Shutdown imports forbidden initialization module: ${id}`,
		);
	}
}
export async function buildFixture({ outDir = path.join(directory, 'dist'), write = true } = {}) {
	const graphs = {};
	const result = await build({
		configFile: false,
		root: path.join(directory, 'frontend'),
		base: './',
		publicDir: false,
		logLevel: 'warn',
		resolve: { alias: { $lib: path.join(repository, 'src/lib') } },
		plugins: [
			svelte({ configFile: false }),
			{
				name: 'fixture-manager-graph-audit',
				generateBundle(_options, bundle) {
					for (const [name, output] of Object.entries(bundle)) {
						if (output.type !== 'chunk') {
							continue;
						}
						graphs[name] = {
							imports: [...output.imports, ...output.dynamicImports],
							modules: Object.keys(output.modules),
							entry: output.facadeModuleId,
						};
					}
					for (const [role, audit] of [
						['manager', assertManagerGraph],
						['shutdown', assertShutdownGraph],
					]) {
						const entry = Object.keys(graphs).find((name) =>
							graphs[name].entry?.endsWith(`/${role}.html`),
						);
						assert(entry, `Missing ${role} entry`);
						const sourceIds = new Set();
						const visitSource = (id) => {
							if (sourceIds.has(id)) {
								return;
							}
							sourceIds.add(id);
							const info = this.getModuleInfo(id);
							if (info) {
								[...info.importedIds, ...info.dynamicallyImportedIds].forEach(visitSource);
							}
						};
						visitSource(graphs[entry].entry);
						audit(sourceIds);
						this.emitFile({
							type: 'asset',
							fileName: `${role}-source-graph.json`,
							source: JSON.stringify([...sourceIds], null, 2),
						});
						const seen = new Set();
						const visit = (name) => {
							if (seen.has(name)) {
								return;
							}
							seen.add(name);
							assert(graphs[name], `Missing emitted import ${name}`);
							audit(graphs[name].modules);
							graphs[name].imports.forEach(visit);
						};
						visit(entry);
					}
					this.emitFile({
						type: 'asset',
						fileName: 'import-graph.json',
						source: JSON.stringify(graphs, null, 2),
					});
				},
			},
		],
		build: {
			outDir,
			write,
			emptyOutDir: true,
			target: 'es2022',
			minify: false,
			rollupOptions: {
				input: Object.fromEntries(
					['manager', 'workspace', 'probe', 'shutdown'].map((role) => [
						role,
						path.join(directory, `frontend/${role}.html`),
					]),
				),
			},
		},
	});
	return { result, graphs };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await buildFixture();
}
