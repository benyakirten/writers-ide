import { expect, test, type Page } from '@playwright/test';

async function click(page: Page, name: string) {
	await page.getByRole('button', { name, exact: true }).click();
}

const saved = (page: Page, label: string) => page.getByTestId(`saved-${label}`);
const probe = (page: Page, label: string) => page.getByTestId(label);

async function increment(page: Page, label: string, kind: 'Local' | 'Service') {
	await probe(page, label)
		.getByRole('button', { name: `${kind} increment`, exact: true })
		.click();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?application');
	await expect(page.getByRole('heading', { name: 'Application component assembly' })).toBeVisible();
	await expect(page.getByTestId('singletons')).toHaveText('shared');
	await expect(page.getByTestId('errors')).toHaveText('0');
});

test('production singleton routing uses stable placement keys and never opens tabs on registration', async ({
	page,
}) => {
	await expect(page.getByTestId('tabs')).toHaveText('[]');
	await expect(page.locator('.main-view .tab')).toHaveCount(0);
	await expect(probe(page, 'first-toolbar')).toBeVisible();
	await expect(probe(page, 'application-toolbar')).toBeVisible();
	await expect(probe(page, 'second-toolbar')).toHaveCount(0);
	const rows = page
		.getByRole('region', { name: 'Actual workspace records' })
		.locator('[data-placement-id]');
	const ids = await rows.evaluateAll((elements) =>
		elements.map((el) => el.getAttribute('data-placement-id')!),
	);
	expect(ids).toHaveLength(6);
	expect(new Set(ids).size).toBe(6);
	for (const id of ids) {
		expect(id).toMatch(/^component:/);
	}
	for (const label of ['first-view', 'second-view', 'application-view']) {
		await expect(saved(page, label)).toHaveAttribute('data-registered', 'true');
		await click(page, `Open ${label}`);
	}
	await expect(page.locator('.main-view .tab')).toHaveCount(2);
	await expect(page.locator('.main-view').getByTestId('first-view')).toBeVisible();
	await expect(page.locator('.main-view').getByTestId('application-view')).toBeVisible();
	await expect(probe(page, 'second-view')).toHaveCount(0);
	const tabs = JSON.parse((await page.getByTestId('tabs').textContent())!);
	expect(tabs.map((tab: { name: string }) => tab.name)).toEqual([ids[1], ids[3], ids[5]]);
});

test('project filtering retains actual open tabs and activation state while remounting local UI', async ({
	page,
}) => {
	for (const label of ['first-view', 'second-view', 'application-view']) {
		await click(page, `Open ${label}`);
	}
	const tabs = await page.getByTestId('tabs').textContent();
	const runtime = await saved(page, 'first-view').getAttribute('data-runtime-id');
	await increment(page, 'first-view', 'Local');
	await increment(page, 'first-view', 'Service');
	await increment(page, 'application-view', 'Local');
	await increment(page, 'application-toolbar', 'Local');
	// DOM identity is stronger evidence than just seeing the same label after a switch.
	const applicationNode = await probe(page, 'application-view').elementHandle();
	const applicationToolbar = await probe(page, 'application-toolbar').elementHandle();
	await click(page, 'Select second');
	await expect(probe(page, 'first-view')).toHaveCount(0);
	await expect(probe(page, 'first-toolbar')).toHaveCount(0);
	await expect(probe(page, 'second-view')).toBeVisible();
	await expect(saved(page, 'first-view')).toHaveAttribute('data-visible', 'false');
	await expect(saved(page, 'first-view')).toHaveAttribute('data-registered', 'true');
	await expect(page.getByTestId('tabs')).toHaveText(tabs!);
	await click(page, 'Select none');
	await expect(page.locator('.main-view .tab')).toHaveCount(1);
	await expect(probe(page, 'second-toolbar')).toHaveCount(0);
	await expect(probe(page, 'second-view')).toHaveCount(0);
	await expect(page.getByTestId('tabs')).toHaveText(tabs!);
	await click(page, 'Select first');
	await expect(probe(page, 'first-view').getByTestId('local')).toHaveText('0');
	await expect(probe(page, 'first-view').getByTestId('service')).toHaveText('1');
	await expect(saved(page, 'first-view')).toHaveAttribute('data-runtime-id', runtime!);
	await expect(probe(page, 'application-view').getByTestId('local')).toHaveText('1');
	await expect(probe(page, 'application-toolbar').getByTestId('local')).toHaveText('1');
	expect(await applicationNode!.evaluate((node) => node.isConnected)).toBe(true);
	expect(await applicationToolbar!.evaluate((node) => node.isConnected)).toBe(true);
	await expect(page.getByTestId('events')).not.toContainText('cleanup:');
	await click(page, 'Register unrelated');
	expect(await applicationNode!.evaluate((node) => node.isConnected)).toBe(true);
	await expect(page.getByTestId('errors')).toHaveText('0');
});

