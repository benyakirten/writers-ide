import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'performance',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60000,
	reporter: [['list'], ['html', { outputFolder: 'performance-report', open: 'never' }]],
	outputDir: 'performance-results',
	use: {
		baseURL: 'http://127.0.0.1:6006',
		browserName: 'chromium',
		viewport: { width: 1280, height: 900 },
		deviceScaleFactor: 1,
		trace: 'retain-on-failure',
	},
	webServer: {
		command:
			'pnpm build-storybook --config-dir .storybook/performance --disable-telemetry && pnpm exec vite preview --outDir storybook-static --host 127.0.0.1 --port 6006 --strictPort',
		url: 'http://127.0.0.1:6006/index.json',
		timeout: 180000,
		reuseExistingServer: false,
	},
});
