import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/smoke';

const topDock = '[data-dock="WINDOW_BLOCK_START"]';
const bottomDock = '[data-dock="WINDOW_BLOCK_END"]';
const rightDock = '[data-dock="INLINE_END"]';
const leftDock = '[data-dock="INLINE_START"]';
const wholeBar = { name: 'Drag toolbar', exact: true };
const basicItem = { name: 'Drag Basic Menu', exact: true };
const tooltip = '#builtin-tooltip';
const description = '.drag-preview .drop-description';

async function moveToCenter(page: Page, locator: Locator) {
	await expect(locator).toBeVisible();
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 20 });
}

async function startDrag(page: Page, handle: Locator) {
	await handle.scrollIntoViewIfNeeded();
	await moveToCenter(page, handle);
	const point = await handle.boundingBox();
	expect(point).not.toBeNull();
	await page.mouse.down();
	await page.mouse.move(point!.x + point!.width / 2 + 8, point!.y + point!.height / 2 + 8, {
		steps: 4,
	});
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
}

async function cancelDrag(page: Page) {
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
	await expect(page.locator('.drag-preview')).toHaveCount(0);
}

async function expectNoDelayedTooltip(page: Page) {
	await expect(page.locator(tooltip)).toHaveCount(0);
	// Deliberately exceed the built-in 200 ms delay: absence must survive pending timers.
	await page.waitForTimeout(350);
	await expect(page.locator(tooltip)).toHaveCount(0);
}

async function freshTooltip(page: Page, control: Locator, label: RegExp) {
	await moveToCenter(page, page.locator('main.main'));
	await expect(page.locator(tooltip)).toHaveCount(0);
	await control.hover();
	await expect(page.locator(tooltip)).toBeVisible();
	await expect(page.locator(tooltip)).toContainText(label);
}

// Canvas normalizes both rgb() and color(srgb ...) computed values across browser engines.
async function colors(locator: Locator) {
	return locator.evaluate((element) => {
		const style = getComputedStyle(element);
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext('2d')!;
		function rgb(color: string) {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return Array.from(context.getImageData(0, 0, 1, 1).data);
		}
		return {
			outline: rgb(style.outlineColor),
			background: rgb(style.backgroundColor),
			border: rgb(style.borderTopColor),
			outlineStyle: style.outlineStyle,
			outlineWidth: parseFloat(style.outlineWidth),
		};
	});
}

function expectHue(rgb: number[], hue: 'blue' | 'yellow' | 'red') {
	const [red, green, blue, alpha] = rgb;
	expect(alpha).toBeGreaterThan(0);
	if (hue === 'blue') {
		expect(blue).toBeGreaterThan(red + 20);
		expect(blue).toBeGreaterThan(green + 10);
	} else if (hue === 'yellow') {
		expect(red).toBeGreaterThan(blue + 40);
		expect(green).toBeGreaterThan(blue + 30);
	} else {
		expect(red).toBeGreaterThan(green + 40);
		expect(red).toBeGreaterThan(blue + 40);
	}
}

test.beforeEach(async ({ app }) => {
	await expect(app.editor).toBeVisible();
});

for (const kind of ['bar', 'item'] as const) {
	test(`suppresses close and minimize tooltips throughout a pointer ${kind} drag and restores fresh hover after cancel`, async ({
		page,
	}) => {
		const top = page.locator(topDock);
		await startDrag(page, top.getByRole('button', kind === 'bar' ? wholeBar : basicItem));
		for (const label of [/Close bar/i, /Minimize bar/i]) {
			await moveToCenter(page, top.getByRole('button', { name: label }));
			await expectNoDelayedTooltip(page);
		}
		await cancelDrag(page);
		// The pointer is still over Minimize: ending a drag must not replay that hover.
		await expectNoDelayedTooltip(page);
		await freshTooltip(page, top.getByRole('button', { name: /Minimize bar/i }), /Minimize bar/i);
		await freshTooltip(page, top.getByRole('button', { name: /Close bar/i }), /Close bar/i);
		await expect(top.getByRole('button', basicItem)).toHaveCount(1);
		await expect(page.locator('.floater')).toHaveCount(0);
	});

	test(`restores ordinary tooltips after dropping a pointer ${kind} drag`, async ({ page }) => {
		const top = page.locator(topDock);
		await startDrag(page, top.getByRole('button', kind === 'bar' ? wholeBar : basicItem));
		await moveToCenter(page, top.getByRole('button', { name: /Close bar/i }));
		await expectNoDelayedTooltip(page);
		const right = page.locator(rightDock);
		await moveToCenter(page, right.locator('.dock-gap'));
		await expect(page.locator(description)).toContainText(/release to.*right dock/i);
		await page.mouse.up();
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(right.getByRole('button', basicItem)).toHaveCount(1);
		await expectNoDelayedTooltip(page);
		await freshTooltip(page, right.getByRole('button', { name: /Close bar/i }), /Close bar/i);
	});
}

