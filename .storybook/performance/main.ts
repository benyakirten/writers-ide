import type { StorybookConfig } from '@storybook/sveltekit';
import base from '../main';

/** Isolate repeatable fixtures from documentation stories and their global decorators. */
const config: StorybookConfig = {
	...base,
	stories: ['../../src/stories/performance/**/*.stories.ts'],
	async viteFinal(config) {
		const { svelte } = await import('@sveltejs/vite-plugin-svelte');
		// These isolated fixtures need Svelte compilation, but no SvelteKit routing.
		return {
			...config,
			plugins: [...(config.plugins ?? []), svelte({ hot: false })],
		};
	},
};

export default config;
