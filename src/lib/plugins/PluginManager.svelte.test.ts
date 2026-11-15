import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { BundledPlugin, PluginContext, PluginManagementService } from '@writers-ide/plugins';
import PluginManager from './PluginManager.svelte';
import { PluginHost } from './plugin-host';

const mounted: ReturnType<typeof mount>[] = [];

afterEach(async () => {
	for (const component of mounted.splice(0)) {
		await unmount(component);
	}
	document.body.replaceChildren();
});

function setup(activate: BundledPlugin<string>['activate'] = () => {}) {
	const register = () => () => {};
	const host = new PluginHost<string>({
		registries: { toolbar: { register }, view: { register }, command: { register } },
	});
	host.register({
		manifest: {
			id: 'bundled.tools',
			name: 'Writing tools',
			description: 'Tools for your writing.',
			version: '1.2.3',
			apiVersion: 1,
			capabilities: ['contributions.toolbar', 'contributions.view', 'contributions.command'],
		},
		activate,
	});
	return host;
}

function render(management: PluginManagementService, requiredPluginIds?: readonly string[]) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({ management, requiredPluginIds });
	const component = mount(PluginManager, { target, props });
	mounted.push(component);
	flushSync();
	return { target, component, props };
}

function button(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('button')!;
}

function click(target: HTMLElement) {
	button(target).click();
	flushSync();
}

describe('host-owned PluginManager panel', () => {
	it('renders metadata and capability explanations, enables and disables without a dialog', () => {
		const host = setup((context) => {
			context.contributions.command({ id: 'bundled.tools/run', name: 'Run', execute: () => true });
		});
		const { target } = render(host);
		expect(target.querySelector('dialog, [role="dialog"]')).toBeNull();
		expect(target.querySelector('h2')?.textContent).toBe('Plugin manager');
		for (const text of [
			'Writing tools',
			'Tools for your writing.',
			'bundled.tools',
			'1.2.3',
			'trusted bundled',
			'in-process',
			'not sandboxed',
			'not its saved data',
		]) {
			expect(target.textContent).toContain(text);
		}
		for (const capability of host.list()[0].manifest.capabilities) {
			expect(target.textContent).toContain(capability);
		}
		expect(target.textContent).toContain('Provide toolbar controls in the workbench.');
		expect(target.textContent).toContain('Provide a central workspace view.');
		expect(target.textContent).toContain('Provide actions the host can invoke.');
		expect(button(target).type).toBe('button');
		button(target).focus();
		expect(document.activeElement).toBe(button(target));
		expect(button(target).textContent).toContain('Enable');
		click(target);
		expect(host.list()[0].status).toBe('active');
		expect(target.textContent).toContain('bundled.tools/run');
		expect(button(target).textContent).toContain('Disable');
		click(target);
		expect(host.list()[0].status).toBe('disabled');
		expect(target.textContent).toContain('No active contributions.');
	});

	it('shows actionable activation errors and retries successfully', () => {
		let fail = true;
		const host = setup(() => {
			if (fail) {
				throw new Error('Tools could not start');
			}
		});
		const { target } = render(host);
		click(target);
		expect(target.querySelector('[role="status"]')?.textContent).toBe('Failed');
		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			'Activation error: Tools could not start',
		);
		expect(target.textContent).toContain('application maintainer');
		expect(button(target).textContent).toContain('Retry enabling');
		fail = false;
		click(target);
		expect(target.querySelector('[role="status"]')?.textContent).toBe('Enabled');
		expect(target.querySelector('[role="alert"]')).toBeNull();
	});

	it('reacts to external registration, status, contributions, and cleanup errors', () => {
		let context!: PluginContext<string>;
		const host = setup((value) => {
			context = value;
		});
		const { target } = render(host);
		host.activate('bundled.tools');
		flushSync();
		expect(button(target).textContent).toContain('Disable');
		const release = context.contributions.view({
			id: 'tools/view',
			name: 'View',
			presentation: 'trusted',
		});
		flushSync();
		expect(target.textContent).toContain('tools/view');
		release();
		context.own(() => {
			throw new Error('Could not release resource');
		})();
		flushSync();
		expect(target.textContent).not.toContain('tools/view');
		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			'Cleanup error: Could not release resource',
		);
		host.deactivate('bundled.tools');
		flushSync();
		expect(target.querySelector('[role="status"]')?.textContent).toBe('Failed');
		host.register({
			manifest: { ...host.list()[0].manifest, id: 'second', name: 'Second plugin' },
			activate() {},
		});
		flushSync();
		expect(target.querySelectorAll('article')).toHaveLength(2);
		expect(target.textContent).toContain('Second plugin');
	});

	it('keeps required plugins enabled but allows enabling a disabled required plugin', () => {
		const host = setup();
		const { target } = render(host, ['bundled.tools']);
		expect(button(target).disabled).toBe(false);
		click(target);
		expect(button(target).disabled).toBe(true);
		expect(target.textContent).toContain('Required by the host');
		click(target);
		expect(host.list()[0].status).toBe('active');
	});

	it('disables busy transitions and catches thrown management calls', () => {
		const host = setup();
		let emit!: Parameters<PluginManagementService['subscribe']>[0];
		const management: PluginManagementService = {
			list: () => host.list(),
			subscribe(listener) {
				emit = listener;
				listener(host.list());
				return () => {};
			},
			activate: vi.fn(() => {
				throw new Error('Host is busy');
			}),
			deactivate: (id) => host.deactivate(id),
		};
		const { target } = render(management);
		for (const status of ['activating', 'deactivating'] as const) {
			emit([{ ...host.list()[0], status }]);
			flushSync();
			expect(button(target).disabled).toBe(true);
			click(target);
		}
		expect(management.activate).not.toHaveBeenCalled();
		emit(host.list());
		flushSync();
		click(target);
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('Host is busy');
		expect(button(target).disabled).toBe(false);
	});

	it('tears down subscriptions on service replacement and unmount', async () => {
		const host = setup();
		const unsubscribe = vi.fn();
		const subscribe = vi.fn<PluginManagementService['subscribe']>((listener) => {
			const release = host.subscribe(listener);
			return () => {
				release();
				unsubscribe();
			};
		});
		const service: PluginManagementService = {
			list: () => host.list(),
			subscribe,
			activate: (id) => host.activate(id),
			deactivate: (id) => host.deactivate(id),
		};
		const { component, props } = render(service);
		expect(subscribe).toHaveBeenCalledOnce();
		props.management = { ...service };
		flushSync();
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(subscribe).toHaveBeenCalledTimes(2);
		await unmount(component);
		mounted.splice(mounted.indexOf(component), 1);
		expect(unsubscribe).toHaveBeenCalledTimes(2);
	});

	it('reports subscription setup failures without crashing the panel', () => {
		const host = setup();
		const { target } = render({
			list: () => host.list(),
			subscribe() {
				throw new Error('Manager unavailable');
			},
			activate: (id) => host.activate(id),
			deactivate: (id) => host.deactivate(id),
		});
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('Manager unavailable');
	});
});
