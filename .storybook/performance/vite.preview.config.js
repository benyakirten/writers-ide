/**
 * Serve built Storybook files without loading the application's SvelteKit plugins.
 * @type {import('vite').UserConfig}
 */
const config = {
	build: { outDir: 'storybook-static' },
};

export default config;
