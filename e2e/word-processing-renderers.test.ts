import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page, name = 'First editor') =>
	page.getByRole('textbox', { name, exact: true });
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function inspect(page: Page) {
	await click(page, 'Inspect renderer state');
	return JSON.parse((await page.getByTestId('renderer-state').textContent())!) as {
		viewId: string;
		composing: boolean;
		undoDepth: number;
		redoDepth: number;
		doc: unknown;
		selection: { type: string; anchor: number; head?: number };
		marks: string[] | null;
		html: string;
	}[];
}
async function metrics(page: Page) {
	return JSON.parse((await page.getByTestId('renderer-metrics').textContent())!) as {
		nodeMounts: number;
		nodeDestroys: number;
		markMounts: number;
		markDestroys: number;
		factories: string[];
		aborted: string[];
	};
}
const content = (page: Page, name = 'First editor') =>
	editor(page, name).locator('[data-renderer-content]');

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('examples are opt-in and mount/release preserves model, selection, marks, serialization and undo', async ({
	page,
}) => {
	await expect(page.locator('[data-renderer-node]')).toHaveCount(0);
	await expect(page.getByTestId('lifecycle')).not.toContainText('fixture.svelte-renderers');
	await click(page, 'Mount renderer proofs');
	await click(page, 'Mark active text strong');
	await click(page, 'Caret inside strong');
	await page.keyboard.type('!');
	await click(page, 'Store renderer strong');
	const before = await inspect(page);
	expect(before[0].marks).toEqual(['strong']);
	await click(page, 'Enable Svelte renderers');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(2);
	await expect(editor(page).locator('[data-renderer-mark]')).toHaveText('al!pha beta');
	expect(await inspect(page)).toEqual(before);
	await click(page, 'Release paragraph renderer');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(0);
	await expect(editor(page).locator('[data-renderer-mark]')).toHaveCount(1);
	expect(await inspect(page)).toEqual(before);
	await click(page, 'Disable Svelte renderers');
	await expect(page.locator('[data-renderer-mark]')).toHaveCount(0);
	expect(await inspect(page)).toEqual(before);
	await expect(editor(page).locator('strong')).toHaveText('al!pha beta');
	await click(page, 'Undo edit');
	await expect(editor(page)).toHaveText('alpha beta');
	await click(page, 'Enable Svelte renderers');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(2);
	await expect(editor(page).locator('[data-renderer-mark]')).toHaveText('alpha beta');
});

test('Svelte contentDOM routes actual typing, range selection, navigation, native controls and undo', async ({
	page,
}) => {
	await click(page, 'Mount renderer proofs');
	await click(page, 'Enable Svelte renderers');
	await content(page).click();
	await click(page, 'Caret at end');
	await page.keyboard.type('!');
	await expect(content(page)).toHaveText('alpha beta!');
	await expect(editor(page).locator('[data-renderer-node]')).toHaveAttribute('data-size', '11');
	const node = editor(page).locator('[data-renderer-node]');
	const dom = await node.elementHandle();
	await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('Shift+ArrowLeft');
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('a!');
	const selected = (await inspect(page))[0].selection;
	expect(selected.anchor).toBe(12);
	expect(selected.head).toBe(10);
	await click(page, 'Select paragraph node');
	await expect(node).toHaveAttribute('data-selected', 'true');
	await click(page, 'Caret at end');
	await expect(node).toHaveAttribute('data-selected', 'false');
	await editor(page).getByRole('button', { name: 'Inspect paragraph position' }).click();
	await expect(page.getByTestId('renderer-control')).toHaveText('view-a:0');
	const beforeControl = await inspect(page);
	await editor(page).getByRole('textbox', { name: 'Paragraph note' }).fill('private UI note');
	expect(await inspect(page)).toEqual(beforeControl);
	expect(await node.evaluate((element, original) => element === original, dom)).toBe(true);
	await click(page, 'Undo edit');
	await expect(content(page)).toHaveText('alpha beta');
	await expect(content(page, 'Second editor')).toHaveText('second view');
});

