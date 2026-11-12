import { expect, test } from '@playwright/test';

// Exercise the built stylesheet rather than jsdom's incomplete CSS implementation.
test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => {
		const fixture = document.createElement('div');
		fixture.id = 'style-compatibility';
		fixture.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;';
		fixture.innerHTML = `
			<div id="style-container" class="container"></div>
			<div id="style-theme" class="rounded-sm border bg-popover text-popover-foreground">Menu</div>
			<button id="style-button" class="outline-none">Button</button>
			<button id="style-focus" class="focus:outline-none">Focus</button>
			<button id="style-disabled" disabled>Disabled</button>
			<input id="style-input" placeholder="Placeholder">
			<dialog id="style-dialog" open>Dialog</dialog>
		`;
		document.body.append(fixture);
	});
});

test('keeps the existing light and dark theme and small radius', async ({ page }) => {
	const theme = page.locator('#style-theme');
	await expect(theme).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await expect(theme).toHaveCSS('color', 'rgb(2, 8, 23)');
	await expect(theme).toHaveCSS('border-color', 'rgb(226, 232, 240)');
	await expect(theme).toHaveCSS('border-radius', '4px');

	await page.locator('#style-compatibility').evaluate((element) => element.classList.add('dark'));
	await expect(theme).toHaveCSS('background-color', 'rgb(2, 8, 23)');
	await expect(theme).toHaveCSS('color', 'rgb(248, 250, 252)');
	await expect(theme).toHaveCSS('border-color', 'rgb(30, 41, 59)');
});

test('keeps the single 1400px container breakpoint and 2rem padding', async ({ page }) => {
	const container = page.locator('#style-container');
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(container).toHaveCSS('width', '1280px');
	await expect(container).toHaveCSS('padding-left', '32px');
	await expect(container).toHaveCSS('padding-right', '32px');

	await page.setViewportSize({ width: 1600, height: 800 });
	await expect(container).toHaveCSS('width', '1400px');
	await expect(container).toHaveCSS('margin-left', '100px');
	await expect(container).toHaveCSS('margin-right', '100px');
});

test('keeps v3 placeholders, cursors, and centered dialogs', async ({ page }) => {
	await expect(page.locator('#style-button')).toHaveCSS('cursor', 'pointer');
	// Disabled buttons retain their engine's normal cursor, not the enabled pointer.
	await expect(page.locator('#style-disabled')).toHaveCSS('cursor', /^(auto|default)$/);
	const placeholderColor = await page
		.locator('#style-input')
		.evaluate((element) => getComputedStyle(element, '::placeholder').color);
	expect(placeholderColor).toBe('rgb(156, 163, 175)');

	const dialog = await page.locator('#style-dialog').boundingBox();
	expect(dialog).not.toBeNull();
	const viewport = page.viewportSize()!;
	expect(Math.abs(dialog!.x + dialog!.width / 2 - viewport.width / 2)).toBeLessThan(1);
});

test('keeps transparent outlines available in forced-colors mode', async ({ page }) => {
	const button = page.locator('#style-button');
	await expect(button).toHaveCSS('outline-style', 'solid');
	await expect(button).toHaveCSS('outline-width', '2px');
	await expect(button).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
	await expect(button).toHaveCSS('outline-offset', '2px');

	const focusedButton = page.locator('#style-focus');
	await focusedButton.focus();
	await expect(focusedButton).toHaveCSS('outline-style', 'solid');
	await expect(focusedButton).toHaveCSS('outline-width', '2px');
	await expect(focusedButton).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
	await expect(focusedButton).toHaveCSS('outline-offset', '2px');

	await page.emulateMedia({ forcedColors: 'active' });
	for (const outlinedButton of [button, focusedButton]) {
		await expect(outlinedButton).toHaveCSS('outline-style', 'solid');
		await expect(outlinedButton).toHaveCSS('outline-width', '2px');
	}
});
