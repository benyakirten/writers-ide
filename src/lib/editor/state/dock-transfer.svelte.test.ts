import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Transfer, {
	BarTransferHandler,
	type BarTransferLocation,
	type DockDragSource,
	type DockDropTarget,
} from './bar-transfer-handler.svelte';
import Floating from './floater-state.svelte';
import Horizontal, { HorizontalBarPosition as H } from './horizontal-bar-state.svelte';
import Vertical, { VerticalBarPosition as V } from './vertical-bar-state.svelte';
import Registry from './bar-item-registry.svelte';
import { BarItems } from './bar-items.svelte';
import type { ModularComponent } from './shared.types';

const Component: ModularComponent = () => ({});
const docks = [H.WindowBlockStart, H.WindowBlockEnd, V.InlineStart, V.InlineEnd];
const locations: BarTransferLocation[] = [...docks, 'floating'];

function add(location: BarTransferLocation, data: string[] = ['a']) {
	if (location === 'floating') {
		return Floating.add({ data });
	}
	if (location === V.InlineStart || location === V.InlineEnd) {
		return Vertical.add({ data }, location);
	}
	return Horizontal.add({ data }, location);
}

function source(location: BarTransferLocation, barId: string, itemId?: string): DockDragSource {
	return { kind: itemId === undefined ? 'bar' : 'item', location, barId, itemId };
}

beforeEach(() => {
	Horizontal.windowBlockStart = [];
	Horizontal.windowBlockEnd = [];
	Vertical.inlineStart = [];
	Vertical.inlineEnd = [];
	Floating.bars = [];
	Floating.root = null;
	Registry.clear();
	for (const id of ['a', 'b', 'c']) {
		Registry.register(
			{ title: id, vertical: { Component, size: 1 }, horizontal: { Component, size: 1 } },
			id,
		);
	}
});

afterEach(() => {
	Registry.clear();
	Floating.root = null;
});

