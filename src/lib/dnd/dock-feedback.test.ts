import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Handler, {
	type BarTransferLocation,
	type DockDragSource,
	type DockDropTarget,
} from '$lib/editor/state/bar-transfer-handler.svelte';
import Registry from '$lib/editor/state/bar-item-registry.svelte';
import Floating from '$lib/editor/state/floater-state.svelte';
import Horizontal, {
	HorizontalBarPosition as H,
} from '$lib/editor/state/horizontal-bar-state.svelte';
import Vertical, { VerticalBarPosition as V } from '$lib/editor/state/vertical-bar-state.svelte';
import type { ModularComponent } from '$lib/editor/state/shared.types';
import { describeDrop, getDockColor } from './dock-feedback';

const Component: ModularComponent = () => ({});

function reset() {
	Horizontal.windowBlockStart = [];
	Horizontal.windowBlockEnd = [];
	Vertical.inlineStart = [];
	Vertical.inlineEnd = [];
	Floating.bars = [];
	Floating.root = null;
	Registry.clear();
}

function add(location: BarTransferLocation, data = ['a']) {
	if (location === 'floating') {
		return Floating.add({ data });
	}
	if (location === V.InlineStart || location === V.InlineEnd) {
		return Vertical.add({ data }, location);
	}
	return Horizontal.add({ data }, location);
}

function drag(location: BarTransferLocation, barId: string, itemId?: string): DockDragSource {
	return { kind: itemId === undefined ? 'bar' : 'item', location, barId, itemId };
}

beforeEach(() => {
	reset();
	for (const id of ['a', 'b', 'c', 'd']) {
		Registry.register(
			{ title: id, vertical: { Component, size: 1 }, horizontal: { Component, size: 1 } },
			id,
		);
	}
});

afterEach(reset);

describe('getDockColor', () => {
	it.each([
		[H.WindowBlockStart, 'horizontal'],
		[H.WindowBlockEnd, 'horizontal'],
		[V.InlineStart, 'vertical'],
		[V.InlineEnd, 'vertical'],
		['floating', 'floating'],
	] as const)('categorizes %s by destination, not insertion strip shape', (location, color) => {
		expect(getDockColor({ kind: 'dock', location, index: 0 })).toBe(color);
		expect(getDockColor({ kind: 'bar', location, barId: 'any', index: 0 })).toBe(color);
	});

	it('categorizes free floating targets and missing targets', () => {
		expect(getDockColor({ kind: 'floating', left: 0, top: 0 })).toBe('floating');
		expect(getDockColor(null)).toBe('none');
		expect(getDockColor(undefined)).toBe('none');
	});
});