test('disable while inactive preserves project ownership, tab records and costs through re-enable', async ({
	page,
}) => {
	await click(page, 'Open first-view');
	const tabs = await page.getByTestId('tabs').textContent();
	const row = saved(page, 'first-toolbar');
	const placement = await row.getAttribute('data-placement-id');
	const runtime = await row.getAttribute('data-runtime-id');
	await increment(page, 'first-view', 'Service');
	await click(page, 'Select second');
	await click(page, 'Disable first');
	await expect(row).toHaveAttribute('data-registered', 'false');
	await expect(row).toHaveAttribute('data-visible', 'false');
	await expect(row).toHaveAttribute('data-horizontal-size', '1');
	await expect(row).toHaveAttribute('data-vertical-size', '2');
	await expect(saved(page, 'first-view')).toHaveAttribute('data-visible', 'false');
	await expect(page.getByTestId('tabs')).toHaveText(tabs!);
	await click(page, 'Select none');
	await expect(page.locator('.main-view .tab')).toHaveCount(0);
	await click(page, 'Enable first');
	await expect(row).toHaveAttribute('data-registered', 'true');
	await expect(row).toHaveAttribute('data-visible', 'false');
	await expect(probe(page, 'first-toolbar')).toHaveCount(0);
	await expect(probe(page, 'first-view')).toHaveCount(0);
	await click(page, 'Select first');
	await expect(probe(page, 'first-view').getByTestId('service')).toHaveText('0');
	await expect(row).toHaveAttribute('data-placement-id', placement!);
	await expect(row).not.toHaveAttribute('data-runtime-id', runtime!);
	await expect(page.getByTestId('tabs')).toHaveText(tabs!);
	await expect(page.getByTestId('events')).toContainText('cleanup:first');
	await expect(page.getByTestId('events')).not.toContainText('cleanup:application');
	await expect(page.getByTestId('errors')).toHaveText('0');
});

test('both production toolbar orientations route presentations to the same activation-owned service', async ({
	page,
}) => {
	await increment(page, 'first-toolbar', 'Local');
	await increment(page, 'first-toolbar', 'Service');
	const runtime = await saved(page, 'first-toolbar').getAttribute('data-runtime-id');
	await click(page, 'Rotate toolbar');
	await expect(probe(page, 'first-toolbar').getByTestId('orientation')).toHaveText('vertical');
	await expect(probe(page, 'first-toolbar').getByTestId('local')).toHaveText('0');
	await expect(probe(page, 'first-toolbar').getByTestId('service')).toHaveText('1');
	await expect(saved(page, 'first-toolbar')).toHaveAttribute('data-runtime-id', runtime!);
	await click(page, 'Select second');
	await expect(probe(page, 'first-toolbar')).toHaveCount(0);
	await expect(probe(page, 'second-toolbar').getByTestId('orientation')).toHaveText('vertical');
	await expect(page.locator('[data-dock-source-kind="bar"]')).toHaveCount(2);
	await click(page, 'Select none');
	await expect(page.locator('[data-dock-source-kind="bar"]')).toHaveCount(1);
	await click(page, 'Select first');
	await expect(probe(page, 'first-toolbar').getByTestId('service')).toHaveText('1');
	await click(page, 'Rotate toolbar');
	await expect(probe(page, 'first-toolbar').getByTestId('orientation')).toHaveText('horizontal');
	await expect(probe(page, 'first-toolbar').getByTestId('service')).toHaveText('1');
});