for (const state of ['pending', 'open'] as const) {
	test(`suppresses a ${state} tooltip when keyboard dragging starts and restores it only on fresh hover`, async ({
		page,
	}) => {
		const top = page.locator(topDock);
		const control = top.getByRole('button', { name: /Close bar/i });
		const handle = top.getByRole('button', wholeBar);
		await handle.focus();
		await control.hover();
		if (state === 'open') {
			await expect(page.locator(tooltip)).toBeVisible();
		} else {
			await expect(page.locator(tooltip)).toHaveCount(0);
		}
		// Keep the pointer over the tooltip-bearing control throughout keyboard activation.
		await page.keyboard.press('Space', { delay: 50 });
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
		await expectNoDelayedTooltip(page);
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(handle).toBeFocused();
		await expectNoDelayedTooltip(page);
		await freshTooltip(page, control, /Close bar/i);
	});
}

test('clicking a tooltip-bearing control does not replay its tooltip without a fresh hover', async ({
	page,
}) => {
	const minimize = page.locator(topDock).getByRole('button', { name: /Minimize bar/i });
	await freshTooltip(page, minimize, /Minimize bar/i);
	await minimize.click();
	await expectNoDelayedTooltip(page);
	// Minimize clips the menu; restore using its persistent resize/toggle control.
	await page.locator(topDock).locator('button.resize').click();
	await freshTooltip(page, minimize, /Minimize bar/i);
});

test('colors edge docks while leaving the main floating destination unhighlighted', async ({
	page,
}) => {
	const floating = page.locator('[data-dock-target="floating"]');
	await startDrag(page, page.locator(topDock).getByRole('button', wholeBar));
	await moveToCenter(page, page.locator('main.main'));
	const outlines: number[][] = [];
	for (const [dock, category, hue] of [
		[leftDock, 'vertical', 'blue'],
		[rightDock, 'vertical', 'blue'],
		[topDock, 'horizontal', 'yellow'],
		[bottomDock, 'horizontal', 'yellow'],
	] as const) {
		const target = page.locator(dock).locator('.dock-gap').first();
		await expect(target).toHaveAttribute('data-dock-active', 'true');
		await expect(target).toHaveAttribute('data-dock-color', category);
		const appearance = await colors(target.locator('.dock-hit'));
		expect(appearance.outlineStyle).not.toBe('none');
		expect(appearance.outlineWidth).toBeGreaterThan(0);
		expectHue(appearance.outline, hue);
		outlines.push(appearance.outline);
	}
	await expect(floating).not.toHaveAttribute('data-dock-active', 'true');
	const appearance = await colors(floating);
	expect(appearance.outlineStyle).toBe('none');
	expect(appearance.background[3]).toBe(0);
	expect(outlines[0]).not.toEqual(outlines[2]);
	await expect(page.locator(description)).toContainText(/release to.*float/i);
	await cancelDrag(page);
	await expect(page.locator('[data-dock-active="true"]')).toHaveCount(0);
});

