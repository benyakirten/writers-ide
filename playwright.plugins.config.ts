import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: 'plugin-dependencies.test.ts',
	forbidOnly: Boolean(process.env.CI),
	workers: process.env.CI ? 2 : undefined,
	reporter: 'list',
	outputDir: 'test-results/plugins',
	use: {
		baseURL: 'http://127.0.0.1:4176',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'webkit', use: { browserName: 'webkit' } },
	],
	webServer: {
		command:
			'pnpm exec vite build --config e2e/fixtures/plugins/vite.config.ts && pnpm exec vite preview --config e2e/fixtures/plugins/vite.config.ts --host 127.0.0.1 --port 4176 --strictPort',
		url: 'http://127.0.0.1:4176',
		timeout: 120000,
		reuseExistingServer: false,
	},
});
