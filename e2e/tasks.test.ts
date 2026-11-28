import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Managed tasks browser fixture' })).toBeVisible();
});

test('bundled module worker transfers input and returns transferred output exactly once', async ({
	page,
}) => {
	const workerURLs: string[] = [];
	page.on('worker', (worker) => workerURLs.push(worker.url()));
	await page.getByRole('button', { name: 'Transfer worker', exact: true }).click();
	await expect(page.getByTestId('worker-status')).toHaveText('completed');
	await expect(page.getByTestId('source-bytes')).toHaveText('0');
	await expect(page.getByTestId('worker-result')).toHaveText(
		JSON.stringify({ status: 'completed', sum: 16, bytes: [8, 5, 3] }),
	);
	await expect(page.getByTestId('applied')).toHaveText('1');
	await expect(page.getByTestId('failures')).toHaveText('[]');
	expect(workerURLs).toHaveLength(1);
	expect(new URL(workerURLs[0]).pathname).toMatch(/^\/assets\/task\.worker-[\w-]+\.js$/);
});

test('cancellation after the real worker starts prevents result application', async ({ page }) => {
	await page.getByRole('button', { name: 'Cancel started worker' }).click();
	await expect(page.getByTestId('worker-ready')).toHaveText('true');
	await expect(page.getByTestId('worker-status')).toHaveText('cancelled');
	await expect(page.getByTestId('worker-result')).toHaveText(
		JSON.stringify({ status: 'cancelled', error: null }),
	);
	// Exceed the worker's 100 ms result delay, not merely the cancellation promise settlement.
	await page.waitForTimeout(250);
	await expect(page.getByTestId('applied')).toHaveText('0');
	await expect(page.getByTestId('worker-status')).toHaveText('cancelled');
	await expect(page.getByTestId('failures')).toHaveText('[]');
	await page.getByRole('button', { name: 'Transfer worker', exact: true }).click();
	await expect(page.getByTestId('worker-status')).toHaveText('completed');
	await expect(page.getByTestId('applied')).toHaveText('1');
});

test('worker exceptions become attributed failures without applying and a fresh worker recovers', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Fail worker' }).click();
	await expect(page.getByTestId('worker-status')).toHaveText('failed');
	await expect(page.getByTestId('worker-result')).toHaveText(
		JSON.stringify({ status: 'failed', error: 'Bundled worker failure' }),
	);
	await expect(page.getByTestId('applied')).toHaveText('0');
	await expect(page.getByTestId('failures')).toHaveText(
		JSON.stringify([
			{
				ownerId: 'fixture.a',
				key: 'worker',
				label: 'Bundled worker',
				message: 'RangeError: Bundled worker failure',
			},
		]),
	);
	await page.getByRole('button', { name: 'Transfer worker', exact: true }).click();
	await expect(page.getByTestId('worker-status')).toHaveText('completed');
	await expect(page.getByTestId('applied')).toHaveText('1');
});

test('same-key services share a real frame queue and owner abort leaves peer and host work alive', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Start shared work' }).click();
	await expect(page.getByTestId('a-status')).toHaveText('paused');
	await expect(page.getByTestId('b-status')).toHaveText('paused');
	await expect(page.getByTestId('a-total')).toHaveText('0');
	await expect(page.getByTestId('b-total')).toHaveText('0');
	await expect(page.getByTestId('queue-size')).toHaveText('3');
	await page.getByRole('button', { name: 'Abort owner A' }).click();
	await expect(page.getByTestId('a-status')).toHaveText('cancelled');
	await expect(page.getByTestId('b-status')).toHaveText('paused');
	await expect(page.getByTestId('queue-size')).toHaveText('2');
	await expect(page.getByTestId('raw-completed')).toHaveText('false');
	await page.getByRole('button', { name: 'Resume owner B' }).click();
	await expect(page.getByTestId('b-status')).toHaveText('completed');
	await expect(page.getByTestId('b-total')).toHaveText('6');
	await expect(page.getByTestId('a-total')).toHaveText('0');
	await expect(page.getByTestId('raw-completed')).toHaveText('true');
	await expect(page.getByTestId('queue-size')).toHaveText('0');
});
