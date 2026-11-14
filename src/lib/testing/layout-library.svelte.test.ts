import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import {
	BarItems,
	createWorkbench,
	HorizontalBarPosition as H,
	VerticalBarPosition as V,
	getDockColor,
	type BarItemSection,
	type BarTransferLocation,
	type DockDragSource,
	type DockDropTarget,
} from '@writers-ide/layout';

// Deliberately not Svelte components or plugin contracts: presentations belong to the host.
type Section = BarItemSection & { Component?: string; detail?: { feature: string } };

function host(prefix = 'host') {
	let nextId = 0;
	const workbench = createWorkbench<Section>({
		generateId: () => {
			nextId++;
			return `${prefix}-${nextId}`;
		},
		unknownItemTitle: () => `${prefix}: missing`,
		newBarTitle: () => `${prefix}: new`,
	});
	for (const id of ['a', 'b', 'c']) {
		workbench.registry.register(
			{
				title: `${prefix}: ${id}`,
				horizontal: { Component: `horizontal-${id}`, size: 1, detail: { feature: id } },
				vertical: { Component: `vertical-${id}`, size: 1 },
			},
			id,
		);
	}
	return workbench;
}

type Workbench = ReturnType<typeof host>;
const locations: BarTransferLocation[] = [
	H.WindowBlockStart,
	H.WindowBlockEnd,
	V.InlineStart,
	V.InlineEnd,
	'floating',
];

function add(workbench: Workbench, location: BarTransferLocation, ids = ['a', 'b']) {
	if (location === 'floating') {
		return workbench.floating.add({ data: ids });
	}
	if (location === V.InlineStart || location === V.InlineEnd) {
		return workbench.vertical.add({ data: ids }, location);
	}
	return workbench.horizontal.add({ data: ids }, location);
}

function source(location: BarTransferLocation, barId: string, itemId?: string): DockDragSource {
	return { kind: itemId === undefined ? 'bar' : 'item', location, barId, itemId };
}