describe('describeDrop', () => {
	it.each([null, undefined])('describes cancellation for %s', (target) => {
		const bar = add(H.WindowBlockStart);
		expect(describeDrop(drag(H.WindowBlockStart, bar.id), target)).toBe(
			'Release to cancel (outside the workbench).',
		);
	});

	it.each([
		[H.WindowBlockStart, false, 'top dock', 'horizontal'],
		[H.WindowBlockEnd, false, 'bottom dock', 'horizontal'],
		[V.InlineStart, false, 'left dock', 'vertical'],
		[V.InlineEnd, false, 'right dock', 'vertical'],
		[V.InlineStart, true, 'right dock', 'vertical'],
		[V.InlineEnd, true, 'left dock', 'vertical'],
	] as const)('labels %s with rtl=%s physically', (location, rtl, side, orientation) => {
		const bar = add('floating');
		const target: DockDropTarget = { kind: 'dock', location, index: 0 };
		expect(describeDrop(drag('floating', bar.id), target, rtl)).toBe(
			`Release to place the whole toolbar in the ${side} at position 1 (${orientation}).`,
		);
		expect(describeDrop(drag('floating', bar.id, 'a'), target, rtl)).toBe(
			`Release to create a new ${orientation} toolbar in the ${side} at position 1.`,
		);
	});

	it('uses the destination title, location and insertion position without mutating stores', () => {
		const source = add(H.WindowBlockStart);
		const destination = add(V.InlineEnd, ['b', 'c']);
		destination.title = 'Formatting';
		const target: DockDropTarget = {
			kind: 'bar',
			location: V.InlineEnd,
			barId: destination.id,
			index: 1,
		};
		expect(describeDrop(drag(H.WindowBlockStart, source.id, 'a'), target)).toBe(
			'Release to insert item at position 2 in Formatting (right dock).',
		);
		expect(source.data.ids).toEqual(['a']);
		expect(destination.data.ids).toEqual(['b', 'c']);
	});

	it.each([
		['a', 3, 'Release to reorder item at position 3 in Toolbar 1 (top dock).'],
		['c', 0, 'Release to reorder item at position 1 in Toolbar 1 (top dock).'],
		['b', 1, 'Release to leave item order unchanged in Toolbar 1 (top dock).'],
		['b', 2, 'Release to leave item order unchanged in Toolbar 1 (top dock).'],
	] as const)('adjusts full-bar item %s at pre-removal boundary %s', (id, index, expected) => {
		const bar = add(H.WindowBlockStart, ['a', 'b', 'c']);
		const source = drag(H.WindowBlockStart, bar.id, id);
		const target: DockDropTarget = {
			kind: 'bar',
			location: H.WindowBlockStart,
			barId: bar.id,
			index,
		};
		expect(Handler.canDrop(source, target)).toBe(true);
		expect(describeDrop(source, target)).toBe(expected);
	});

	it('uses a numbered fallback based on destination collection position', () => {
		const source = add('floating');
		add(V.InlineStart, ['b']);
		const destination = add(V.InlineStart, ['c']);
		destination.title = '  ';
		expect(
			describeDrop(
				drag('floating', source.id, 'a'),
				{
					kind: 'bar',
					location: V.InlineStart,
					barId: destination.id,
					index: 1,
				},
				true,
			),
		).toBe('Release to insert item at position 2 in Toolbar 2 (right dock).');
	});

	it('rejects full targets rather than promising a new toolbar', () => {
		const source = add(H.WindowBlockStart);
		const full = add(V.InlineEnd, ['b', 'c', 'd']);
		const target: DockDropTarget = { kind: 'bar', location: V.InlineEnd, barId: full.id, index: 1 };
		expect(Handler.canDrop(drag(H.WindowBlockStart, source.id, 'a'), target)).toBe(false);
		expect(describeDrop(drag(H.WindowBlockStart, source.id, 'a'), target)).toBe(
			'Cannot drop here — release will cancel.',
		);
		expect(
			describeDrop(drag(H.WindowBlockStart, source.id, 'a'), {
				kind: 'dock',
				location: V.InlineEnd,
				index: 1,
			}),
		).toContain('create a new vertical toolbar');
	});

	it('uses real destination-orientation capacity validation', () => {
		Registry.register(
			{ title: 'a', horizontal: { Component, size: 1 }, vertical: { Component, size: 3 } },
			'a',
		);
		const source = add(H.WindowBlockStart, ['a', 'b']);
		expect(
			describeDrop(drag(H.WindowBlockStart, source.id), {
				kind: 'dock',
				location: V.InlineStart,
				index: 0,
			}),
		).toBe('Cannot drop here — release will cancel.');
	});

	it('rejects stale sources, duplicates, whole-bar interiors, invalid indices and coordinates', () => {
		const source = add(H.WindowBlockStart);
		const destination = add(V.InlineStart);
		const interior: DockDropTarget = {
			kind: 'bar',
			location: V.InlineStart,
			barId: destination.id,
			index: 0,
		};
		const invalid: [DockDragSource, DockDropTarget][] = [
			[drag(H.WindowBlockStart, 'missing'), { kind: 'dock', location: V.InlineStart, index: 0 }],
			[drag(H.WindowBlockStart, source.id, 'a'), interior],
			[drag(H.WindowBlockStart, source.id), interior],
			[drag(H.WindowBlockStart, source.id), { kind: 'dock', location: V.InlineStart, index: 9 }],
			[drag(H.WindowBlockStart, source.id), { kind: 'floating', left: NaN, top: 0 }],
		];
		for (const [from, to] of invalid) {
			expect(Handler.canDrop(from, to)).toBe(false);
			expect(describeDrop(from, to)).toBe('Cannot drop here — release will cancel.');
		}
	});

	it.each([false, true])('preserves source floating orientation vertical=%s', (isVertical) => {
		const bar = Floating.add({ data: ['a'], isVertical });
		const orientation = isVertical ? 'vertical' : 'horizontal';
		const target: DockDropTarget = { kind: 'floating', left: 20, top: 40 };
		expect(describeDrop(drag('floating', bar.id), target)).toBe(
			`Release to reposition the whole ${orientation} toolbar.`,
		);
		expect(describeDrop(drag('floating', bar.id, 'a'), target)).toBe(
			`Release to create a new ${orientation} floating toolbar.`,
		);
	});

	it.each([H.WindowBlockStart, V.InlineStart])('floats a whole %s bar intact', (location) => {
		const bar = add(location);
		const orientation = location === H.WindowBlockStart ? 'horizontal' : 'vertical';
		for (const target of [
			{ kind: 'floating', left: 20, top: 40 },
			{ kind: 'dock', location: 'floating', index: 0 },
		] satisfies DockDropTarget[]) {
			expect(describeDrop(drag(location, bar.id), target)).toContain(
				`float the whole ${orientation} toolbar`,
			);
			expect(describeDrop(drag(location, bar.id, 'a'), target)).toContain(
				`create a new ${orientation} floating toolbar`,
			);
		}
	});

	it('describes insertion into an existing floating toolbar, not creation', () => {
		const source = add(H.WindowBlockStart);
		const destination = add('floating', ['b']);
		expect(
			describeDrop(drag(H.WindowBlockStart, source.id, 'a'), {
				kind: 'bar',
				location: 'floating',
				barId: destination.id,
				index: 1,
			}),
		).toBe('Release to insert item at position 2 in New Bar (floating).');
	});

	it('adjusts whole-bar positions and identifies adjacent no-op dock gaps', () => {
		const bar = add(H.WindowBlockStart);
		add(H.WindowBlockStart);
		for (const index of [0, 1]) {
			expect(
				describeDrop(drag(H.WindowBlockStart, bar.id), {
					kind: 'dock',
					location: H.WindowBlockStart,
					index,
				}),
			).toBe('Release to leave toolbar order unchanged (top dock).');
		}
		expect(
			describeDrop(drag(H.WindowBlockStart, bar.id), {
				kind: 'dock',
				location: H.WindowBlockStart,
				index: 2,
			}),
		).toContain('position 2');
		expect(
			describeDrop(drag(H.WindowBlockStart, bar.id, 'a'), {
				kind: 'dock',
				location: H.WindowBlockStart,
				index: 2,
			}),
		).toBe('Release to create a new horizontal toolbar in the top dock at position 2.');
	});

	it('keeps feedback concise even with a long custom title', () => {
		const source = add(H.WindowBlockStart);
		const destination = add(V.InlineEnd, ['b']);
		destination.title = 'An unusually long custom toolbar title '.repeat(8);
		const text = describeDrop(drag(H.WindowBlockStart, source.id, 'a'), {
			kind: 'bar',
			location: V.InlineEnd,
			barId: destination.id,
			index: 0,
		});
		expect(text).toContain('…');
		expect(text.length).toBeLessThanOrEqual(140);
	});
});