test('strong mark content remains editable and serializes as schema strong, not Svelte UI', async ({
	page,
}) => {
	await click(page, 'Mount renderer proofs');
	await click(page, 'Mark active text strong');
	await click(page, 'Enable Svelte renderers');
	await click(page, 'Caret inside strong');
	await page.keyboard.type('X');
	await expect(editor(page).locator('[data-renderer-mark]')).toHaveText('alXpha beta');
	await page.keyboard.press('Shift+ArrowLeft');
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('X');
	await page.keyboard.type('Y');
	await expect(editor(page).locator('[data-renderer-mark]')).toHaveText('alYpha beta');
	const state = await inspect(page);
	expect(state[0].html).toBe('<p><strong>alYpha beta</strong></p>');
	await click(page, 'Disable Svelte renderers');
	expect(await inspect(page)).toEqual(state);
	await expect(editor(page).locator('strong')).toHaveText('alYpha beta');
	await click(page, 'Enable Svelte renderers');
	await expect(editor(page).locator('[data-renderer-mark]')).toHaveText('alYpha beta');
});

test('conflicting renderer is rejected without replacing the active renderer or changing content', async ({
	page,
}) => {
	await click(page, 'Mount renderer proofs');
	await click(page, 'Enable Svelte renderers');
	const before = await inspect(page);
	await click(page, 'Try renderer conflict');
	await expect(page.getByTestId('renderer-status')).not.toHaveText('unexpected success');
	await expect(page.getByTestId('renderer-status')).toContainText('paragraph');
	expect(await inspect(page)).toEqual(before);
	await expect(page.locator('[data-renderer-node]')).toHaveCount(2);
	await click(page, 'Caret at end');
	await page.keyboard.type('!');
	await expect(content(page)).toHaveText('alpha beta!');
});

for (const phase of ['constructor', 'update'] as const) {
	test(`${phase} failure restores schema rendering across views, attributes errors and permits editing`, async ({
		page,
	}) => {
		await click(page, 'Mount renderer proofs');
		const before = await inspect(page);
		await click(
			page,
			phase === 'constructor' ? 'Enable constructor failure' : 'Enable update failure',
		);
		if (phase === 'update') {
			await expect(page.locator('[data-failing-renderer]')).toHaveCount(2);
			await click(page, 'Caret at end');
			await page.keyboard.type('!');
		}
		await expect(page.locator('[data-failing-renderer]')).toHaveCount(0);
		await expect(editor(page).locator('p')).toHaveText(
			phase === 'update' ? 'alpha beta!' : 'alpha beta',
		);
		await expect(editor(page, 'Second editor').locator('p')).toHaveText('second view');
		await click(page, 'Inspect renderer state');

		await expect(page.getByTestId('renderer-errors')).toContainText(
			`intentional renderer ${phase} failure`,
		);
		await expect(page.getByTestId('renderer-errors')).toContainText(
			'writers-ide.word-processing:[]',
		);
		await expect(page.getByTestId('renderer-errors')).toContainText('fixture.renderer-controls:[]');
		if (phase === 'constructor') {
			expect(await inspect(page)).toEqual(before);
		}
		await click(page, 'Caret at end');
		await page.keyboard.type('?');
		await expect(editor(page)).toHaveText(phase === 'update' ? 'alpha beta!?' : 'alpha beta?');
	});
}

test('later views get independent factories and close/disable/cascade clean up components and signals', async ({
	page,
}) => {
	await click(page, 'Mount renderer proofs');
	await click(page, 'Mark active text strong');
	await click(page, 'Enable Svelte renderers');
	await click(page, 'Create renderer later view');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(3);
	await expect(content(page, 'Later editor')).toHaveText('later view');
	expect((await metrics(page)).factories).toEqual(['view-a', 'view-b', 'view-later']);
	await content(page, 'Later editor').click();
	await click(page, 'Caret at end');
	await page.keyboard.type('!');
	await expect(content(page, 'Later editor')).toHaveText('later view!');
	await expect(content(page)).toHaveText('alpha beta');
	await click(page, 'Close first view');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(2);
	await expect.poll(async () => (await metrics(page)).aborted).toEqual(['view-a']);
	await click(page, 'Disable Svelte renderers');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(0);
	const cleaned = await metrics(page);
	expect(cleaned.nodeMounts).toBe(cleaned.nodeDestroys);
	expect(cleaned.markMounts).toBe(cleaned.markDestroys);
	expect(cleaned.aborted).toEqual(['view-a', 'view-b', 'view-later']);
	await click(page, 'Enable Svelte renderers');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(2);
	await click(page, 'Disable provider and dependents');
	await expect(page.locator('[data-renderer-node]')).toHaveCount(0);
	const cascade = await metrics(page);
	expect(cascade.nodeMounts).toBe(cascade.nodeDestroys);
	expect(cascade.markMounts).toBe(cascade.markDestroys);
	expect(cascade.aborted).toEqual(['view-a', 'view-b', 'view-later', 'view-b', 'view-later']);
	await expect(editor(page, 'Later editor')).toHaveText('later view!');
});

