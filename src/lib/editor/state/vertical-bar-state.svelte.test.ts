import { describe, it, expect, beforeEach } from 'vitest';
import {
	VerticalBarState,
	VerticalBarPosition,
	type VerticalBar
} from './vertical-bar-state.svelte';

describe('VerticalBarState', () => {
	let state: VerticalBarState;
	const MIN_SIZE = 70;

	const inlineStartBars: VerticalBar[] = [
		{
			id: 'inline-start-1',
			visible: true,
			width: 200
		},
		{
			id: 'inline-start-2',
			visible: true,
			width: 200
		}
	];
	const inlineEndBars: VerticalBar[] = [
		{
			id: 'inline-end-1',
			visible: true,
			width: 200
		}
	];

	beforeEach(() => {
		state = new VerticalBarState(MIN_SIZE);
	});

	describe('bars', () => {
		beforeEach(() => {
			state.inlineStart = state.inlineStart.concat(inlineStartBars);
			state.inlineEnd = state.inlineEnd.concat(inlineEndBars);
		});

		it('should return the list of inline start bars if the position is InlineStart', () => {
			const bars = state.bars(VerticalBarPosition.InlineStart);
			expect(bars).toEqual(inlineStartBars);
		});

		it('should return the list of inline end bars if the position is InlineEnd', () => {
			const bars = state.bars(VerticalBarPosition.InlineEnd);
			expect(bars).toEqual(inlineEndBars);
		});
	});

	describe('add', () => {
		it('should add a bar to the inline start list if the position is InlineStart', () => {
			const bar = state.add(100, VerticalBarPosition.InlineStart, 'inline-start-1');
			expect(state.inlineStart).toEqual([bar]);
		});

		it('should add a bar to the inline end list if the position is InlineEnd', () => {
			const bar = state.add(100, VerticalBarPosition.InlineEnd, 'inline-end-1');
			expect(state.inlineEnd).toEqual([bar]);
		});
	});

	describe('bar', () => {
		it('should find a bar by id if given a number', () => {
			const bar = state.add(100, VerticalBarPosition.InlineStart, 'inline-start-1');
			expect(state.bar(0, VerticalBarPosition.InlineStart)).toEqual(bar);
		});

		it('should find a bar by id if given a string', () => {
			const bar = state.add(100, VerticalBarPosition.InlineEnd, 'inline-end-1');
			expect(state.bar('inline-end-1', VerticalBarPosition.InlineEnd)).toEqual(bar);
		});

		it('should return undefined if the bar does not exist', () => {
			expect(state.bar('non-existent', VerticalBarPosition.InlineStart)).toBeUndefined();
		});
	});

	// it('should find a bar by id or index', () => {
	// 	expect(state.bar('inline-start-1', VerticalBarPosition.InlineStart)).toBe(state.inlineStart[0]);
	// 	expect(state.bar(1, VerticalBarPosition.InlineStart)).toBe(state.inlineStart[1]);
	// 	expect(state.bar('non-existent', VerticalBarPosition.InlineStart)).toBeUndefined();
	// });

	// it('should return the correct width of a bar', () => {
	// 	expect(state.width(state.inlineStart[0])).toBe(200);
	// 	state.inlineStart[0].visible = false;
	// 	expect(state.width(state.inlineStart[0])).toBe(0);
	// 	state.inlineStart[0].visible = true;
	// 	state.inlineStart[0].width = 50;
	// 	expect(state.width(state.inlineStart[0])).toBe(0);
	// });

	// it('should toggle the visibility of a bar', () => {
	// 	const bar = state.inlineStart[0];
	// 	state.toggleBar(bar);
	// 	expect(bar.visible).toBe(false);
	// 	state.toggleBar(bar);
	// 	expect(bar.visible).toBe(true);
	// 	expect(bar.width).toBe(200);
	// 	bar.width = 50;
	// 	state.toggleBar(bar);
	// 	expect(bar.visible).toBe(false);
	// 	state.toggleBar(bar);
	// 	expect(bar.visible).toBe(true);
	// 	expect(bar.width).toBe(100);
	// });

	// it('should not toggle a bar if it is being resized', () => {
	// 	state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 0);
	// 	state.resizedSection!.resized = true;
	// 	state.toggle('inline-start-1', VerticalBarPosition.InlineStart);
	// 	expect(state.inlineStart[0].visible).toBe(true);
	// });

	// it('should start resizing a bar', () => {
	// 	state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 100);
	// 	expect(state.resizedSection).toEqual({
	// 		id: 'inline-start-1',
	// 		position: VerticalBarPosition.InlineStart,
	// 		x: 100,
	// 		resized: false
	// 	});
	// });

	// it('should resize a bar', async () => {
	// 	state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 100);
	// 	const event = new MouseEvent('mousemove', { clientX: 150 });
	// 	const result = await state.resize(event);
	// 	expect(result).toBe(true);
	// 	expect(state.inlineStart[0].width).toBe(250);
	// });

	// it('should end resizing a bar', async () => {
	// 	state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 100);
	// 	await state.endResize();
	// 	expect(state.resizedSection).toBeNull();
	// });

	// it('should humanize bar descriptions', () => {
	// 	expect(state.humanize('inline-start-1', VerticalBarPosition.InlineStart)).toBe(
	// 		'Inline Start Bar #1'
	// 	);
	// 	expect(state.humanize(1, VerticalBarPosition.InlineStart)).toBe('Inline Start Bar #2');
	// 	expect(state.humanize('inline-start-3', VerticalBarPosition.InlineEnd)).toBe(
	// 		'Inline End Bar #1'
	// 	);
	// });

	// it('should remove a bar', () => {
	// 	state.remove('inline-start-1', VerticalBarPosition.InlineStart);
	// 	expect(state.inlineStart).toHaveLength(1);
	// 	expect(state.inlineStart[0].id).toBe('inline-start-2');
	// });
});
