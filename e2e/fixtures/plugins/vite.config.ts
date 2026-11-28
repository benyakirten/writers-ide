import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	plugins: [svelte({ configFile: false })],
	publicDir: false,
	resolve: { alias: { $lib: fileURLToPath(new URL('../../../src/lib', import.meta.url)) } },
	css: { postcss: { plugins: [] } },
	build: {
		outDir: fileURLToPath(new URL('../../../node_modules/.cache/plugins-fixture', import.meta.url)),
		emptyOutDir: true,
	},
});