test('production mounts inherit tooltip context and remove focused inactive or disabled UI', async ({
	page,
}) => {
	await click(page, 'Open first-view');
	for (const label of ['first-view', 'first-toolbar']) {
		await page.getByRole('button', { name: `${label} help`, exact: true }).hover();
		await expect(page.getByText(`Host tooltip for ${label}`, { exact: true })).toBeVisible();
		await page.mouse.move(0, 0);
	}
	for (const action of ['Select second', 'Disable first']) {
		await click(page, 'Select first');
		const input = page.getByRole('textbox', { name: 'first-view input', exact: true });
		await input.focus();
		await expect(input).toBeFocused();
		// Keep focus on the presentation until production filtering unmounts it.
		await page
			.getByRole('button', { name: action, exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(input).toHaveCount(0);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						Boolean(document.activeElement?.isConnected) &&
						!document.activeElement?.closest('[data-testid="first-view"]'),
				),
			)
			.toBe(true);
	}
	await page.getByRole('button', { name: 'application-toolbar help', exact: true }).hover();
	await expect(
		page.getByText('Host tooltip for application-toolbar', { exact: true }),
	).toBeVisible();
});

const barShell = (page: Page, id: string) =>
	page.locator(`[data-dock-source-kind="bar"][data-dock-bar-id="${id}"]`);

test('project-only floating shell disappears completely and returns with retained layout and service state', async ({
	page,
}) => {
	await page.goto('/?application&layout=floating');
	const shell = barShell(page, 'project-floater');
	const empty = barShell(page, 'empty-floater');
	await expect(shell.locator('.floater')).toBeVisible();
	await expect(empty.locator('.floater')).toBeVisible();
	await shell
		.getByTestId('first-toolbar')
		.getByRole('button', { name: 'Local increment', exact: true })
		.click();
	await shell
		.getByTestId('first-toolbar')
		.getByRole('button', { name: 'Service increment', exact: true })
		.click();
	// Use the real floater control, rather than replacing its model in the fixture.
	await shell.getByRole('button', { name: 'Vertical', exact: true }).click();
	await expect(shell.getByTestId('orientation')).toHaveText('vertical');
	await shell.getByRole('button', { name: 'Project tools', exact: true }).click();
	await shell.locator('input[name="title"]').fill('Retained tools');
	await shell.locator('input[name="title"]').press('Enter');
	await expect(shell.getByRole('button', { name: 'Retained tools', exact: true })).toBeVisible();
	await expect(shell.locator('.menu').first()).toBeVisible();
	await expect(shell.locator('[data-dock-target]')).toHaveCount(3);
	const layout = await page.getByTestId('floating-layout').textContent();
	const runtime = await saved(page, 'first-toolbar').getAttribute('data-runtime-id');
	const oldShell = await shell.elementHandle();
	for (const selection of ['second', 'none']) {
		await click(page, `Select ${selection}`);
		await expect(shell).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Retained tools', exact: true })).toHaveCount(0);
		await expect(page.locator('[data-dock-bar-id="project-floater"]')).toHaveCount(0);
		await expect(empty.locator('.floater')).toBeVisible();
		await expect(empty.locator('.dock-slot')).toHaveCount(1);
		await expect(page.getByTestId('floating-layout')).toHaveText(layout!);
	}
	expect(await oldShell!.evaluate((node) => node.isConnected)).toBe(false);
	await click(page, 'Select first');
	await expect(shell.locator('.floater')).toBeVisible();
	await expect(shell.getByRole('button', { name: 'Retained tools', exact: true })).toBeVisible();
	await expect(shell.getByTestId('orientation')).toHaveText('vertical');
	await expect(shell.getByTestId('local')).toHaveText('0');
	await expect(shell.getByTestId('service')).toHaveText('1');
	await expect(page.getByTestId('floating-layout')).toHaveText(layout!);
	await expect(saved(page, 'first-toolbar')).toHaveAttribute('data-runtime-id', runtime!);
	await expect(page.getByTestId('events')).not.toContainText('cleanup:first');
	await expect(page.getByTestId('errors')).toHaveText('0');
});