for (const kind of ['bar', 'item'] as const) {
	test(`updates the pointer ${kind} preview to describe each release destination`, async ({
		page,
	}) => {
		await startDrag(
			page,
			page.locator(topDock).getByRole('button', kind === 'bar' ? wholeBar : basicItem),
		);
		const preview = page.locator('.drag-preview');
		await expect(preview).not.toHaveAttribute('aria-hidden', 'true');
		for (const [dock, location, category] of [
			[rightDock, 'right', 'vertical'],
			[topDock, 'top', 'horizontal'],
			[bottomDock, 'bottom', 'horizontal'],
		] as const) {
			await moveToCenter(page, page.locator(dock).locator('.dock-gap').last());
			await expect(page.locator(description)).toContainText(
				new RegExp(`release to.*${location} dock`, 'i'),
			);
			await expect(preview).toHaveAttribute('data-dock-color', category);
			expectHue((await colors(preview)).border, category === 'vertical' ? 'blue' : 'yellow');
			if (kind === 'item') {
				await expect(page.locator(description)).toContainText(/create.*new.*toolbar/i);
			} else if (dock !== topDock) {
				await expect(page.locator(description)).toContainText(/whole toolbar/i);
			}
		}
		await moveToCenter(page, page.locator('main.main'));
		await expect(page.locator(description)).toContainText(/release to.*float/i);
		await expect(preview).toHaveAttribute('data-dock-color', 'floating');
		expectHue((await colors(preview)).border, 'red');
		if (kind === 'item') {
			await expect(page.locator(description)).toContainText(/create.*new/i);
		}
		await page.mouse.up();
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(page.locator('.floater').getByRole('button', basicItem)).toHaveCount(1);
		await expect(page.locator(topDock).getByRole('button', basicItem)).toHaveCount(0);
	});
}

test('invalid full-bar preview explains cancellation and release leaves the item in its source', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Add vertical bar', exact: true }).click();
	for (let index = 0; index < 3; index++) {
		await page.getByRole('button', { name: 'Add null to bar', exact: true }).click();
	}
	const left = page.locator(leftDock);
	const top = page.locator(topDock);
	const interior = left.locator('.vertical-slice > [data-dock-target="bar"]');
	await expect(left.locator('.renderer')).toHaveCount(3);
	await startDrag(page, top.getByRole('button', basicItem));
	await moveToCenter(page, interior);
	await expect(interior).toHaveAttribute('data-dock-valid', 'false');
	await expect(page.locator(description)).toContainText(/cannot drop here/i);
	await expect(page.locator(description)).toContainText(/release.*cancel/i);
	await page.mouse.up();
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
	await expect(page.locator('.drag-preview')).toHaveCount(0);
	await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText(
		/move cancelled/i,
	);
	await expect(top.getByRole('button', basicItem)).toHaveCount(1);
	await expect(left.locator('.renderer')).toHaveCount(3);
	await expect(left.getByRole('button', basicItem)).toHaveCount(0);
	await expect(page.locator('.floater')).toHaveCount(0);
});

for (const kind of ['bar', 'item'] as const) {
	test(`keyboard ${kind} drag provides a live release description and Escape restores focus and layout`, async ({
		page,
	}) => {
		const top = page.locator(topDock);
		const handle = top.getByRole('button', kind === 'bar' ? wholeBar : basicItem);
		await handle.focus();
		await page.keyboard.press('Space', { delay: 50 });
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
		await expect(page.locator(description)).toContainText(/release to|cannot drop here/i);
		await page.keyboard.press('ArrowRight');
		await expect(page.locator(description)).toContainText(/release to|cannot drop here/i);
		await expect(page.locator('.drag-preview')).not.toHaveAttribute('aria-hidden', 'true');
		await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText(
			/release to|cannot drop here/i,
		);
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
		await expect(page.locator('.drag-preview')).toHaveCount(0);
		await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText(
			/move cancelled/i,
		);
		await expect(handle).toBeFocused();
		await expect(top.getByRole('button', wholeBar)).toHaveCount(1);
		await expect(top.getByRole('button', basicItem)).toHaveCount(1);
		await expect(page.locator(rightDock).getByRole('button', wholeBar)).toHaveCount(0);
		await expect(page.locator('.floater')).toHaveCount(0);
	});
}
