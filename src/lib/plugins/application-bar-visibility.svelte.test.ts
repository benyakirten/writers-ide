import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { useDroppable } from '@dnd-kit-svelte/core';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import Registry from '$lib/editor/state/bar-item-registry.svelte';
import Horizontal, {
	HorizontalBarPosition as H,
} from '$lib/editor/state/horizontal-bar-state.svelte';
import Vertical, { VerticalBarPosition as V } from '$lib/editor/state/vertical-bar-state.svelte';
import Floating from '$lib/editor/state/floater-state.svelte';
import Transfer, {
	type BarTransferLocation,
	type DockDropTarget,
} from '$lib/editor/state/bar-transfer-handler.svelte';
import {
	applicationComponentPlacementId,
	createApplicationComponentHost,
} from './application-component-host.svelte';
import Probe from './ApplicationComponentProbe.svelte';
import Workspace from './ApplicationComponentWorkspaceFixture.svelte';

// Observe actual target registrations without replacing DnD behavior or application components.
const droppables = vi.hoisted(
	() =>
		[] as {
			options: Parameters<typeof useDroppable>[0];
			node: HTMLElement | null | undefined;
		}[],
);
vi.mock('@dnd-kit-svelte/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@dnd-kit-svelte/core')>();
	return {
		...actual,
		useDroppable(options: Parameters<typeof useDroppable>[0]) {
			const value = actual.useDroppable(options);
			const registration = { options, node: undefined as HTMLElement | null | undefined };
			droppables.push(registration);
			$effect(() => {
				registration.node = value.node.current;
				return () => {
					registration.node = undefined;
				};
			});
			return value;
		},
	};
});

const kinds = ['horizontal', 'vertical', 'floating-horizontal', 'floating-vertical'] as const;
type Kind = (typeof kinds)[number];
const mounted: ReturnType<typeof mount>[] = [];
const cleanups: (() => void)[] = [];
const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor() {
				observers.push(this);
			}
		},
	);
});

