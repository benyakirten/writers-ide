import { expect, test, type Page } from '@playwright/test';

const firstEditor = (page: Page) =>
	page.getByRole('textbox', { name: 'First editor', exact: true });
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function inspect(page: Page) {
	await click(page, 'Inspect behavior state');
	return JSON.parse((await page.getByTestId('behavior-state').textContent())!);
}
async function analyze(page: Page) {
	await click(page, 'Analyze selection');
	await expect(page.getByTestId('behavior-status')).toHaveText('ready');
	await expect(page.getByRole('button', { name: 'Deliver analysis', exact: true })).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await click(page, 'Mount behavior proofs');
	await expect(page.getByTestId('behavior-diagnostics')).toContainText(
		'fixture.priority-high:active',
	);
});

test('real input rules work after registration and in later views, with upstream undo identity', async ({
	page,
}) => {
	const editor = firstEditor(page);
	await click(page, 'Enable punctuation');
	await click(page, 'Caret at end');
	await page.keyboard.type('...');
	await expect(editor).toHaveText('alpha beta…');
	await click(page, 'Undo input rule');
	await expect(editor).toHaveText('alpha beta...');
	await expect(page.getByTestId('behavior-status')).toHaveText('command:true');
	await click(page, 'Create later view');
	const later = page.getByRole('textbox', { name: 'Later editor', exact: true });
	await later.click();
	await click(page, 'Caret at end');
	await page.keyboard.type('--');
	await expect(later).toHaveText('later view—');
	await click(page, 'Undo input rule');
	await expect(later).toHaveText('later view--');
	await click(page, 'Disable punctuation');
	await click(page, 'Caret at end');
	await page.keyboard.type('...');
	await expect(later).toHaveText('later view--...');
	await expect(editor).toHaveText('alpha beta...');
});

test('selection metadata decorates without changing the document and maps only existing ranges', async ({
	page,
}) => {
	await click(page, 'Enable highlights');
	await click(page, 'Select active text');
	const before = await inspect(page);
	await click(page, 'Highlight selection');
	const decorated = await inspect(page);
	expect(decorated.doc).toEqual(before.doc);
	expect(decorated.selection).toEqual(before.selection);
	expect(decorated.highlights).toEqual([{ from: 1, to: 11 }]);
	await expect(firstEditor(page).locator('.selection-highlight')).toHaveText('alpha beta');
	await click(page, 'Insert prefix');
	expect((await inspect(page)).highlights).toEqual([{ from: 3, to: 13 }]);
	await expect(firstEditor(page).locator('.selection-highlight')).toHaveText('alpha beta');
	await click(page, 'Disable highlights');
	expect((await inspect(page)).highlights).toBeNull();
	await expect(firstEditor(page).locator('.selection-highlight')).toHaveCount(0);
	await click(page, 'Undo edit');
	await expect(firstEditor(page)).toHaveText('alpha beta');
});

test('priority is deterministic and removal/cascade preserve surviving state, history, selection and stored marks', async ({
	page,
}) => {
	await click(page, 'Enable highlights');
	await click(page, 'Select active text');
	await click(page, 'Highlight selection');
	await click(page, 'Insert prefix');
	await click(page, 'Store strong at end');
	const before = await inspect(page);
	await firstEditor(page).focus();
	await page.keyboard.press('F8');
	await expect(page.getByTestId('behavior-order')).toHaveText('high low');
	await click(page, 'Remove low priority');
	const after = await inspect(page);
	expect(after).toEqual(before);
	await firstEditor(page).focus();
	await page.keyboard.press('F8');
	await expect(page.getByTestId('behavior-order')).toHaveText('high low high');
	await click(page, 'Disable highlights');
	const removed = await inspect(page);
	expect(removed.doc).toEqual(before.doc);
	expect(removed.selection).toEqual(before.selection);
	expect(removed.marks).toEqual(['strong']);
	expect(removed.counter).toEqual(before.counter);
	expect(removed.factories).toEqual(before.factories);
	await click(page, 'Enable highlights');
	await click(page, 'Select active text');
	await click(page, 'Highlight selection');
	await click(page, 'Store strong at end');
	const cascadeBefore = await inspect(page);
	await click(page, 'Disable provider and dependents');
	await expect(firstEditor(page).locator('.selection-highlight')).toHaveCount(0);
	await click(page, 'Re-enable proof consumer');
	await click(page, 'Re-enable behavior controls');
	const restarted = await inspect(page);
	expect(restarted.doc).toEqual(cascadeBefore.doc);
	expect(restarted.selection).toEqual(cascadeBefore.selection);
	expect(restarted.marks).toEqual(['strong']);
	expect(restarted.highlights).toBeNull();
	await click(page, 'Undo edit');
	await expect(firstEditor(page)).toHaveText('alpha beta');
});

