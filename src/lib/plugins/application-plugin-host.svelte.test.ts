import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type {
	FormattingService,
	FormattingSnapshot,
} from '$lib/editor/prosemirror/menu/basic/contracts';
import {
	defineSveltePresentation,
	type SveltePlugin,
	type SveltePluginContext,
	type SveltePresentation,
} from '@writers-ide/plugins/svelte';
import Registry, { BarItemRegistry } from '$lib/editor/state/bar-item-registry.svelte';
import { BarItems } from '$lib/editor/state/bar-items.svelte';
import { TabStateRegistry } from '$lib/editor/state/tab-state-registry.svelte';
import BasicMenuHorizontal from '$lib/editor/prosemirror/menu/basic/BasicMenuHorizontal.svelte';
import BasicMenuVertical from '$lib/editor/prosemirror/menu/basic/BasicMenuVertical.svelte';
import { createFormattingPlugin } from '$lib/editor/prosemirror/menu/basic/menu';
import { scopeFormattingService } from '$lib/editor/prosemirror/menu/basic/scope-formatting-service';
import PluginPresentationFixture from '$lib/testing/PluginPresentationFixture.svelte';
import { createApplicationPluginHost, PluginCommands } from './application-plugin-host';

const components = new Set<ReturnType<typeof mount>>();
const cleanups: (() => void)[] = [];

