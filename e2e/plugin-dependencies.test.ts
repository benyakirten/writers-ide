import { expect, test, type Page } from '@playwright/test';

function article(page: Page, name: string) {
	return page
		.getByRole('article')
		.filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function enable(page: Page, name: string) {
	const plugin = article(page, name);
	await plugin.getByRole('button', { name: `Enable ${name}`, exact: true }).click();
	await expect(plugin.getByRole('status')).toHaveText('Enabled');
}

const revoked = 'Plugin API revoked: example.provider/example.messages';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Plugin manager', exact: true })).toBeVisible();
});

test('dependency activation, cascade consent, cleanup and fresh versus revoked handles', async ({
	page,
}) => {
	const provider = article(page, 'Example provider');
	const consumer = article(page, 'Required consumer');
	const optional = article(page, 'Optional consumer');
	await expect(provider.getByRole('status')).toHaveText('Disabled');
	await expect(
		provider.getByRole('listitem').filter({ hasText: 'example.messages v1' }),
	).toHaveText('example.messages v1 — Inactive');
	await expect(consumer.getByRole('listitem').filter({ hasText: 'Required:' })).toHaveText(
		'Required: example.provider / example.messages v1 — inactive',
	);

	await enable(page, 'Optional consumer');
	await expect(page.getByTestId('optional-events')).toHaveText('null');
	await expect(provider.getByRole('status')).toHaveText('Disabled');
	await enable(page, 'Required consumer');
	await expect(provider.getByRole('status')).toHaveText('Enabled');
	await expect(
		provider.getByRole('listitem').filter({ hasText: 'example.messages v1' }),
	).toHaveText('example.messages v1 — Available');
	await expect(consumer.getByRole('listitem').filter({ hasText: 'Required:' })).toHaveText(
		'Required: example.provider / example.messages v1 — available',
	);
	await expect(optional.getByRole('listitem').filter({ hasText: 'Optional:' })).toHaveText(
		'Optional: example.provider / example.messages v1 — available',
	);
	await expect(consumer.getByRole('listitem').filter({ hasText: 'command:' })).toHaveText(
		'command: example.consumer.read',
	);
	await expect(page.getByTestId('cached-get')).toHaveText('true');
	await expect(page.getByTestId('optional-events')).toHaveText(
		'null | available:example.optional@1',
	);
	await page.getByRole('button', { name: 'Run contributed command', exact: true }).click();
	await expect(page.getByTestId('call-result')).toHaveText('true: example.consumer@1');
	await page.getByRole('button', { name: 'Call current optional handle', exact: true }).click();
	await expect(page.getByTestId('call-result')).toHaveText('example.optional@1');

	const disable = provider.getByRole('button', { name: 'Disable Example provider', exact: true });
	const confirmation = page.getByRole('group', {
		name: 'Confirm dependent plugin disable',
		exact: true,
	});
	await disable.click();
	await expect(confirmation.getByRole('listitem')).toHaveText([
		'Required consumer (example.consumer)',
		'Example provider (example.provider)',
	]);
	await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(confirmation).toHaveCount(0);
	await expect.soft(disable).toBeFocused();
	await expect(provider.getByRole('status')).toHaveText('Enabled');
	await expect(consumer.getByRole('status')).toHaveText('Enabled');
	await expect(page.getByTestId('cleanup')).toBeEmpty();

	await disable.click();
	await confirmation.getByRole('button', { name: 'Confirm disable', exact: true }).click();
	await expect(confirmation).toHaveCount(0);
	await expect(consumer.getByRole('status')).toHaveText('Disabled');
	await expect(provider.getByRole('status')).toHaveText('Disabled');
	await expect(optional.getByRole('status')).toHaveText('Enabled');
	await expect(page.getByTestId('cleanup')).toHaveText('example.consumer | example.provider');
	await expect(page.getByTestId('connections')).toHaveText(
		'example.consumer:aborted=true | example.optional:aborted=true',
	);
	await expect(page.getByTestId('optional-events')).toHaveText(
		'null | available:example.optional@1 | null',
	);
	await expect(
		consumer.getByRole('listitem').filter({ hasText: 'No active contributions.' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Run contributed command', exact: true }).click();
	await expect(page.getByTestId('call-result')).toHaveText('No command');
	for (const endpoint of ['consumer', 'optional']) {
		await page.getByRole('button', { name: `Call stale ${endpoint} handle`, exact: true }).click();
		await expect(page.getByTestId('call-result')).toHaveText(revoked);
	}
	await page.getByRole('button', { name: 'Call current optional handle', exact: true }).click();
	await expect(page.getByTestId('call-result')).toHaveText('No handle');
	const callsBeforeRetry = await page.getByTestId('calls').textContent();

	await enable(page, 'Required consumer');
	await expect(page.getByTestId('fresh-consumer')).toHaveText('true');
	await expect(page.getByTestId('fresh-optional')).toHaveText('true');
	await expect(page.getByTestId('optional-events')).toHaveText(
		'null | available:example.optional@1 | null | available:example.optional@2',
	);
	for (const endpoint of ['consumer', 'optional']) {
		await page
			.getByRole('button', { name: `Call current ${endpoint} handle`, exact: true })
			.click();
		await expect(page.getByTestId('call-result')).toHaveText(`example.${endpoint}@2`);
		const callsBeforeStale = await page.getByTestId('calls').textContent();
		await page.getByRole('button', { name: `Call stale ${endpoint} handle`, exact: true }).click();
		await expect(page.getByTestId('call-result')).toHaveText(revoked);
		await expect(page.getByTestId('calls')).toHaveText(callsBeforeStale ?? '');
	}
	await expect(page.getByTestId('calls')).not.toHaveText(callsBeforeRetry ?? '');
});

test('host-required dependent blocks cascade before and after confirmation opens', async ({
	page,
}) => {
	await enable(page, 'Required consumer');
	const provider = article(page, 'Example provider');
	const consumer = article(page, 'Required consumer');
	const protect = page.getByRole('checkbox', { name: 'Protect required consumer', exact: true });
	await protect.check();
	await expect(
		consumer.getByRole('button', { name: 'Disable Required consumer', exact: true }),
	).toBeDisabled();
	await provider.getByRole('button', { name: 'Disable Example provider', exact: true }).click();
	await expect(provider.getByRole('alert')).toContainText(
		'This would disable a plugin required by the host.',
	);
	await expect(
		page.getByRole('group', { name: 'Confirm dependent plugin disable', exact: true }),
	).toHaveCount(0);
	await expect(provider.getByRole('status')).toHaveText('Enabled');
	await expect(consumer.getByRole('status')).toHaveText('Enabled');
	await expect(page.getByTestId('cleanup')).toBeEmpty();

	await protect.uncheck();
	await provider.getByRole('button', { name: 'Disable Example provider', exact: true }).click();
	const confirmation = page.getByRole('group', {
		name: 'Confirm dependent plugin disable',
		exact: true,
	});
	await expect(confirmation).toBeVisible();
	await protect.check();
	await expect(confirmation.getByRole('alert')).toContainText(
		'This would disable a plugin required by the host.',
	);
	await expect(
		confirmation.getByRole('button', { name: 'Confirm disable', exact: true }),
	).toBeDisabled();
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(provider.getByRole('status')).toHaveText('Enabled');
	await expect(consumer.getByRole('status')).toHaveText('Enabled');
	await expect(page.getByTestId('cleanup')).toBeEmpty();
});

for (const { name, providerId, major, status } of [
	{ name: 'Missing dependency', providerId: 'example.absent', major: 1, status: 'missing' },
	{
		name: 'Incompatible dependency',
		providerId: 'example.provider',
		major: 2,
		status: 'incompatible',
	},
]) {
	test(`${status} dependency is reported without activating plugins`, async ({ page }) => {
		const plugin = article(page, name);
		await expect(plugin.getByRole('listitem').filter({ hasText: 'Required:' })).toHaveText(
			`Required: ${providerId} / example.messages v${major} — ${status}`,
		);
		await plugin.getByRole('button', { name: `Enable ${name}`, exact: true }).click();
		await expect(plugin.getByRole('status')).toHaveText('Failed');
		await expect(plugin.getByRole('alert')).toContainText('Dependency error:');
		await expect(plugin.getByRole('alert')).toContainText(
			`${providerId}/example.messages@${major} is ${status}`,
		);
		await expect(
			plugin.getByRole('button', { name: `Retry enabling ${name}`, exact: true }),
		).toBeEnabled();
		await expect(article(page, 'Example provider').getByRole('status')).toHaveText('Disabled');
		await expect(page.getByTestId('calls')).toBeEmpty();
	});
}
