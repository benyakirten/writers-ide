import { expect, test } from '@playwright/test';

const url = 'http://localhost:4173/';

test('paginates on mount and maintains DOM page indexes after editing and scrolling', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(url);
	const viewport = page.locator('.document-viewport');
	const editor = viewport.locator('.ProseMirror');
	const pages = editor.locator(':scope > .prosemirror-page');
	await expect(editor).toBeVisible();
	await expect(pages).toHaveCount(2);
	await expect(pages.nth(0)).toHaveAttribute('data-index', '0');
	await expect(pages.nth(1)).toHaveAttribute('data-index', '1');

	await editor.click();
	await page.keyboard.press('ControlOrMeta+Home');
	await page.keyboard.insertText('Pagination regression test. '.repeat(1600));
	await expect.poll(() => pages.count()).toBeGreaterThan(2);
	for (let i = 0; i < 8; i++) {
		await viewport.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await page.waitForTimeout(150);
	}
	await expect
		.poll(async () =>
			pages.evaluateAll((els) =>
				els.every((el, index) => el.getAttribute('data-index') === String(index)),
			),
		)
		.toBe(true);
	const bounds = await viewport.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await expect
		.poll(async () => viewport.evaluate((el) => el.scrollHeight > el.clientHeight))
		.toBe(true);
	expect(errors).toEqual([]);
});

test('separate document views paginate and scroll independently', async ({ page }) => {
	await page.goto(url);
	await expect(page.locator('.document-viewport .prosemirror-page')).toHaveCount(2);
	await page.getByRole('button', { name: 'Create Prosemirror', exact: true }).click();
	const viewports = page.locator('.document-viewport');
	await expect(viewports).toHaveCount(2);
	await expect(viewports.nth(1).locator('.prosemirror-page')).toHaveCount(2);
	await viewports.nth(0).evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect.poll(async () => viewports.nth(0).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	expect(await viewports.nth(1).evaluate((el) => el.scrollTop)).toBe(0);
});
