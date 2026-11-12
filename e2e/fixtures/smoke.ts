import { expect, test as base, type Locator } from '@playwright/test';

export const test = base.extend<{ app: { editor: Locator; viewport: Locator } }>({
	app: async ({ page }, use) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/');
		const viewport = page.locator('.document-viewport');
		const editor = viewport.locator('.ProseMirror');
		await expect(editor).toBeVisible();
		await expect(editor).toHaveAttribute('contenteditable', 'true');
		await page.evaluate(() => document.fonts.ready.then(() => undefined));
		await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
		await use({ editor, viewport });
		expect(errors, 'The app must not throw during startup or smoke interactions').toEqual([]);
	},
});

export function sampleMarkers(text: string | null): string[] {
	return text?.match(/CASE \d{2} —|\[\d{2}\.\d{2}\]/g) ?? [];
}

// Use the same padding/border content bounds and 0.5 CSS-pixel tolerance as
// pagination.test.ts, but inspect only pages intersecting the document viewport.
export async function visiblePageGeometry(viewport: Locator) {
	return viewport.evaluate((root) => {
		const bounds = root.getBoundingClientRect();
		return Array.from(root.querySelectorAll<HTMLElement>('.prosemirror-page'))
			.filter((el) => {
				const rect = el.getBoundingClientRect();
				return rect.bottom > bounds.top && rect.top < bounds.bottom;
			})
			.map((el) => {
				const rect = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				const bottom =
					rect.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
				const left = rect.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
				const right =
					rect.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
				const children = Array.from(el.children).map((child) => child.getBoundingClientRect());
				return {
					index: Number(el.getAttribute('data-index')),
					overflow: Math.max(
						0,
						...children.flatMap((child) => [
							child.bottom - bottom,
							left - child.left,
							child.right - right,
						]),
					),
				};
			});
	});
}

export async function expectVisiblePagesToFit(viewport: Locator) {
	await expect
		.poll(
			async () => {
				const visible = await visiblePageGeometry(viewport);
				return visible.length > 0 && visible.every((page) => page.overflow <= 0.5);
			},
			{ message: 'Visible page content must fit within its padded page bounds' },
		)
		.toBe(true);
}
