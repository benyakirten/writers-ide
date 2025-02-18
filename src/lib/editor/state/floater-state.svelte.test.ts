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

	describe('determineStartingCoordinates', () => {
		it("should return the parameters if they're both defined", () => {
			const top = 100;
			const left = 200;
			const got = floaterState.determineStartingCoordinates({ top, left });
			expect(got).toEqual({ top, left });
		});

		it('should return the left with a slightly adjusted top if a left position is given and a nearby bar is found', () => {
			floaterState.add({ left: 100, top: 150 });
			const got = floaterState.determineStartingCoordinates({ left: 104 });
			expect(got).toEqual({ top: 150 + floaterState.DEFAULT_TOP_PX, left: 104 });
		});

		it('should provide a deafult top value if a left position is given but a nearby bar is not found', () => {
			const got = floaterState.determineStartingCoordinates({ left: 104 });
			expect(got).toEqual({ top: floaterState.DEFAULT_TOP_PX, left: 104 });
		});

		it('should provide values for left and top otherwise', () => {
			const rootWidth = 150;
			const rootHeight = 350;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const wantLeft = (floaterState.OFFSET / 100) * rootWidth;
			const wantTop = (floaterState.OFFSET / 100) * rootHeight;

			const got = floaterState.determineStartingCoordinates({});
			expect(got).toEqual({ top: wantTop, left: wantLeft });
		});

		it('should use the value for top if it is provided by left is not', () => {
			const rootWidth = 150;
			const rootHeight = 350;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const wantLeft = (floaterState.OFFSET / 100) * rootWidth;

			const top = 123;
			const got = floaterState.determineStartingCoordinates({ top });
			expect(got).toEqual({ top, left: wantLeft });
		});
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

	describe('determineStartingMeasurements', () => {
		it("should return the parameters if they're both defined", () => {
			const width = 100;
			const height = 200;
			const got = floaterState.determineStartingMeasurements(width, height);
			expect(got).toEqual({ width, height });
		});

		it('should provide default values if there is no root element', () => {
			const got = floaterState.determineStartingMeasurements();
			expect(got).toEqual({ width: floaterState.MIN_WIDTH_PX, height: floaterState.MIN_HEIGHT_PX });
		});

		it("should provide the value of width and/or height if they are passed in and the other isn't", () => {
			const rootWidth = 1500;
			const rootHeight = 3500;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const height = 850;
			const wantWidth = (rootWidth * floaterState.DEFAULT_WIDTH_PERCENT) / 100;
			const got = floaterState.determineStartingMeasurements(undefined, height);
			expect(got).toEqual({ width: wantWidth, height });
		});

		it('should provide values for width and height if they are not passed in', () => {
			const rootWidth = 1500;
			const rootHeight = 3500;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const wantWidth = (rootWidth * floaterState.DEFAULT_WIDTH_PERCENT) / 100;
			const wantHeight = (rootHeight * floaterState.DEFAULT_HEIGHT_PERCENT) / 100;

			const got = floaterState.determineStartingMeasurements();
			expect(got).toEqual({ width: wantWidth, height: wantHeight });
		});

		it("should provide a minimum value for height and width if the root element's dimensions are too small", () => {
			const rootWidth = 10;
			const rootHeight = 10;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const got = floaterState.determineStartingMeasurements();
			expect(got).toEqual({ width: floaterState.MIN_WIDTH_PX, height: floaterState.MIN_HEIGHT_PX });
		});

		it("should provide a maximum value fo width but not height if the root element's dimensions are too large", () => {
			const rootWidth = 15000;
			const rootHeight = 35000;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const wantWidth = floaterState.MAX_WIDTH_PX;
			const wantHeight = (rootHeight * floaterState.DEFAULT_HEIGHT_PERCENT) / 100;

			const got = floaterState.determineStartingMeasurements();
			expect(got).toEqual({ width: wantWidth, height: wantHeight });
		});
	});

	describe('removeZGaps', () => {
		it('should compress all z indexes for the bars without changing sort order', () => {
			const bar1 = floaterState.add({ z: 100 });
			const bar2 = floaterState.add({ z: 2000 });
			const bar3 = floaterState.add({ z: 300 });

			floaterState.removeZGaps();
			const { bars } = floaterState;
			expect(bars[0].id).toBe(bar1.id);
			expect(bars[0].z).toBe(floaterState.BASE_Z);

			expect(bars[1].id).toBe(bar2.id);
			expect(bars[1].z).toBe(floaterState.BASE_Z + 2);

			expect(bars[2].id).toBe(bar3.id);
			expect(bars[2].z).toBe(floaterState.BASE_Z + 1);
		});
	});

	describe('add', () => {
		// Most of the functionality is described by the above functions
		// This will just test functionality not described above
		// e.g.: id, title, minimized
		it("should add the bar's id, title, and minimized properties", () => {
			const id = 'unique-id';
			const title = 'Floating Bar';
			const minimized = true;

			const bar = floaterState.add({ id, title, minimized });
			expect(bar.id).toBe(id);
			expect(bar.title).toBe(title);
			expect(bar.minimized).toBe(minimized);
		});

		it("should default to a random UUID, 'New Bar' and minimized to false if not provided", () => {
			const bar = floaterState.add();
			expect(typeof bar.id).toBe('string');
			expect(bar.title).toBe('New Bar');
			expect(bar.minimized).toBe(false);
		});
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

	describe('updateMeasurements', () => {
		it('should return null if the bar does not exist', () => {
			const got = floaterState.updateMeasurements('non-existent', 100, 200);
			expect(got).toBeNull();
		});

		it("should update the bar's width and height if it is found", () => {
			const bar = floaterState.add({ width: 200, height: 300 });
			const got = floaterState.updateMeasurements(bar.id, 250, 350);

			expect(got!.position.width).toBe(250);
			expect(got!.position.height).toBe(350);
		});

		it("should keep the bar's width and height within the minimums", () => {
			const bar = floaterState.add({ width: 200, height: 300 });

			const got = floaterState.updateMeasurements(bar.id, 50, 50);

			expect(got!.position.width).toBe(floaterState.MIN_WIDTH_PX);
			expect(got!.position.height).toBe(floaterState.MIN_HEIGHT_PX);
		});

		it("should keep the bar's width within the maximum", () => {
			const bar = floaterState.add({ width: 200, height: 300 });

			const got = floaterState.updateMeasurements(bar.id, 5000, 50);

			expect(got!.position.width).toBe(floaterState.MAX_WIDTH_PX);
		});

		it("should have a maximum height if the root element's height times the maximum height is greater than the minimum height", () => {
			const rootWidth = 1500;
			const rootHeight = 3500;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const bar = floaterState.add({ width: 200, height: 300 });

			const wantHeight = (floaterState.MAX_HEIGHT_PERCENT * rootHeight) / 100;
			const got = floaterState.updateMeasurements(bar.id, 300, 5000);

			expect(got!.position.height).toBe(wantHeight);
		});

		it("should have a maximum height if the root element's height times the maximum height is greater than the minimum height", () => {
			const bar = floaterState.add({ width: 200, height: 300 });
			const got = floaterState.updateMeasurements(bar.id, 300, 5000);
			expect(got!.position.height).toBe(5000);
		});
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

	describe('move', () => {
		it("should return false if the dragging bar doesn't exist", () => {
			const event = new MouseEvent('mousemove', { clientX: 100, clientY: 100 });
			const got = floaterState.move(event);
			expect(got).toBe(false);
		});

		it("should return false if the root element doesn't exist", () => {
			const bar = floaterState.add();
			const event = new MouseEvent('mousemove', { clientX: 100, clientY: 100 });

			const got = floaterState.startDragging(bar.id, event);
			expect(got).toBe(true);

			floaterState.root = null;
			const got2 = floaterState.move(event);
			expect(got2).toBe(false);
		});

		it("should return false if the dragging bar doesn't exist", () => {
			const root = createRoot(1000, 1500);
			floaterState.root = root;

			const event = new MouseEvent('mousemove', { clientX: 100, clientY: 100 });
			floaterState.dragging = { id: 'non-existant', x: 100, y: 100 };

			const got = floaterState.move(event);
			expect(got).toBe(false);
		});

		it('should increase the top and left of the bar and the x and y of the dragging bar to the new x and y coordinates if they are moved down and to the right', () => {
			const root = createRoot(2000, 3500);
			floaterState.root = root;

			const bar = floaterState.add({ left: 500, top: 600, height: 400, width: 300 });
			const event1 = new MouseEvent('mousemove', { clientX: 1000, clientY: 1100 });

			const got = floaterState.startDragging(bar.id, event1);
			expect(got).toBe(true);

			const event2 = new MouseEvent('mousemove', { clientX: 1200, clientY: 1400 });
			const got2 = floaterState.move(event2);
			expect(got2).toBe(true);

			const wantLeft = 700; // 500 + (1200 - 1000);
			const wantTop = 900; // 600 + (1400 - 1100);
			const gotBar = floaterState.bar(bar.id)!;

			expect(floaterState.dragging).toEqual({ id: bar.id, x: 1200, y: 1400 });
			expect(gotBar.position.left).toBe(wantLeft);
			expect(gotBar.position.top).toBe(wantTop);
		});

		it('should decrease the top and left of the bar and the x and y of the dragging bar to the new x and y coordinates if they are moved down and to the right', () => {
			const root = createRoot(20000, 35000);
			floaterState.root = root;

			const bar = floaterState.add({ left: 5000, top: 6000, height: 400, width: 300 });
			const event1 = new MouseEvent('mousemove', { clientX: 2000, clientY: 2100 });

			const got = floaterState.startDragging(bar.id, event1);
			expect(got).toBe(true);

			const event2 = new MouseEvent('mousemove', { clientX: 1900, clientY: 2000 });
			const got2 = floaterState.move(event2);
			expect(got2).toBe(true);

			const wantLeft = 4900; // 5000 + (1900 - 2000);
			const wantTop = 5900; // 6000 + (2000 - 2100);
			const gotBar = floaterState.bar(bar.id)!;

			expect(floaterState.dragging).toEqual({ id: bar.id, x: 1900, y: 2000 });
			expect(gotBar.position.left).toBe(wantLeft);
			expect(gotBar.position.top).toBe(wantTop);
		});

		it('should not move the left and top below 0', () => {
			const root = createRoot(2000, 3500);
			floaterState.root = root;

			const bar = floaterState.add({ left: 300, top: 300, height: 400, width: 300 });
			const event1 = new MouseEvent('mousemove', { clientX: 1000, clientY: 1100 });

			const got = floaterState.startDragging(bar.id, event1);
			expect(got).toBe(true);

			const event2 = new MouseEvent('mousemove', { clientX: 500, clientY: 500 });
			const got2 = floaterState.move(event2);
			expect(got2).toBe(true);

			const gotBar = floaterState.bar(bar.id)!;

			expect(gotBar.position.left).toBe(0);
			expect(gotBar.position.top).toBe(0);
		});

		it('should keep the top and left below the width of the screen minus the width and buffer', () => {
			const rootWidth = 2000;
			const rootHeight = 3500;
			const root = createRoot(rootWidth, rootHeight);
			floaterState.root = root;

			const barWidth = 300;
			const barHeight = 400;

			const bar = floaterState.add({ left: 1500, top: 3000, height: barHeight, width: barWidth });
			const event1 = new MouseEvent('mousemove', { clientX: 1000, clientY: 1000 });

			const got = floaterState.startDragging(bar.id, event1);
			expect(got).toBe(true);

			const event2 = new MouseEvent('mousemove', { clientX: 2500, clientY: 2500 });
			const got2 = floaterState.move(event2);
			expect(got2).toBe(true);

			const gotBar = floaterState.bar(bar.id)!;

			expect(gotBar.position.left).toBe(rootWidth - barWidth - floaterState.EDGE_BUFFER_PX);
			expect(gotBar.position.top).toBe(rootHeight - barHeight - floaterState.EDGE_BUFFER_PX);
		});
	});

	describe.todo('nudge', () => {
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
