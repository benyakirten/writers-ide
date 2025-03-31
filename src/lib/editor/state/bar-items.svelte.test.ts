import { describe, it, expect, afterEach, beforeEach, test } from 'vitest';
import { BarItems } from './bar-items.svelte';
import Registry from './bar-item-registry.svelte.js';

describe('BarItems', () => {
	let barItems: BarItems;
	let item1Key: string;
	let item2Key: string;
	let item3Key: string;

	beforeEach(() => {
		item1Key = Registry.register({
			title: 'item1',
			vertical: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				Component: null as any,
				size: 1
			},
			horizontal: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				Component: null as any,
				size: 2
			}
		})[0];

		item2Key = Registry.register({
			title: 'item2',
			vertical: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				Component: null as any,
				size: 2
			},
			horizontal: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				Component: null as any,
				size: 1
			}
		})[0];

		item3Key = Registry.register({
			title: 'item3',
			vertical: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				Component: null as any,
				size: 3
			},
			horizontal: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				Component: null as any,
				size: 3
			}
		})[0];
	});

	afterEach(() => {
		Registry.items.clear();
	});

	it('should initialize with default values', () => {
		barItems = new BarItems(true);
		expect(barItems.isVertical).toBe(true);
		expect(barItems.ids).toEqual([]);
		expect(barItems.maxSize).toBe(3);
	});

	describe('has', () => {
		it('should return false if the id is null', () => {
			barItems = new BarItems(true);
			expect(barItems.has(null)).toBe(false);
		});

		it('should return false if the id is not in the list', () => {
			barItems = new BarItems(true, [item1Key]);
			expect(barItems.has(item2Key)).toBe(false);
		});

		it('should return true if the id is in the list', () => {
			barItems = new BarItems(true, [item1Key]);
			expect(barItems.has(item1Key)).toBe(true);
		});
	});

	describe('ids', () => {
		it('should be an array of all ids of the items in the bar', () => {
			barItems = new BarItems(true, [item1Key]);
			expect(barItems.ids).toEqual([item1Key]);

			barItems.append(item2Key);
			expect(barItems.ids).toEqual([item1Key, item2Key]);
		});
	});

	describe('index', () => {
		it('should return the index of the id in the list if a string is passed in', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.index(item1Key)).toBe(0);
			expect(barItems.index(item2Key)).toBe(1);
		});

		it('should return the index passed in if a number is passed in', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.index(0)).toBe(0);
			expect(barItems.index(1)).toBe(1);
		});

		it('should return -1 if the id is not found in the list', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.index(item3Key)).toBe(-1);
		});

		it('should return -1 if the number is out of bounds', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.index(2)).toBe(-1);
			expect(barItems.index(-2)).toBe(-1);
		});
	});

	describe('append', () => {
		it('should append an item if there is enough space', () => {
			barItems = new BarItems(true, [item1Key]);

			const got = barItems.append(item2Key);
			expect(got).toBe(true);

			expect(barItems.ids).toEqual([item1Key, item2Key]);
		});

		it('should not append an item if there is not enough space', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.append(item3Key);
			expect(got).toBe(false);
			expect(barItems.ids).toEqual([item1Key, item2Key]);
		});

		it('should not append an item if it is already in the list', () => {
			barItems = new BarItems(true, [item1Key]);

			const got = barItems.append(item1Key);
			expect(got).toBe(false);
			expect(barItems.ids).toEqual([item1Key]);
		});
	});

	describe('canSwap', () => {
		it('should return true if both indexes are valid and not equal', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.canSwap(0, 1)).toBe(true);
			expect(barItems.canSwap(1, 0)).toBe(true);
		});

		test.each([
			[0, -1],
			[0, 2],
			[-1, 0],
			[2, 1],
			[1, 1]
		])('should return false for invalid indexes %i and %i', (index1, index2) => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.canSwap(index1, index2)).toBe(false);
		});
	});

	describe('swap', () => {
		it('should swap two items in the list if they are valid indexes', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.swap(0, 1);
			expect(got).toBe(true);
			expect(barItems.ids).toEqual([item2Key, item1Key]);
		});

		it('should not swap if the indexes are invalid', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.swap(0, -1);
			expect(got).toBe(false);
			expect(barItems.ids).toEqual([item1Key, item2Key]);
		});
	});

	describe('availableSpace', () => {
		it('should return the available space for the vertical direction if the items are vertical', () => {
			barItems = new BarItems(true, [item1Key]);
			expect(barItems.availableSpace).toBe(2);
		});

		it('should return the available space for the horizontal direction if the items are horizontal', () => {
			barItems = new BarItems(false, [item1Key]);
			expect(barItems.availableSpace).toBe(1);
		});

		it('should return 0 if there is no space left', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);
			expect(barItems.availableSpace).toBe(0);
		});
	});

	describe('insert', () => {
		it('should insert an item at the specified index if there is enough space', () => {
			barItems = new BarItems(true, [item1Key]);

			const got = barItems.insert(item2Key, 0);
			expect(got).toBe(true);
			expect(barItems.ids).toEqual([item2Key, item1Key]);
		});

		it('should not insert an item if there is not enough space', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.insert(item3Key, 0);
			expect(got).toBe(false);
			expect(barItems.ids).toEqual([item1Key, item2Key]);
		});

		it('should not insert an item if it is already in the list', () => {
			barItems = new BarItems(true, [item1Key]);

			const got = barItems.insert(item1Key, 0);
			expect(got).toBe(false);
			expect(barItems.ids).toEqual([item1Key]);
		});
	});

	describe('remove', () => {
		it('should remove an item from the list by id if a string is passed in', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.remove(item1Key);
			expect(got).toBe(true);
			expect(barItems.ids).toEqual([item2Key]);
		});

		it('should remove an item from the list by index if a number is passed in', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.remove(0);
			expect(got).toBe(true);
			expect(barItems.ids).toEqual([item2Key]);
		});

		it('should not remove an item if the id is not found', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.remove(item3Key);
			expect(got).toBe(false);
			expect(barItems.ids).toEqual([item1Key, item2Key]);
		});
	});

	describe('canFit', () => {
		it('should return true if there is enough space for the item', () => {
			barItems = new BarItems(true, [item1Key]);

			const got = barItems.canFit(item2Key);
			expect(got).toBe(true);
		});

		it('should return false if there is not enough space for the item', () => {
			barItems = new BarItems(true, [item1Key, item2Key]);

			const got = barItems.canFit(item3Key);
			expect(got).toBe(false);
		});

		it('should return false if the item is already in the list', () => {
			barItems = new BarItems(true, [item1Key]);

			const got = barItems.canFit(item1Key);
			expect(got).toBe(false);
		});
	});
});
