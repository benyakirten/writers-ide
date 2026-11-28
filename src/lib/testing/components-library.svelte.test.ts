import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { IconButton, TooltipState } from '@writers-ide/components';
import TooltipFixture from '../../../packages-js/components/tests/TooltipFixture.svelte';
import TooltipFailureFixture from '../../../packages-js/components/tests/TooltipFailureFixture.svelte';

const mounted: ReturnType<typeof mount>[] = [];
const managers: TooltipState[] = [];

function manager() {
	const service = new TooltipState();
	managers.push(service);
	return service;
}

function fixture(service?: TooltipState) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onclick = vi.fn();
	const props = $state({
		manager: service,
		showFirst: true,
		showSecond: true,
		disabled: false,
		onclick,
	});
	const component = mount(TooltipFixture, { target, props });
	mounted.push(component);
	flushSync();
	return { target, component, onclick, props };
}

async function advance(duration = 200) {
	await vi.advanceTimersByTimeAsync(duration);
	flushSync();
}

function hover(button: Element) {
	button.parentElement!.dispatchEvent(new MouseEvent('mouseenter'));
	flushSync();
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(async () => {
	for (const component of mounted.splice(0)) {
		await unmount(component);
	}
	for (const service of managers.splice(0)) {
		service.clear();
	}
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe('standalone component library (no app imports)', () => {
	it('isolates service data, timers, IDs and nested suppression leases', async () => {
		const first = manager();
		const second = manager();
		const firstTarget = document.createElement('button');
		const secondTarget = document.createElement('button');
		expect(first.TOOLTIP_ID).not.toBe(second.TOOLTIP_ID);
		first.set('First', 'vertical', firstTarget);
		second.set('Second', 'horizontal', secondTarget);
		const releaseOuter = first.suppress();
		const releaseInner = first.suppress();
		releaseOuter();
		releaseOuter();
		await advance();
		expect(first.suppressed).toBe(true);
		expect(first.open).toBe(false);
		expect(second.open).toBe(true);
		expect(second.tooltip?.data).toBe('Second');
		expect(secondTarget.getAttribute('aria-describedby')).toBe(second.TOOLTIP_ID);
		first.set('Discarded', 'vertical', firstTarget);
		releaseInner();
		await advance();
		expect(first.tooltip).toBeNull();
		first.set('Fresh', 'horizontal', firstTarget);
		await advance(199);
		expect(first.open).toBe(false);
		await advance(1);
		expect(first.open).toBe(true);
		expect(first.tooltip?.calibrateFor).toBe('horizontal');
		first.clear();
		expect(firstTarget.hasAttribute('aria-describedby')).toBe(false);
		expect(second.open).toBe(true);
	});

	it('mounts a provider button with its icon, label, inversion and delayed hover tooltip', async () => {
		const service = manager();
		const { target, onclick } = fixture(service);
		const button = target.querySelector('button')!;
		expect(button.getAttribute('aria-label')).toBe('Bold');
		expect(button.type).toBe('button');
		expect(button.querySelector('[data-icon="bold"]')?.textContent).toBe('B');
		expect(button.style.getPropertyValue('--inversion')).toBe('50%');
		button.click();
		expect(onclick).toHaveBeenCalledOnce();
		hover(button);
		await advance(199);
		expect(target.querySelector('[role="tooltip"]')).toBeNull();
		await advance(1);
		const tooltip = target.querySelector('[role="tooltip"]')!;
		expect(tooltip.textContent).toContain('Bold');
		expect(tooltip.id).toBe(service.TOOLTIP_ID);
		expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
		expect(service.tooltip?.target).toBe(button);
		expect(service.tooltip?.calibrateFor).toBe('vertical');
		await advance(20);
		expect((tooltip as HTMLElement).style.visibility).toBe('visible');
		button.parentElement!.dispatchEvent(new MouseEvent('mouseleave'));
		await advance();
		expect(target.querySelector('[role="tooltip"]')).toBeNull();
		expect(button.hasAttribute('aria-describedby')).toBe(false);
	});

	it('supports focus, snippet content, horizontal calibration, pointer hover and Escape', async () => {
		const service = manager();
		const { target } = fixture(service);
		const button = target.querySelectorAll('button')[1];
		button.focus();
		await advance();
		const tooltip = target.querySelector('[role="tooltip"]')!;
		expect(tooltip.querySelector('em')?.textContent).toBe('Indent content');
		expect(service.tooltip?.calibrateFor).toBe('horizontal');
		button.blur();
		tooltip.dispatchEvent(new MouseEvent('mouseenter'));
		await advance();
		expect(service.open).toBe(true);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(service.open).toBe(false);
		expect(button.hasAttribute('aria-describedby')).toBe(false);
		await advance(1000);
		expect(service.open).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('creates isolated local providers without requiring an application service', async () => {
		const first = fixture();
		const second = fixture();
		const firstButton = first.target.querySelector('button')!;
		const secondButton = second.target.querySelector('button')!;
		hover(firstButton);
		hover(secondButton);
		await advance();
		expect(first.target.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
		expect(second.target.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
		expect(firstButton.getAttribute('aria-describedby')).not.toBe(
			secondButton.getAttribute('aria-describedby'),
		);
		await unmount(first.component);
		mounted.splice(mounted.indexOf(first.component), 1);
		expect(firstButton.hasAttribute('aria-describedby')).toBe(false);
		expect(second.target.querySelector('[role="tooltip"]')).not.toBeNull();
	});

	it('does not let a sibling teardown dismiss the active trigger; cleans up its owner', async () => {
		const service = manager();
		const { target, props } = fixture(service);
		const button = target.querySelectorAll('button')[1];
		hover(button);
		await advance();
		props.showFirst = false;
		flushSync();
		expect(service.open).toBe(true);
		expect(service.tooltip?.target).toBe(button);
		props.showSecond = false;
		flushSync();
		expect(service.open).toBe(false);
		expect(service.tooltip).toBeNull();
		expect(button.hasAttribute('aria-describedby')).toBe(false);
		await advance(1000);
		expect(service.open).toBe(false);
	});

	it('cancels a pending tooltip and all calibration work on unmount', async () => {
		const service = manager();
		const { target, component } = fixture(service);
		hover(target.querySelector('button')!);
		expect(service.tooltip).not.toBeNull();
		await unmount(component);
		mounted.splice(mounted.indexOf(component), 1);
		expect(service.tooltip).toBeNull();
		expect(service.tooltipEl).toBeNull();
		expect(service.tooltipDebouncer.value).toBeNull();
		// Svelte may retain a shared scheduler frame; no service work may survive it.
		const show = vi.spyOn(service, 'show');
		const calibrate = vi.spyOn(service, 'calibratePosition');
		await advance(1000);
		expect(show).not.toHaveBeenCalled();
		expect(calibrate).not.toHaveBeenCalled();
		expect(service.open).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('applies suppression to mounted controls without replaying discarded requests', async () => {
		const service = manager();
		const { target } = fixture(service);
		const button = target.querySelector('button')!;
		hover(button);
		await advance();
		const release = service.suppress();
		flushSync();
		expect(target.querySelector('[role="tooltip"]')).toBeNull();
		expect(button.hasAttribute('aria-describedby')).toBe(false);
		hover(button);
		button.focus();
		await advance();
		expect(service.tooltip).toBeNull();
		release();
		await advance();
		expect(service.open).toBe(false);
		hover(button);
		await advance();
		expect(target.querySelector('[role="tooltip"]')?.textContent).toContain('Bold');
	});

	it.each(['render', 'effect'] as const)(
		'contains tooltip %s failures without breaking host controls or subsequent requests',
		async (mode) => {
			const service = manager();
			const target = document.createElement('div');
			document.body.appendChild(target);
			const props = $state({ manager: service, mode, fail: true });
			mounted.push(mount(TooltipFailureFixture, { target, props }));
			flushSync();
			const [pluginButton, hostButton] = target.querySelectorAll('button');

			hover(pluginButton);
			await advance();
			expect(target.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
				'Tooltip unavailable',
			);
			expect(target.textContent).not.toContain('Private plugin');
			expect(pluginButton.getAttribute('aria-describedby')).toBe(service.TOOLTIP_ID);
			hostButton.click();
			flushSync();
			expect(hostButton.textContent).toBe('Host clicks: 1');

			// Recover without dismissing: both content and descriptor identity reset failures.
			const descriptor = service.tooltip!;
			const failingContent = descriptor.data;
			descriptor.data = createRawSnippet(() => ({
				render: () => '<span>Replacement content</span>',
			}));
			flushSync();
			expect(target.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
				'Replacement content',
			);
			descriptor.data = failingContent;
			flushSync();
			await advance(0);
			expect(target.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
				'Tooltip unavailable',
			);
			props.fail = false;
			service.tooltip = { ...descriptor };
			flushSync();
			await advance(0);
			expect(target.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
				'Recovered plugin tooltip',
			);
			props.fail = true;
			flushSync();
			await advance(0);
			expect(target.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
				'Tooltip unavailable',
			);

			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
			flushSync();
			expect(service.open).toBe(false);
			expect(service.tooltip).toBeNull();
			expect(pluginButton.hasAttribute('aria-describedby')).toBe(false);
			expect(target.querySelector('[role="tooltip"]')).toBeNull();

			hover(hostButton);
			await advance();
			expect(target.querySelector('[role="tooltip"] strong')?.textContent).toBe('Host tooltip');
			expect(hostButton.getAttribute('aria-describedby')).toBe(service.TOOLTIP_ID);

			// A fresh descriptor can retry the same snippet after its failure is fixed.
			props.fail = false;
			hostButton.parentElement!.dispatchEvent(new MouseEvent('mouseleave'));
			hover(pluginButton);
			await advance();
			expect(target.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(
				'Recovered plugin tooltip',
			);
			expect(hostButton.hasAttribute('aria-describedby')).toBe(false);
			hostButton.click();
			flushSync();
			expect(hostButton.textContent).toBe('Host clicks: 2');
		},
	);

	it('accepts an explicit manager without context and respects disabled buttons', async () => {
		const service = manager();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onclick = vi.fn();

		const icon = createRawSnippet(() => ({ render: () => '<span>B</span>' }));
		mounted.push(
			mount(IconButton, {
				target,
				props: {
					manager: service,
					icon,
					label: 'Disabled',
					tooltipDirection: 'vertical',
					disabled: true,
					onclick,
				},
			}),
		);
		flushSync();
		const button = target.querySelector('button')!;
		expect(button.disabled).toBe(true);
		button.click();
		expect(onclick).not.toHaveBeenCalled();
		hover(button);
		await advance();
		expect(service.tooltip?.data).toBe('Disabled');
	});
});