describe('typed dock transfers', () => {
	it.each(locations.flatMap((from) => locations.map((to) => [from, to] as const)))(
		'moves a whole bar from %s to %s without merging or changing identity',
		(from, to) => {
			const original = add(from, ['a', 'b']);
			const bar = Transfer.getBar(from, original.id)!;
			const data = bar.data;
			const neighbor = add(to, ['a']);
			const target: DockDropTarget = { kind: 'dock', location: to, index: from === to ? 2 : 1 };
			expect(Transfer.canDrop(source(from, bar.id), target)).toBe(true);
			expect(Transfer.getBar(from, bar.id)).toBe(bar);
			expect(Transfer.drop(source(from, bar.id), target)).toBe(true);
			expect(Transfer.getBar(to, bar.id)).toBe(bar);
			expect(bar.data).toBe(data);
			expect(bar.data.ids).toEqual(['a', 'b']);
			expect(Transfer.getBar(to, neighbor.id)?.data.ids).toEqual(['a']);
			expect(bar.data.isVertical).toBe(
				to === 'floating' ? Transfer.isVertical(from, bar.id) : Transfer.isVertical(to),
			);
		},
	);

	it.each(locations.flatMap((from) => locations.map((to) => [from, to] as const)))(
		'inserts an item from %s into %s and deletes its empty source',
		(from, to) => {
			const bar = add(from);
			const destination = add(to, ['b']);
			expect(
				Transfer.drop(source(from, bar.id, 'a'), {
					kind: 'bar',
					location: to,
					barId: destination.id,
					index: 0,
				}),
			).toBe(true);
			expect(destination.data.ids).toEqual(['a', 'b']);
			expect(Transfer.getBar(from, bar.id)).toBeUndefined();
		},
	);

	it('rejects interior overflow without creating bars, but accepts an explicit gap', () => {
		const bar = add(H.WindowBlockStart);
		const full = add(V.InlineEnd, ['a', 'b', 'c']);
		const drag = source(H.WindowBlockStart, bar.id, 'a');
		const interior: DockDropTarget = {
			kind: 'bar',
			location: V.InlineEnd,
			barId: full.id,
			index: 1,
		};
		expect(Transfer.canDrop(drag, interior)).toBe(false);
		expect(Transfer.drop(drag, interior)).toBe(false);
		expect(Vertical.inlineEnd).toHaveLength(1);
		expect(bar.data.ids).toEqual(['a']);
		expect(Transfer.drop(drag, { kind: 'dock', location: V.InlineEnd, index: 0 })).toBe(true);
		expect(Vertical.inlineEnd.map((bar) => bar.data.ids)).toEqual([['a'], ['a', 'b', 'c']]);
	});

	it('uses destination orientation capacity and never splits a whole bar', () => {
		Registry.register(
			{ title: 'a', vertical: { Component, size: 3 }, horizontal: { Component, size: 1 } },
			'a',
		);
		const bar = add(H.WindowBlockStart, ['a', 'b']);
		const drag = source(H.WindowBlockStart, bar.id);
		const gap: DockDropTarget = { kind: 'dock', location: V.InlineStart, index: 0 };
		expect(Transfer.canDrop(drag, gap)).toBe(false);
		expect(Transfer.drop(drag, gap)).toBe(false);
		expect(Transfer.moveMenu(H.WindowBlockStart, bar.id, V.InlineStart)).toBe(false);
		expect(Vertical.inlineStart).toHaveLength(0);
		expect(bar.data.ids).toEqual(['a', 'b']);
		const destination = add(V.InlineStart, ['b']);
		expect(
			Transfer.drop(source(H.WindowBlockStart, bar.id, 'a'), {
				kind: 'bar',
				location: V.InlineStart,
				barId: destination.id,
				index: 0,
			}),
		).toBe(false);
		expect(
			Transfer.drop(drag, {
				kind: 'bar',
				location: V.InlineStart,
				barId: destination.id,
				index: 0,
			}),
		).toBe(false);
	});

	it('supports duplicate registry IDs in different source bars, rejecting a destination duplicate', () => {
		const first = add(H.WindowBlockStart);
		const second = add(H.WindowBlockStart);
		const destination = add(V.InlineStart, ['b']);
		expect(
			Transfer.drop(source(H.WindowBlockStart, second.id, 'a'), {
				kind: 'bar',
				location: V.InlineStart,
				barId: destination.id,
				index: 0,
			}),
		).toBe(true);
		expect(first.data.ids).toEqual(['a']);
		expect(
			Transfer.drop(source(H.WindowBlockStart, first.id, 'a'), {
				kind: 'bar',
				location: V.InlineStart,
				barId: destination.id,
				index: 0,
			}),
		).toBe(false);
	});

	it.each([
		[0, 3, ['b', 'c', 'a']],
		[2, 0, ['c', 'a', 'b']],
		[1, 2, ['a', 'b', 'c']],
	] as const)(
		'reorders a full bar from item %i to pre-removal boundary %i',
		(from, index, expected) => {
			const bar = add(H.WindowBlockStart, ['a', 'b', 'c']);
			expect(
				Transfer.drop(source(H.WindowBlockStart, bar.id, bar.data.ids[from]), {
					kind: 'bar',
					location: H.WindowBlockStart,
					barId: bar.id,
					index,
				}),
			).toBe(true);
			expect(bar.data.ids).toEqual(expected);
		},
	);

	it.each([
		[0, 3, [1, 2, 0]],
		[2, 0, [2, 0, 1]],
		[1, 2, [0, 1, 2]],
	])('reorders a dock from bar %i to pre-removal boundary %i', (from, index, expected) => {
		const bars = [add(H.WindowBlockStart), add(H.WindowBlockStart), add(H.WindowBlockStart)];
		expect(
			Transfer.drop(source(H.WindowBlockStart, bars[from as number].id), {
				kind: 'dock',
				location: H.WindowBlockStart,
				index: index as number,
			}),
		).toBe(true);
		expect(Horizontal.windowBlockStart.map((bar) => bar.id)).toEqual(
			(expected as number[]).map((i) => bars[i].id),
		);
	});

	it.each([0, 1, 2, 3])('adjusts gap %i after removing an empty source bar', (index) => {
		const bars = [add(H.WindowBlockStart), add(H.WindowBlockStart), add(H.WindowBlockStart)];
		expect(
			Transfer.drop(source(H.WindowBlockStart, bars[1].id, 'a'), {
				kind: 'dock',
				location: H.WindowBlockStart,
				index,
			}),
		).toBe(true);
		expect(Horizontal.windowBlockStart).toHaveLength(3);
		expect(Transfer.getBar(H.WindowBlockStart, bars[1].id)).toBeUndefined();
		const newIndex = index > 1 ? index - 1 : index;
		expect(Horizontal.windowBlockStart[newIndex].id).not.toBe(bars[0].id);
		expect(Horizontal.windowBlockStart[newIndex].id).not.toBe(bars[2].id);
	});

	it.each([true, false])(
		'retains floating orientation %s when detaching a bar or an item',
		(vertical) => {
			const location = vertical ? V.InlineStart : H.WindowBlockStart;
			const bar = add(location, ['a', 'b']);
			expect(
				Transfer.drop(source(location, bar.id, 'a'), { kind: 'floating', left: 0, top: 0 }),
			).toBe(true);
			expect(Floating.bars[0].data.isVertical).toBe(vertical);
			expect(Floating.bars[0].position).toMatchObject({ left: 0, top: 0 });
			expect(Transfer.drop(source(location, bar.id), { kind: 'floating', left: 10, top: 20 })).toBe(
				true,
			);
			expect(Floating.bar(bar.id)?.data.isVertical).toBe(vertical);
		},
	);

	it('preserves title and geometry through docking and detaching', () => {
		const original = Floating.add({
			data: ['a'],
			title: 'Tools',
			left: 0,
			top: 0,
			width: 310,
			height: 210,
			isVertical: false,
		});
		const bar = Floating.bar(original.id)!;
		const position = bar.position;
		expect(Transfer.moveMenu('floating', bar.id, V.InlineEnd)).toBe(true);
		Vertical.inlineEnd[0].width = 325;
		expect(Transfer.moveMenu(V.InlineEnd, bar.id, H.WindowBlockEnd)).toBe(true);
		Horizontal.windowBlockEnd[0].height = 145;
		expect(Transfer.moveMenu(H.WindowBlockEnd, bar.id, 'floating')).toBe(true);
		expect(Floating.bar(bar.id)).toBe(bar);
		expect(bar.title).toBe('Tools');
		expect(bar.position).toBe(position);
		expect(bar.position).toEqual({ left: 0, top: 0, width: 310, height: 210 });
		expect(bar.width).toBe(325);
		expect(bar.height).toBe(145);
		expect(bar.data.isVertical).toBe(false);
	});

	it('validates orientation changes and recomputes reactive item sizes/capacity', () => {
		Registry.register(
			{ title: 'a', vertical: { Component, size: 3 }, horizontal: { Component, size: 1 } },
			'a',
		);
		const bar = Floating.add({ data: ['a', 'b'], isVertical: false });
		expect(bar.data.items[0].size).toBe(1);
		expect(bar.data.availableSpace).toBe(1);
		expect(Floating.setOrientation(bar.id, true)).toBe(false);
		expect(bar.data.isVertical).toBe(false);
		bar.data.remove('b');
		expect(Floating.setOrientation(bar.id, true)).toBe(true);
		expect(bar.data.items[0].size).toBe(3);
		expect(bar.data.availableSpace).toBe(0);
		expect(Floating.setOrientation('missing', false)).toBe(false);
	});

	it('clamps floating coordinates within small roots and accepts zero coordinates', () => {
		const root = document.createElement('div');
		Object.defineProperties(root, { clientWidth: { value: 100 }, clientHeight: { value: 50 } });
		Floating.root = root;
		const bar = add(H.WindowBlockStart);
		expect(
			Transfer.drop(source(H.WindowBlockStart, bar.id), { kind: 'floating', left: 500, top: -10 }),
		).toBe(true);
		expect(Floating.bar(bar.id)?.position).toMatchObject({ left: 0, top: 0 });
		expect(Floating.determineStartingCoordinates({ left: 0, top: 0 })).toEqual({ left: 0, top: 0 });
	});

	it.each([-1, 0.5, 2, NaN, Infinity])(
		'rejects invalid insertion boundary %s atomically',
		(index) => {
			const bar = add(H.WindowBlockStart);
			const destination = add(V.InlineStart, ['b']);
			for (const target of [
				{ kind: 'bar', location: V.InlineStart, barId: destination.id, index },
				{ kind: 'dock', location: V.InlineStart, index },
			] satisfies DockDropTarget[]) {
				expect(Transfer.drop(source(H.WindowBlockStart, bar.id, 'a'), target)).toBe(false);
			}
			expect(bar.data.ids).toEqual(['a']);
			expect(destination.data.ids).toEqual(['b']);
		},
	);

	it('clamps a floating drop to the root bounds using its retained geometry', () => {
		const root = document.createElement('div');
		Object.defineProperties(root, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
		Floating.root = root;
		const bar = Floating.add({ data: ['a'], width: 300, height: 200 });
		expect(
			Transfer.drop(source('floating', bar.id), { kind: 'floating', left: 5000, top: 5000 }),
		).toBe(true);
		expect(Floating.bar(bar.id)?.position).toMatchObject({ left: 697, top: 597 });
		expect(
			Transfer.drop(source('floating', bar.id), { kind: 'floating', left: -10, top: -10 }),
		).toBe(true);
		expect(Floating.bar(bar.id)?.position).toMatchObject({ left: 0, top: 0 });
	});

	it('relocates a menu item into a new bar rather than losing a destination duplicate', () => {
		const bar = add(H.WindowBlockStart);
		const destination = add(V.InlineStart);
		expect(
			Transfer.relocateItem(
				{ location: H.WindowBlockStart, barId: bar.id, itemId: 'a' },
				V.InlineStart,
			),
		).toBe(true);
		expect(Vertical.inlineStart).toHaveLength(2);
		expect(destination.data.ids).toEqual(['a']);
		expect(Vertical.inlineStart[1].data.ids).toEqual(['a']);
		expect(Horizontal.windowBlockStart).toHaveLength(0);
	});

	it('revalidates stale sources and refuses non-finite coordinates or duplicate bar IDs', () => {
		const bar = add(H.WindowBlockStart);
		const drag = source(H.WindowBlockStart, bar.id, 'a');
		const target: DockDropTarget = { kind: 'floating', left: 0, top: 0 };
		expect(Transfer.canDrop(drag, target)).toBe(true);
		bar.data.remove('a');
		expect(Transfer.drop(drag, target)).toBe(false);
		expect(Floating.bars).toHaveLength(0);
		expect(
			Transfer.drop(source(H.WindowBlockStart, bar.id), { kind: 'floating', left: NaN, top: 0 }),
		).toBe(false);
		Floating.add({ id: bar.id });
		expect(Transfer.drop(source(H.WindowBlockStart, bar.id), target)).toBe(false);
		expect(
			Transfer.relocateItem(
				{ location: H.WindowBlockStart, barId: 'missing', itemId: 'a' },
				V.InlineStart,
			),
		).toBe(false);
		expect(Vertical.inlineStart).toHaveLength(0);
	});

	it('always deletes empty source bars for drop, independent of the legacy remove option', () => {
		const handler = new BarTransferHandler(false);
		const bar = add(H.WindowBlockStart);
		expect(
			handler.drop(source(H.WindowBlockStart, bar.id, 'a'), { kind: 'floating', left: 0, top: 0 }),
		).toBe(true);
		expect(Horizontal.windowBlockStart).toHaveLength(0);
	});

	it('enforces a maximum of three units even with a larger custom BarItems limit', () => {
		const data = new BarItems(false, ['a', 'b', 'c'], 10);
		data.ids.push('unknown');
		expect(data.setOrientation(true)).toBe(false);
	});
});
