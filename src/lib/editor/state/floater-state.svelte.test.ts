import { describe, it, expect, beforeEach } from 'vitest';

import { FloaterState } from './floater-state.svelte.js';

describe('FloaterState', () => {
	let floaterState: FloaterState;

	beforeEach(() => {
		floaterState = new FloaterState();
	});

	it('should add a new floating bar with default values', () => {
		const bar = floaterState.add();
		expect(bar).toBeDefined();
		expect(bar.position.top).toBe(20);
		expect(bar.position.left).toBe(20);
		expect(bar.position.width).toBeGreaterThanOrEqual(200);
		expect(bar.position.height).toBeGreaterThanOrEqual(100);
		expect(bar.z).toBeGreaterThan(10);
		expect(bar.id).toBeDefined();
		expect(bar.title).toBe('New Bar');
		expect(bar.minimized).toBe(false);
	});

	it('should find a bar by id', () => {
		const bar = floaterState.add();
		const foundBar = floaterState.bar(bar.id);
		expect(foundBar).toBe(bar);
	});

	it('should remove a bar by id', () => {
		const bar = floaterState.add();
		const removed = floaterState.remove(bar.id);
		expect(removed).toBe(true);
		expect(floaterState.bar(bar.id)).toBeUndefined();
	});

	it('should update measurements of a bar', () => {
		const bar = floaterState.add();
		const updatedBar = floaterState.updateMeasurements(bar.id, 300, 150);
		expect(updatedBar).toBeDefined();
		expect(updatedBar?.position.width).toBe(300);
		expect(updatedBar?.position.height).toBe(150);
	});

	it('should start and stop dragging a bar', () => {
		const bar = floaterState.add();
		const startDragging = floaterState.startDragging(bar.id, {
			clientX: 100,
			clientY: 100
		} as MouseEvent);
		expect(startDragging).toBe(true);
		expect(floaterState.dragging).toEqual({ id: bar.id, x: 100, y: 100 });

		floaterState.stopDragging();
		expect(floaterState.dragging).toBeNull();
	});

	// it('should move a bar while dragging', () => {
	// 	const bar = floaterState.add();
	// 	floaterState.root = { clientWidth: 800, clientHeight: 600 } as HTMLElement;
	// 	floaterState.startDragging(bar.id, { clientX: 100, clientY: 100 } as MouseEvent);

	// 	const moved = floaterState.move({
	// 		clientX: 200,
	// 		clientY: 200,
	// 		currentTarget: {} as HTMLElement
	// 	} as MouseEvent);
	// 	expect(moved).toBe(true);
	// 	expect(bar.position.left).toBe(120);
	// 	expect(bar.position.top).toBe(120);
	// });

	it('should nudge a bar in a direction', () => {
		const bar = floaterState.add();
		floaterState.root = { clientWidth: 800, clientHeight: 600 } as HTMLElement;

		floaterState.nudge(bar.id, 'up');
		expect(bar.position.top).toBeLessThan(20);

		floaterState.nudge(bar.id, 'left');
		expect(bar.position.left).toBeLessThan(20);

		floaterState.nudge(bar.id, 'down');
		expect(bar.position.top).toBeGreaterThan(20);

		floaterState.nudge(bar.id, 'right');
		expect(bar.position.left).toBeGreaterThan(20);
	});

	it('should minimize and restore a bar', () => {
		const bar = floaterState.add();
		floaterState.minimize(bar.id, true);
		expect(bar.minimized).toBe(true);

		floaterState.minimize(bar.id, false);
		expect(bar.minimized).toBe(false);
	});

	it('should rename a bar', () => {
		const bar = floaterState.add();
		floaterState.rename(bar.id, 'Updated Title');
		expect(bar.title).toBe('Updated Title');
	});
});
