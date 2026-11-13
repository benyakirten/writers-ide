import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/smoke';
import { selectWithKeyboard } from './fixtures/pagination-selection';

const topDock = '[data-dock="WINDOW_BLOCK_START"]';
const rightDock = '[data-dock="INLINE_END"]';
const leftDock = '[data-dock="INLINE_START"]';
const wholeBar = { name: 'Drag toolbar', exact: true };
const basicItem = { name: 'Drag Basic Menu', exact: true };

async function center(locator: Locator) {
	await expect(locator).toBeVisible();
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

async function startDrag(page: Page, handle: Locator) {
	const point = await center(handle);
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await page.mouse.move(point.x + 8, point.y + 8, { steps: 4 });
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
}

async function hoverTarget(page: Page, target: Locator) {
	const point = await center(target);
	await page.mouse.move(point.x, point.y, { steps: 20 });
}

async function dropOn(page: Page, handle: Locator, target: Locator) {
	await startDrag(page, handle);
	await hoverTarget(page, target);
	await page.mouse.up();
	await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
		'Toolbar layout updated.',
	);
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
}

async function floatBar(page: Page, handle: Locator) {
	await startDrag(page, handle);
	const point = await center(page.locator('main.main'));
	await page.mouse.move(point.x, point.y, { steps: 20 });

	await page.mouse.up();
	await expect(page.locator('.floater')).toHaveCount(1);
	await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
		'Toolbar layout updated.',
	);
}

test.beforeEach(async ({ app }) => {
	await expect(app.editor).toBeVisible();
});

test('moves the whole top toolbar to the empty right dock', async ({ page }) => {
	const top = page.locator(topDock);
	const right = page.locator(rightDock);
	await expect(top.getByRole('button', wholeBar)).toHaveCount(1);
	await expect(right.getByRole('button', wholeBar)).toHaveCount(0);

	await dropOn(page, top.getByRole('button', wholeBar), right.locator('.dock-gap'));

	await expect(top.getByRole('button', wholeBar)).toHaveCount(0);
	await expect(right.getByRole('button', wholeBar)).toHaveCount(1);
	await expect(right.getByRole('button', basicItem)).toHaveCount(1);
	await expect(page.locator('.floater')).toHaveCount(0);
});

test('floats the whole toolbar on the workbench and redocks it', async ({ page }) => {
	await floatBar(page, page.locator(topDock).getByRole('button', wholeBar));
	await expect(page.locator(topDock).getByRole('button', wholeBar)).toHaveCount(0);
	await expect(page.locator('.floater').getByRole('button', basicItem)).toHaveCount(1);

	await dropOn(
		page,
		page.locator('.floater').getByRole('button', wholeBar),
		page.locator(rightDock).locator('.dock-gap'),
	);

	await expect(page.locator('.floater')).toHaveCount(0);
	await expect(page.locator(rightDock).getByRole('button', basicItem)).toHaveCount(1);
});

test('extracts an individual item into a new bar at an explicit dock gap', async ({ page }) => {
	await page.getByRole('combobox').selectOption('horizontal');
	await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	const top = page.locator(topDock);
	await expect(top.locator('.renderer')).toHaveCount(2);

	await dropOn(
		page,
		top.getByRole('button', basicItem),
		page.locator(rightDock).locator('.dock-gap'),
	);

	await expect(top.getByRole('button', wholeBar)).toHaveCount(1);
	await expect(top.locator('.renderer')).toHaveCount(1);
	await expect(top.getByRole('button', basicItem)).toHaveCount(0);
	await expect(page.locator(rightDock).getByRole('button', basicItem)).toHaveCount(1);
	await expect(page.locator('.renderer')).toHaveCount(2);
});

test('floats an individual item and removes its now-empty source bar', async ({ page }) => {
	await floatBar(page, page.locator(topDock).getByRole('button', basicItem));
	await expect(page.locator(topDock).getByRole('button', wholeBar)).toHaveCount(0);
	await expect(page.locator('.floater').getByRole('button', basicItem)).toHaveCount(1);
	await expect(page.locator('.renderer')).toHaveCount(1);
});

