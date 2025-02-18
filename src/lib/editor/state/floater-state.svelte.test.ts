import { describe, it, expect, beforeEach, test } from 'vitest';
import { FloaterState } from './floater-state.svelte';

describe('FloaterState', () => {
	let floaterState: FloaterState;

	beforeEach(() => {
		floaterState = new FloaterState();
	});

	function createRoot(width: number, height: number) {
		const root = document.createElement('div');
		Object.defineProperty(root, 'clientWidth', { get: () => width });
		Object.defineProperty(root, 'clientHeight', { get: () => height });
		return root;
	}

	describe('derived', () => {
		test('titleNumbers should return the number of floating bars with that title case-insensitive', () => {
			const bar1 = floaterState.add({ title: 'cool' });
			const bar2 = floaterState.add({ title: 'Cool' });
			const bar3 = floaterState.add({ title: ' cool ' });
			const bar4 = floaterState.add({ title: 'hot' });

			const gotBar1 = floaterState.titleNumbers.get(bar1.id);
			expect(gotBar1).toEqual(0);

			const gotBar2 = floaterState.titleNumbers.get(bar2.id);
			expect(gotBar2).toEqual(1);

			const gotBar3 = floaterState.titleNumbers.get(bar3.id);
			expect(gotBar3).toEqual(2);

			const gotBar4 = floaterState.titleNumbers.get(bar4.id);
			expect(gotBar4).toEqual(0);
		});

		test('highestBar should return the floating bar with the highest z-index', () => {
			floaterState.add({ z: 100 });
			const bar2 = floaterState.add({ z: 2000 });
			floaterState.add({ z: 300 });

			expect(floaterState.highestBar!.id).toEqual(bar2.id);
		});

		test('visibleBars should return all floating bars that are not minimized', () => {
			floaterState.add({ minimized: true });
			const bar2 = floaterState.add({ minimized: false });
			floaterState.add({ minimized: true });

			expect(floaterState.visibleBars).toEqual([bar2]);
		});

		test('minimizedBars should return all floating bars that are minimized', () => {
			const bar1 = floaterState.add({ minimized: true });
			floaterState.add({ minimized: false });
			const bar3 = floaterState.add({ minimized: true });

			expect(floaterState.minimizedBars).toEqual([bar1, bar3]);
		});
	});

	describe('bar', () => {
		it('should find a bar by its id when passed a string', () => {
			const bar = floaterState.add();
			const gotBar = floaterState.bar(bar.id);
			expect(gotBar!.id).toEqual(bar.id);
		});

		it('should find a bar by its index when passed a number', () => {
			const bar = floaterState.add();
			const gotBar = floaterState.bar(0);
			expect(gotBar!.id).toEqual(bar.id);
		});

		it('should return undefined if the bar is not found', () => {
			const gotBar = floaterState.bar('not-found');
			expect(gotBar).toBeUndefined();
		});
	});

	describe('findNextOpenPosition', () => {
		it("should return the default position if there isn't a root element", () => {
			const got = floaterState.findNextOpenPosition();
			expect(got).toEqual({ top: floaterState.DEFAULT_TOP_PX, left: floaterState.DEFAULT_LEFT_PX });
		});

		it("should return the default's position multiplied by the default offset as a percent if the from parameter is not defined", () => {
			const rootWidth = 150;
			const rootHeight = 350;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const wantLeft = (floaterState.OFFSET / 100) * rootWidth;
			const wantTop = (floaterState.OFFSET / 100) * rootHeight;

			const got = floaterState.findNextOpenPosition();
			expect(got).toEqual({ top: wantTop, left: wantLeft });
		});

		it("should add the default offset distance to the parameter's left or top position if it is less than the max distance from the left or top respectively", () => {
			const rootWidth = 15000;
			const rootHeight = 35000;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const from = { left: 2000, top: 2000 };
			const wantLeft = from.left + (floaterState.OFFSET / 100) * rootWidth;
			const wantTop = from.top + (floaterState.OFFSET / 100) * rootHeight;

			const got = floaterState.findNextOpenPosition(from);
			expect(got.left).toEqual(wantLeft);
			expect(got.top).toEqual(wantTop);
		});

		it("should subtract the default offset distance from the parameter's left or top position if it is greater than the max distance from the right or bottom respectively", () => {
			const rootWidth = 15000;
			const rootHeight = 35000;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const from = { left: 14950, top: 34950 };
			const wantLeft = from.left - (floaterState.OFFSET / 100) * rootWidth;
			const wantTop = from.top - (floaterState.OFFSET / 100) * rootHeight;

			const got = floaterState.findNextOpenPosition(from);
			expect(got.left).toEqual(wantLeft);
			expect(got.top).toEqual(wantTop);
		});
	});

	describe.todo('determineStartingCoordinates', () => {
		// TODO
	});

	describe('determineStartingZ', () => {
		it("should return the paramter as the z index if it's greater than the minimum z index", () => {
			const zIndex = floaterState.BASE_Z * 2;
			const got = floaterState.determineStartingZ(zIndex);
			expect(got).toBe(zIndex);
		});

		it('should return the minimum z index if the parameter is less than the minimum z index', () => {
			const zIndex = floaterState.BASE_Z / 2 - 1;
			const got = floaterState.determineStartingZ(zIndex);
			expect(got).toBe(floaterState.BASE_Z);
		});

		it("should return the highst bar's z index + 1 if no paramter is passed in", () => {
			floaterState.add({ z: 100 });

			const got = floaterState.determineStartingZ();
			expect(got).toBe(101);
		});

		it('should return the minimum z index if there is no parameter passed in and no highest bar', () => {
			const got = floaterState.determineStartingZ();
			expect(got).toBe(floaterState.BASE_Z);
		});
	});

	describe.todo('determineStartingMeasurements', () => {
		// TODO
	});

	describe.todo('removeZGaps', () => {
		// TODO
	});

	describe.todo('add', () => {
		// TODO
	});

	describe('focus', () => {
		it("should return null if there aren't at least 2 floating bars", () => {
			const bar = floaterState.add();
			const got = floaterState.focus(bar.id);
			expect(got).toBeNull();
		});

		it('should return null if the ID passed in already belongs to the highest bar', () => {
			floaterState.add({ z: 100 });
			const bar2 = floaterState.add({ z: 2000 });
			floaterState.add({ z: 300 });

			const got = floaterState.focus(bar2.id);
			expect(got).toBeNull();
		});

		it("should return null if the bar doesn't exist", () => {
			floaterState.add();
			const got = floaterState.focus('non-existent');
			expect(got).toBeNull();
		});

		it("should set the bar's z-index to the highest bar's z-index + 1", () => {
			const bar1 = floaterState.add({ z: 100 });
			const bar2 = floaterState.add({ z: 2000 });

			expect(bar1.z).toBe(100);
			expect(floaterState.highestBar!.id).toBe(bar2.id);

			const got = floaterState.focus(bar1.id);
			expect(got!.id).toEqual(bar1.id);
			expect(got!.z).toEqual(2001);
			expect(floaterState.highestBar!.id).toBe(bar1.id);
		});
	});

	describe('remove', () => {
		it('should remove a floating bar', () => {
			const bar = floaterState.add();
			const got = floaterState.remove(bar.id);
			expect(got).toBe(true);
			expect(floaterState.bars.length).toBe(0);
		});

		it("should not remove a floating bar that doesn't exist", () => {
			const bar = floaterState.add();
			const got = floaterState.remove('non-existent');
			expect(got).toBe(false);
			expect(floaterState.bar(bar.id)).toBeDefined();
		});
	});

	describe.todo('updateMeasurements', () => {
		// TODO
	});

	describe('startDragging', () => {
		it('should set the dragging bar with the speified x and y coordinates if the bar exists', () => {
			const bar = floaterState.add();

			const event = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
			const got = floaterState.startDragging(bar.id, event);

			expect(got).toBe(true);
			expect(floaterState.dragging).toEqual({ id: bar.id, x: 100, y: 100 });
		});

		it("should not set the dragging bar if the bar doesn't exist", () => {
			const event = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
			const got = floaterState.startDragging('non-existent', event);

			expect(got).toBe(false);
			expect(floaterState.dragging).toBeNull();
		});
	});

	describe('stopDragging', () => {
		it('should set the dragging bar to null', () => {
			const bar = floaterState.add();
			const event = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

			const got = floaterState.startDragging(bar.id, event);
			expect(got).toBe(true);

			floaterState.stopDragging();
			expect(floaterState.dragging).toBeNull();
		});
	});

	describe.todo('nudge', () => {
		// TODO
	});

	describe.todo('move', () => {
		// TODO
	});

	describe('update', () => {
		it("should update the bar's properties if it is found", () => {
			const bar = floaterState.add({ minimized: true, title: 'Floating Bar' });
			expect(bar.title).toBe('Floating Bar');
			expect(bar.minimized).toBe(true);

			let got = floaterState.update(bar.id, 'title', 'New Title');
			expect(got!.id).toBe(bar.id);
			expect(got!.title).toBe('New Title');

			got = floaterState.update(bar.id, 'minimized', false);
			expect(got!.minimized).toBe(false);
		});
	});
});
