import { expect, test, type Page } from '@playwright/test';

type Snapshot = {
	text: string;
	pages: number;
	caretOffset: number;
	revision: number;
	settled: boolean;
	errors: unknown[];
};
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function inspect(page: Page): Promise<Snapshot> {
	await click(page, 'Inspect pagination renderer');
	return JSON.parse((await page.getByTestId('paginated-renderer-state').textContent())!);
}
async function fit(page: Page) {
	await expect
		.poll(
			async () => {
				const snapshot = await inspect(page);
				const overflow = await page
					.getByTestId('paginated-renderer-viewport')
					.locator('.prosemirror-page')
					.evaluateAll((pages) =>
						pages.some((page) => {
							const bounds = page.getBoundingClientRect();
							const style = getComputedStyle(page);
							const bottom =
								bounds.bottom -
								parseFloat(style.paddingBottom) -
								parseFloat(style.borderBottomWidth);
							return Array.from(page.children).some(
								(block) => block.getBoundingClientRect().bottom > bottom + 0.5,
							);
						}),
					);
				return snapshot.settled && !overflow;
			},
			{
				timeout: 15000,
				message:
					'Production pagination settles and all rendered blocks fit inside page content bounds',
			},
		)
		.toBe(true);
	const snapshot = await inspect(page);
	expect(snapshot.errors).toEqual([]);
	return snapshot;
}

test('renderer installation, Svelte-only size changes and removal reflow real pages without losing content or undo', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.getByTestId('paginated-renderer-fixture')).toHaveCount(0);
	await click(page, 'Mount paginated renderer proofs');
	const initial = await fit(page);
	await click(page, 'Insert pagination marker');
	const edited = await fit(page);
	expect(edited.text).toBe(initial.text.slice(0, 5) + '!' + initial.text.slice(5));
	await click(page, 'Enable paginated renderer');
	await expect(page.locator('[data-paginated-renderer]')).toHaveCount(8);
	const installed = await fit(page);
	expect(installed.text).toBe(edited.text);
	expect(installed.caretOffset).toBe(edited.caretOffset);
	expect(installed.revision).toBeGreaterThan(edited.revision);

	await click(page, 'Grow renderer UI');
	const grown = await fit(page);
	expect(grown.pages).toBeGreaterThan(installed.pages);
	expect(grown.revision).toBeGreaterThan(installed.revision);
	expect(grown.text).toBe(edited.text);
	expect(grown.caretOffset).toBe(edited.caretOffset);

	await click(page, 'Shrink renderer UI');
	const shrunk = await fit(page);
	expect(shrunk.pages).toBeLessThan(grown.pages);
	expect(shrunk.text).toBe(edited.text);

	await click(page, 'Grow renderer UI');
	await fit(page);
	await click(page, 'Disable paginated renderer');
	await expect(page.locator('[data-paginated-renderer]')).toHaveCount(0);
	const removed = await fit(page);
	expect(removed.pages).toBeLessThan(grown.pages);
	expect(removed.text).toBe(edited.text);
	expect(removed.caretOffset).toBe(edited.caretOffset);
	await click(page, 'Undo pagination marker');
	expect((await fit(page)).text).toBe(initial.text);
});

test('inline mark font changes reflow pages without document edits or changing inline wrapping', async ({
	page,
}) => {
	await page.goto('/');
	await click(page, 'Mount paginated renderer proofs');
	await click(page, 'Insert pagination marker');
	const edited = await fit(page);
	await click(page, 'Enable paginated mark');
	await expect(page.locator('[data-paginated-mark]')).toHaveCount(8);
	const installed = await fit(page);
	expect(installed.text).toBe(edited.text);
	const mark = page.locator('[data-paginated-mark]').first();
	expect(
		await mark.evaluate((element) => [
			getComputedStyle(element).display,
			getComputedStyle(element.parentElement!).display,
		]),
	).toEqual(['inline', 'inline']);

	await click(page, 'Grow mark font');
	await expect(mark).toHaveCSS('font-size', '32px');
	const grown = await fit(page);
	expect(grown.revision).toBeGreaterThan(installed.revision);
	expect(grown.pages).toBeGreaterThan(installed.pages);
	expect(grown.text).toBe(edited.text);
	expect(grown.caretOffset).toBe(edited.caretOffset);
	await page.waitForTimeout(500);
	expect((await fit(page)).revision).toBe(grown.revision);

	await click(page, 'Shrink mark font');
	const shrunk = await fit(page);
	expect(shrunk.pages).toBeLessThan(grown.pages);
	expect(shrunk.text).toBe(edited.text);
	await click(page, 'Grow mark font');
	await fit(page);
	await click(page, 'Disable paginated mark');
	await expect(page.locator('[data-paginated-mark]')).toHaveCount(0);
	const removed = await fit(page);
	expect(removed.pages).toBeLessThan(grown.pages);
	expect(removed.text).toBe(edited.text);
	expect(removed.caretOffset).toBe(edited.caretOffset);
	await click(page, 'Undo pagination marker');
	expect((await fit(page)).text).toBe(edited.text.replace('!', ''));
});

test('idle renderers and selection-only transactions do not continuously invalidate geometry', async ({
	page,
}) => {
	await page.goto('/');
	await click(page, 'Mount paginated renderer proofs');
	await click(page, 'Enable paginated renderer');
	await expect(page.locator('[data-paginated-renderer]')).toHaveCount(8);
	const before = await fit(page);
	const content = page
		.getByTestId('paginated-renderer-viewport')
		.locator('[data-paginated-renderer] p')
		.first();
	await content.click();
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(500);
	const after = await fit(page);
	expect(after.revision).toBe(before.revision);
	expect(after.text).toBe(before.text);
});