afterEach(async () => {
	for (const component of mounted.splice(0)) {
		await unmount(component);
	}
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	Horizontal.windowBlockStart = [];
	Horizontal.windowBlockEnd = [];
	Vertical.inlineStart = [];
	Vertical.inlineEnd = [];
	Floating.bars = [];
	Floating.root = null;
	Registry.clear();
	droppables.length = 0;
	observers.length = 0;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function setup() {
	const assembly = createApplicationComponentHost();
	cleanups.push(assembly.dispose);
	const first = assembly.host.openProject('first', 'First');
	const second = assembly.host.openProject('second', 'Second');
	assembly.host.selectProject(first);
	function contribute(slotId: string, projectOpeningId: string | null) {
		assembly.host.register({
			slotId,
			identity: { packageId: 'bars', componentId: slotId, projectOpeningId },
			commands: [],
			dependencies: [],
			capabilities: ['contributions.toolbar'],
			activate(context) {
				const presentation = defineSveltePresentation(Probe, { label: slotId, onEvent: () => {} });
				context.contributions.toolbar({
					id: 'local',
					name: slotId,
					horizontal: { presentation, size: 1 },
					vertical: { presentation, size: 1 },
				});
			},
		});
		assembly.host.activate(slotId);
		return applicationComponentPlacementId(
			assembly.host.presentations().find((record) => record.identity.componentId === slotId)!
				.placementId,
		);
	}
	return { ...assembly, first, second, contribute };
}

function renderBar(kind: Kind, ids: string[]) {
	const id = `bar:${kind}`;
	const target = document.createElement('div');
	document.body.appendChild(target);
	const location: BarTransferLocation = kind.startsWith('floating')
		? 'floating'
		: kind === 'horizontal'
			? H.WindowBlockStart
			: V.InlineStart;
	const bar = kind.startsWith('floating')
		? Floating.add({
				id,
				data: ids,
				isVertical: kind === 'floating-vertical',
				title: 'Retained title',
				top: 23,
				left: 31,
				width: 300,
				height: 220,
			})
		: kind === 'horizontal'
			? Horizontal.add({ id, data: ids, height: 120 }, H.WindowBlockStart)
			: Vertical.add({ id, data: ids, width: 240 }, V.InlineStart);
	const props = kind.startsWith('floating')
		? { floatingBars: [Floating.bar(id)!] }
		: kind === 'horizontal'
			? { horizontalBars: [Horizontal.bar(id, H.WindowBlockStart)!] }
			: { verticalBars: [Vertical.bar(id, V.InlineStart)!] };
	mounted.push(mount(Workspace, { target, props }));
	flushSync();
	const model = Transfer.getBar(location, bar.id)!;
	return { target, bar: model, location, model };
}

function boundaries(barId: string) {
	return droppables
		.filter(({ node }) => node?.isConnected)
		.flatMap(({ options }) => {
			const id = typeof options.id === 'function' ? options.id() : options.id;
			if (typeof id !== 'string' || JSON.parse(id)[0] !== 'bar-boundary') {
				return [];
			}
			const data = typeof options.data === 'function' ? options.data() : options.data;
			const target = data?.target as DockDropTarget;
			return target.kind === 'bar' && target.barId === barId ? [target.index] : [];
		})
		.sort((a, b) => a - b);
}

function snapshot(bar: ReturnType<typeof renderBar>['bar']) {
	return JSON.stringify({
		...bar,
		data: {
			ids: bar.data.ids,
			isVertical: bar.data.isVertical,
			availableSpace: bar.data.availableSpace,
		},
	});
}

describe.each(kinds)('%s production bar visibility', (kind) => {
	it('unmounts the entire inactive shell and targets, then restores the same stored bar', () => {
		const a = setup();
		const itemId = a.contribute('project', a.first.openingId);
		a.host.selectProject(a.second);
		const { target, bar, location, model } = renderBar(kind, [itemId]);
		expect(target.querySelector('[data-dock-source-kind="bar"]')).toBeNull();
		expect(boundaries(bar.id)).toEqual([]);
		a.host.selectProject(a.first);
		flushSync();
		const data = bar.data;
		const oldShell = target.querySelector('[data-dock-source-kind="bar"]');
		expect(oldShell).not.toBeNull();
		const oldFloater = target.querySelector('.floater');
		const observer = oldFloater
			? observers.find((observer) =>
					observer.observe.mock.calls.some(
						([element, options]) => element === oldFloater && options?.box === 'border-box',
					),
				)
			: undefined;
		(target.querySelector('.dock-grip') as HTMLButtonElement).focus();
		const original = snapshot(bar);
		a.host.selectProject(a.second);
		flushSync();
		expect(target.querySelector('[data-dock-source-kind="bar"]')).toBeNull();
		expect(target.querySelector('[data-dock-target]')).toBeNull();
		expect(target.querySelector('button, input, .resize, .floater')).toBeNull();
		expect(document.activeElement).toBe(document.body);
		expect(boundaries(bar.id)).toEqual([]);
		expect(Transfer.getBar(location, bar.id)).toBe(model);
		expect(bar.data).toBe(data);
		expect(snapshot(bar)).toBe(original);
		if (observer) {
			expect(observer.disconnect).toHaveBeenCalledOnce();
		}
		a.host.selectProject(a.first);
		flushSync();
		expect(target.querySelector('[data-dock-source-kind="bar"]')).not.toBe(oldShell);
		expect(target.querySelector('[data-probe="project"]')).not.toBeNull();
		expect(boundaries(bar.id)).toEqual([0, 1]);
		expect(snapshot(bar)).toBe(original);
		if (oldFloater) {
			const newFloater = target.querySelector('.floater');
			expect(newFloater).not.toBe(oldFloater);
			expect(
				observers.some(
					(candidate) =>
						candidate !== observer &&
						candidate.observe.mock.calls.some(
							([element, options]) => element === newFloater && options?.box === 'border-box',
						),
				),
			).toBe(true);
		}
	});

	it('omits inactive gaps but keeps original insertion indexes and full transfer capacity', () => {
		const a = setup();
		const leading = a.contribute('leading', a.first.openingId);
		const application = a.contribute('application', null);
		const trailing = a.contribute('trailing', a.first.openingId);
		const { target, bar, location } = renderBar(kind, [leading, application, trailing]);
		const original = snapshot(bar);
		const appNode = target.querySelector('[data-probe="application"]');
		expect(boundaries(bar.id)).toEqual([0, 1, 2, 3]);
		a.host.selectProject(a.second);
		flushSync();
		expect(target.querySelector('[data-dock-source-kind="bar"]')).not.toBeNull();
		expect(target.querySelectorAll('.dock-slot')).toHaveLength(2);
		expect(boundaries(bar.id)).toEqual([1, 3]);
		expect(target.querySelector('[data-probe="application"]')).toBe(appNode);
		expect(target.querySelectorAll('[data-dock-source-kind="item"]')).toHaveLength(1);
		if (kind === 'horizontal' || kind === 'floating-horizontal') {
			expect(
				(target.querySelector('.items') as HTMLElement).style.getPropertyValue('--insertion-space'),
			).toBe('32px');
		}
		expect(snapshot(bar)).toBe(original);
		expect(bar.data.availableSpace).toBe(0);
		Registry.register({ title: 'extra', horizontal: { size: 1 }, vertical: { size: 1 } }, 'extra');
		const source = Floating.add({ data: ['extra'], isVertical: false });
		expect(
			Transfer.canDrop(
				{ kind: 'item', location: 'floating', barId: source.id, itemId: 'extra' },
				{ kind: 'bar', location, barId: bar.id, index: 1 },
			),
		).toBe(false);
		const endIndex = boundaries(bar.id).at(-1)!;
		expect(
			Transfer.drop(
				{ kind: 'item', location, barId: bar.id, itemId: application },
				{ kind: 'bar', location, barId: bar.id, index: endIndex },
			),
		).toBe(true);
		expect(bar.data.ids).toEqual([leading, trailing, application]);
		a.host.selectProject(a.first);
		flushSync();
		expect(boundaries(bar.id)).toEqual([0, 1, 2, 3]);
		expect(target.querySelector('[data-probe="application"]')).toBe(appNode);
	});

	it('keeps a truly empty bar available as a drop target', () => {
		const a = setup();
		const { target, bar } = renderBar(kind, []);
		a.host.selectProject(a.second);
		flushSync();
		expect(target.querySelector('[data-dock-source-kind="bar"]')).not.toBeNull();
		expect(target.querySelector('[data-dock-target="bar"]')).not.toBeNull();
		expect(boundaries(bar.id)).toEqual([0]);
		expect(bar.data.ids).toEqual([]);
	});

	it('keeps disabled selected-project placeholders but hides them in other projects', () => {
		const a = setup();
		const itemId = a.contribute('project', a.first.openingId);
		const { target, bar } = renderBar(kind, [itemId]);
		a.host.deactivate('project');
		flushSync();
		expect(target.querySelector('[data-dock-source-kind="bar"]')).not.toBeNull();
		expect(target.querySelector('.renderer')).not.toBeNull();
		expect(target.querySelector('[data-probe="project"]')).toBeNull();
		expect(boundaries(bar.id)).toEqual([0, 1]);
		expect(bar.data.availableSpace).toBe(2);
		a.host.selectProject(a.second);
		flushSync();
		expect(target.querySelector('[data-dock-source-kind="bar"]')).toBeNull();
		expect(boundaries(bar.id)).toEqual([]);
		a.host.selectProject(a.first);
		flushSync();
		expect(target.querySelector('.renderer')).not.toBeNull();
		expect(bar.data.ids).toEqual([itemId]);
		expect(bar.data.availableSpace).toBe(2);
	});
});
