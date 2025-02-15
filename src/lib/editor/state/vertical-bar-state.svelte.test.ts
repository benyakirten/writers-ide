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
			const bar = state.add({ width: 100, id: 'inline-start-1' }, VerticalBarPosition.InlineStart);
			expect(state.inlineStart).toEqual([bar]);
		});

		it('should add a bar to the inline end list if the position is InlineEnd', () => {
			const bar = state.add({ width: 100, id: 'inline-end-1' }, VerticalBarPosition.InlineEnd);
			expect(state.inlineEnd).toEqual([bar]);
		});
	});

	describe('bar', () => {
		it('should find a bar by id if given a number', () => {
			const bar = state.add({ width: 100, id: 'inline-start-1' }, VerticalBarPosition.InlineStart);
			expect(state.bar(0, VerticalBarPosition.InlineStart)).toEqual(bar);
		});

		it('should find a bar by id if given a string', () => {
			const bar = state.add({ width: 100, id: 'inline-end-1' }, VerticalBarPosition.InlineEnd);
			expect(state.bar('inline-end-1', VerticalBarPosition.InlineEnd)).toEqual(bar);
		});

		it('should return undefined if the bar does not exist', () => {
			expect(state.bar('non-existent', VerticalBarPosition.InlineStart)).toBeUndefined();
		});
	});

	describe('width', () => {
		it("should return the width of a bar if it's visible and the widht is over the minimum size", () => {
			const bar = state.add({ width: 100, id: 'inline-start-1' }, VerticalBarPosition.InlineStart);
			expect(state.width(bar)).toBe(100);
		});

		it('should return 0 if the bar is not visible', () => {
			const bar = state.add(
				{ width: 100, id: 'inline-start-1', visible: false },
				VerticalBarPosition.InlineEnd
			);
			expect(state.width(bar)).toBe(0);
		});

		it('should return 0 if the bar is visible but the width is below the minimum size', () => {
			const bar = state.add(
				{ width: MIN_SIZE / 2, id: 'inline-start-1' },
				VerticalBarPosition.InlineStart
			);
			expect(state.width(bar)).toBe(0);
		});
	});

	describe('widthOf', () => {
		it('should return the width of a bar by id', () => {
			state.add({ width: 100, id: 'inline-start-1' }, VerticalBarPosition.InlineStart);
			expect(state.widthOf('inline-start-1', VerticalBarPosition.InlineStart)).toBe(100);
		});

		it('should return undefined if the bar does not exist', () => {
			expect(state.widthOf('non-existent', VerticalBarPosition.InlineStart)).toBeUndefined();
		});
	});

	describe('toggleBar', () => {
		it('should toggle the visibility of a bar', () => {
			const bar = state.add(
				{ id: 'inline-start-1', visible: true },
				VerticalBarPosition.InlineStart
			);
			state.toggleBar(bar);
			expect(bar.visible).toBe(false);

			state.toggleBar(bar);
			expect(bar.visible).toBe(true);
		});
	});

	describe('toggle', () => {
		it('should toggle the visibility of a bar by index if a number is provided', () => {
			state.add({ id: 'inline-start-1', visible: true }, VerticalBarPosition.InlineStart);
			const [bar] = state.inlineStart;

			let got = state.toggle(0, VerticalBarPosition.InlineStart);
			expect(bar.visible).toBe(false);
			expect(got).toBe(true);

			got = state.toggle(0, VerticalBarPosition.InlineStart);
			expect(bar.visible).toBe(true);
			expect(got).toBe(true);
		});

		it('should toggle the visibility of a bar by its id if a string is provided', () => {
			state.add({ id: 'inline-start-1', visible: true }, VerticalBarPosition.InlineStart);
			const [bar] = state.inlineStart;

			let got = state.toggle('inline-start-1', VerticalBarPosition.InlineStart);
			expect(bar.visible).toBe(false);
			expect(got).toBe(true);

			got = state.toggle('inline-start-1', VerticalBarPosition.InlineStart);
			expect(bar.visible).toBe(true);
			expect(got).toBe(true);
		});

		it('should not toggle a bar if the bar is being resized', () => {
			state.add({ id: 'inline-start-1', visible: true }, VerticalBarPosition.InlineEnd);
			const [bar] = state.inlineEnd;

			state.startResize('inline-start-1', VerticalBarPosition.InlineEnd, 0);
			state.resizedSection!.resized = true;

			const got = state.toggle('inline-start-1', VerticalBarPosition.InlineEnd);
			expect(bar.visible).toBe(true);
			expect(got).toBe(false);
		});

		describe('humanize', () => {
			it('should return the correct description for an inline start bar by id', () => {
				state.add({ id: 'inline-start-1', width: 100 }, VerticalBarPosition.InlineStart);
				const description = state.humanize('inline-start-1', VerticalBarPosition.InlineStart);
				expect(description).toBe('Inline start bar #1');
			});

			it('should return the correct description for an inline end bar by id', () => {
				state.add({ id: 'inline-end-1', width: 100 }, VerticalBarPosition.InlineEnd);
				const description = state.humanize('inline-end-1', VerticalBarPosition.InlineEnd);
				expect(description).toBe('Inline end bar #1');
			});

			it('should return the correct description for an inline start bar by index', () => {
				state.add({ id: 'inline-start-1', width: 100 }, VerticalBarPosition.InlineStart);
				state.add({ id: 'inline-start-2', width: 100 }, VerticalBarPosition.InlineStart);
				const description = state.humanize(1, VerticalBarPosition.InlineStart);
				expect(description).toBe('Inline start bar #2');
			});

			it('should return the correct description for an inline end bar by index', () => {
				state.add({ id: 'inline-end-1', width: 100 }, VerticalBarPosition.InlineEnd);
				state.add({ id: 'inline-end-2', width: 100 }, VerticalBarPosition.InlineEnd);
				const description = state.humanize(1, VerticalBarPosition.InlineEnd);
				expect(description).toBe('Inline end bar #2');
			});

			it('should give an error message if the bar does not exist', () => {
				const description = state.humanize('non-existent', VerticalBarPosition.InlineStart);
				expect(description).toBe('Unknown inline start bar');
			});
		});
	});

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

	// it('should remove a bar', () => {
	// 	state.remove('inline-start-1', VerticalBarPosition.InlineStart);
	// 	expect(state.inlineStart).toHaveLength(1);
	// 	expect(state.inlineStart[0].id).toBe('inline-start-2');
	// });
});
