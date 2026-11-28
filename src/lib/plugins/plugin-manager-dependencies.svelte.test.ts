import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { definePluginApi, type PluginManagementService } from '@writers-ide/plugins';
import PluginManager from './PluginManager.svelte';
import { PluginHost } from './plugin-host';

const mounted: ReturnType<typeof mount>[] = [];
const api = definePluginApi<{ read(): string }>({ id: 'example.read', major: 1 });

afterEach(async () => {
	for (const component of mounted.splice(0)) {
		await unmount(component);
	}
	document.body.replaceChildren();
});

function fixture() {
	const register = () => () => {};
	const host = new PluginHost<string>({
		registries: { toolbar: { register }, view: { register }, command: { register } },
	});
	const cleanup: string[] = [];
	const manifest = (id: string) => ({
		id,
		name: id,
		description: id,
		version: '1.0.0',
		apiVersion: 1 as const,
		capabilities: [],
	});
	host.register({
		manifest: { ...manifest('provider'), provides: [api] },
		activate(context) {
			context.apis.provide(api, () => ({ read: () => 'ok' }));
			return () => {
				cleanup.push('provider');
			};
		},
	});
	function consumer(id: string, optional = false) {
		host.register({
			manifest: {
				...manifest(id),
				dependencies: [{ provider: 'provider', api: api.id, major: api.major, optional }],
			},
			activate() {
				return () => {
					cleanup.push(id);
				};
			},
		});
	}
	consumer('consumer');
	consumer('optional', true);
	host.activate('consumer');
	host.activate('optional');
	const target = document.createElement('div');
	document.body.append(target);
	const props = $state<{ management: PluginManagementService; requiredPluginIds: string[] }>({
		management: host,
		requiredPluginIds: [],
	});
	mounted.push(mount(PluginManager, { target, props }));
	flushSync();
	const article = (id: string) =>
		[...target.querySelectorAll('article')].find(
			(article) => article.querySelector('h3')?.textContent === id,
		)!;
	const button = (name: string, root: ParentNode = target) =>
		[...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)!;
	return { host, target, props, cleanup, consumer, article, button };
}

function click(button: HTMLButtonElement) {
	button.click();
	flushSync();
}

describe('dependency management UI', () => {
	it('shows API metadata and asks before a dependent-first cascade, with cancellation focus', async () => {
		const f = fixture();
		expect(f.article('provider').textContent).toContain('example.read');
		expect(f.article('consumer').textContent).toContain('Required:');
		expect(f.article('optional').textContent).toContain('Optional:');
		const disable = f.button('Disable provider');
		click(disable);
		expect(f.host.get('consumer')!.status).toBe('active');
		expect(f.target.querySelector('[role="group"]')?.textContent).toContain('consumer');
		await tick();
		expect(document.activeElement).toBe(f.button('Cancel'));
		click(f.button('Cancel'));
		await tick();
		expect(document.activeElement).toBe(disable);
		expect(f.cleanup).toEqual([]);
		click(disable);
		click(f.button('Confirm disable'));
		expect(f.cleanup).toEqual(['consumer', 'provider']);
		expect(f.host.get('optional')!.status).toBe('active');
		expect(f.target.querySelector('[role="group"]')).toBeNull();
	});

	it('requires renewed consent when the cascade grows while confirmation is open', () => {
		const f = fixture();
		click(f.button('Disable provider'));
		f.consumer('new-dependent');
		f.host.activate('new-dependent');
		flushSync();
		click(f.button('Confirm disable'));
		expect(f.target.textContent).toContain(
			'Dependencies changed. Review the updated list and confirm again.',
		);
		expect(f.target.querySelector('[role="group"]')?.textContent).toContain('new-dependent');
		expect(f.cleanup).toEqual([]);
		click(f.button('Confirm disable'));
		expect(f.cleanup).toEqual(['consumer', 'new-dependent', 'provider']);
	});

	it('protects host-required dependents before and during confirmation', () => {
		const f = fixture();
		f.props.requiredPluginIds = ['consumer'];
		flushSync();
		click(f.button('Disable provider'));
		expect(f.target.querySelector('[role="group"]')).toBeNull();
		expect(f.article('provider').textContent).toContain(
			'This would disable a plugin required by the host.',
		);
		f.props.requiredPluginIds = [];
		flushSync();
		click(f.button('Disable provider'));
		f.props.requiredPluginIds = ['consumer'];
		flushSync();
		expect(f.button('Confirm disable').disabled).toBe(true);
		click(f.button('Confirm disable'));
		expect(f.cleanup).toEqual([]);
	});

	it('discards a pending confirmation when the management service changes', () => {
		const f = fixture();
		click(f.button('Disable provider'));
		const deactivate = vi.spyOn(f.host, 'deactivate');
		f.props.management = {
			list: () => [],
			subscribe(listener) {
				listener([]);
				return () => {};
			},
			activate() {
				throw new Error('empty');
			},
			deactivate() {
				throw new Error('empty');
			},
			planDeactivation() {
				throw new Error('empty');
			},
		};
		flushSync();
		expect(f.target.querySelector('[role="group"]')).toBeNull();
		expect(deactivate).not.toHaveBeenCalled();
		expect(f.cleanup).toEqual([]);
	});

	it('shows dependency errors distinctly from cleanup errors', () => {
		const f = fixture();
		f.host.register({
			manifest: {
				id: 'missing',
				name: 'missing',
				description: 'missing',
				version: '1',
				apiVersion: 1,
				capabilities: [],
				dependencies: [{ provider: 'absent', api: api.id, major: 1 }],
			},
			activate() {},
		});
		flushSync();
		click(f.button('Enable missing'));
		expect(f.article('missing').textContent).toContain('Dependency error:');
		expect(f.article('missing').textContent).toContain('is missing');
	});
});