for (const kind of ['node', 'mark'] as const) {
	test(`async Svelte ${kind} boundary failure preserves editable content and history across views`, async ({
		page,
	}) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		await click(page, 'Mount renderer proofs');
		for (const name of ['First editor', 'Second editor']) {
			await editor(page, name).focus();
			await click(page, 'Mark active text strong');
			await click(page, 'Caret inside strong');
			await page.keyboard.type('!');
			await click(page, 'Store renderer strong');
		}
		await editor(page).focus();
		await click(page, 'Select active text');
		await click(page, 'Store renderer strong');
		const before = await inspect(page);
		expect(before[0].selection.anchor).not.toBe(before[0].selection.head);
		// PM keeps stored marks only at a text cursor. Cover a range in view-a
		// and nonempty stored marks at the independent cursor in view-b.
		expect(before[0].marks).toBeNull();
		expect(before[1].marks).toEqual(['strong']);
		for (const state of before) {
			expect(state.undoDepth).toBeGreaterThan(0);
		}
		await click(page, `Enable async ${kind} renderer`);
		await expect(page.locator(`[data-async-renderer-${kind}]`)).toHaveCount(2);
		expect(await inspect(page)).toEqual(before);

		// This button only changes independent Svelte state. It dispatches no PM transaction
		// and calls no adapter update hook. Only view-a throws; quarantine must cover both views.
		await click(page, 'Trigger independent reactive failure');
		await expect(page.locator(`[data-async-renderer-${kind}]`)).toHaveCount(0);
		await expect(page.getByTestId('renderer-async-aborted')).toHaveText('["view-a","view-b"]');
		await expect(editor(page).locator('p > strong')).toHaveText('al!pha beta');
		await expect(editor(page, 'Second editor').locator('p > strong')).toHaveText('se!cond view');
		expect(await inspect(page)).toEqual(before);
		await expect(page.getByTestId('renderer-errors')).toContainText(
			`intentional async Svelte ${kind} boundary failure`,
		);
		await expect(page.getByTestId('renderer-errors')).toContainText(`fixture.async-${kind}`);
		await expect(page.getByTestId('renderer-errors')).toContainText('view-a');
		await expect(page.getByTestId('renderer-errors')).not.toContainText(
			'fixture.async-failed-renderer:[]',
		);
		await expect(page.getByTestId('renderer-errors')).toContainText(
			'writers-ide.word-processing:[]',
		);
		await expect(page.getByTestId('renderer-errors')).toContainText('fixture.renderer-controls:[]');
		await expect(page.getByTestId('renderer-errors')).toContainText('fixture.svelte-renderers:[]');
		expect(pageErrors).toEqual([]);

		await click(page, 'Undo edit');
		await expect(editor(page).locator('strong')).toHaveText('alpha beta');
		expect((await inspect(page))[1]).toEqual(before[1]);
		await editor(page, 'Second editor').focus();
		await click(page, 'Undo edit');
		await expect(editor(page, 'Second editor').locator('strong')).toHaveText('second view');
		await click(page, 'Caret at end');
		await page.keyboard.type('?');
		await expect(editor(page, 'Second editor')).toHaveText('second view?');
	});
}

test('synthetic composition events reach ProseMirror through editable content (not a real IME test)', async ({
	page,
}) => {
	await click(page, 'Mount renderer proofs');
	await click(page, 'Enable Svelte renderers');
	await click(page, 'Caret at end');
	const target = content(page).locator('span').first();
	await target.dispatchEvent('compositionstart', { data: '' });
	expect((await inspect(page))[0].composing).toBe(true);
	// Inspection uses a native button, so restore focus without changing the selection.
	await editor(page).focus();
	// Browser-dispatched composition lifecycle plus real keyboard input exercises event routing,
	// but does not simulate an operating-system IME or prove its candidate handling.
	await page.keyboard.type('z');
	await target.dispatchEvent('compositionend', { data: 'z' });
	await expect(content(page)).toHaveText('alpha betaz');
	const state = (await inspect(page))[0];
	expect(state.composing).toBe(false);
	expect(state.html).toBe('<p>alpha betaz</p>');
});
