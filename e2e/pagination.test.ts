import { expect, test } from '@playwright/test';

const url = 'http://localhost:4173/';

for (const deviceScaleFactor of [1, 2]) {
	test.describe(`page geometry at DPR ${deviceScaleFactor}`, () => {
		test.use({ deviceScaleFactor });

		test('paginated pages keep their content inside the page bounds', async ({ page }) => {
			test.setTimeout(60000);
			await page.goto(url);
			const viewport = page.locator('.document-viewport');
			const editor = viewport.locator('.ProseMirror');
			const pages = editor.locator(':scope > .prosemirror-page');
			await expect.poll(() => pages.count()).toBeGreaterThanOrEqual(20);
			const markers = (text: string) => text.match(/CASE \d{2} —|\[\d{2}\.\d{2}\]/g);
			const originalMarkers = markers((await editor.textContent()) ?? '');
			for (let index = 0; index < (await pages.count()); index++) {
				await pages.nth(index).evaluate((el) => {
					const root = el.closest('.document-viewport')!;
					root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top;
				});
				await expect
					.poll(
						async () =>
							pages.nth(index).evaluate((el) => {
								const style = getComputedStyle(el);
								const bottom =
									el.getBoundingClientRect().bottom -
									parseFloat(style.paddingBottom) -
									parseFloat(style.borderBottomWidth);
								return (
									Math.max(
										...Array.from(el.children).map((child) => child.getBoundingClientRect().bottom),
									) - bottom
								);
							}),
						{ message: `Page ${index} content must fit without overlapping the next page` },
					)
					.toBeLessThanOrEqual(0.5);
			}
			expect(markers((await editor.textContent()) ?? '')).toEqual(originalMarkers);
		});
	});
}

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
	await expect.poll(() => pages.count()).toBeGreaterThanOrEqual(20);
	await expect(editor).toContainText('CASE 01');
	await expect(editor).toContainText('CASE 20');
	await expect(pages.nth(0)).toHaveAttribute('data-index', '0');
	await expect(pages.nth(1)).toHaveAttribute('data-index', '1');
	const markers = (text: string) => text.match(/CASE \d{2} —|\[\d{2}\.\d{2}\]/g);
	const originalMarkers = markers((await editor.textContent()) ?? '');

	await editor.click();
	await page.keyboard.press('ControlOrMeta+Home');
	await page.keyboard.insertText('Pagination regression test. '.repeat(1600));
	await expect(editor).toContainText('Pagination regression test.');
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
	expect(markers((await editor.textContent()) ?? '')).toEqual(originalMarkers);
	expect(errors).toEqual([]);
});

test('separate document views paginate and scroll independently', async ({ page }) => {
	await page.goto(url);
	await expect
		.poll(() => page.locator('.document-viewport .prosemirror-page').count())
		.toBeGreaterThanOrEqual(20);
	await page.getByRole('button', { name: 'Create Prosemirror', exact: true }).click();
	const viewports = page.locator('.document-viewport');
	await expect(viewports).toHaveCount(2);
	await expect
		.poll(() => viewports.nth(1).locator('.prosemirror-page').count())
		.toBeGreaterThanOrEqual(20);
	await viewports.nth(0).evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect.poll(async () => viewports.nth(0).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	expect(await viewports.nth(1).evaluate((el) => el.scrollTop)).toBe(0);
});
