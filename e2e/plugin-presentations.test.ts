import { expect, test, type Page } from '@playwright/test';

function probe(page: Page, label: string) {
	return page.getByTestId(label);
}

async function click(page: Page, name: string) {
	await page.getByRole('button', { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?presentations');
	await expect(
		page.getByRole('heading', { name: 'Internal presentation fixture workspace' }),
	).toBeVisible();
});

test('local IDs are independent across components and contribution kinds; views open only on host request', async ({
	page,
}) => {
	await expect(
		page.getByRole('region', { name: 'Fixture toolbars' }).getByRole('heading'),
	).toHaveText(['first-toolbar', 'peer-toolbar', 'application-toolbar']);
	await expect(
		page.getByRole('region', { name: 'Fixture open views' }).getByRole('heading'),
	).toHaveCount(0);
	await expect(page.getByTestId('tab-first-view')).toHaveText('closed');
	await expect(page.getByTestId('tab-second-view')).toHaveText('closed');
	const saved = page
		.getByRole('region', { name: 'Saved workspace records' })
		.locator('[data-placement-id]');
	const ids = await saved.evaluateAll((elements) =>
		elements.map((element) => element.getAttribute('data-placement-id')),
	);
	expect(ids).toHaveLength(8);
	expect(new Set(ids).size).toBe(8);
	for (const label of ['first-view', 'peer-view', 'application-view']) {
		await click(page, `Open ${label}`);
		await expect(probe(page, label)).toBeVisible();
	}
	const runtimeIds = await page
		.locator('[data-runtime-id]')
		.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-runtime-id')));
	expect(runtimeIds).toHaveLength(6);
	expect(new Set(runtimeIds).size).toBe(6);
	for (const id of runtimeIds) {
		expect(JSON.parse(id!)[2]).toBe('local');
	}
	await probe(page, 'first-toolbar')
		.getByRole('button', { name: 'Local increment', exact: true })
		.click();
	await expect(probe(page, 'first-toolbar').getByTestId('local')).toHaveText('1');
	await expect(probe(page, 'first-view').getByTestId('local')).toHaveText('0');
	await expect(probe(page, 'peer-toolbar').getByTestId('local')).toHaveText('0');
});

test('project switching unmounts UI and restores open tabs with fresh local state but the same activation and services', async ({
	page,
}) => {
	await click(page, 'Open first-view');
	const first = probe(page, 'first-view');
	const application = probe(page, 'application-toolbar');
	await first.getByRole('button', { name: 'Local increment', exact: true }).click();
	await first.getByRole('button', { name: 'Service increment', exact: true }).click();
	await application.getByRole('button', { name: 'Local increment', exact: true }).click();
	const runtime = await page.getByTestId('record-first-view').getAttribute('data-runtime-id');
	const placement = await page.getByTestId('record-first-view').getAttribute('data-placement-id');
	await click(page, 'Select second');
	await expect(first).toHaveCount(0);
	await expect(probe(page, 'first-toolbar')).toHaveCount(0);
	await expect(probe(page, 'second-toolbar')).toBeVisible();
	await expect(probe(page, 'second-view')).toHaveCount(0);
	await expect(page.getByTestId('tab-first-view')).toHaveText('open');
	await expect(page.getByTestId('events')).toContainText('destroy:first-view:view');
	await expect(page.getByTestId('events')).not.toContainText('cleanup:first');
	await click(page, 'Call first service');
	await expect(page.getByTestId('service-result')).toHaveText('first:1:2:false:en-US');
	await expect(application.getByTestId('local')).toHaveText('1');
	await click(page, 'Select none');
	await expect(probe(page, 'second-toolbar')).toHaveCount(0);
	await expect(application.getByTestId('local')).toHaveText('1');
	await click(page, 'Select first');
	await expect(first.getByTestId('local')).toHaveText('0');
	await expect(first.getByTestId('service')).toHaveText('2');
	await expect(page.getByTestId('record-first-view')).toHaveAttribute('data-runtime-id', runtime!);
	await expect(page.getByTestId('record-first-view')).toHaveAttribute(
		'data-placement-id',
		placement!,
	);
	await expect(application.getByTestId('local')).toHaveText('1');
});

test('teardown removes UI but preserves saved placements and open tabs for a fresh activation', async ({
	page,
}) => {
	await click(page, 'Open first-view');
	const record = page.getByTestId('record-first-view');
	const runtime = await record.getAttribute('data-runtime-id');
	const placement = await record.getAttribute('data-placement-id');
	await probe(page, 'first-view')
		.getByRole('button', { name: 'Service increment', exact: true })
		.click();
	await click(page, 'Disable first');
	await expect(probe(page, 'first-view')).toHaveCount(0);
	await expect(probe(page, 'first-toolbar')).toHaveCount(0);
	await expect(page.getByTestId('saved-first-view')).toHaveAttribute(
		'data-placement-id',
		placement!,
	);
	await expect(page.getByTestId('tab-first-view')).toHaveText('open');
	await expect(page.getByTestId('events')).toContainText('cleanup:first');
	await click(page, 'Call first service');
	await expect(page.getByTestId('service-result')).toHaveText('Unavailable');
	await click(page, 'Enable first');
	await expect(record).toHaveAttribute('data-placement-id', placement!);
	await expect(record).not.toHaveAttribute('data-runtime-id', runtime!);
	await expect(probe(page, 'first-view').getByTestId('service')).toHaveText('0');
	await click(page, 'Call first service');
	await expect(page.getByTestId('service-result')).toHaveText('first:2:1:false:en-US');
	await expect(page.getByTestId('saved-first-view')).toHaveCount(1);
	await expect(probe(page, 'peer-toolbar')).toBeVisible();
});

test('failed activation publishes no UI or saved placement, while healthy peers remain usable', async ({
	page,
}) => {
	await click(page, 'Activate rollback');
	await expect(page.getByTestId('activation-result')).toHaveText(
		'Error: Intentional activation rollback',
	);
	await expect(page.getByTestId('saved-rollback-toolbar')).toHaveCount(0);
	await expect(page.getByTestId('saved-rollback-view')).toHaveCount(0);
	await expect(probe(page, 'rollback-toolbar')).toHaveCount(0);
	await expect(page.getByTestId('events')).not.toContainText('mount:rollback');
	await expect(page.getByTestId('events')).toContainText('cleanup:rollback');
	await probe(page, 'peer-toolbar')
		.getByRole('button', { name: 'Local increment', exact: true })
		.click();
	await expect(probe(page, 'peer-toolbar').getByTestId('local')).toHaveText('1');
});

test('focused descendants are removed on switch and teardown, not retained in hidden subtrees', async ({
	page,
}) => {
	for (const action of ['Select second', 'Disable first']) {
		await click(page, 'Select first');
		await click(page, 'Open first-view');
		const input = page.getByRole('textbox', { name: 'first-view input', exact: true });
		await input.focus();
		await expect(input).toBeFocused();
		// Dispatch without moving focus to the host control before the subtree is removed.
		await page
			.getByRole('button', { name: action, exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(input).toHaveCount(0);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.activeElement?.isConnected &&
						!document.activeElement.closest('[data-runtime-id]'),
				),
			)
			.toBe(true);
	}
});

test('host tooltip context reaches presentations and render failures stay inside their boundary', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'peer-toolbar help', exact: true }).hover();
	await expect(page.getByText('Host tooltip for peer-toolbar', { exact: true })).toBeVisible();
	await page.mouse.move(0, 0);
	await click(page, 'Activate broken');
	await expect(page.getByTestId('record-broken-toolbar').getByRole('alert')).toContainText(
		'could not be displayed',
	);
	await click(page, 'Open broken-view');
	await expect(page.getByTestId('record-broken-view').getByRole('alert')).toContainText(
		'could not be displayed',
	);
	await probe(page, 'peer-toolbar')
		.getByRole('button', { name: 'Local increment', exact: true })
		.click();
	await expect(probe(page, 'peer-toolbar').getByTestId('local')).toHaveText('1');
	await page.getByRole('button', { name: 'application-toolbar help', exact: true }).hover();
	await expect(
		page.getByText('Host tooltip for application-toolbar', { exact: true }),
	).toBeVisible();
});

test('orientation replacement remounts local UI against the same activation-owned service', async ({
	page,
}) => {
	const first = probe(page, 'first-toolbar');
	await first.getByRole('button', { name: 'Local increment', exact: true }).click();
	await first.getByRole('button', { name: 'Service increment', exact: true }).click();
	const runtime = await page.getByTestId('record-first-toolbar').getAttribute('data-runtime-id');
	await click(page, 'Rotate toolbar');
	await expect(first.getByTestId('orientation')).toHaveText('vertical');
	await expect(first.getByTestId('local')).toHaveText('0');
	await expect(first.getByTestId('service')).toHaveText('1');
	await expect(page.getByTestId('record-first-toolbar')).toHaveAttribute(
		'data-runtime-id',
		runtime!,
	);
	await expect(page.getByTestId('events')).toContainText('destroy:first-toolbar:horizontal');
	await expect(page.getByTestId('events')).toContainText('mount:first-toolbar:vertical');
});
