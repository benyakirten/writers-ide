import type { UserConfig } from 'vite';

/** Serve built Storybook files without loading the application's SvelteKit plugins. */
const config: UserConfig = {
	build: { outDir: 'storybook-static' },
};

export default config;
