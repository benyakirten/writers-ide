import { test as base, expect, type Page } from '@playwright/test';
import type { BenchmarkOptions, BenchmarkReport } from '../../src/lib/testing/browser-benchmark';
import { stories, type StoryArgs, type StoryName } from './stories';
import { storyUrl, type StoryArg } from './story-url';

export interface VisitOptions {
	timeout?: number;
	/** Optional application-specific ready locator, in addition to the mounted story root. */
	readySelector?: string;
}

export type StorybookPage = Page & {
	visit<Name extends StoryName>(
		name: Name,
		args?: StoryArgs[Name],
		options?: VisitOptions,
	): Promise<void>;
	benchmark(options: BenchmarkOptions): Promise<BenchmarkReport>;
};

export const test = base.extend<{ page: StorybookPage }>({
	page: async ({ page, baseURL, browser }, use, testInfo) => {
		if (!baseURL) {
			throw new Error('Storybook fixture requires a baseURL in the Playwright configuration.');
		}
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		const storybookPage = Object.assign(page, {
			async visit<Name extends StoryName>(
				name: Name,
				args: StoryArgs[Name] = {},
				options: VisitOptions = {},
			) {
				const story = stories[name];
				if (!story) {
					throw new Error(`Unknown story: ${name}`);
				}
				const values = Object.fromEntries(
					Object.entries(args).filter(([, value]) => value !== undefined),
				);
				for (const key of Object.keys(values)) {
					if (!(story.args as readonly string[]).includes(key)) {
						throw new Error(`Unknown argument ${key} for ${name}`);
					}
				}
				const response = await page.request.get(new URL('/index.json', baseURL).href);
				if (!response.ok()) {
					throw new Error(`Cannot read Storybook index: HTTP ${response.status()}`);
				}
				const index = await response.json();
				if (index.entries?.[story.id]?.type !== 'story') {
					throw new Error(`Story ${name} (${story.id}) is missing from the built Storybook index.`);
				}
				await page.goto(
					new URL(storyUrl(story.id, values as Record<string, StoryArg>), baseURL).href,
					{ timeout: options.timeout },
				);
				await expect(page.locator('#storybook-root')).not.toBeEmpty({ timeout: options.timeout });
				if (options.readySelector) {
					await expect(page.locator(options.readySelector)).toBeVisible({
						timeout: options.timeout,
					});
				}
				await page.evaluate(async () => {
					await document.fonts.ready;
					await new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					);
				});
				await expect(page.locator('.sb-errordisplay')).toBeHidden();
			},
			async benchmark(options: BenchmarkOptions) {
				await page.waitForFunction(() => Boolean(window.__browserBenchmark));
				const report = await page.evaluate(
					(options) => window.__browserBenchmark!.measure(options),
					options,
				);
				await testInfo.attach(`benchmark-${testInfo.attachments.length}.json`, {
					body: JSON.stringify(
						{
							...report,
							runner: {
								browser: browser.browserType().name(),
								version: browser.version(),
								platform: process.platform,
								node: process.version,
							},
							story: page.url(),
						},
						null,
						2,
					),
					contentType: 'application/json',
				});
				return report;
			},
		});
		await use(storybookPage);
		expect(errors, 'Stories must not produce uncaught browser errors').toEqual([]);
	},
});

export { expect };