test('cancels an item dropped inside a full destination without floating it', async ({ page }) => {
	await page.getByRole('button', { name: 'Add vertical bar', exact: true }).click();
	for (let index = 0; index < 3; index++) {
		await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	}
	const left = page.locator(leftDock);
	const top = page.locator(topDock);
	await expect(left.locator('.renderer')).toHaveCount(3);
	const interior = left.locator('.vertical-slice > [data-dock-target="bar"]');
	await startDrag(page, top.getByRole('button', basicItem));
	await hoverTarget(page, interior);
	await expect.soft(interior).toHaveAttribute('data-dock-valid', 'false');
	await page.mouse.up();

	await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
		'Move cancelled: the destination is unavailable or has insufficient capacity.',
	);
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
	await expect(top.getByRole('button', basicItem)).toHaveCount(1);
	await expect(left.locator('.renderer')).toHaveCount(3);
	await expect(left.getByRole('button', wholeBar)).toHaveCount(1);
	await expect(page.locator('.floater')).toHaveCount(0);
});

test('uses destination-oriented units when inserting an item into a bar interior', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Add vertical bar', exact: true }).click();
	for (let index = 0; index < 2; index++) {
		await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	}
	const left = page.locator(leftDock);
	// Basic Menu costs two horizontal units but only one vertical unit.
	await dropOn(
		page,
		page.locator(topDock).getByRole('button', basicItem),
		left.locator('.vertical-slice > [data-dock-target="bar"]'),
	);
	await expect(left.getByRole('button', wholeBar)).toHaveCount(1);
	await expect(left.locator('.renderer')).toHaveCount(3);
	await expect(left.getByRole('button', basicItem)).toHaveCount(1);
	await expect(page.locator(topDock).getByRole('button', wholeBar)).toHaveCount(0);
	await expect(page.locator('.floater')).toHaveCount(0);
});

test('an explicit gap beside a full bar creates a new bar using destination orientation', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Add vertical bar', exact: true }).click();
	for (let index = 0; index < 3; index++) {
		await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	}
	const left = page.locator(leftDock);
	const top = page.locator(topDock);
	await expect(left.locator('.renderer')).toHaveCount(3);
	await dropOn(page, top.getByRole('button', basicItem), left.locator('.dock-gap').last());
	await expect(left.getByRole('button', wholeBar)).toHaveCount(2);
	await expect(left.locator('.vertical-slice').last().getByRole('button', basicItem)).toHaveCount(
		1,
	);
	await expect(left.locator('.renderer')).toHaveCount(4);
	await expect(top.getByRole('button', wholeBar)).toHaveCount(0);
});

test('reorders whole bars within the same dock in both directions', async ({ page }) => {
	await page.getByRole('button', { name: 'Add horizontal bar', exact: true }).click();
	const top = page.locator(topDock);
	await expect(top.getByRole('button', wholeBar)).toHaveCount(2);

	await dropOn(page, top.getByRole('button', wholeBar).first(), top.locator('.dock-gap').last());
	await expect(top.locator('.horizontal-slice').first().getByRole('button', basicItem)).toHaveCount(
		0,
	);
	await expect(top.locator('.horizontal-slice').last().getByRole('button', basicItem)).toHaveCount(
		1,
	);

	await dropOn(page, top.getByRole('button', wholeBar).last(), top.locator('.dock-gap').first());
	await expect(top.locator('.horizontal-slice').first().getByRole('button', basicItem)).toHaveCount(
		1,
	);
	await expect(top.getByRole('button', wholeBar)).toHaveCount(2);
	await expect(page.locator('.floater')).toHaveCount(0);
});

for (const kind of ['bar', 'item'] as const) {
	test(`Escape cancels a pointer move of a ${kind} without changing its source`, async ({
		page,
	}) => {
		const top = page.locator(topDock);
		await startDrag(page, top.getByRole('button', kind === 'bar' ? wholeBar : basicItem));
		await hoverTarget(page, page.locator(rightDock).locator('.dock-gap'));
		await page.keyboard.press('Escape');
		await page.mouse.up();

		await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText('Move cancelled.');
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(top.getByRole('button', wholeBar)).toHaveCount(1);
		await expect(top.getByRole('button', basicItem)).toHaveCount(1);
		await expect(page.locator(rightDock).getByRole('button', wholeBar)).toHaveCount(0);
		await expect(page.locator('.floater')).toHaveCount(0);
	});
}

test('moves a floating toolbar using its keyboard handle', async ({ page }) => {
	await floatBar(page, page.locator(topDock).getByRole('button', wholeBar));
	const floater = page.locator('.floater');
	const handle = floater.getByRole('button', wholeBar);
	const before = await floater.boundingBox();
	expect(before).not.toBeNull();
	await handle.focus();
	// KeyboardSensor installs its document listener on a timer after keydown.
	await page.keyboard.press('Space', { delay: 50 });
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
	// The default tall floater is clamped at the bottom after detaching; move inward.
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Space');
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
	await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
		'Toolbar layout updated.',
	);
	await expect.poll(async () => (await floater.boundingBox())!.y).toBeLessThan(before!.y);
	await expect(floater.getByRole('button', basicItem)).toHaveCount(1);
});