test('bundled worker returns model ranges, applies metadata synchronously, and rejects selection/layout stale targets', async ({
	page,
}) => {
	await click(page, 'Enable analysis');
	await click(page, 'Seed repeated text');
	const before = await inspect(page);
	await analyze(page);
	await click(page, 'Deliver analysis');
	await expect(page.getByTestId('behavior-status')).toHaveText('applied:true');
	const applied = await inspect(page);
	expect(applied.doc).toEqual(before.doc);
	expect(applied.selection).toEqual(before.selection);
	expect(applied.analysis).toEqual([
		{ from: 1, to: 5 },
		{ from: 6, to: 10 },
	]);
	await expect(firstEditor(page).locator('.repeated-word')).toHaveText(['echo', 'echo']);
	await expect(
		page.getByRole('textbox', { name: 'Second editor', exact: true }).locator('.repeated-word'),
	).toHaveCount(0);
	await analyze(page);
	await click(page, 'Caret at end');
	await click(page, 'Deliver analysis');
	await expect(page.getByTestId('behavior-status')).toHaveText('stale');
	await click(page, 'Select active text');
	await analyze(page);
	await click(page, 'Structural layout edit');
	const layout = await inspect(page);
	await click(page, 'Deliver analysis');
	await expect(page.getByTestId('behavior-status')).toHaveText('stale');
	expect((await inspect(page)).doc).toEqual(layout.doc);
	await click(page, 'Seed marked chunks');
	const chunks = await inspect(page);
	await analyze(page);
	await click(page, 'Deliver analysis');
	const chunkResult = await inspect(page);
	expect(chunkResult.doc).toEqual(chunks.doc);
	expect(chunkResult.analysis).toEqual([
		{ from: 4, to: 8 },
		{ from: 9, to: 13 },
		{ from: 20, to: 24 },
	]);
	// The emoji occupies two model positions; paragraph boundaries and mark-split
	// "ec" + "ho" must not be flattened into misleading textBetween offsets.
	await expect(firstEditor(page).locator('.repeated-word')).toHaveText(['echo', 'echo', 'echo']);
});

test('ready worker deliveries are dropped after disable, view close, and provider cascade', async ({
	page,
}) => {
	await click(page, 'Enable analysis');
	await click(page, 'Seed repeated text');
	await analyze(page);
	await click(page, 'Disable analysis');
	await click(page, 'Deliver analysis');
	await expect(page.getByTestId('behavior-status')).toHaveText('cancelled');
	await expect(firstEditor(page).locator('.repeated-word')).toHaveCount(0);
	await click(page, 'Enable analysis');
	await analyze(page);
	await click(page, 'Close first view');
	await click(page, 'Deliver analysis');
	await expect(page.getByTestId('behavior-status')).toHaveText('cancelled');
	await click(page, 'Select active text');
	await analyze(page);
	await click(page, 'Disable provider and dependents');
	// Delivery checks inherited lifetime before touching the revoked facade.
	// Re-enable only the controls so they can inspect the remaining source view.
	await click(page, 'Re-enable proof consumer');
	await click(page, 'Re-enable behavior controls');
	await click(page, 'Deliver analysis');
	await expect(page.getByTestId('behavior-status')).toHaveText('cancelled');
	await expect(page.getByRole('textbox', { name: 'Second editor', exact: true })).toHaveText(
		'second view',
	);
	expect((await inspect(page)).analysis).toBeNull();
});

test('throwing filter is quarantined, attributed to its consumer and does not prevent continued typing', async ({
	page,
}) => {
	await click(page, 'Enable failed filter');
	await click(page, 'Insert prefix');
	await expect(firstEditor(page)).toHaveText('alpha beta');
	await click(page, 'Inspect behavior state');
	await expect(page.getByTestId('behavior-diagnostics')).toContainText(
		'fixture.failing-behavior/fixture.failed-filter:failed',
	);
	await expect(page.getByTestId('behavior-errors')).toContainText('intentional filter failure');
	await expect(page.getByTestId('behavior-errors')).toContainText('writers-ide.word-processing:[]');
	await expect(page.getByTestId('behavior-errors')).toContainText('fixture.behavior-controls:[]');
	await click(page, 'Caret at end');
	await page.keyboard.type('!');
	await expect(firstEditor(page)).toHaveText('alpha beta!');
	await click(page, 'Inspect behavior state');
	await expect(page.getByTestId('behavior-diagnostics')).toContainText(
		'fixture.priority-high:active',
	);
	expect((await inspect(page)).counter).toBe(1);
});
