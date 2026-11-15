import { expect } from '@playwright/test';
import { test } from './fixtures/smoke';
import { selectWithKeyboard } from './fixtures/pagination-selection';

const toolbar = '[data-dock-item-id="basic-menu"]';

test('opens the host plugin manager with the keyboard and restores focus on close', async ({
	page,
	app,
}) => {
	await expect(app.editor).toBeVisible();
	const launcher = page.getByRole('button', { name: 'Plugins', exact: true });
	await launcher.focus();
	await page.keyboard.press('Enter');
	const manager = page.getByRole('dialog', { name: 'Plugin manager', exact: true });
	await expect(manager).toBeVisible();
	await expect(manager.getByRole('heading', { name: 'Basic Menu', exact: true })).toBeVisible();
	await expect(manager).toContainText('writers-ide.formatting');
	await expect(manager).toContainText('0.1.0');
	await expect(manager).toContainText('trusted bundled plugins');
	await expect(manager).toContainText('not sandboxed');
	await expect(manager).toContainText('contributions.toolbar');
	await expect(manager).not.toContainText('formatting.observe');
	await expect(manager).not.toContainText('formatting.execute');
	await expect(manager).toContainText('toolbar:');
	await expect(manager).toContainText('basic-menu');
	await expect(manager.getByRole('status')).toHaveText('Enabled');
	await expect(manager.getByRole('button', { name: /install/i })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(manager).not.toBeVisible();
	await expect(launcher).toBeFocused();
	await launcher.click();
	await manager.getByRole('button', { name: 'Close plugin manager', exact: true }).click();
	await expect(manager).not.toBeVisible();
	await expect(launcher).toBeFocused();
});

test('disables and re-enables formatting without losing placement, content, or manager access', async ({
	page,
	app,
}) => {
	const source = page.locator(toolbar);
	const originalBar = await source.getAttribute('data-dock-bar-id');
	const originalText = await app.editor.textContent();
	const manager = page.getByRole('dialog', { name: 'Plugin manager', exact: true });
	const launcher = page.getByRole('button', { name: 'Plugins', exact: true });

	for (let cycle = 0; cycle < 2; cycle++) {
		await launcher.click();
		await manager.getByRole('button', { name: 'Disable Basic Menu', exact: true }).click();
		await expect(manager.getByRole('status')).toHaveText('Disabled');
		await expect(manager).toContainText('No active contributions.');
		await expect(source.locator('button[aria-label="Add Bold to text."]')).toHaveCount(0);
		await expect(source).toHaveAttribute('data-dock-bar-id', originalBar!);
		await manager.getByRole('button', { name: 'Close plugin manager', exact: true }).click();
		await expect.poll(() => app.editor.textContent()).toBe(originalText);

		await launcher.click();
		await manager.getByRole('button', { name: 'Enable Basic Menu', exact: true }).click();
		await expect(manager.getByRole('status')).toHaveText('Enabled');
		await expect(source.locator('button[aria-label="Add Bold to text."]')).toHaveCount(1);
		await expect(source).toHaveAttribute('data-dock-bar-id', originalBar!);
		await manager.getByRole('button', { name: 'Close plugin manager', exact: true }).click();
		await expect.poll(() => app.editor.textContent()).toBe(originalText);
	}

	await app.editor.focus();
	const isMac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));
	await page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home');
	const text = 'Formatting after re-enable ';
	await page.keyboard.insertText(text);
	await selectWithKeyboard(page, text);
	await source.getByRole('button', { name: 'Add Bold to text.', exact: true }).click();
	await expect(app.editor.locator('strong').filter({ hasText: text })).toHaveCount(1);
	await expect(page.locator(toolbar)).toHaveCount(1);
});
