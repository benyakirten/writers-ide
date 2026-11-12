import { test, expect } from '../e2e/fixtures/storybook';

for (const enabled of [true, false]) {
	test(`visit preserves primitive argument types (enabled=${enabled})`, async ({ page }) => {
		const args = { label: '', enabled, amount: -12.5, optional: null };
		await page.visit('Performance/Harness arguments/Echo', args, {
			readySelector: '[data-testid="arguments"]',
		});
		expect(JSON.parse((await page.getByTestId('arguments').textContent())!)).toEqual(args);
	});
}

test('visit preserves spaces and omits undefined overrides', async ({ page }) => {
	await page.visit('Performance/Harness arguments/Echo', { label: 'two words', amount: undefined });
	expect(JSON.parse((await page.getByTestId('arguments').textContent())!)).toEqual({
		label: 'two words',
		enabled: true,
		amount: 1,
		optional: 'default',
	});
});