test('disabled same-project item keeps its floating placeholder and controls, but inactive project hides the shell', async ({
	page,
}) => {
	await page.goto('/?application&layout=floating');
	const shell = barShell(page, 'project-floater');
	await click(page, 'Disable first');
	await expect(shell.locator('.floater')).toBeVisible();
	await expect(shell.getByText('Component not found.', { exact: true })).toBeVisible();
	await expect(shell.getByRole('button', { name: 'Project tools', exact: true })).toBeVisible();
	await expect(shell.locator('.dock-slot')).toHaveCount(2);
	await expect(saved(page, 'first-toolbar')).toHaveAttribute('data-visible', 'true');
	await expect(saved(page, 'first-toolbar')).toHaveAttribute('data-registered', 'false');
	await click(page, 'Select second');
	await expect(shell).toHaveCount(0);
	await click(page, 'Select first');
	await expect(shell.getByText('Component not found.', { exact: true })).toBeVisible();
	await click(page, 'Enable first');
	await expect(shell.getByTestId('first-toolbar')).toBeVisible();
	await expect(shell.getByText('Component not found.', { exact: true })).toHaveCount(0);
});

test('mixed docked and floating bars omit inactive insertion gaps without removing active items or truly empty bars', async ({
	page,
}) => {
	await page.goto('/?application&layout=mixed');
	for (const selection of ['first', 'second', 'none']) {
		await click(page, `Select ${selection}`);
		for (const id of ['mixed-dock', 'project-floater']) {
			const shell = barShell(page, id);
			await expect(shell).toBeVisible();
			await expect(shell.getByTestId('application-toolbar')).toBeVisible();
			const activeLabels =
				selection === 'none'
					? ['application-toolbar']
					: [`${selection}-toolbar`, 'application-toolbar'];
			await expect(shell.locator('[data-testid$="-toolbar"]')).toHaveCount(activeLabels.length);
			await expect(shell.locator('.dock-slot')).toHaveCount(activeLabels.length + 1);
			// Each retained leading gap belongs to the next visible item, followed by one trailing gap.
			const gapLabels = await shell
				.locator('.dock-slot')
				.evaluateAll((slots) =>
					slots.map(
						(slot) =>
							slot.nextElementSibling
								?.querySelector('[data-testid$="-toolbar"]')
								?.getAttribute('data-testid') ?? null,
					),
				);
			expect(gapLabels).toEqual([...activeLabels, null]);
			await expect(shell.locator('.items')).toHaveCSS(
				'--insertion-space',
				`${(activeLabels.length + 1) * 16}px`,
			);
		}
		for (const id of ['empty-dock', 'empty-floater']) {
			await expect(barShell(page, id)).toBeVisible();
			await expect(barShell(page, id).locator('.dock-slot')).toHaveCount(1);
			await expect(
				barShell(page, id).getByRole('button', { name: 'Drag toolbar', exact: true }),
			).toBeVisible();
		}
	}
	await expect(page.getByTestId('errors')).toHaveText('0');
});

test('complete no-native contexts follow the real application locale, including inactive projects', async ({
	page,
}) => {
	const contexts = JSON.parse((await page.getByTestId('contexts').textContent())!);
	expect(contexts).toHaveLength(3);
	for (const context of contexts) {
		expect(context.keys).toEqual([
			'apis',
			'commands',
			'contributions',
			'identity',
			'locale',
			'native',
			'own',
			'project',
			'projects',
			'signal',
			'tasks',
		]);
		expect(context.native).toEqual({ projectFiles: null, externalLinks: null });
		expect(context.frozen).toBe(true);
		expect(context.aborted).toBe(false);
		expect(context.generation).toBe(1);
	}
	await click(page, 'Select none');
	await click(page, 'Use French');
	await expect(page.getByTestId('locale')).toHaveText('fr');
	for (const slot of ['first', 'second', 'application']) {
		await expect(page.getByTestId('locale-events')).toContainText(`${slot}:fr:ltr`);
	}
	await click(page, 'Disable first');
	const before = (await page.getByTestId('locale-events').textContent())!;
	await click(page, 'Use English');
	await expect(page.getByTestId('locale-events')).toContainText('application:en:ltr');
	await expect
		.poll(
			async () =>
				((await page.getByTestId('locale-events').textContent())!.match(/second:en:ltr/g) ?? [])
					.length,
		)
		.toBe(2);
	const after = (await page.getByTestId('locale-events').textContent())!;
	expect(after.slice(before.length)).not.toContain('first:');
	await click(page, 'Enable first');
	await expect(page.getByTestId('locale-events')).toContainText('first:en:ltr');
	await expect(page.getByTestId('contexts')).toContainText('"generation":2');
});
