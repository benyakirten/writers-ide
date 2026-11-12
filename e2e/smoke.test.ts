import { expect } from '@playwright/test';
import {
	expectVisiblePagesToFit,
	sampleMarkers,
	test,
	visiblePageGeometry,
} from './fixtures/smoke';

test('starts an editable workspace and supports keyboard formatting and undo', async ({
	page,
	app,
}) => {
	const { editor } = app;
	await expect(editor).toContainText('CASE 01');
	await expectVisiblePagesToFit(app.viewport);
	const originalMarkers = sampleMarkers(await editor.textContent());
	const text = 'Smoke editing works. ';

	await editor.focus();
	const isMac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));
	await page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home');

	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text);

	for (let index = 0; index < text.length; index++) {
		await page.keyboard.press('Shift+ArrowLeft');
	}
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);

	// The app explicitly registers meta-b/meta-z, even on non-Mac platforms.
	await page.keyboard.press('Meta+b');
	await expect(editor.locator('strong').filter({ hasText: text })).toHaveCount(1);
	await page.keyboard.press('Meta+z');
	await expect(editor.locator('strong').filter({ hasText: text })).toHaveCount(0);
	await expect(editor).toContainText(text);
	await page.keyboard.press('Meta+z');
	await expect(editor).not.toContainText(text);
	await expectVisiblePagesToFit(app.viewport);
	expect(sampleMarkers(await editor.textContent())).toEqual(originalMarkers);
});

test('opens the real bar dropdown with the keyboard and restores focus on Escape', async ({
	page,
	app,
}) => {
	await expect(app.editor).toBeVisible();
	// Both the bar and its formatting item have position menus; exercise the first bar menu.
	const trigger = page.getByRole('button', { name: 'Position item', exact: true }).first();
	await trigger.focus();
	await page.keyboard.press('ArrowDown');
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	const firstPosition = menu.getByRole('menuitemradio', {
		name: /^Window block start\b/,
	});
	await expect(firstPosition).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitemradio', { name: /^Window block end\b/ })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();
});

test('scrolls the document and paginates visible pages without losing sample markers', async ({
	page,
	app,
}) => {
	const { editor, viewport } = app;
	const pages = editor.locator(':scope > .prosemirror-page');
	await expectVisiblePagesToFit(viewport);
	const originalMarkers = sampleMarkers(await editor.textContent());
	expect(originalMarkers.length).toBeGreaterThan(0);
	await expect.poll(() => viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	const viewportBounds = await viewport.boundingBox();
	expect(viewportBounds).not.toBeNull();
	expect(viewportBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

	// Visit the next physical page only; the sample's case labels are not page numbers.
	await pages.nth(1).evaluate((el) => {
		const root = el.closest('.document-viewport')!;
		root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top;
	});
	await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect
		.poll(async () => (await visiblePageGeometry(viewport)).some((page) => page.index > 0))
		.toBe(true);
	await expectVisiblePagesToFit(viewport);
	await expect
		.poll(() =>
			pages.evaluateAll((elements) =>
				elements.every((el, index) => el.getAttribute('data-index') === String(index)),
			),
		)
		.toBe(true);
	expect(sampleMarkers(await editor.textContent())).toEqual(originalMarkers);
});

for (const { locale, expectedLanguage } of [
	{ locale: 'fr-FR', expectedLanguage: 'fr' },
	{ locale: 'de-DE', expectedLanguage: 'en' },
]) {
	test.describe(`browser locale ${locale}`, () => {
		test.use({ locale });
		test('resolves the document language and renders the workspace', async ({ page, app }) => {
			await expect(page.locator('html')).toHaveAttribute('lang', expectedLanguage);
			await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
			await expect(app.editor).toContainText('CASE 01');
			// The French catalog currently has English copy; assert resolution, not a fabricated translation.
			await expect(
				page.getByRole('button', { name: 'Position item', exact: true }).first(),
			).toBeVisible();
		});
	});
}
