import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		paraglide({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// TODO: With Tauri or Electron, what is the best internationalizaiton strategy?
			// We could route things based on a user settings - but should it come from the OS or the app?
			// Should the user be able to override OS settings?
			// @ts-expect-error This is a valid config option
			strategy: ['preferredLanguage']
		})
	],

	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom'
	}
});
