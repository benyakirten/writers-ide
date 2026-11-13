import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures/smoke';

const topDock = '[data-dock="WINDOW_BLOCK_START"]';
const rightDock = '[data-dock="INLINE_END"]';
const leftDock = '[data-dock="INLINE_START"]';
const wholeBar = { name: 'Drag toolbar', exact: true };
const basicItem = { name: 'Drag Basic Menu', exact: true };

async function bounds(locator: Locator) {
	await expect(locator).toBeVisible();
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	return box!;
}

async function moveToCenter(page: Page, locator: Locator) {
	const box = await bounds(locator);
	const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(point.x, point.y, { steps: 20 });
	return point;
}

async function startDrag(page: Page, handle: Locator) {
	// Raw coordinate input needs the handle's visible box, not a clipped scroll descendant.
	await handle.scrollIntoViewIfNeeded();
	const point = await moveToCenter(page, handle);
	await page.mouse.down();
	await page.mouse.move(point.x + 8, point.y + 8, { steps: 4 });
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(1);
}

async function cancelDrag(page: Page) {
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('[data-dock-dragging="true"]')).toHaveCount(0);
}

async function appearance(target: Locator) {
	return target.evaluate((element) =>
		[element, ...element.querySelectorAll('.dock-hit')].map((node) => {
			const style = getComputedStyle(node);
			return {
				background: style.backgroundColor,
				border: style.borderColor,
				outline: style.outline,
				shadow: style.boxShadow,
				opacity: style.opacity,
			};
		}),
	);
}

async function expectStableBounds(locator: Locator, before: Awaited<ReturnType<typeof bounds>>) {
	await expect
		.poll(async () => {
			const after = await bounds(locator);
			return Math.max(
				...(['x', 'y', 'width', 'height'] as const).map((key) =>
					Math.abs(after[key] - before[key]),
				),
			);
		})
		.toBeLessThanOrEqual(0.5);
}

test.beforeEach(async ({ app }) => {
	await expect(app.editor).toBeVisible();
});

test('dock gaps have generous baseline hit areas before dragging', async ({ page }) => {
	for (const dock of [topDock, rightDock, leftDock]) {
		const gaps = page.locator(dock).locator('.dock-gap[data-dock-target]');
		expect(await gaps.count()).toBeGreaterThan(0);
		for (const gap of await gaps.all()) {
			const slot = await bounds(gap);
			const hit = await bounds(gap.locator('.dock-hit'));
			const axis = dock === topDock ? 'height' : 'width';
			expect(slot[axis]).toBeGreaterThanOrEqual(24);
			expect(hit[axis]).toBeGreaterThanOrEqual(24);
		}
	}
});

test('eligible destinations remain visibly active remotely and gain a near cue', async ({
	page,
}) => {
	const remote = page.locator(leftDock).locator('.dock-gap[data-dock-target]');
	const destination = page.locator(rightDock).locator('.dock-gap[data-dock-target]');
	const idleAppearance = await appearance(remote);

	await startDrag(page, page.locator(topDock).getByRole('button', wholeBar));
	await moveToCenter(page, page.locator('main.main'));
	for (const target of [remote, destination]) {
		await expect(target).toBeVisible();
		await expect(target).toHaveAttribute('data-dock-active', 'true');
		await expect(target).not.toHaveAttribute('data-dock-near', 'true');
	}
	await expect.poll(() => appearance(remote)).not.toEqual(idleAppearance);

	await moveToCenter(page, destination);
	await expect(destination).toHaveAttribute('data-dock-near', 'true');
	await expect(remote).toHaveAttribute('data-dock-active', 'true');
	await expect(remote).not.toHaveAttribute('data-dock-near', 'true');

	await moveToCenter(page, page.locator('main.main'));
	await expect(destination).not.toHaveAttribute('data-dock-near', 'true');
	await expect(destination).toHaveAttribute('data-dock-active', 'true');
	await cancelDrag(page);
});

