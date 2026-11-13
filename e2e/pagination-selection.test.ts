import { expect } from '@playwright/test';
import { expectVisiblePagesToFit, test } from './fixtures/smoke';
import {
	replaceDocument,
	selectionOffsets,
	selectTextRange,
} from './fixtures/pagination-selection';

const prose = 'The patient writer follows the words across the turning page. ';

test('keeps the typing caret at the logical insertion point when overflow creates pages', async ({
	page,
	app,
}) => {
	const { editor, viewport } = app;
	const pages = editor.locator(':scope > .prosemirror-page');
	const opening = 'Caret regression: ';
	await replaceDocument(page, editor, opening);
	await expect(pages).toHaveCount(1);
	await expectVisiblePagesToFit(viewport);

	const text = opening + prose.repeat(100);
	await page.keyboard.insertText(prose.repeat(100));
	await expect.poll(() => pages.count()).toBeGreaterThan(1);
	await expectVisiblePagesToFit(viewport);
	await expect
		.poll(() => selectionOffsets(editor))
		.toEqual({
			anchor: text.length,
			focus: text.length,
			collapsed: true,
		});
	await expect
		.poll(() =>
			editor.evaluate(() =>
				Number(
					window
						.getSelection()!
						.focusNode!.parentElement!.closest('.prosemirror-page')!
						.getAttribute('data-index'),
				),
			),
		)
		.toBeGreaterThan(0);

	// Further real keystrokes must append here, not at a remapped page boundary.
	const suffix = 'Still at the caret.';
	await page.keyboard.type(suffix);
	await expect.poll(() => editor.textContent()).toBe(text + suffix);
	await expectVisiblePagesToFit(viewport);
	await selectTextRange(editor, text.length + suffix.length, text.length);
	await page.keyboard.press('Meta+b');
	await expect(editor.locator('strong')).toHaveText(suffix);
	await expect.poll(() => editor.textContent()).toBe(text + suffix);
});

for (const direction of ['forward', 'reverse'] as const) {
	test(`preserves a nonempty ${direction} range and all text through formatting reflow and undo`, async ({
		page,
		app,
	}) => {
		const { editor, viewport } = app;
		const pages = editor.locator(':scope > .prosemirror-page');
		const text = prose.repeat(70);
		await replaceDocument(page, editor, text);
		await expect.poll(() => pages.count()).toBeGreaterThan(1);
		await expectVisiblePagesToFit(viewport);
		const initialBoundary = (await pages.first().textContent())!.length;
		const from = 12;
		const to = text.length - 12;
		const anchor = direction === 'forward' ? from : to;
		const focus = direction === 'forward' ? to : from;
		const selection = { anchor, focus, collapsed: false };
		await selectTextRange(editor, anchor, focus);

		// Bold changes measured line widths, forcing a different physical split.
		await page.keyboard.press('Meta+b');
		await expect
			.poll(async () => (await pages.first().textContent())!.length)
			.not.toBe(initialBoundary);
		await expectVisiblePagesToFit(viewport);
		await expect.poll(() => selectionOffsets(editor)).toEqual(selection);
		await expect.poll(() => editor.textContent()).toBe(text);
		await expect
			.poll(() =>
				editor
					.locator('strong')
					.allTextContents()
					.then((parts) => parts.join('')),
			)
			.toBe(text.slice(from, to));

		// Undo removes the user mark, while pagination's reunion/split is not history.
		await page.keyboard.press('Meta+z');
		await expect(editor.locator('strong')).toHaveCount(0);
		await expect
			.poll(async () => (await pages.first().textContent())!.length)
			.toBe(initialBoundary);
		await expectVisiblePagesToFit(viewport);
		await expect.poll(() => selectionOffsets(editor)).toEqual(selection);
		await expect.poll(() => editor.textContent()).toBe(text);
	});
}
