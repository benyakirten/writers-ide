import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	forbidOnly: Boolean(process.env.CI),
	workers: process.env.CI ? 2 : undefined,
	reporter: [['list'], ['html', { outputFolder: 'browser-report', open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		viewport: { width: 1280, height: 900 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'webkit', use: { browserName: 'webkit' } },
	],
	webServer: {
		command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173',
		timeout: 120000,
		reuseExistingServer: false,
	},
});