test('proximity grows the actual hit area without moving the slot or editor', async ({
	page,
	app,
}) => {
	const slot = page.locator(rightDock).locator('.dock-gap[data-dock-target]');
	const hit = slot.locator('.dock-hit');
	await startDrag(page, page.locator(topDock).getByRole('button', wholeBar));
	await moveToCenter(page, page.locator('main.main'));
	await expect(slot).not.toHaveAttribute('data-dock-near', 'true');
	const slotBefore = await bounds(slot);
	const editorBefore = await bounds(app.viewport);
	const hitBefore = await bounds(hit);

	// Approach from outside the baseline hit area, but well inside the proximity radius.
	await page.mouse.move(slotBefore.x - 24, slotBefore.y + slotBefore.height / 2, { steps: 20 });
	await expect(slot).toHaveAttribute('data-dock-near', 'true');
	await expect.poll(async () => (await bounds(hit)).width).toBeGreaterThan(hitBefore.width + 1);
	const expanded = await bounds(hit);
	expect(expanded.x).toBeLessThan(hitBefore.x);
	await expectStableBounds(slot, slotBefore);
	await expectStableBounds(app.viewport, editorBefore);

	// The newly exposed part must belong to the real droppable, not just decoration.
	await page.mouse.move((expanded.x + hitBefore.x) / 2, expanded.y + expanded.height / 2);
	await expect(slot).toHaveAttribute('data-dock-valid', 'true');
	await expectStableBounds(slot, slotBefore);
	await expectStableBounds(app.viewport, editorBefore);
	await cancelDrag(page);
});

test('Escape removes active and near cues and restores hit geometry', async ({ page }) => {
	const target = page.locator(rightDock).locator('.dock-gap[data-dock-target]');
	const hitBefore = await bounds(target.locator('.dock-hit'));
	const idleAppearance = await appearance(target);
	await startDrag(page, page.locator(topDock).getByRole('button', basicItem));
	await moveToCenter(page, target);
	await expect(target).toHaveAttribute('data-dock-active', 'true');
	await expect(target).toHaveAttribute('data-dock-near', 'true');

	await cancelDrag(page);
	await expect(page.locator('[data-dock-active="true"]')).toHaveCount(0);
	await expect(page.locator('[data-dock-near="true"]')).toHaveCount(0);
	await expect(page.locator('.drag-preview')).toHaveCount(0);
	await expectStableBounds(target.locator('.dock-hit'), hitBefore);
	await expect.poll(() => appearance(target)).toEqual(idleAppearance);
	await expect(page.locator(topDock).getByRole('button', basicItem)).toBeVisible();
	await expect(page.locator(rightDock).getByRole('button', wholeBar)).toHaveCount(0);
});

test('pointer preview identifies the source and stays compact beside the pointer', async ({
	page,
}) => {
	for (const kind of ['item', 'toolbar'] as const) {
		await startDrag(
			page,
			page.locator(topDock).getByRole('button', kind === 'item' ? basicItem : wholeBar),
		);
		const preview = page.locator('.drag-preview');
		await expect(preview).toBeVisible();
		if (kind === 'item') {
			await expect(preview).toContainText('Basic Menu');
		}
		await expect(preview).toContainText(new RegExp(`move\\s+${kind}`, 'i'));
		await expect(preview).toContainText(/esc.*cancel/i);

		const workbench = await bounds(page.locator('main.main'));
		for (const fraction of [0.35, 0.65]) {
			const pointer = {
				x: workbench.x + workbench.width * fraction,
				y: workbench.y + workbench.height / 2,
			};
			await page.mouse.move(pointer.x, pointer.y, { steps: 20 });
			await expect
				.poll(async () => {
					const box = await bounds(preview);
					return Math.hypot(
						Math.max(box.x - pointer.x, pointer.x - box.x - box.width, 0),
						Math.max(box.y - pointer.y, pointer.y - box.y - box.height, 0),
					);
				})
				.toBeLessThanOrEqual(64);
			const box = await bounds(preview);
			expect(box.width).toBeLessThanOrEqual(400);
			expect(box.height).toBeLessThanOrEqual(160);
			const viewport = page.viewportSize()!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
			expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
			await expect(preview).toHaveCSS('opacity', '1');
			await expect(preview).not.toHaveCSS('box-shadow', 'none');
		}
		await cancelDrag(page);
		await expect
			.poll(() =>
				page.locator(`${topDock} .horizontal-slice`).evaluate((element) => element.scrollTop),
			)
			.toBe(0);
	}
});