for (const kind of ['bar', 'item'] as const) {
	test(`Escape cancels a keyboard move of a ${kind} and retains handle focus`, async ({ page }) => {
		const top = page.locator(topDock);
		const handle = top.getByRole('button', kind === 'bar' ? wholeBar : basicItem);
		await handle.focus();
		// Hold through KeyboardSensor's deferred listener registration.
		await page.keyboard.press('Space', { delay: 50 });
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Escape');
		await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText('Move cancelled.');
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(handle).toBeFocused();
		await expect(top.getByRole('button', wholeBar)).toHaveCount(1);
		await expect(top.getByRole('button', basicItem)).toHaveCount(1);
		await expect(page.locator('.floater')).toHaveCount(0);
	});
}

test('switches a populated floater between horizontal and vertical arrangements', async ({
	page,
}) => {
	await page.getByRole('combobox').selectOption('horizontal');
	await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	await floatBar(page, page.locator(topDock).getByRole('button', wholeBar));
	const floater = page.locator('.floater');
	const items = floater.locator('.renderer');
	const originalLabels = await items
		.locator('.dock-grip')
		.evaluateAll((handles) => handles.map((handle) => handle.getAttribute('aria-label')));

	for (const orientation of ['Vertical', 'Horizontal'] as const) {
		// PointerSensor suppresses clicks for 50 ms after a drag ends.
		await floater.getByRole('button', { name: orientation, exact: true }).click({ delay: 75 });
		await expect(floater.locator('.items.horizontal')).toHaveCount(
			orientation === 'Horizontal' ? 1 : 0,
		);
		await expect(items).toHaveCount(2);
		expect(
			await items
				.locator('.dock-grip')
				.evaluateAll((handles) => handles.map((handle) => handle.getAttribute('aria-label'))),
		).toEqual(originalLabels);
		await expect
			.poll(async () => {
				const first = await items.first().boundingBox();
				const second = await items.last().boundingBox();
				return orientation === 'Horizontal'
					? second!.x > first!.x + first!.width / 2
					: second!.y > first!.y + first!.height / 2;
			})
			.toBe(true);
	}
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
});

test('disables a floater orientation switch that would exceed destination capacity', async ({
	page,
}) => {
	await floatBar(page, page.locator(topDock).getByRole('button', wholeBar));
	const floater = page.locator('.floater');
	await floater.getByRole('button', { name: 'Vertical', exact: true }).click({ delay: 75 });
	await expect(floater.locator('.items.horizontal')).toHaveCount(0);
	await page.getByRole('combobox').selectOption('floating');
	for (let index = 0; index < 2; index++) {
		await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	}
	await expect(floater.locator('.renderer')).toHaveCount(3);
	await expect(floater.getByRole('button', { name: 'Horizontal', exact: true })).toBeDisabled();
	await expect(floater.locator('.items.horizontal')).toHaveCount(0);
	await expect(floater.getByRole('button', basicItem)).toHaveCount(1);
});

for (const kind of ['bar', 'item'] as const) {
	test(`a successful keyboard ${kind} transfer focuses its new floating handle`, async ({
		page,
	}) => {
		const top = page.locator(topDock);
		if (kind === 'item') {
			await page.getByRole('combobox').selectOption('horizontal');
			await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
		}
		const source = top.getByRole('button', kind === 'bar' ? wholeBar : basicItem);
		await source.focus();
		await page.keyboard.press('Space', { delay: 50 });
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
		const workbench = page.locator('[data-dock-target="floating"]');
		for (let step = 0; step < 30; step++) {
			await page.keyboard.press('ArrowDown', { delay: 50 });
			if ((await workbench.getAttribute('data-dock-valid')) === 'true') {
				break;
			}
		}
		await expect(workbench).toHaveAttribute('data-dock-valid', 'true');
		await page.keyboard.press('Space');
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(
			'Toolbar layout updated.',
		);
		const floater = page.locator('.floater');
		await expect(floater).toHaveCount(1);
		await expect(floater.getByRole('button', kind === 'bar' ? wholeBar : basicItem)).toBeFocused();
		await expect(floater.getByRole('button', basicItem)).toHaveCount(1);
		await expect(top.getByRole('button', basicItem)).toHaveCount(0);
		await expect(top.getByRole('button', wholeBar)).toHaveCount(kind === 'item' ? 1 : 0);
		await expect(page.locator('.renderer')).toHaveCount(kind === 'item' ? 2 : 1);
	});
}

