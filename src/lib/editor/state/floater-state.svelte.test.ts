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

	describe.todo('sortBarsByZIndex', () => {
		// TODO
	});

	describe.todo('add', () => {
		// TODO
	});

	describe.todo('focus', () => {
		// TODO
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

	describe.todo('startDragging', () => {
		// TODO
	});

	describe.todo('stopDragging', () => {
		// TODO
	});

	describe.todo('nudge', () => {
		// TODO
	});

	describe.todo('move', () => {
		// TODO
	});

	describe.todo('update', () => {
		// TODO
	});

	// describe('focus', () => {
	// 	it('should focus a floating bar', () => {
	// 		const bar1 = floaterState.add();
	// 		const bar2 = floaterState.add();
	// 		floaterState.focus(bar1.id);
	// 		expect(bar1.z).toBeGreaterThan(bar2.z);
	// 	});
	// });

	// describe('add', () => {
	// 	// TODO: Add tests for every possible condition
	// 	it('should add a new floating bar', () => {
	// 		const bar = floaterState.add();
	// 		expect(bar).toBeDefined();
	// 		expect(floaterState.bars.length).toBe(1);
	// 		expect(bar.position.top).toBeGreaterThan(0);
	// 		expect(bar.position.left).toBeGreaterThan(0);
	// 	});
	// });

	// describe('updateMeasurements', () => {
	// 	it('should update measurements of a floating bar', () => {
	// 		const bar = floaterState.add();
	// 		floaterState.updateMeasurements(bar.id, 300, 200);
	// 		expect(bar.position.width).toBe(300);
	// 		expect(bar.position.height).toBe(200);
	// 	});
	// });

	// it('should start dragging a floating bar', () => {
	// 	const bar = floaterState.add();
	// 	const event = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
	// 	const result = floaterState.startDragging(bar.id, event);
	// 	expect(result).toBe(true);
	// 	expect(floaterState.dragging).toBeDefined();
	// });

	// it('should stop dragging a floating bar', () => {
	// 	const bar = floaterState.add();
	// 	const event = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
	// 	floaterState.startDragging(bar.id, event);
	// 	floaterState.stopDragging();
	// 	expect(floaterState.dragging).toBeNull();
	// });

	// it('should move a floating bar', () => {
	// 	const bar = floaterState.add();
	// 	const startEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
	// 	floaterState.startDragging(bar.id, startEvent);
	// 	const moveEvent = new MouseEvent('mousemove', { clientX: 200, clientY: 200 });
	// 	floaterState.move({ ...moveEvent, currentTarget: floaterState.root! });
	// 	expect(bar.position.left).toBeGreaterThan(100);
	// 	expect(bar.position.top).toBeGreaterThan(100);
	// });

	// it('should minimize a floating bar', () => {
	// 	const bar = floaterState.add();
	// 	floaterState.minimize(bar.id, true);
	// 	expect(bar.minimized).toBe(true);
	// });

	// it('should rename a floating bar', () => {
	// 	const bar = floaterState.add();
	// 	floaterState.rename(bar.id, 'New Title');
	// 	expect(bar.title).toBe('New Title');
	// });

	// it('should nudge a floating bar', () => {
	// 	const bar = floaterState.add();
	// 	const initialTop = bar.position.top;
	// 	floaterState.nudge(bar.id, 'down');
	// 	expect(bar.position.top).toBeGreaterThan(initialTop);
	// });
});
