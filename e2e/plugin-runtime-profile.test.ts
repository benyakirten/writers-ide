import { test, expect, type Page } from '@playwright/test';
const fixture = <T = unknown>(page: Page, code: string) =>
	page.evaluate(`(async () => { const f = window.profileFixture; ${code} })()`) as Promise<T>;
async function ready(page: Page) {
	await page.goto('/');
	await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}
test('separate artifacts share namespaces, Svelte context, styles, assets, commands and ProseMirror', async ({
	page,
}) => {
	await ready(page);
	const plugin = page.locator('.profile-plugin');
	await expect(plugin).toHaveAttribute('data-context', 'same-runtime-context');
	await expect(plugin).toHaveAttribute('data-tooltip', 'true');
	await expect(plugin).toHaveCSS('color', 'rgb(17, 83, 129)');
	await expect(page.getByRole('button', { name: 'Profile action' })).toHaveCSS(
		'position',
		'relative',
	);
	expect(
		await page
			.getByAltText('Profile emblem')
			.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 19),
	).toBe(true);
	await expect
		.poll(() => fixture(page, 'return f.events;'))
		.toEqual(
			expect.arrayContaining([
				'command:42',
				'pm-plugin:true:host',
				'pm-host:true:plugin',
				'activate-style:rgb(17, 83, 129)',
				'worker:{"status":"completed","value":42}',
			]),
		);
	const inventory = await fixture<Record<string, string[]>>(page, 'return f.inventory();');
	expect(Object.keys(inventory)).toHaveLength(27);
	for (const name of ['PluginHost', 'CommandComponentHost', 'createApplicationComponentHost']) {
		expect(inventory['@writers-ide/plugins']).not.toContain(name);
	}
	expect(inventory).not.toHaveProperty('@writers-ide/tasks/worker');
	await page.getByRole('button', { name: 'Profile action' }).click();
	expect(await fixture(page, 'return f.events;')).toContain('click');
	await fixture(page, 'await f.stop();');
	await expect(plugin).toHaveCount(0);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
	expect(await fixture(page, 'try { f.retained(); return false; } catch { return true; }')).toBe(
		true,
	);
	expect(await fixture(page, 'return f.events;')).toEqual(
		expect.arrayContaining(['ui-destroy', 'cleanup:true']),
	);
	await fixture(page, 'await f.start();');
	await expect(plugin).toHaveCount(1);
});
test('portable SDK sample activates from its independent accepted snapshot', async ({
	page,
	request,
}) => {
	await page.goto('/#portable-sdk');
	await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
	const sample = page.locator('.portable-sdk');
	await expect(sample).toHaveAttribute('data-context', 'same-runtime-context');
	await expect(sample).toHaveCSS('color', 'rgb(17, 83, 129)');
	await expect(page.getByTestId('portable-card')).toHaveText('Portable SDK: 42');
	await expect
		.poll(() => fixture(page, 'return f.events;'))
		.toEqual(
			expect.arrayContaining([
				'portable:activate',
				'portable:locale:en',
				'portable:command:42',
				'portable:provider:consumer',
			]),
		);
	const original = await (await request.get('/accepted.json')).json();
	const accepted = await (await request.get('/sample-accepted.json')).json();
	expect(accepted.snapshot).not.toBe(original.snapshot);
	expect(accepted.profile).toBe(original.profile);
	expect(await fixture(page, 'return f.base;')).toContain(`/snapshots/${accepted.snapshot}/`);
	await page.getByRole('button', { name: 'Portable action' }).click();
	expect(await fixture(page, 'return f.events;')).toContain('portable:click');
	await fixture(page, 'await f.stop();');
	await expect(sample).toHaveCount(0);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
	expect(await fixture(page, 'return f.events;')).toEqual(
		expect.arrayContaining(['portable:ui-destroy', 'portable:cleanup:true']),
	);
	expect(await fixture(page, 'try { f.retained(); return false; } catch { return true; }')).toBe(
		true,
	);
	await fixture(page, 'await f.start();');
	await expect(sample).toHaveCount(1);
});
test('shared CSS owners survive one release and disappear after the final release', async ({
	page,
}) => {
	await ready(page);
	expect(
		await fixture(page, 'window.extraStyleOwner = await f.acquire(); return f.owners();'),
	).toEqual([2]);
	await fixture(page, 'await f.stop();');
	expect(await fixture(page, 'return f.owners();')).toEqual([1]);
	await expect(page.locator('.style-probe')).toHaveCSS('color', 'rgb(17, 83, 129)');
	await fixture(page, 'window.extraStyleOwner();');
	await expect(page.locator('link[data-package-style]')).toHaveCount(0);
});
test('unsupported profile is blocked before package import', async ({ page }) => {
	const imports: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/snapshots/')) {
			imports.push(request.url());
		}
	});
	await page.goto('/#unsupported');
	await expect(page.locator('body')).toHaveAttribute('data-error', /Unsupported runtime profile/);
	expect(await page.evaluate('window.pluginImports ?? 0')).toBe(0);
	expect(imports).toEqual([]);
});
test('activation rollback and renderer boundaries allow clean reactivation', async ({ page }) => {
	await page.goto('/#activation-failure');
	await expect(page.locator('body')).toHaveAttribute('data-error', /Fixture activation failure/);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
	await expect(page.locator('.profile-plugin')).toHaveCount(0);
	expect(await fixture(page, 'return f.events;')).toContain('cleanup:true');
	await page.evaluate('location.hash = "renderer-failure"');
	await fixture(page, 'await f.start();');
	await expect(page.getByRole('alert')).toContainText('could not be displayed');
	await fixture(page, 'await f.stop();');
	await page.evaluate('location.hash = ""');
	await fixture(page, 'await f.start();');
	await expect(page.locator('.profile-plugin')).toHaveCount(1);
});
test('dock CSS is bundled into declared package styles, not the import map', async ({
	page,
	request,
}) => {
	await ready(page);
	await expect(page.getByTestId('dock-color')).toHaveCSS('background-color', 'rgb(37, 99, 235)');
	const accepted = (await (await request.get('/accepted.json')).json()) as {
		snapshot: string;
		styles: string[];
	};
	const manifest = await (
		await request.get(`/snapshots/${accepted.snapshot}/manifest.toml`)
	).text();
	let styles = '';
	for (const name of accepted.styles) {
		expect(manifest).toContain(JSON.stringify(name));
		styles += await (await request.get(`/snapshots/${accepted.snapshot}/${name}`)).text();
	}
	expect(styles).toContain('data-dock-color');
	const imports = await page.evaluate(
		() => JSON.parse(document.querySelector('script[type="importmap"]')!.textContent!).imports,
	);
	expect(imports).not.toHaveProperty('@writers-ide/layout/dock-colors.css');
	expect(Object.keys(imports)).toHaveLength(27);
});
test('preliminary browser verification rejects a tampered prefetch response', async ({ page }) => {
	await page.route('**/snapshots/**/entry.js', async (route) => {
		const response = await route.fetch();
		await route.fulfill({ response, body: `${await response.text()}\nwindow.tampered = true;` });
	});
	await page.goto('/');
	await expect(page.locator('body')).toHaveAttribute('data-error', /Integrity mismatch/);
	expect(await page.evaluate('window.pluginImports ?? 0')).toBe(0);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
});
test('frontend prefetch cannot prevent a compromised second import response', async ({ page }) => {
	let responses = 0;
	await page.route('**/snapshots/**/entry.js', async (route) => {
		responses++;
		const response = await route.fetch();
		// The first response passes prefetch verification. Native import makes
		// another request; a transport replacement is outside that check's guarantee.
		await route.fulfill({
			response,
			body: `${await response.text()}${responses === 2 ? '\nwindow.secondResponseExecuted = true;' : ''}`,
		});
	});
	await ready(page);
	expect(responses).toBe(2);
	expect(await page.evaluate('window.secondResponseExecuted')).toBe(true);
});
test('stop cancels delayed preparation without later activation or CSS owners', async ({
	page,
}) => {
	await ready(page);
	await fixture(page, 'await f.stop();');
	let delayed: import('@playwright/test').Route | undefined;
	await page.route('**/snapshots/**/entry.js', (route) => {
		delayed = route;
	});
	await fixture(
		page,
		'window.startResult = f.start().then(() => "unexpected", (error) => error.name);',
	);
	await expect.poll(() => Boolean(delayed)).toBe(true);
	await fixture(page, 'await f.stop();');
	expect(await fixture(page, 'return window.startResult;')).toBe('AbortError');
	await delayed!.abort();
	await expect(page.locator('.profile-plugin')).toHaveCount(0);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
});
test('replacement cancels delayed and concurrent starts without leaking owners', async ({
	page,
}) => {
	await ready(page);
	await fixture(page, 'await f.stop();');
	let delayed: import('@playwright/test').Route | undefined;
	await page.route('**/snapshots/**/entry.js', async (route) => {
		if (!delayed) {
			delayed = route;
		} else {
			await route.continue();
		}
	});
	await fixture(
		page,
		'window.oldStart = f.start().then(() => "unexpected", (error) => error.name);',
	);
	await expect.poll(() => Boolean(delayed)).toBe(true);
	await fixture(page, 'await f.start();');
	expect(await fixture(page, 'return window.oldStart;')).toBe('AbortError');
	await delayed!.abort();
	await expect(page.locator('.profile-plugin')).toHaveCount(1);
	expect(await fixture(page, 'return f.owners();')).toEqual([1]);
	expect(
		await fixture(
			page,
			'return Promise.all([f.start().then(() => "first", (error) => error.name), f.start().then(() => "second", (error) => error.name)]);',
		),
	).toEqual(['AbortError', 'second']);
	await fixture(page, 'await f.stop();');
	await expect(page.locator('.profile-plugin')).toHaveCount(0);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
});
for (const replacement of [false, true]) {
	test(`stale native import cannot activate after ${replacement ? 'replacement' : 'stop'}`, async ({
		page,
	}) => {
		await page.goto('/#unsupported');
		await expect(page.locator('body')).toHaveAttribute('data-error', /Unsupported runtime profile/);
		let delayed: import('@playwright/test').Route | undefined;
		await page.route('**/snapshots/**/entry.js', async (route) => {
			if (route.request().resourceType() === 'script') {
				delayed = route;
			} else {
				await route.continue();
			}
		});
		await fixture(
			page,
			'window.oldStart = f.start().then(() => "unexpected", (error) => error.name);',
		);
		await expect.poll(() => Boolean(delayed)).toBe(true);
		expect(await fixture(page, 'return f.owners();')).toEqual([1]);
		if (replacement) {
			await fixture(
				page,
				'window.newStart = f.start().then(() => "started", (error) => error.name);',
			);
		} else {
			await fixture(page, 'await f.stop();');
			expect(await fixture(page, 'return f.owners();')).toEqual([]);
		}
		await delayed!.continue();
		expect(await fixture(page, 'return window.oldStart;')).toBe('AbortError');
		if (replacement) {
			expect(await fixture(page, 'return window.newStart;')).toBe('started');
			await expect(page.locator('.profile-plugin')).toHaveCount(1);
			expect(await fixture(page, 'return f.owners();')).toEqual([1]);
		} else {
			expect(await fixture(page, 'return f.events;')).toEqual([]);
		}
		await fixture(page, 'await f.stop();');
		await expect(page.locator('.profile-plugin')).toHaveCount(0);
		expect(await fixture(page, 'return f.owners();')).toEqual([]);
	});
}
test('verified Blob workers clean up completion, cancellation and startup failures', async ({
	page,
}) => {
	await ready(page);
	await expect.poll(() => fixture(page, 'return f.stats.terminated;')).toBe(1);
	for (const mode of ['cancel', 'constructor-failure', 'startup-failure']) {
		const result = await fixture<{ status: string }>(
			page,
			`return f.worker(f.base + '${mode === 'startup-failure' ? 'broken-worker.js' : 'worker.js'}', 5, '${mode}');`,
		);
		expect(result.status).toBe(mode === 'cancel' ? 'cancelled' : 'failed');
	}
	expect(await fixture(page, 'return f.stats;')).toEqual({ created: 3, terminated: 3, revoked: 4 });
	for (const url of [
		'https://example.com/worker.js',
		'file:///tmp/worker.js',
		'/snapshots/foreign/worker.js',
	]) {
		expect(
			await fixture(
				page,
				`try { await f.worker(${JSON.stringify(url)}, 1); return false; } catch (error) { return String(error); }`,
			),
		).toContain('Not an accepted snapshot URL');
	}
	await page.route('**/snapshots/**/worker.js', (route) =>
		route.fulfill({ body: 'throw new Error("tampered")', contentType: 'text/javascript' }),
	);
	expect(
		await fixture(
			page,
			'try { await f.worker(f.base + "worker.js", 1); return false; } catch (error) { return String(error); }',
		),
	).toContain('Integrity mismatch');
	expect(await fixture(page, 'return f.stats;')).toEqual({ created: 3, terminated: 3, revoked: 4 });
});
test('in-flight stylesheet abort and load failure release their owners', async ({ page }) => {
	await ready(page);
	await fixture(page, 'await f.stop();');
	let stylesheetRoute: import('@playwright/test').Route | undefined;
	await page.route('**/snapshots/**/*.css', async (route) => {
		if (route.request().resourceType() === 'stylesheet') {
			stylesheetRoute = route;
		} else {
			await route.continue();
		}
	});
	await fixture(
		page,
		'window.styleAbort = new AbortController(); window.styleResult = f.acquire(window.styleAbort.signal).then(() => "unexpected", (error) => error.name);',
	);
	await expect.poll(() => Boolean(stylesheetRoute)).toBe(true);
	expect(await fixture(page, 'window.styleAbort.abort(); return window.styleResult;')).toBe(
		'AbortError',
	);
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
	await stylesheetRoute!.abort();
	await page.unroute('**/snapshots/**/*.css');
	await page.route('**/snapshots/**/*.css', async (route) => {
		if (route.request().resourceType() === 'stylesheet') {
			await route.abort();
		} else {
			await route.continue();
		}
	});
	expect(
		await fixture(
			page,
			'try { await f.acquire(); return false; } catch (error) { return String(error); }',
		),
	).toContain('Stylesheet failed');
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
});
test('abort during worker byte acquisition creates no Blob or worker', async ({ page }) => {
	await ready(page);
	await expect.poll(() => fixture(page, 'return f.stats.terminated;')).toBe(1);
	let workerRoute: import('@playwright/test').Route | undefined;
	await page.route('**/snapshots/**/worker.js', (route) => {
		workerRoute = route;
	});
	await fixture(
		page,
		'window.workerResult = f.workerWithAbort(f.base + "worker.js").then(() => "unexpected", (error) => error.name);',
	);
	await expect.poll(() => Boolean(workerRoute)).toBe(true);
	expect(await fixture(page, 'f.workerAbortController.abort(); return window.workerResult;')).toBe(
		'AbortError',
	);
	expect(await fixture(page, 'return f.stats;')).toEqual({ created: 1, terminated: 1, revoked: 1 });
	await workerRoute!.abort();
});
test('aborted preparation releases resources and unknown bare imports fail in browser', async ({
	page,
}) => {
	await ready(page);
	await fixture(page, 'await f.stop();');
	expect(
		await fixture(
			page,
			'try { await f.abortedPrepare(); return false; } catch (error) { return error.name; }',
		),
	).toBe('AbortError');
	expect(await fixture(page, 'return f.owners();')).toEqual([]);
	expect(
		await page.evaluate('window.fixtureImport("/unknown.js").then(() => false, () => true)'),
	).toBe(true);
	expect(await page.evaluate('window.unknownImported ?? false')).toBe(false);
});