test('keeps the floating handle visible and reachable after the viewport shrinks', async ({
	page,
}) => {
	await floatBar(page, page.locator(topDock).getByRole('button', wholeBar));
	const handle = page.locator('.floater').getByRole('button', wholeBar);
	await startDrag(page, handle);
	const viewport = page.viewportSize()!;
	await page.mouse.move(viewport.width - 40, viewport.height / 2, { steps: 20 });
	await page.mouse.up();
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
	await expect(handle).toBeInViewport({ ratio: 1 });

	await page.setViewportSize({ width: 640, height: 480 });
	await expect(handle).toBeInViewport({ ratio: 1 });
	await handle.click({ trial: true });
	await expect(page.locator('.floater').getByRole('button', basicItem)).toHaveCount(1);
});

test('reorders items at same-bar insertion boundaries in both directions', async ({ page }) => {
	await page.getByRole('combobox').selectOption('horizontal');
	await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	const top = page.locator(topDock);
	const items = top.locator('.renderer');
	const boundaries = top.locator('.items > [data-dock-target="bar"]');
	await expect(items).toHaveCount(2);
	await expect(items.first().getByRole('button', basicItem)).toHaveCount(1);

	await dropOn(page, top.getByRole('button', basicItem), boundaries.last());
	await expect(items.first().getByRole('button', basicItem)).toHaveCount(0);
	await expect(items.last().getByRole('button', basicItem)).toHaveCount(1);
	await dropOn(page, top.getByRole('button', basicItem), boundaries.first());
	await expect(items.first().getByRole('button', basicItem)).toHaveCount(1);
	await expect(items.last().getByRole('button', basicItem)).toHaveCount(0);
	await expect(items).toHaveCount(2);
	await expect(top.getByRole('button', wholeBar)).toHaveCount(1);
	await expect(page.locator('.floater')).toHaveCount(0);
});

test('clicking a formatting button changes formatting without starting a drag', async ({
	page,
	app,
}) => {
	await app.editor.focus();
	const isMac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));
	await page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home');
	await page.keyboard.insertText('Docking button click ');
	await selectWithKeyboard(page, 'Docking button click ');
	const button = page
		.locator(topDock)
		.getByRole('button', { name: 'Add Bold to text.', exact: true });
	await button.click();
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
	await expect(
		app.editor.locator('strong').filter({ hasText: 'Docking button click ' }),
	).toHaveCount(1);
	await expect(page.locator('[role="status"][aria-live="polite"]')).toBeEmpty();
	await expect(page.locator(topDock).getByRole('button', wholeBar)).toHaveCount(1);
	await expect(page.locator('.floater')).toHaveCount(0);
});

test('drops an item into the visible topmost overlapping floater', async ({ page }) => {
	await page.getByRole('button', { name: 'Add floater bar', exact: true }).click();
	await page.getByRole('button', { name: 'Add floater bar', exact: true }).click();
	const floaters = page.locator('.floater');
	await expect(floaters).toHaveCount(2);
	const lower = floaters.first();
	const upper = floaters.last();
	const target = upper.locator(':scope > [data-dock-target="bar"]');
	const point = await center(target);
	const lowerBounds = await lower.boundingBox();
	expect(point.x).toBeGreaterThan(lowerBounds!.x);
	expect(point.x).toBeLessThan(lowerBounds!.x + lowerBounds!.width);
	expect(point.y).toBeGreaterThan(lowerBounds!.y);
	expect(point.y).toBeLessThan(lowerBounds!.y + lowerBounds!.height);
	expect(
		await upper.evaluate(
			(element, point) =>
				document.elementFromPoint(point.x, point.y)?.closest('.floater') === element,
			point,
		),
	).toBe(true);

	await dropOn(page, page.locator(topDock).getByRole('button', basicItem), target);
	await expect(upper.getByRole('button', basicItem)).toHaveCount(1);
	await expect(lower.locator('.renderer')).toHaveCount(0);
	await expect(page.locator(topDock).getByRole('button', wholeBar)).toHaveCount(0);
	await expect(floaters).toHaveCount(2);
});
