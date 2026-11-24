import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: 'e2e',
	testMatch: 'plugin-runtime-profile.test.ts',
	forbidOnly: Boolean(process.env.CI),
	workers: process.env.CI ? 2 : undefined,
	reporter: 'list',
	outputDir: 'test-results/runtime-profile',
	use: {
		baseURL: 'http://127.0.0.1:4179',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'webkit', use: { browserName: 'webkit' } },
	],
	webServer: {
		command:
			'node e2e/fixtures/runtime-profile/build.mjs && node e2e/fixtures/runtime-profile/server.mjs',
		url: 'http://127.0.0.1:4179',
		timeout: 120000,
		reuseExistingServer: false,
	},
});
