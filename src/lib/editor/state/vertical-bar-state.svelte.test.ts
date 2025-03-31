import { describe, it, expect, beforeEach } from 'vitest';
import {
	VerticalBarState,
	VerticalBarPosition,
	type VerticalBar
} from './vertical-bar-state.svelte';
import { BarItems } from './bar-items.svelte.js';

describe('VerticalBarState', () => {
	let state: VerticalBarState;
	const MIN_SIZE = 70;

	beforeEach(() => {
		state = new VerticalBarState(MIN_SIZE);
	});

	function makeEvent(
		clientX: number,
		{ left = 0, right = 0 }: { left: number; right: number }
	): MouseEvent {
		const target = document.createElement('div');
		const getBoundingClientRect = () => ({ left, right });

		// @ts-expect-error: Test Object
		target.getBoundingClientRect = getBoundingClientRect;

		// @ts-expect-error: Test Object
		return {
			clientX,
			target
		};
	}

	describe('bars', () => {
		const inlineStartBars: VerticalBar[] = [
			{
				data: new BarItems(true),
				id: 'inline-start-1',
				visible: true,
				width: 200
			},
			{
				data: new BarItems(true),
				id: 'inline-start-2',
				visible: true,
				width: 200
			}
		];
		const inlineEndBars: VerticalBar[] = [
			{
				data: new BarItems(true),
				id: 'inline-end-1',
				visible: true,
				width: 200
			}
		];

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

		it('should add a bar at the designated index if it is specified and a valid index', () => {
			const bar1 = state.add({ width: 100, id: 'inline-start-1' }, VerticalBarPosition.InlineStart);
			const bar2 = state.add(
				{ width: 200, id: 'inline-start-2' },
				VerticalBarPosition.InlineStart,
				0
			);
			expect(state.inlineStart).toEqual([bar2, bar1]);
		});

		it('should add a bar at the end of the list if the index is -1 or too great', () => {
			const bar1 = state.add({ width: 100, id: 'inline-start-1' }, VerticalBarPosition.InlineStart);
			const bar2 = state.add(
				{ width: 200, id: 'inline-start-2' },
				VerticalBarPosition.InlineStart,
				-1
			);
			expect(state.inlineStart).toEqual([bar1, bar2]);

			const bar3 = state.add(
				{ width: 300, id: 'inline-start-3' },
				VerticalBarPosition.InlineStart,
				10
			);
			expect(state.inlineStart).toEqual([bar1, bar2, bar3]);
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
	});

	describe('startResize', () => {
		it('should start resizing a bar', () => {
			state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 100);
			expect(state.resizedSection).toEqual({
				id: 'inline-start-1',
				position: VerticalBarPosition.InlineStart,
				x: 100,
				resized: false
			});
		});
	});

	describe('resize', () => {
		function createBarAndStartResizing(
			width: number,
			x: number,
			position: VerticalBarPosition,
			visible = true
		) {
			const id = crypto.randomUUID();
			const bar = state.add({ width, id, visible }, position);
			state.startResize(id, position, x);
			return bar;
		}

		it('should set the resized property to true, change the width on the bar, change the x coordinate of the resized section', async () => {
			createBarAndStartResizing(150, 150, VerticalBarPosition.InlineStart);
			const evt = makeEvent(175, { left: 225, right: 275 });

			const got = await state.resize(evt);

			const [bar] = state.inlineStart;
			expect(got).toBe(true);
			expect(bar.width).toEqual(175);
			expect(state.resizedSection!.resized).toBe(true);
			expect(state.resizedSection!.x).toBe(175);
		});

		it('should subtract the distance from the bar width instead if the bar should be inverted', async () => {
			createBarAndStartResizing(150, 150, VerticalBarPosition.InlineEnd);
			const evt = makeEvent(175, { left: 225, right: 275 });

			const got = await state.resize(evt);

			const [bar] = state.inlineEnd;
			expect(got).toBe(true);
			expect(bar.width).toEqual(125);
			expect(state.resizedSection!.resized).toBe(true);
			expect(state.resizedSection!.x).toBe(175);
		});

		it('should set the bar to visible if it was previously not visible and the new size is larger than the minimum size', async () => {
			createBarAndStartResizing(50, 50, VerticalBarPosition.InlineStart, false);
			const evt = makeEvent(75, { left: 125, right: 175 });

			const got = await state.resize(evt);
			const [bar] = state.inlineStart;
			expect(got).toBe(true);
			expect(bar.visible).toBe(true);
			expect(bar.width).toBe(75);
		});

		it("should set the bar to 0 width if the new size is below the minimum size and update the resizedSection x to the target's left if it should not invert", async () => {
			createBarAndStartResizing(50, 50, VerticalBarPosition.InlineStart);
			const evt = makeEvent(25, { left: 75, right: 125 });

			const got = await state.resize(evt);
			const [bar] = state.inlineStart;
			expect(got).toBe(true);
			expect(bar.width).toBe(0);
			expect(state.resizedSection!.x).toBe(75);
		});

		it("should set the bar to 0 width if the new size is below the minimum size and update the resizedSection x to the target's right if it should not invert", async () => {
			createBarAndStartResizing(50, 50, VerticalBarPosition.InlineEnd);
			const evt = makeEvent(75, { left: 75, right: 125 });

			const got = await state.resize(evt);
			const [bar] = state.inlineEnd;
			expect(got).toBe(true);
			expect(bar.width).toBe(0);
			expect(state.resizedSection!.x).toBe(125);
		});

		it("should not resize the section if the event's target is not an HTMLElement", async () => {
			createBarAndStartResizing(150, 150, VerticalBarPosition.InlineStart);
			const evt = {
				clientX: 100,
				target: { getBoundingClientRect: () => ({ left: 225, right: 275 }) }
			} as unknown as MouseEvent;
			const got = await state.resize(evt);
			expect(got).toBe(false);

			const [bar] = state.inlineStart;
			expect(bar.width).toBe(150);
			expect(state.resizedSection!.resized).toBe(false);
			expect(state.resizedSection!.x).toBe(150);
		});

		it("should not resize the section if the bar doesn't exist and return false", async () => {
			state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 200);
			const evt = makeEvent(100, { left: 225, right: 275 });

			const got = await state.resize(evt);

			expect(got).toBe(false);
			expect(state.resizedSection!.resized).toBe(false);
			expect(state.resizedSection!.x).toBe(200);
		});

		it('should return false if there is no resized section', async () => {
			createBarAndStartResizing(150, 150, VerticalBarPosition.InlineStart);
			const evt = makeEvent(100, { left: 225, right: 275 });
			await state.endResize();

			const got = await state.resize(evt);
			const [bar] = state.inlineStart;

			expect(got).toBe(false);
			expect(bar.width).toBe(150);
		});
	});

	describe('endResize', () => {
		it('should end resizing a bar', async () => {
			state.startResize('inline-start-1', VerticalBarPosition.InlineStart, 100);
			await state.endResize();
			expect(state.resizedSection).toBeNull();
		});
	});

	describe('remove', () => {
		it('should return false if the bar does not exist', () => {
			const result = state.remove('non-existent', VerticalBarPosition.InlineStart);
			expect(result).toBe(false);
		});

		it('should remove the bar if it exists', () => {
			const bar1 = state.add({}, VerticalBarPosition.InlineStart);
			const bar2 = state.add({}, VerticalBarPosition.InlineStart);
			const bar3 = state.add({}, VerticalBarPosition.InlineStart);

			const result = state.remove(bar2.id, VerticalBarPosition.InlineStart);
			expect(result).toBe(true);
			expect(state.inlineStart).toEqual([bar1, bar3]);
		});
	});
});