describe('independent layout workbenches', () => {
	it('isolates registries, retained sizes, collections, transfer sessions and floating roots', () => {
		const first = host('first');
		const second = host('second');
		const bar = add(first, H.WindowBlockStart);
		expect(bar.id).toBe('first-1');
		expect(first.registry.items.a.horizontal.detail).toEqual({ feature: 'a' });
		first.registry.deregister('a', true);
		first.transfer.startTransfer({ type: 'bar', id: bar.id, location: H.WindowBlockStart });
		first.floating.root = document.createElement('div');
		expect(second.registry.items.a.title).toBe('second: a');
		expect(second.horizontal.windowBlockStart).toEqual([]);
		expect(second.floating.root).toBeNull();
		expect(second.transfer.transfer).toBeNull();
		expect(second.transfer.getBar(H.WindowBlockStart, bar.id)).toBeUndefined();
		expect(
			second.transfer.drop(source(H.WindowBlockStart, bar.id), {
				kind: 'floating',
				left: 0,
				top: 0,
			}),
		).toBe(false);
		second.registry.clear();
		expect(first.registry.items.b.title).toBe('first: b');
		expect(first.horizontal.windowBlockStart[0].data.ids).toEqual(['a', 'b']);
	});

	it('uses generic presentations and injected reactive fallback labels', () => {
		let missing = $state('Missing');
		const workbench = createWorkbench<Section>({
			generateId: () => 'id',
			unknownItemTitle: () => missing,
			newBarTitle: () => 'Untitled',
		});
		const bar = add(workbench, H.WindowBlockStart, ['unknown']);
		expect(bar.data.items).toEqual([{ id: 'unknown', Component: null, title: 'Missing', size: 1 }]);
		missing = 'Unavailable';
		flushSync();
		expect(bar.data.items[0].title).toBe('Unavailable');
		workbench.registry.register(
			{
				title: 'Now available',
				horizontal: { Component: 'wide', size: 2 },
				vertical: { Component: 'tall', size: 3 },
			},
			'unknown',
		);
		expect(bar.data.items[0]).toMatchObject({ title: 'Now available', Component: 'wide', size: 2 });
		expect(bar.data.availableSpace).toBe(1);
		expect(bar.data.setOrientation(true)).toBe(true);
		expect(bar.data.items[0]).toMatchObject({ Component: 'tall', size: 3 });
	});

	it('preserves disabled orientation costs through moves and clear releases retained metadata', () => {
		const workbench = host();
		workbench.registry.register(
			{ title: 'Large', horizontal: { size: 2 }, vertical: { size: 3 } },
			'large',
		);
		const bar = add(workbench, H.WindowBlockStart, ['large', 'unknown']);
		workbench.registry.deregister('large', true);
		workbench.registry.deregister('large', true);
		expect(bar.data.items[0]).toEqual({
			id: 'large',
			Component: null,
			title: 'host: missing',
			size: 2,
		});
		expect(bar.data.availableSpace).toBe(0);
		const gap: DockDropTarget = { kind: 'dock', location: V.InlineStart, index: 0 };
		expect(workbench.transfer.canDrop(source(H.WindowBlockStart, bar.id), gap)).toBe(false);
		expect(workbench.transfer.drop(source(H.WindowBlockStart, bar.id), gap)).toBe(false);
		bar.data.remove('unknown');
		expect(workbench.transfer.drop(source(H.WindowBlockStart, bar.id), gap)).toBe(true);
		expect(bar.data.availableSpace).toBe(0);
		workbench.registry.register(
			{
				title: 'Enabled',
				horizontal: { size: 2, Component: 'wide' },
				vertical: { size: 3, Component: 'tall' },
			},
			'large',
		);
		expect(bar.data.items[0].Component).toBe('tall');
		expect(bar.data.ids).toEqual(['large']);
		workbench.registry.deregister('large', true);
		workbench.registry.clear();
		expect(bar.data.availableSpace).toBe(2);
	});

	it.each(locations.flatMap((from) => locations.map((to) => [from, to] as const)))(
		'preserves container and item identity moving %s to %s',
		(from, to) => {
			const workbench = host();
			const original = add(workbench, from);
			const bar = workbench.transfer.getBar(from, original.id)!;
			const data = bar.data;
			const neighbor = add(workbench, to, ['c']);
			const target: DockDropTarget = { kind: 'dock', location: to, index: from === to ? 2 : 1 };
			expect(workbench.transfer.canDrop(source(from, bar.id), target)).toBe(true);
			expect(workbench.transfer.getBar(from, bar.id)).toBe(bar);
			expect(workbench.transfer.drop(source(from, bar.id), target)).toBe(true);
			expect(workbench.transfer.getBar(to, bar.id)).toBe(bar);
			expect(bar.data).toBe(data);
			expect(bar.data.ids).toEqual(['a', 'b']);
			expect(workbench.transfer.getBar(to, neighbor.id)?.data.ids).toEqual(['c']);
		},
	);

	it.each(locations.flatMap((from) => locations.map((to) => [from, to] as const)))(
		'moves an individual item %s to %s and deletes its empty source',
		(from, to) => {
			const workbench = host();
			const bar = add(workbench, from, ['a']);
			const destination = add(workbench, to, ['b']);
			expect(
				workbench.transfer.drop(source(from, bar.id, 'a'), {
					kind: 'bar',
					location: to,
					barId: destination.id,
					index: 0,
				}),
			).toBe(true);
			expect(destination.data.ids).toEqual(['a', 'b']);
			expect(workbench.transfer.getBar(from, bar.id)).toBeUndefined();
		},
	);

	it('keeps an invalid interior authoritative, permitting a new container only at an explicit gap', () => {
		const workbench = host();
		const bar = add(workbench, H.WindowBlockStart, ['a']);
		const full = add(workbench, V.InlineStart, ['unknown', 'b', 'c']);
		const drag = source(H.WindowBlockStart, bar.id, 'a');
		const interior: DockDropTarget = {
			kind: 'bar',
			location: V.InlineStart,
			barId: full.id,
			index: 0,
		};
		expect(workbench.transfer.canDrop(drag, interior)).toBe(false);
		expect(workbench.transfer.drop(drag, interior)).toBe(false);
		expect(workbench.floating.bars).toEqual([]);
		expect(bar.data.ids).toEqual(['a']);
		expect(workbench.transfer.drop(drag, { kind: 'dock', location: V.InlineStart, index: 0 })).toBe(
			true,
		);
		expect(workbench.vertical.inlineStart.map((entry) => entry.data.ids)).toEqual([
			['a'],
			['unknown', 'b', 'c'],
		]);
	});

	it('reorders at pre-removal boundaries and rejects duplicates or stale sources atomically', () => {
		const workbench = host();
		const bar = add(workbench, H.WindowBlockStart, ['a', 'b', 'c']);
		expect(
			workbench.transfer.drop(source(H.WindowBlockStart, bar.id, 'a'), {
				kind: 'bar',
				location: H.WindowBlockStart,
				barId: bar.id,
				index: 3,
			}),
		).toBe(true);
		expect(bar.data.ids).toEqual(['b', 'c', 'a']);
		const destination = add(workbench, V.InlineEnd, ['a']);
		expect(
			workbench.transfer.drop(source(H.WindowBlockStart, bar.id, 'a'), {
				kind: 'bar',
				location: V.InlineEnd,
				barId: destination.id,
				index: 0,
			}),
		).toBe(false);
		const drag = source(H.WindowBlockStart, bar.id, 'b');
		const gap: DockDropTarget = { kind: 'dock', location: V.InlineStart, index: 0 };
		expect(workbench.transfer.canDrop(drag, gap)).toBe(true);
		bar.data.remove('b');
		expect(workbench.transfer.drop(drag, gap)).toBe(false);
		expect(workbench.vertical.inlineStart).toEqual([]);
	});

	it('retains floating geometry, orientation and titles through docking; clamps against its own root', () => {
		const workbench = host();
		const root = document.createElement('div');
		Object.defineProperties(root, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
		workbench.floating.root = root;
		const original = workbench.floating.add({
			data: ['a'],
			width: 300,
			height: 200,
			isVertical: false,
		});
		const bar = workbench.floating.bar(original.id)!;
		const position = bar.position;
		expect(bar.title).toBe('host: new');
		expect(workbench.transfer.moveMenu('floating', bar.id, V.InlineEnd)).toBe(true);
		expect(workbench.transfer.moveMenu(V.InlineEnd, bar.id, H.WindowBlockEnd)).toBe(true);
		expect(
			workbench.transfer.drop(source(H.WindowBlockEnd, bar.id), {
				kind: 'floating',
				left: 5000,
				top: -10,
			}),
		).toBe(true);
		expect(workbench.floating.bar(bar.id)).toBe(bar);
		expect(bar.position).toBe(position);
		expect(position).toEqual({ left: 697, top: 0, width: 300, height: 200 });
		expect(bar.data.isVertical).toBe(false);
		expect(workbench.floating.setPosition(bar.id, NaN, 0)).toBe(false);
	});

	it('retains the three-unit orientation ceiling for custom item limits', () => {
		const workbench = host();
		const items = new BarItems(
			workbench.registry,
			() => 'Missing',
			false,
			['a', 'b', 'c', 'unknown'],
			10,
		);
		expect(items.ids).toHaveLength(4);
		expect(items.setOrientation(true)).toBe(false);
	});

	it('classifies feedback by destination, independent of any workbench singleton', () => {
		expect(getDockColor(null)).toBe('none');
		expect(getDockColor({ kind: 'dock', location: H.WindowBlockEnd, index: 0 })).toBe('horizontal');
		expect(getDockColor({ kind: 'dock', location: V.InlineStart, index: 0 })).toBe('vertical');
		expect(getDockColor({ kind: 'bar', location: 'floating', barId: 'bar', index: 0 })).toBe(
			'floating',
		);
	});
});
