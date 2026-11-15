import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FormattingService, FormattingSnapshot } from './contracts';
import { defineSveltePresentation, type SveltePluginContext } from '@writers-ide/plugins/svelte';
import BasicMenuHorizontal from './BasicMenuHorizontal.svelte';
import BasicMenuVertical from './BasicMenuVertical.svelte';
import { createFormattingPlugin } from './menu';
import PluginPresentationFixture from '$lib/testing/PluginPresentationFixture.svelte';

const components: ReturnType<typeof mount>[] = [];

afterEach(async () => {
	for (const component of components) {
		await unmount(component);
	}
	components.length = 0;
	document.body.innerHTML = '';
});

function snapshot(): FormattingSnapshot {
	return {
		viewId: 'editor-one',
		revision: 7,
		marks: {
			bold: 1,
			italic: 0.5,
			superscript: 0,
			subscript: 0,
			underline: 0,
			overline: 0,
			strikethrough: 0,
		},
		blocks: {
			indent: 0.25,
			dedent: 0.75,
			'align-left': 0,
			'align-center': 1,
			'align-right': 0,
			'align-justify': 0,
		},
		enabled: {
			bold: true,
			italic: true,
			superscript: true,
			subscript: false,
			underline: true,
			overline: true,
			strikethrough: true,
			indent: true,
			dedent: false,
			'align-left': true,
			'align-center': true,
			'align-right': true,
			'align-justify': true,
		},
	};
}

function setup() {
	const listeners = new Set<(value: FormattingSnapshot | null) => void>();
	const dispose = vi.fn();
	const context: SveltePluginContext = {
		signal: new AbortController().signal,
		own: (cleanup) => cleanup,

		contributions: {
			toolbar: vi.fn(() => () => {}),
			view: vi.fn(() => () => {}),
			command: vi.fn(() => () => {}),
		},
	};
	const formatting: FormattingService = {
		subscribe: vi.fn((listener) => {
			listeners.add(listener);
			listener(null);
			return () => {
				listeners.delete(listener);
				dispose();
			};
		}),
		execute: vi.fn(() => true),
	};
	return {
		context,
		formatting,
		listeners,
		dispose,
		emit(value: FormattingSnapshot | null) {
			for (const listener of listeners) {
				listener(value);
			}
			flushSync();
		},
	};
}

function render(Component: typeof BasicMenuHorizontal, formatting: FormattingService) {
	const target = document.createElement('div');
	document.body.append(target);
	const component = mount(PluginPresentationFixture, {
		target,
		props: { presentation: defineSveltePresentation(Component, { formatting }) },
	});
	components.push(component);
	flushSync();
	return [...target.querySelectorAll('button')];
}

describe('formatting plugin', () => {
	it('registers the stable toolbar identity and both scoped presentation descriptors', () => {
		const { context, formatting } = setup();
		const formattingPlugin = createFormattingPlugin(formatting);
		expect(formattingPlugin.manifest).toMatchObject({
			id: 'writers-ide.formatting',
			version: '0.1.0',
			apiVersion: 1,
			capabilities: ['contributions.toolbar'],
		});
		formattingPlugin.activate(context);
		expect(context.contributions.toolbar).toHaveBeenCalledExactlyOnceWith({
			id: 'basic-menu',
			name: 'Basic Menu',
			horizontal: {
				presentation: { component: BasicMenuHorizontal, props: { formatting: expect.any(Object) } },
				size: 2,
			},
			vertical: {
				presentation: { component: BasicMenuVertical, props: { formatting: expect.any(Object) } },
				size: 1,
			},
		});
	});

	for (const [orientation, Component] of [
		['horizontal', BasicMenuHorizontal],
		['vertical', BasicMenuVertical],
	] as const) {
		it(`${orientation}: renders availability and ratios and executes current revision-tagged commands`, () => {
			const { formatting, emit } = setup();
			const buttons = render(Component, formatting);
			expect(buttons).toHaveLength(13);
			expect(buttons.every((button) => button.disabled)).toBe(true);
			emit(snapshot());
			expect(buttons[0].getAttribute('aria-label')).toBe('Remove Bold from text.');
			expect(buttons[0].style.getPropertyValue('--inversion')).toBe('100%');
			expect(buttons[1].style.getPropertyValue('--inversion')).toBe('50%');
			expect(buttons[7].style.getPropertyValue('--inversion')).toBe('25%');
			expect(buttons[8].style.getPropertyValue('--inversion')).toBe('75%');
			expect(buttons[10].style.getPropertyValue('--inversion')).toBe('100%');
			expect(buttons[3].disabled).toBe(true);
			expect(buttons[8].disabled).toBe(true);
			buttons[0].click();
			expect(formatting.execute).toHaveBeenLastCalledWith({
				viewId: 'editor-one',
				revision: 7,
				command: 'bold',
			});
			emit({ ...snapshot(), viewId: 'editor-two', revision: 12 });
			buttons[10].click();
			expect(formatting.execute).toHaveBeenLastCalledWith({
				viewId: 'editor-two',
				revision: 12,
				command: 'align-center',
			});
			buttons[3].click();
			buttons[8].click();
			expect(formatting.execute).toHaveBeenCalledTimes(2);
			emit(null);
			expect(buttons.every((button) => button.disabled)).toBe(true);
			buttons[0].click();
			expect(formatting.execute).toHaveBeenCalledTimes(2);
		});

		it(`${orientation}: releases its subscription on unmount`, async () => {
			const { formatting, listeners, dispose } = setup();
			render(Component, formatting);
			expect(listeners.size).toBe(1);
			await unmount(components.pop()!);
			expect(listeners.size).toBe(0);
			expect(dispose).toHaveBeenCalledOnce();
		});
	}

	it('does not share formatting snapshots between presentation instances', () => {
		const first = setup();
		const second = setup();
		const firstButtons = render(BasicMenuHorizontal, first.formatting);
		const secondButtons = render(BasicMenuVertical, second.formatting);
		first.emit(snapshot());
		expect(firstButtons[0].disabled).toBe(false);
		expect(secondButtons.every((button) => button.disabled)).toBe(true);
	});
});
