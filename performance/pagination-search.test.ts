import { test, expect } from '../e2e/fixtures/storybook';
import type { StoryArgs } from '../e2e/fixtures/stories';

const story = 'Performance/Pagination search/Paragraph';
const cases: { name: string; args: StoryArgs[typeof story] }[] = [
	{ name: 'empty', args: { repetitions: 0 } },
	{ name: 'short', args: { repetitions: 1, linesToKeep: 1 } },
	{ name: 'long early split', args: { repetitions: 1000, linesToKeep: 1 } },
	{ name: 'long middle split', args: { repetitions: 300, linesToKeep: 200 } },
	{ name: 'long late split', args: { repetitions: 300, linesToKeep: 400 } },
	{ name: 'formatting spans', args: { repetitions: 100, spanSize: 25, linesToKeep: 30 } },
	{
		name: 'unicode',
		args: { repetitions: 100, spanSize: 17, content: 'unicode', linesToKeep: 30 },
	},
	{ name: 'none fit', args: { repetitions: 100, linesToKeep: -1 } },
	{ name: 'all fit', args: { repetitions: 100, linesToKeep: 1000000 } },
];

for (const scenario of cases) {
	test(scenario.name, async ({ page }) => {
		await page.visit(story, scenario.args);
		const report = await page.benchmark({ variants: ['sequential', 'hybrid'] });
		const sequential = report.samples.filter((sample) => sample.variant === 'sequential');
		const hybrid = report.samples.filter((sample) => sample.variant === 'hybrid');
		expect(sequential).toHaveLength(7);
		expect(hybrid).toHaveLength(7);
		for (let index = 0; index < hybrid.length; index++) {
			const candidate = hybrid[index].result;
			const sample =
				scenario.args.content === 'unicode'
					? 'Café e\u0301lan — Ελληνικά 日本語 🙂 👩‍💻; another quiet morning. '
					: 'The patient writer watches the river and records another quiet morning. ';
			expect(candidate.textLength).toBe(sample.length * scenario.args.repetitions!);
			if (scenario.name === 'none fit') {
				expect(candidate.splitOffset).toBe(0);
			}
			if (scenario.name === 'all fit') {
				expect(candidate.splitOffset).toBe(candidate.textLength);
			}
			expect(candidate.splitOffset).toBe(sequential[index].result.splitOffset);
			expect(candidate.probes).toBeLessThanOrEqual(
				20 + Math.ceil(Math.log2(Math.max(1, candidate.textLength))),
			);
			if (candidate.textLength <= 10) {
				expect(candidate.probes).toBe(sequential[index].result.probes);
			}
		}
		if (sequential[0].result.probes > 100) {
			expect(hybrid[0].result.probes).toBeLessThan(sequential[0].result.probes);
		}
	});
}

test('visit rejects unknown args rather than silently ignoring them', async ({ page }) => {
	// Deliberately exercise the runtime guard in addition to the typed API.
	// @ts-expect-error Unknown keys are also rejected at compile time.
	await expect(page.visit(story, { typo: 1 })).rejects.toThrow('Unknown argument typo');
});
