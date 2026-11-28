import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: 'tasks.test.ts',
	forbidOnly: Boolean(process.env.CI),
	workers: process.env.CI ? 2 : undefined,
	reporter: 'list',
	outputDir: 'test-results/tasks',
	use: {
		baseURL: 'http://127.0.0.1:4175',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'webkit', use: { browserName: 'webkit' } },
	],
	webServer: {
		command:
			'pnpm exec vite build --config e2e/fixtures/tasks/vite.config.ts && pnpm exec vite preview --config e2e/fixtures/tasks/vite.config.ts --host 127.0.0.1 --port 4175 --strictPort',
		url: 'http://127.0.0.1:4175',
		timeout: 120000,
		reuseExistingServer: false,
	},
});
