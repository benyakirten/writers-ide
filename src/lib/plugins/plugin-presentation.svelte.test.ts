import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import FailingPluginPresentation from '$lib/testing/FailingPluginPresentation.svelte';
import { failures } from '$lib/testing/plugin-presentation-failures';
import PluginBoundaryHostFixture from '$lib/testing/PluginBoundaryHostFixture.svelte';
import { PluginHost } from './plugin-host';

const mounted = new Set<ReturnType<typeof mount>>();

afterEach(async () => {
	for (const component of mounted) {
		await unmount(component);
	}
	mounted.clear();
	document.body.replaceChildren();
});

function setup(failure: 'init' | 'effect') {
	const props = $state<{ presentation: SveltePresentation | null }>({ presentation: null });
	const unsubscribe = vi.fn();
	const subscribe = vi.fn(() => unsubscribe);
	const register = () => () => {};
	const host = new PluginHost<SveltePresentation>({
		formatting: { subscribe, execute: () => false },
		registries: {
			toolbar: { register },
			command: { register },
			view: {
				register(_owner, contribution) {
					props.presentation = contribution.presentation;
					return () => {
						props.presentation = null;
					};
				},
			},
		},
	});
	let fail = true;
	host.register({
		manifest: {
			id: 'test.boundary',
			name: 'Boundary test plugin',
			description: 'Exercises presentation failures.',
			version: '1.0.0',
			apiVersion: 1,
			capabilities: ['formatting.observe', 'contributions.view'],
		},
		activate(context) {
			if (fail) {
				failures.set(context.signal, failure);
			}
			context.contributions.view({
				id: 'test.boundary/view',
				name: 'Test view',
				presentation: { component: FailingPluginPresentation, context },
			});
		},
	});
	host.activate('test.boundary');
	const target = document.createElement('div');
	document.body.append(target);
	const component = mount(PluginBoundaryHostFixture, {
		target,
		props: {
			get presentation() {
				return props.presentation;
			},
			management: host,
		},
	});
	mounted.add(component);
	flushSync();
	return {
		target,
		component,
		props,
		host,
		subscribe,
		unsubscribe,
		recover() {
			fail = false;
			failures.delete(props.presentation!.context.signal);
		},
	};
}

function managerButton(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('article button')!;
}

describe('plugin presentation host boundary', () => {
	it.each(['init', 'effect'] as const)(
		'contains %s errors while host controls and manager disable/re-enable remain usable',
		async (failure) => {
			const f = setup(failure);
			const alert = f.target.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain('Open Plugins');
			expect(alert?.textContent).toContain('disable and re-enable');
			expect(alert?.textContent).not.toContain('Private plugin');
			expect(f.target.textContent).not.toContain('Plugin interface ready');
			expect(f.host.list()[0]).toMatchObject({ status: 'active', errors: [] });
			expect(f.target.querySelector('[role="status"]')?.textContent).toBe('Enabled');
			const sibling = f.target.querySelector('button')!;
			sibling.click();
			flushSync();
			expect(sibling.textContent).toBe('Host action: 1');
			expect(f.subscribe).toHaveBeenCalledTimes(failure === 'effect' ? 1 : 0);
			expect(f.unsubscribe).toHaveBeenCalledTimes(failure === 'effect' ? 1 : 0);

			f.recover();
			flushSync();
			expect(f.target.querySelector('[role="alert"]')).not.toBeNull();
			managerButton(f.target).click();
			flushSync();
			expect(f.host.list()[0].status).toBe('disabled');
			expect(f.target.querySelector('[role="alert"]')).toBeNull();
			managerButton(f.target).click();
			flushSync();
			expect(f.host.list()[0].status).toBe('active');
			expect(f.target.textContent).toContain('Plugin interface ready');
			expect(f.target.querySelector('[role="alert"]')).toBeNull();
			await unmount(f.component);
			mounted.delete(f.component);
			expect(f.unsubscribe).toHaveBeenCalledTimes(f.subscribe.mock.calls.length);
			f.host.deactivate('test.boundary');
			expect(f.unsubscribe).toHaveBeenCalledTimes(f.subscribe.mock.calls.length);
		},
	);

	it('recovers on descriptor replacement and releases the recovered subscription on replacement', () => {
		const f = setup('effect');
		expect(f.target.querySelector('[role="alert"]')).not.toBeNull();
		f.recover();
		const original = f.props.presentation!;
		f.props.presentation = { ...original };
		flushSync();
		expect(f.target.querySelector('[role="alert"]')).toBeNull();
		expect(f.target.textContent).toContain('Plugin interface ready');
		expect(f.subscribe).toHaveBeenCalledTimes(2);
		f.props.presentation = { ...original };
		flushSync();
		expect(f.subscribe).toHaveBeenCalledTimes(3);
		expect(f.unsubscribe).toHaveBeenCalledTimes(2);
	});

	it('recovers on context replacement even when the descriptor is retained', () => {
		const f = setup('effect');
		expect(f.target.querySelector('[role="alert"]')).not.toBeNull();
		f.recover();
		const descriptor = f.props.presentation!;

		const context = descriptor.context;
		Object.assign(descriptor, { context: { ...context } });
		flushSync();
		expect(f.target.querySelector('[role="alert"]')).toBeNull();
		expect(f.target.textContent).toContain('Plugin interface ready');
		expect(f.subscribe).toHaveBeenCalledTimes(2);
	});
});
