import { describe, it, expect, beforeEach, test } from 'vitest';
import { FloaterState } from './floater-state.svelte';

describe('FloaterState', () => {
	let floaterState: FloaterState;

	beforeEach(() => {
		floaterState = new FloaterState();
	});

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

	describe.todo('findNextOpenPosition', () => {
		// TODO
	});

	describe.todo('determineStartingCoordinates', () => {
		// TODO
	});

	describe.todo('determineStartingZ', () => {
		// TODO
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

	describe.todo('update', () => {
		it("should update the bar's properties if it is found", () => {
			const bar = floaterState.add({ minimized: true, title: 'Floating Bar' });
			expect(bar.title).toBe('Floating Bar');
			expect(bar.minimized).toBe(true);

			floaterState.update(bar.id, 'title', 'New Title');
			expect(bar.title).toBe('New Title');

			floaterState.update(bar.id, 'minimized', false);
			expect(bar.minimized).toBe(false);
		});
	});
});