// Exercise the application adapters without sharing the workbench's singleton registries.
function setup(bars = new BarItemRegistry()) {
	const views = new TabStateRegistry();
	const commands = new PluginCommands();
	let current: FormattingSnapshot = {
		viewId: 'editor-one',
		revision: 7,
		marks: {
			bold: 0,
			italic: 0,
			superscript: 0,
			subscript: 0,
			underline: 0,
			overline: 0,
			strikethrough: 0,
		},
		blocks: {
			indent: 0,
			dedent: 1,
			'align-left': 1,
			'align-center': 0,
			'align-right': 0,
			'align-justify': 0,
		},
		enabled: {
			bold: true,
			italic: true,
			superscript: true,
			subscript: true,
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
	const listeners = new Set<(value: FormattingSnapshot | null) => void>();
	const unsubscribe = vi.fn();
	const formatting = {
		subscribe: vi.fn<FormattingService['subscribe']>((listener) => {
			listeners.add(listener);
			listener(current);
			return () => {
				listeners.delete(listener);
				unsubscribe();
			};
		}),
		execute: vi.fn<FormattingService['execute']>(() => true),
	};
	const host = createApplicationPluginHost({ bars, views, commands });
	const formattingPlugin = createFormattingPlugin(formatting);
	cleanups.push(() => {
		for (const plugin of host.list()) {
			host.deactivate(plugin.manifest.id);
		}
	});
	return {
		host,
		formattingPlugin,
		bars,
		views,
		commands,
		formatting,
		listeners,
		unsubscribe,
		emitTarget(viewId: string, revision: number) {
			current = { ...current, viewId, revision };
			for (const listener of listeners) {
				listener(current);
			}
			flushSync();
		},
	};
}

function plugin(activate: SveltePlugin['activate']): SveltePlugin {
	return {
		manifest: {
			id: 'test.adapters',
			name: 'Adapter integration',
			description: 'Exercises application contribution adapters.',
			version: '0.1.0',
			apiVersion: 1,
			capabilities: ['contributions.toolbar', 'contributions.view', 'contributions.command'],
		},
		activate,
	};
}

function contributeToolbar(
	context: SveltePluginContext,
	formatting: FormattingService,
	id = 'tools',
) {
	return context.contributions.toolbar({
		id,
		name: 'Tools',
		horizontal: {
			size: 2,
			presentation: defineSveltePresentation(BasicMenuHorizontal, { formatting }),
		},
		vertical: {
			size: 1,
			presentation: defineSveltePresentation(BasicMenuVertical, { formatting }),
		},
	});
}

function render(presentation: SveltePresentation) {
	const target = document.createElement('div');
	document.body.append(target);
	const component = mount(PluginPresentationFixture, { target, props: { presentation } });
	components.add(component);
	flushSync();
	return { target, component };
}

async function remove(component: ReturnType<typeof mount>) {
	await unmount(component);
	components.delete(component);
}

function boldButton(target: HTMLElement) {
	const button = target.querySelector<HTMLButtonElement>('button[aria-label="Add Bold to text."]');
	expect(button).not.toBeNull();
	return button!;
}

afterEach(async () => {
	for (const component of components) {
		await unmount(component);
	}
	components.clear();
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('application plugin adapters', () => {
	it('provides only feature-agnostic lifecycle and contribution APIs', () => {
		const f = setup();
		let retained: SveltePluginContext | undefined;
		f.host.register(
			plugin((context) => {
				retained = context;
				expect(Object.keys(context).sort()).toEqual(['contributions', 'own', 'signal']);
				expect(Object.keys(context.contributions).sort()).toEqual(['command', 'toolbar', 'view']);
				expect(context.signal.aborted).toBe(false);
			}),
		);
		expect(f.host.activate('test.adapters').status).toBe('active');
		f.host.deactivate('test.adapters');
		expect(retained!.signal.aborted).toBe(true);
		expect(f.formatting.subscribe).not.toHaveBeenCalled();
	});
	it('registers the real formatting plugin with orientation sizes and only scoped presentation data', () => {
		const f = setup();
		f.host.register(f.formattingPlugin);
		expect(f.host.activate(f.formattingPlugin.manifest.id)).toMatchObject({
			status: 'active',
			contributions: [{ kind: 'toolbar', id: 'basic-menu' }],
		});
		const item = f.bars.items['basic-menu'];
		const props = item.horizontal.plugin!.props;
		expect(f.bars.items).toEqual({
			'basic-menu': {
				title: 'Basic Menu',
				horizontal: { size: 2, plugin: { component: BasicMenuHorizontal, props } },
				vertical: { size: 1, plugin: { component: BasicMenuVertical, props } },
			},
		});
		expect(f.bars.size('basic-menu', false)).toBe(2);
		expect(f.bars.size('basic-menu', true)).toBe(1);
		expect(Object.keys(props)).toEqual(['formatting']);
		expect(Object.keys(props.formatting as FormattingService).sort()).toEqual([
			'execute',
			'subscribe',
		]);
		const verticalFormatting = item.vertical.plugin!.props.formatting as FormattingService;
		expect(verticalFormatting.subscribe).toBe((props.formatting as FormattingService).subscribe);
		expect(verticalFormatting.execute).toBe((props.formatting as FormattingService).execute);
		expect(props.formatting).not.toBe(f.formatting);
		expect(item.horizontal.plugin).not.toHaveProperty('context');
		expect(f.views.items).toEqual({});
		expect(f.formatting.subscribe).not.toHaveBeenCalled();
		f.host.deactivate(f.formattingPlugin.manifest.id);
		expect(f.bars.items).toEqual({});
		expect(f.bars.size('basic-menu', false)).toBe(2);
		expect(
			(props.formatting as FormattingService).execute({
				viewId: 'editor-one',
				revision: 7,
				command: 'bold',
			}),
		).toBe(false);
		expect(f.formatting.execute).not.toHaveBeenCalled();
	});

	it('reserves disabled plugin capacity in every placement and orientation until metadata is cleared', () => {
		Registry.clear();
		const f = setup(Registry);
		cleanups.push(() => Registry.clear());
		Registry.register({ title: 'One', horizontal: { size: 1 }, vertical: { size: 1 } }, 'one');
		Registry.register({ title: 'Extra', horizontal: { size: 1 }, vertical: { size: 1 } }, 'extra');
		Registry.register({ title: 'Two', horizontal: { size: 2 }, vertical: { size: 2 } }, 'two');
		f.host.register(f.formattingPlugin);
		expect(f.host.activate(f.formattingPlugin.manifest.id).status).toBe('active');
		const first = new BarItems(false, ['basic-menu', 'one']);
		const second = new BarItems(false, ['one', 'basic-menu']);
		const vertical = new BarItems(true, ['basic-menu', 'two']);
		const bars = [first, second, vertical];
		const placements = bars.map((bar) => [...bar.ids]);
		for (const bar of bars) {
			expect(bar.availableSpace).toBe(0);
			expect(bar.items.reduce((sum, item) => sum + item.size, 0)).toBe(3);
		}
		for (let cycle = 0; cycle < 2; cycle++) {
			f.host.deactivate(f.formattingPlugin.manifest.id);
			for (const bar of bars) {
				expect(bar.availableSpace).toBe(0);
				expect(bar.canFit('extra')).toBe(false);
				expect(bar.append('extra')).toBe(false);
				expect(bar.insert('extra', 0)).toBe(false);
				expect(bar.items.find((item) => item.id === 'basic-menu')).toMatchObject({
					Component: null,
					size: bar.isVertical ? 1 : 2,
				});
			}
			expect(vertical.canOrient(false)).toBe(false);
			expect(vertical.setOrientation(false)).toBe(false);
			expect(first.setOrientation(true)).toBe(true);
			expect(first.items.find((item) => item.id === 'basic-menu')!.size).toBe(1);
			expect(first.availableSpace).toBe(1);
			expect(first.setOrientation(false)).toBe(true);
			expect(first.availableSpace).toBe(0);
			expect(f.host.activate(f.formattingPlugin.manifest.id).status).toBe('active');
			expect(bars.map((bar) => [...bar.ids])).toEqual(placements);
			for (const bar of bars) {
				expect(bar.items.reduce((sum, item) => sum + item.size, 0)).toBeLessThanOrEqual(3);
			}
		}
		f.host.deactivate(f.formattingPlugin.manifest.id);
		Registry.clear();
		expect(bars.map((bar) => [...bar.ids])).toEqual(placements);
		for (const bar of bars) {
			expect(bar.items.every((item) => item.size === 1)).toBe(true);
			expect(bar.availableSpace).toBe(1);
		}
		expect(vertical.canOrient(false)).toBe(true);
	});

	it.each(['horizontal', 'vertical'] as const)(
		'%s presentation subscribes through the injected feature service, routes real buttons to the latest target, and is revoked before unmount',
		async (orientation) => {
			const f = setup();
			f.host.register(f.formattingPlugin);
			f.host.activate(f.formattingPlugin.manifest.id);
			const presentation = f.bars.items['basic-menu'][orientation].plugin!;
			const { target, component } = render(presentation);
			expect(f.formatting.subscribe).toHaveBeenCalledOnce();
			expect(f.listeners.size).toBe(1);
			boldButton(target).click();
			expect(f.formatting.execute).toHaveBeenLastCalledWith({
				viewId: 'editor-one',
				revision: 7,
				command: 'bold',
			});
			f.emitTarget('editor-two', 19);
			boldButton(target).click();
			expect(f.formatting.execute).toHaveBeenLastCalledWith({
				viewId: 'editor-two',
				revision: 19,
				command: 'bold',
			});
			f.host.deactivate(f.formattingPlugin.manifest.id);
			expect(f.bars.items).toEqual({});
			expect(f.listeners.size).toBe(0);
			expect(f.unsubscribe).toHaveBeenCalledOnce();
			// A retained mounted presentation must not keep command authority after removal.
			boldButton(target).click();
			expect(f.formatting.execute).toHaveBeenCalledTimes(2);
			await remove(component);
			expect(target.querySelector('button')).toBeNull();
			expect(f.unsubscribe).toHaveBeenCalledOnce();
		},
	);

	it('unmounting one orientation releases only its subscription, leaving the other presentation live', async () => {
		const f = setup();
		f.host.register(f.formattingPlugin);
		f.host.activate(f.formattingPlugin.manifest.id);
		const item = f.bars.items['basic-menu'];
		const horizontal = render(item.horizontal.plugin!);
		const vertical = render(item.vertical.plugin!);
		expect(f.listeners.size).toBe(2);
		await remove(horizontal.component);
		expect(f.listeners.size).toBe(1);
		expect(f.unsubscribe).toHaveBeenCalledOnce();
		f.emitTarget('remaining-editor', 23);
		boldButton(vertical.target).click();
		expect(f.formatting.execute).toHaveBeenCalledExactlyOnceWith({
			viewId: 'remaining-editor',
			revision: 23,
			command: 'bold',
		});
		f.host.deactivate(f.formattingPlugin.manifest.id);
		expect(f.listeners.size).toBe(0);
		expect(f.unsubscribe).toHaveBeenCalledTimes(2);
		await remove(vertical.component);
		expect(f.unsubscribe).toHaveBeenCalledTimes(2);
	});

	it('registers and removes views and commands through scoped contexts, revoking retained command handles', async () => {
		const f = setup();
		const execute = vi.fn(() => true);
		const register = vi.spyOn(f.commands, 'register');
		f.host.register(
			plugin((context) => {
				context.contributions.view({
					id: 'view',
					name: 'View',
					presentation: defineSveltePresentation(BasicMenuHorizontal, {
						formatting: scopeFormattingService(f.formatting, context),
					}),
				});
				context.contributions.command({ id: 'command', name: 'Command', execute });
			}),
		);
		expect(f.host.activate('test.adapters').status).toBe('active');
		expect(Object.keys(f.views.items)).toEqual(['view']);
		const presentation = f.views.items.view.plugin!;
		expect(f.views.items.view).toEqual({
			plugin: { component: BasicMenuHorizontal, props: presentation.props },
		});
		const fallback = f.views.get('missing');
		const { target, component } = render(presentation);
		boldButton(target).click();
		expect(f.formatting.execute).toHaveBeenCalledOnce();
		expect(register).toHaveBeenCalledWith(
			'test.adapters',
			expect.objectContaining({ id: 'command' }),
		);
		const retained = register.mock.calls[0][1].execute;
		expect(f.commands.execute('command')).toBe(true);
		expect(execute).toHaveBeenCalledOnce();
		f.host.deactivate('test.adapters');
		expect(f.views.items).toEqual({});
		expect(f.views.get('view')).toBe(fallback);
		expect(f.commands.execute('command')).toBe(false);
		expect(retained()).toBe(false);
		expect(execute).toHaveBeenCalledOnce();
		expect(f.unsubscribe).toHaveBeenCalledOnce();
		await remove(component);
		expect(f.unsubscribe).toHaveBeenCalledOnce();
	});

	it.each(['toolbar', 'view', 'command'] as const)(
		'rolls back earlier adapter registrations on a preexisting legacy %s ID without removing the original',
		(kind) => {
			const f = setup();
			const legacyBar = {
				title: 'Legacy',
				horizontal: { size: 3 as const },
				vertical: { size: 2 as const },
			};
			const legacyView = { component: f.views.get('missing') };
			const legacyExecute = vi.fn(() => true);
			if (kind === 'toolbar') {
				f.bars.register(legacyBar, 'collision');
			} else if (kind === 'view') {
				f.views.register(legacyView, 'collision');
			} else {
				f.commands.register('legacy', { id: 'collision', name: 'Legacy', execute: legacyExecute });
			}
			const originalBar = f.bars.items.collision;
			const originalView = f.views.items.collision;
			f.host.register(
				plugin((context) => {
					contributeToolbar(context, f.formatting);
					context.contributions.view({
						id: 'view',
						name: 'View',
						presentation: defineSveltePresentation(BasicMenuHorizontal, {
							formatting: scopeFormattingService(f.formatting, context),
						}),
					});
					context.contributions.command({ id: 'command', name: 'Command', execute: () => true });
					if (kind === 'toolbar') {
						contributeToolbar(context, f.formatting, 'collision');
					} else if (kind === 'view') {
						context.contributions.view({
							id: 'collision',
							name: 'Collision',
							presentation: defineSveltePresentation(BasicMenuVertical, {
								formatting: f.formatting,
							}),
						});
					} else {
						context.contributions.command({
							id: 'collision',
							name: 'Collision',
							execute: () => false,
						});
					}
				}),
			);
			const result = f.host.activate('test.adapters');
			expect(result.status).toBe('failed');
			expect(result.errors).toEqual([
				{
					phase: 'activation',
					message: `${{ toolbar: 'Bar item', view: 'View', command: 'Command' }[kind]} already registered: collision`,
				},
			]);
			expect(result.contributions).toEqual([]);
			expect(Object.keys(f.bars.items)).toEqual(kind === 'toolbar' ? ['collision'] : []);
			expect(Object.keys(f.views.items)).toEqual(kind === 'view' ? ['collision'] : []);
			expect(f.bars.items.collision).toBe(originalBar);
			expect(f.views.items.collision).toBe(originalView);
			expect(f.commands.execute('command')).toBe(false);
			if (kind === 'command') {
				expect(f.commands.execute('collision')).toBe(true);
				expect(legacyExecute).toHaveBeenCalledOnce();
			}
		},
	);

	it('does not delete replacement registrations belonging to other owners during cleanup', () => {
		const f = setup();
		const register = vi.spyOn(f.commands, 'register');
		f.host.register(
			plugin((context) => {
				contributeToolbar(context, f.formatting);
				context.contributions.view({
					id: 'view',
					name: 'View',
					presentation: defineSveltePresentation(BasicMenuHorizontal, {
						formatting: scopeFormattingService(f.formatting, context),
					}),
				});
				context.contributions.command({ id: 'command', name: 'Command', execute: () => true });
			}),
		);
		expect(f.host.activate('test.adapters').status).toBe('active');
		const retained = register.mock.calls[0][1].execute;
		const releaseCommandRegistration = register.mock.results[0].value as () => void;
		f.bars.register(
			{ title: 'Replacement', horizontal: { size: 3 }, vertical: { size: 2 } },
			'tools',
		);
		f.views.register({ component: f.views.get('missing') }, 'view');
		const replacementBar = f.bars.items.tools;
		const replacementView = f.views.items.view;
		releaseCommandRegistration();
		const replacementExecute = vi.fn(() => true);
		f.commands.register('other-owner', {
			id: 'command',
			name: 'Replacement',
			execute: replacementExecute,
		});
		expect(f.host.deactivate('test.adapters')).toMatchObject({ status: 'disabled', errors: [] });
		expect(f.bars.items.tools).toBe(replacementBar);
		expect(f.views.items.view).toBe(replacementView);
		expect(retained()).toBe(false);
		expect(f.commands.execute('command')).toBe(true);
		expect(replacementExecute).toHaveBeenCalledOnce();
	});
});
