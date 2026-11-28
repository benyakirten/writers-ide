import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FrontendContext } from '@writers-ide/plugins';
import { defineSveltePresentation, type SveltePresentation } from '@writers-ide/plugins/svelte';
import type { ComponentDescriptor } from '../../../packages-js/plugins/command-component-model';
import Registry, { BarItemRegistry } from '$lib/editor/state/bar-item-registry.svelte';
import TabRegistry, { TabStateRegistry } from '$lib/editor/state/tab-state-registry.svelte';
import TabState from '$lib/editor/state/tab-state.svelte';
import LocaleManager from '$lib/services/locale-manager.svelte';
import { workQueue } from '$lib/editor/state/work-queue.svelte';
import {
	applicationComponentPlacementId as placementId,
	createApplicationComponentHost,
} from './application-component-host.svelte';
import Probe from './ApplicationComponentProbe.svelte';
import Workspace from './ApplicationComponentWorkspaceFixture.svelte';

type Context = FrontendContext<SveltePresentation>;
const cleanups: (() => void)[] = [];
const mounted: ReturnType<typeof mount>[] = [];
const events: string[] = [];

function setup(defaults = false) {
	const assembly = createApplicationComponentHost(
		defaults ? {} : { bars: new BarItemRegistry(), views: new TabStateRegistry() },
	);
	cleanups.push(assembly.dispose);
	return assembly;
}

function descriptor(
	slotId: string,
	activate?: (context: Context) => void | (() => void),
	projectOpeningId: string | null = null,
): ComponentDescriptor<SveltePresentation> {
	return {
		slotId,
		identity: { packageId: 'test', componentId: slotId, projectOpeningId },
		commands: [],
		dependencies: [],
		capabilities: ['contributions.toolbar', 'contributions.view'],
		activate: activate ?? ((context) => contribute(context, slotId)),
	};
}

function contribute(context: Context, label: string) {
	const presentation = defineSveltePresentation(Probe, {
		label,
		onEvent: (event) => {
			events.push(event);
		},
	});
	context.contributions.toolbar({
		id: 'local',
		name: label,
		horizontal: { presentation, size: 2 },
		vertical: { presentation, size: 3 },
	});
	context.contributions.view({ id: 'local', name: label, presentation });
}

function ids(assembly: ReturnType<typeof setup>, componentId: string) {
	const records = assembly.host
		.presentations()
		.filter((record) => record.identity.componentId === componentId);
	return {
		bar: placementId(records.find((record) => record.kind === 'toolbar')!.placementId),
		view: placementId(records.find((record) => record.kind === 'view')!.placementId),
	};
}

