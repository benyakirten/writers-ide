import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount, type ComponentProps } from 'svelte';
import Harness from './dropdown-menu.test-harness.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (component) {
		await unmount(component);
		component = undefined;
	}
	document.body.innerHTML = '';
});

async function render(props: ComponentProps<typeof Harness> = {}) {
	const target = document.createElement('div');
	target.dataset.harnessTarget = '';
	document.body.append(target);
	component = mount(Harness, { target, props });
	flushSync();
	await tick();
}

function item(text: string) {
	const element = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
		(node) => node.textContent?.trim() === text,
	);
	expect(element).toBeDefined();
	return element!;
}

describe('Bits 2 dropdown wrappers', () => {
	it('preserves standalone labels, styling, and original legacy/modern click events', async () => {
		const onlegacyclick = vi.fn();
		const onclick = vi.fn();
		await render({ onlegacyclick, onclick });
		expect(document.querySelector('[role="menu"]')?.classList.contains('custom-content')).toBe(
			true,
		);
		expect(document.body.textContent).toContain('Standalone label');
		expect(document.querySelector('[role="menu"]')?.closest('[data-harness-target]')).toBeNull();
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		item('Action').dispatchEvent(event);
		expect(onlegacyclick).toHaveBeenCalledExactlyOnceWith(event);
		expect(onclick).toHaveBeenCalledExactlyOnceWith(event);
	});

	it('activates items with the keyboard and preserves legacy click listeners', async () => {
		const onlegacyclick = vi.fn();
		await render({ onlegacyclick });
		item('Action').focus();
		item('Action').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		await tick();
		expect(onlegacyclick).toHaveBeenCalledOnce();
		expect(document.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
	});

	it('opens submenus with the keyboard and renders their styled content', async () => {
		await render();
		item('More').focus();
		item('More').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		flushSync();
		await tick();
		expect(item('Nested action').closest('[role="menu"]')?.classList.contains('shadow-lg')).toBe(
			true,
		);
	});

	it('does not activate disabled items', async () => {
		const onDisabledSelect = vi.fn();
		await render({ onDisabledSelect });
		expect(item('Disabled').getAttribute('aria-disabled')).toBe('true');
		expect(item('Disabled').classList.contains('data-[disabled]:pointer-events-none')).toBe(true);
		item('Disabled').click();
		expect(onDisabledSelect).not.toHaveBeenCalled();
	});

	it('updates checkbox bindings, callbacks, ARIA state, and indicators', async () => {
		const onCheckedChange = vi.fn();
		await render({ onCheckedChange });
		expect(item('Checkbox').querySelector('svg')).toBeNull();
		item('Checkbox').click();
		flushSync();
		await tick();
		expect(item('Checkbox').getAttribute('aria-checked')).toBe('true');
		expect(item('Checkbox').querySelector('svg')).not.toBeNull();
		expect(document.querySelector('[data-checked]')?.textContent).toBe('true');
		expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
	});

	it('updates radio bindings, callbacks, ARIA state, and indicators', async () => {
		const onValueChange = vi.fn();
		await render({ onValueChange });
		expect(item('First').querySelector('svg')).not.toBeNull();
		expect(item('Second').querySelector('svg')).toBeNull();
		item('Second').click();
		flushSync();
		await tick();
		expect(item('First').getAttribute('aria-checked')).toBe('false');
		expect(item('First').querySelector('svg')).toBeNull();
		expect(item('Second').getAttribute('aria-checked')).toBe('true');
		expect(item('Second').querySelector('svg')).not.toBeNull();
		expect(document.querySelector('[data-value]')?.textContent).toBe('second');
		expect(onValueChange).toHaveBeenCalledExactlyOnceWith('second');
	});
});
