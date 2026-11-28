import { expect, test, type Page } from '@playwright/test';

async function computeSelection(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Select active text', exact: true }).click();
	await page.getByRole('button', { name: 'Compute uppercase result', exact: true }).click();
	await expect(page.getByTestId('worker-status')).toHaveText('completed');
	await expect(page.getByTestId('result')).toHaveText('ready');
	await expect(page.getByRole('button', { name: 'Deliver result', exact: true })).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Quick bold', exact: true })).toBeEnabled();
	await expect(page.getByTestId('basic-status')).toHaveText('unregistered');
});

test('independent quick toolbar toggles selected text, restores focus and survives orientation remount', async ({
	page,
}) => {
	const editor = page.getByRole('textbox', { name: 'First editor', exact: true });
	const bold = page.getByRole('button', { name: 'Quick bold', exact: true });
	await expect(page.getByTestId('commands')).toContainText(
		'writers-ide.quick-format.bold (writers-ide.quick-format)',
	);
	for (const orientation of ['horizontal', 'vertical']) {
		await test.step(orientation, async () => {
			await expect(page.getByTestId('toolbar-size')).toHaveText('1');
			await page.getByRole('button', { name: 'Select active text', exact: true }).click();
			await bold.click();
			await expect(editor.locator('strong')).toHaveText('alpha beta');
			await expect(bold).toHaveAttribute('aria-pressed', 'true');
			await expect(editor).toBeFocused();
			await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
			await expect(editor.locator('strong')).toHaveCount(0);
			await expect(bold).toHaveAttribute('aria-pressed', 'false');
			await expect(editor).toBeFocused();
			await page.getByRole('button', { name: 'Change orientation', exact: true }).click();
		});
	}
	await expect(page.getByRole('textbox', { name: 'Second editor', exact: true })).toHaveText(
		'second view',
	);
});

test('caret bold uses stored marks for typing and normal history undo', async ({ page }) => {
	const editor = page.getByRole('textbox', { name: 'First editor', exact: true });
	const bold = page.getByRole('button', { name: 'Quick bold', exact: true });
	await page.getByRole('button', { name: 'Caret at end', exact: true }).click();
	await bold.click();
	await expect(bold).toHaveAttribute('aria-pressed', 'true');
	await expect(editor).toBeFocused();
	await page.keyboard.type('!');
	await expect(editor.locator('strong')).toHaveText('!');
	await expect(editor).toHaveText('alpha beta!');
	await bold.click();
	await expect(bold).toHaveAttribute('aria-pressed', 'false');
	await expect(editor).toBeFocused();
	await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
	await expect(editor).toHaveText('alpha beta');
	await expect(editor.locator('strong')).toHaveCount(0);
});

test('worker result rejects a selection-only stale target then freshly recomputed result applies and undoes', async ({
	page,
}) => {
	const editor = page.getByRole('textbox', { name: 'First editor', exact: true });
	await computeSelection(page);
	await page.getByRole('button', { name: 'Caret at end', exact: true }).click();
	await page.getByRole('button', { name: 'Deliver result', exact: true }).click();
	await expect(page.getByTestId('result')).toHaveText('stale');
	await expect(editor).toHaveText('alpha beta');
	await computeSelection(page);
	await page.getByRole('button', { name: 'Deliver result', exact: true }).click();
	await expect(page.getByTestId('result')).toHaveText('applied:true');
	await expect(editor).toHaveText('ALPHA BETA');
	await expect(page.getByRole('textbox', { name: 'Second editor', exact: true })).toHaveText(
		'second view',
	);
	await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
	await expect(editor).toHaveText('alpha beta');
});

test('cancelled result cannot apply; a fresh result for the other same-document view stays isolated', async ({
	page,
}) => {
	const first = page.getByRole('textbox', { name: 'First editor', exact: true });
	const second = page.getByRole('textbox', { name: 'Second editor', exact: true });
	await computeSelection(page);
	await page.getByRole('button', { name: 'Cancel result', exact: true }).click();
	await page.getByRole('button', { name: 'Deliver result', exact: true }).click();
	await expect(page.getByTestId('result')).toHaveText('cancelled');
	await expect(first).toHaveText('alpha beta');
	await page.getByRole('button', { name: 'Activate second view', exact: true }).click();
	await computeSelection(page);
	await page.getByRole('button', { name: 'Deliver result', exact: true }).click();
	await expect(page.getByTestId('result')).toHaveText('applied:true');
	await expect(second).toHaveText('SECOND VIEW');
	await expect(first).toHaveText('alpha beta');
});

test('closing captured view before result delivery never retargets to the remaining view', async ({
	page,
}) => {
	await computeSelection(page);
	await page.getByRole('button', { name: 'Close first view', exact: true }).click();
	await page.getByRole('button', { name: 'Deliver result', exact: true }).click();
	await expect(page.getByTestId('result')).toHaveText('unavailable');
	await expect(page.getByRole('textbox', { name: 'First editor', exact: true })).toHaveCount(0);
	const second = page.getByRole('textbox', { name: 'Second editor', exact: true });
	await expect(second).toHaveText('second view');
	await page.getByRole('button', { name: 'Select active text', exact: true }).click();
	await page.getByRole('button', { name: 'Quick bold', exact: true }).click();
	await expect(second.locator('strong')).toHaveText('second view');
	await expect(second).toBeFocused();
});

test('provider cascade revokes retained API, commands and results; re-enable creates fresh working handles', async ({
	page,
}) => {
	await computeSelection(page);
	await page.getByRole('button', { name: 'Disable provider and dependents', exact: true }).click();
	await expect(page.getByTestId('lifecycle')).toContainText('writers-ide.quick-format:disabled');
	await expect(page.getByTestId('lifecycle')).toContainText('writers-ide.word-processing:disabled');
	await expect(page.getByTestId('lifecycle')).toContainText('fixture.controls:disabled');
	await expect(page.getByRole('button', { name: 'Quick bold', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Call retained API command', exact: true }).click();
	await expect(page.getByTestId('retained-result')).toContainText('Plugin API revoked');
	await page.getByRole('button', { name: 'Deliver result', exact: true }).click();
	await expect(page.getByTestId('result')).toContainText('Plugin API revoked');
	await page.getByRole('button', { name: 'Re-enable proof consumer', exact: true }).click();
	await expect(page.getByTestId('fresh-handle')).toHaveText('true');
	await expect(page.getByTestId('commands')).not.toContainText('fixture.retained-command');
	await expect(page.getByTestId('commands')).toContainText('writers-ide.quick-format.bold');
	await page.getByRole('button', { name: 'Call first activation command', exact: true }).click();
	await expect(page.getByTestId('retained-result')).toHaveText('unknown-command');
	await page.getByRole('button', { name: 'Call retained API command', exact: true }).click();
	await expect(page.getByTestId('retained-result')).toContainText('Plugin API revoked');
	await page.getByRole('button', { name: 'Quick bold', exact: true }).click();
	const first = page.getByRole('textbox', { name: 'First editor', exact: true });
	await expect(first.locator('strong')).toHaveText('alpha beta');
	await expect(first).toBeFocused();
	await expect(page.getByRole('textbox', { name: 'Second editor', exact: true })).toHaveText(
		'second view',
	);
	await expect(page.getByTestId('basic-status')).toHaveText('unregistered');
});