afterEach(async () => {
	for (const component of mounted.splice(0)) {
		await unmount(component);
	}
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	Registry.clear();
	for (const id of Object.keys(TabRegistry.items)) {
		TabRegistry.deregister(id);
	}
	for (const tab of [...TabState.windows]) {
		TabState.remove(tab.id);
	}
	LocaleManager.locale = 'en';
	flushSync();
	events.length = 0;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('application component assembly', () => {
	it('uses the real registries, stable namespaced placements, shared queue and actual locale', () => {
		const assembly = setup(true);
		expect(assembly.bars).toBe(Registry);
		expect(assembly.views).toBe(TabRegistry);
		LocaleManager.locale = 'fr';
		let context!: Context;
		assembly.host.register(
			descriptor('one', (value) => {
				context = value;
				contribute(value, 'one');
			}),
		);
		assembly.host.activate('one');
		const names = ids(assembly, 'one');
		expect(Object.keys(Registry.items)).toEqual([names.bar]);
		expect(Object.keys(TabRegistry.items)).toEqual([names.view]);
		expect(TabState.windows).toEqual([]);
		for (const record of assembly.host.presentations()) {
			expect(Registry.items[record.id]).toBeUndefined();
			expect(TabRegistry.items[record.id]).toBeUndefined();
		}
		expect(context.locale.snapshot()).toEqual({ languageTag: 'fr', direction: 'ltr' });
		expect(context.native).toEqual({ projectFiles: null, externalLinks: null });
		expect(Object.isFrozen(context.native)).toBe(true);
		const notices: string[] = [];
		context.locale.subscribe((value) => notices.push(value.languageTag));
		flushSync();
		LocaleManager.locale = 'en';
		flushSync();
		expect(notices).toEqual(['fr', 'en']);
		const enqueue = vi.spyOn(workQueue, 'enqueue');
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn(() => 1),
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		const task = context.tasks.cooperative({
			label: 'shared',
			key: 'shared',
			*create() {
				yield;
			},
		});
		expect(enqueue).toHaveBeenCalledOnce();
		assembly.dispose();
		expect(task.status).toBe('cancelled');
		LocaleManager.locale = 'fr';
		flushSync();
		expect(notices).toEqual(['fr', 'en']);
		expect(() => context.locale.snapshot()).toThrow();
		expect(Registry.items[names.bar]).toBeUndefined();
		expect(TabRegistry.items[names.view]).toBeUndefined();
		expect(Registry.size(names.bar, true)).toBe(3);
	});

	it('retains disabled project ownership, costs and descriptors across unrelated notices', () => {
		const a = setup();
		const first = a.host.openProject('first', 'First');
		const second = a.host.openProject('second', 'Second');
		let context!: Context;
		const cleanup = vi.fn();
		a.host.register(
			descriptor(
				'project',
				(value) => {
					context = value;
					contribute(value, 'project');
					return cleanup;
				},
				first.openingId,
			),
		);
		a.host.register(descriptor('application'));
		a.host.selectProject(first);
		a.host.activate('project');
		a.host.activate('application');
		const project = ids(a, 'project');
		const application = ids(a, 'application');
		const item = a.bars.items[application.bar];
		const presentation = item.horizontal.plugin;
		a.host.selectProject(second);
		expect(context.signal.aborted).toBe(false);
		expect(cleanup).not.toHaveBeenCalled();
		expect(a.bars.isVisible(project.bar)).toBe(false);
		expect(a.views.isVisible(project.view)).toBe(false);
		expect(a.bars.items[application.bar]).toBe(item);
		expect(a.bars.items[application.bar].horizontal.plugin).toBe(presentation);
		a.host.deactivate('project');
		expect(a.views.items[project.view]).toBeUndefined();
		expect(a.views.isVisible(project.view)).toBe(false);
		expect(a.bars.size(project.bar, false)).toBe(2);
		expect(a.bars.size(project.bar, true)).toBe(3);
		a.host.selectProject(first);
		expect(a.views.isVisible(project.view)).toBe(true);
		expect(a.bars.isVisible(project.bar)).toBe(true);
		a.host.selectProject(null);
		expect(a.views.isVisible(project.view)).toBe(false);
		expect(a.views.isVisible(application.view)).toBe(true);
		a.host.selectProject(first);
		a.host.activate('project');
		expect(ids(a, 'project')).toEqual(project);
		expect(a.errors).toEqual([]);
		a.host.closeProject(first);
		expect(a.views.isVisible(project.view)).toBe(false);
	});

	it.each(['toolbar', 'view'] as const)(
		'reports %s collisions without overwrites or disrupting peer activation',
		(kind) => {
			const a = setup();
			let context!: Context;
			a.host.register(
				descriptor('one', (value) => {
					context = value;
					contribute(value, 'one');
				}),
			);
			a.host.activate('one');
			const names = ids(a, 'one');
			a.host.deactivate('one');
			if (kind === 'toolbar') {
				a.bars.register(
					{ title: 'peer', horizontal: { size: 1 }, vertical: { size: 1 } },
					names.bar,
				);
			} else {
				a.views.register({}, names.view);
			}
			const registry = kind === 'toolbar' ? a.bars : a.views;
			const name = kind === 'toolbar' ? names.bar : names.view;
			const peer = registry.items[name];
			a.host.activate('one');
			expect(a.host.get('one')?.status).toBe('active');
			expect(context.signal.aborted).toBe(false);
			expect(a.errors).toHaveLength(1);
			expect(a.errors[0]).toMatchObject({ kind, placementId: name, error: expect.any(Error) });
			expect(registry.items[name]).toBe(peer);
			a.host.register(descriptor('healthy'));
			a.host.activate('healthy');
			expect(a.host.get('healthy')?.status).toBe('active');
			a.dispose();
			expect(registry.items[name]).toBe(peer);
		},
	);

	it('keeps replacement registrations and visibility untouched during disable and disposal', () => {
		const a = setup();
		const project = a.host.openProject('project', 'Project');
		a.host.register(descriptor('one', undefined, project.openingId));
		a.host.activate('one');
		const names = ids(a, 'one');
		a.bars.register(
			{ title: 'replacement', horizontal: { size: 1 }, vertical: { size: 1 } },
			names.bar,
		);
		a.views.register({}, names.view);
		const bar = a.bars.items[names.bar];
		const view = a.views.items[names.view];
		a.host.deactivate('one');
		a.host.selectProject(null);
		expect(a.bars.isVisible(names.bar)).toBe(true);
		expect(a.views.isVisible(names.view)).toBe(true);
		a.dispose();
		expect(a.bars.items[names.bar]).toBe(bar);
		expect(a.views.items[names.view]).toBe(view);
	});

	it('rolls back failed activation and cancels only its own tasks on a shared queue', () => {
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn(() => 1),
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		const a = setup();
		const cleanup = vi.fn();
		let failed!: Context;
		let healthy!: Context;
		a.host.register(
			descriptor('healthy', (value) => {
				healthy = value;
				contribute(value, 'healthy');
			}),
		);
		a.host.activate('healthy');
		const peer = healthy.tasks.cooperative({
			label: 'peer',
			key: 'peer',
			*create() {
				yield;
			},
		});
		a.host.register(
			descriptor('failed', (value) => {
				failed = value;
				value.own(cleanup);
				contribute(value, 'failed');
				value.tasks.cooperative({
					label: 'failed',
					key: 'failed',
					*create() {
						yield;
					},
				});
				throw new Error('setup failed');
			}),
		);
		expect(() => a.host.activate('failed')).toThrow('setup failed');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(failed.signal.aborted).toBe(true);
		expect(peer.status).toBe('queued');
		expect(a.host.presentations()).toHaveLength(2);
		expect(Object.keys(a.views.items)).toHaveLength(1);
		expect(a.errors).toEqual([]);
	});

	it('retains placement identity across project reopening without retaining old contexts or disposers', () => {
		const a = setup();
		const first = a.host.openProject('project', 'Project');
		let release!: () => void;
		let oldContext!: Context;
		a.host.register(
			descriptor(
				'one',
				(context) => {
					oldContext = context;
					release = context.contributions.view({
						id: 'local',
						name: 'View',
						presentation: defineSveltePresentation(Probe, { label: 'view', onEvent: () => {} }),
					});
				},
				first.openingId,
			),
		);
		a.host.selectProject(first);
		a.host.activate('one');
		const original = a.host.presentations()[0];
		const name = placementId(original.placementId);
		release();
		expect(a.views.items[name]).toBeUndefined();
		expect(a.views.isVisible(name)).toBe(true);
		a.host.closeProject(first);
		expect(a.views.isVisible(name)).toBe(false);
		expect(oldContext.signal.aborted).toBe(true);
		a.host.unregister('one');
		const reopened = a.host.openProject('project', 'Reopened');
		a.host.register(descriptor('one', undefined, reopened.openingId));
		a.host.activate('one');
		const names = ids(a, 'one');
		expect(names.view).toBe(name);
		expect(a.host.presentations().find((record) => record.kind === 'view')?.id).not.toBe(
			original.id,
		);
		const current = a.views.items[name];
		release();
		expect(a.views.items[name]).toBe(current);
		a.host.selectProject(reopened);
		expect(a.views.isVisible(name)).toBe(true);
	});

	it('does not detach adapters when reentrant disposal is rejected, and cleans up direct host disposal', () => {
		const a = setup();
		let context!: Context;
		a.host.register(
			descriptor('one', (value) => {
				context = value;
				contribute(value, 'one');
			}),
		);
		let attempted = false;
		a.host.subscribePresentations((records) => {
			if (records.length && !attempted) {
				attempted = true;
				expect(() => a.dispose()).toThrow();
			}
		});
		a.host.activate('one');
		const names = ids(a, 'one');
		const languages: string[] = [];
		context.locale.subscribe((value) => languages.push(value.languageTag));
		LocaleManager.locale = 'fr';
		flushSync();
		expect(languages).toEqual(['en', 'fr']);
		a.host.dispose();
		expect(a.views.items[names.view]).toBeUndefined();
		expect(a.bars.items[names.bar]).toBeUndefined();
		LocaleManager.locale = 'en';
		flushSync();
		expect(languages).toEqual(['en', 'fr']);
		a.host.dispose();
	});

	it('makes registration failures observable rather than losing them in subscriber isolation', () => {
		const a = setup();
		const error = new Error('registry unavailable');
		const register = vi.spyOn(a.views, 'register').mockImplementation(() => {
			throw error;
		});
		a.host.register(descriptor('one'));
		a.host.activate('one');
		expect(a.errors[0]?.error).toBe(error);
		expect(a.host.get('one')?.status).toBe('active');
		register.mockRestore();
		a.host.register(descriptor('notice'));
		expect(a.errors).toEqual([]);
		expect(Object.keys(a.views.items)).toHaveLength(1);
	});

	it('reports removal failures and retries cleanup without stopping healthy peers', () => {
		const a = setup();
		a.host.register(descriptor('one'));
		a.host.register(descriptor('peer'));
		a.host.activate('one');
		a.host.activate('peer');
		const names = ids(a, 'one');
		const peer = ids(a, 'peer');
		const error = new Error('removal failed');
		const remove = vi.spyOn(a.views, 'deregister').mockImplementation(() => {
			throw error;
		});
		a.host.deactivate('one');
		expect(a.host.get('one')?.status).toBe('disabled');
		expect(a.errors.some((failure) => failure.error === error)).toBe(true);
		expect(a.views.items[peer.view]).toBeDefined();
		remove.mockRestore();
		a.host.register(descriptor('notice'));
		expect(a.views.items[names.view]).toBeUndefined();
		expect(a.errors).toEqual([]);
	});

	it.each([false, true])(
		'mounts production views and %s vertical toolbar renderers with project unmounting',
		(vertical) => {
			const a = setup(true);
			const first = a.host.openProject('first', 'First');
			const second = a.host.openProject('second', 'Second');
			a.host.selectProject(first);
			a.host.register(descriptor('project', undefined, first.openingId));
			a.host.register(descriptor('application'));
			a.host.activate('project');
			a.host.activate('application');
			const project = ids(a, 'project');
			const application = ids(a, 'application');
			TabState.create(project.view, 'project-tab');
			TabState.create(application.view, 'application-tab');
			const target = document.createElement('div');
			document.body.appendChild(target);
			mounted.push(
				mount(Workspace, {
					target,
					props: { toolbarIds: [project.bar, application.bar], vertical },
				}),
			);
			flushSync();
			expect(target.querySelectorAll('[data-probe="project"]')).toHaveLength(2);
			expect(target.querySelectorAll('[data-probe="application"]')).toHaveLength(2);
			const appNodes = [...target.querySelectorAll('[data-probe="application"]')];
			a.host.register(descriptor('unrelated-notice'));
			flushSync();
			expect(events.filter((event) => event === 'mount:application')).toHaveLength(2);
			(target.querySelector('[data-probe="project"]') as HTMLButtonElement).focus();
			a.host.selectProject(second);
			flushSync();
			expect(target.querySelectorAll('[data-probe="project"]')).toHaveLength(0);
			expect(document.activeElement?.getAttribute('data-probe')).not.toBe('project');
			expect(events.filter((event) => event === 'unmount:project')).toHaveLength(2);
			expect([...target.querySelectorAll('[data-probe="application"]')]).toEqual(appNodes);
			expect(events.filter((event) => event === 'mount:application')).toHaveLength(2);
			expect(TabState.windows.map((tab) => tab.id)).toEqual(['project-tab', 'application-tab']);
			a.host.deactivate('project');
			flushSync();
			expect(target.querySelectorAll('.tab')).toHaveLength(1);
			a.host.selectProject(first);
			flushSync();
			expect(target.querySelectorAll('.tab')).toHaveLength(2);
			a.host.activate('project');
			flushSync();
			expect(target.querySelectorAll('[data-probe="project"]')).toHaveLength(2);
			expect(events.filter((event) => event === 'mount:project')).toHaveLength(4);
			expect(events.filter((event) => event === 'unmount:application')).toHaveLength(0);
		},
	);
});
