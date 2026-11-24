import path from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(({ command }) => {
	// Checking loads the Svelte configuration without a runtime profile. A build
	// must receive the fixture's generated exact import inventory; never infer it.
	/** @type {Set<string>} */
	const exact = new Set();
	if (command === 'build') {
		const inventory = /** @type {unknown} */ (
			JSON.parse(readFileSync(new URL('./profile-imports.json', import.meta.url), 'utf8'))
		);
		if (
			!Array.isArray(inventory) ||
			inventory.length === 0 ||
			!inventory.every((id) => typeof id === 'string' && id.length > 0)
		) {
			throw new Error('A build requires a nonempty runtime profile import inventory');
		}
		for (const id of inventory) {
			exact.add(id);
		}
	}
	return {
		root,
		base: './',
		publicDir: false,
		plugins: [
			{
				name: 'portable-exact-profile',
				enforce: 'pre',
				load(id) {
					const filename = id.split('?')[0];
					if (
						path.isAbsolute(filename) &&
						!realpathSync(filename).startsWith(realpathSync(root) + path.sep)
					) {
						throw new Error(`Build resolved outside clean sample: ${id}`);
					}
				},
				resolveId(id) {
					if (id === '@writers-ide/layout/dock-colors.css') {
						return;
					}
					if (exact.has(id)) {
						return { id, external: true };
					}
					if (
						/^(svelte(?:[/?#]|$)|prosemirror-(?:model|state|view|transform)(?:[/?#]|$)|@writers-ide\/|@dnd-kit-svelte\/core(?:[/?#]|$))/.test(
							id,
						)
					) {
						throw new Error(`Unsupported shared import: ${id}`);
					}
				},
			},
			svelte({
				configFile: false,
				compilerOptions: { dev: false, experimental: { async: false } },
			}),
		],
		css: { postcss: { plugins: [] } },
		build: {
			minify: false,
			assetsInlineLimit: 0,
			rolldownOptions: {
				input: {
					entry: path.join(root, 'src/entry.ts'),
					'calculate.worker': path.join(root, 'src/calculate.worker.ts'),
				},
				preserveEntrySignatures: 'strict',
				output: {
					entryFileNames: '[name].js',
					chunkFileNames: 'chunks/[name]-[hash].js',
					assetFileNames: 'assets/[name][extname]',
				},
			},
		},
	};
});
