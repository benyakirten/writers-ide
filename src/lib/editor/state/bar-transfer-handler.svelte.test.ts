import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import TransferHandler from './bar-transfer-handler.svelte';
import FloatingBarState from './floater-state.svelte.js';
import HorizontalBarState, { HorizontalBarPosition } from './horizontal-bar-state.svelte.js';
import VerticalBarState, { VerticalBarPosition } from './vertical-bar-state.svelte.js';
import Registry from './bar-item-registry.svelte';

describe('BarTransferHandler', () => {
	let item1Key: string;
	let item2Key: string;
	let item3Key: string;

	afterEach(() => {
		Registry.items.clear();
	});

	beforeEach(() => {
		FloatingBarState.bars = [];
		HorizontalBarState.windowBlockStart = [];
		HorizontalBarState.windowBlockEnd = [];
		VerticalBarState.inlineStart = [];
		VerticalBarState.inlineEnd = [];

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

	describe('moveMenu', () => {
		it('should return false if from and to locations are the same', () => {
			const bar = FloatingBarState.add();
			const result = TransferHandler.moveMenu('floating', bar.id, 'floating');
			expect(result).toBe(false);
		});

		it("should return false if the bar doesn't exist in the from location", () => {
			const bar = VerticalBarState.add({}, VerticalBarPosition.InlineStart);
			const result = TransferHandler.moveMenu(
				HorizontalBarPosition.WindowBlockStart,
				bar.id,
				VerticalBarPosition.InlineEnd
			);
			expect(result).toBe(false);

			expect(VerticalBarState.inlineStart.find((b) => b.id === bar.id)).not.toBeUndefined();
			expect(HorizontalBarState.windowBlockStart).toHaveLength(0);
		});

		it('should remove the bar from the from set, add it to the end of the new bar and return true', () => {
			const horizontalBar = HorizontalBarState.add(
				{ data: ['a', 'b', 'c'] },
				HorizontalBarPosition.WindowBlockStart
			);
			const verticalBar1 = VerticalBarState.add({}, VerticalBarPosition.InlineStart);
			const verticalBar2 = VerticalBarState.add({}, VerticalBarPosition.InlineStart);

			const result = TransferHandler.moveMenu(
				HorizontalBarPosition.WindowBlockStart,
				horizontalBar.id,
				VerticalBarPosition.InlineStart
			);
			expect(result).toBe(true);
			expect(HorizontalBarState.windowBlockStart).toHaveLength(0);

			expect(VerticalBarState.inlineStart).toHaveLength(3);
			expect(VerticalBarState.inlineStart[0].id).toBe(verticalBar1.id);
			expect(VerticalBarState.inlineStart[1].id).toBe(verticalBar2.id);
			expect(VerticalBarState.inlineStart[2].data.ids).toEqual(horizontalBar.data.ids);
		});
	});

	describe('swapBarPosition', () => {
		it('should return false if the position is floating', () => {
			const bar1 = FloatingBarState.add();
			const bar2 = FloatingBarState.add();
			const result = TransferHandler.swapBarPosition(bar1.id, 'floating', bar2.id);

			expect(result).toBe(false);
			expect(FloatingBarState.bars[0].id).toBe(bar1.id);
			expect(FloatingBarState.bars[1].id).toBe(bar2.id);
		});

		it("should return false if either the from or to bar doesn't exist", () => {
			const bar1 = HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart);
			const bar2 = HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart);

			const result = TransferHandler.swapBarPosition(
				bar1.id,
				HorizontalBarPosition.WindowBlockStart,
				'nonexistent'
			);
			expect(result).toBe(false);

			expect(HorizontalBarState.windowBlockStart[0].id).toBe(bar1.id);
			expect(HorizontalBarState.windowBlockStart[1].id).toBe(bar2.id);

			const result2 = TransferHandler.swapBarPosition(
				'nonexistent',
				HorizontalBarPosition.WindowBlockStart,
				bar2.id
			);
			expect(result2).toBe(false);
			expect(HorizontalBarState.windowBlockStart[0].id).toBe(bar1.id);
			expect(HorizontalBarState.windowBlockStart[1].id).toBe(bar2.id);
		});

		it('should return true and swap the bar positions on the same bar', () => {
			const bar1 = HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart);
			const bar2 = HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart);

			const result = TransferHandler.swapBarPosition(
				bar1.id,
				HorizontalBarPosition.WindowBlockStart,
				bar2.id
			);
			expect(result).toBe(true);

			expect(HorizontalBarState.windowBlockStart[0].id).toBe(bar2.id);
			expect(HorizontalBarState.windowBlockStart[1].id).toBe(bar1.id);
		});
	});

	describe('relocateItem', () => {
		it('should return false if the from and to locations are the same', () => {
			const bar = HorizontalBarState.add({}, HorizontalBarPosition.WindowBlockStart);
			const result = TransferHandler.relocateItem(
				{ location: HorizontalBarPosition.WindowBlockStart, barId: bar.id, itemId: item1Key },
				HorizontalBarPosition.WindowBlockStart
			);
			expect(result).toBe(false);
		});

		it('should create a new bar in the target location if no bar exists or the item cannot fit', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const result = TransferHandler.relocateItem(
				{ location: HorizontalBarPosition.WindowBlockStart, barId: bar.id, itemId: item1Key },
				VerticalBarPosition.InlineStart
			);

			expect(result).toBe(true);
			expect(HorizontalBarState.windowBlockStart).toHaveLength(0);
			expect(VerticalBarState.inlineStart).toHaveLength(1);
			expect(VerticalBarState.inlineStart[0].data.ids).toContain(item1Key);
		});

		it('should append the item to the last bar in the target location if it can fit', () => {
			const bar1 = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = VerticalBarState.add({ data: [item2Key] }, VerticalBarPosition.InlineStart);

			const result = TransferHandler.relocateItem(
				{ location: HorizontalBarPosition.WindowBlockStart, barId: bar1.id, itemId: item1Key },
				VerticalBarPosition.InlineStart
			);

			expect(result).toBe(true);
			expect(HorizontalBarState.windowBlockStart).toHaveLength(0);
			expect(bar2.data.ids).toContain(item1Key);
		});

		it('should focus the bar where the item transferred in the floating state if the target location is floating', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const floatingBar1 = FloatingBarState.add({
				data: [item3Key]
			});
			const floatingBar2 = FloatingBarState.add({});

			FloatingBarState.focus(floatingBar1.id);
			expect(FloatingBarState.highestBar?.id).toEqual(floatingBar1.id);

			const result = TransferHandler.relocateItem(
				{ location: HorizontalBarPosition.WindowBlockStart, barId: bar.id, itemId: item1Key },
				'floating'
			);

			expect(result).toBe(true);
			expect(HorizontalBarState.windowBlockStart).toHaveLength(0);
			expect(FloatingBarState.bars).toHaveLength(2);
			expect(floatingBar2.data.ids).toContain(item1Key);
			expect(FloatingBarState.highestBar?.id).toEqual(floatingBar2.id);
		});
	});

	describe('remove', () => {
		it("should return false if the bar doesn't exist", () => {
			const result = TransferHandler.remove(
				HorizontalBarPosition.WindowBlockStart,
				'nonexistent',
				item1Key
			);
			expect(result).toBe(false);
		});

		it('should remove the item from the bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key, item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.remove(
				HorizontalBarPosition.WindowBlockStart,
				bar.id,
				item1Key
			);
			expect(result).toBe(true);
			expect(bar.data.ids).not.toContain(item1Key);
			expect(bar.data.ids).toContain(item2Key);
		});

		it("should delete the bar if it's empty and deleteBarIfEmpty is true", () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.remove(
				HorizontalBarPosition.WindowBlockStart,
				bar.id,
				item1Key
			);
			expect(result).toBe(true);
			expect(HorizontalBarState.windowBlockStart).toHaveLength(0);
		});
	});

	describe('isBarLocation', () => {
		it('should return true for valid bar locations', () => {
			expect(TransferHandler.isBarLocation('floating')).toBe(true);
			expect(TransferHandler.isBarLocation(HorizontalBarPosition.WindowBlockStart)).toBe(true);
			expect(TransferHandler.isBarLocation(HorizontalBarPosition.WindowBlockEnd)).toBe(true);
			expect(TransferHandler.isBarLocation(VerticalBarPosition.InlineStart)).toBe(true);
			expect(TransferHandler.isBarLocation(VerticalBarPosition.InlineEnd)).toBe(true);
		});
		it('should return false for invalid bar locations', () => {
			expect(TransferHandler.isBarLocation('invalid')).toBe(false);
			expect(TransferHandler.isBarLocation('')).toBe(false);
		});
	});

	describe('append', () => {
		it("should return false if the bar doesn't exist", () => {
			const result = TransferHandler.append(
				HorizontalBarPosition.WindowBlockStart,
				'nonexistent',
				item1Key
			);
			expect(result).toBe(false);
		});

		it("should return false if the item doesn't fit in the bar", () => {
			const bar = HorizontalBarState.add(
				{ data: [item3Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.append(
				HorizontalBarPosition.WindowBlockStart,
				bar.id,
				item1Key
			);
			expect(result).toBe(false);
			expect(bar.data.ids).not.toContain(item1Key);
		});

		it('should append the item to the end of the bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.append(
				HorizontalBarPosition.WindowBlockStart,
				bar.id,
				item2Key
			);
			expect(result).toBe(true);
			expect(bar.data.ids).toContain(item1Key);
			expect(bar.data.ids).toContain(item2Key);
		});
	});

	describe('insert', () => {
		it("should return false if the bar doesn't exist", () => {
			const result = TransferHandler.insert(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: 'nonexistent',
					itemId: item1Key
				},
				0
			);
			expect(result).toBe(false);
		});

		it("should return false if the item doesn't fit in the bar", () => {
			const bar = HorizontalBarState.add(
				{ data: [item3Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.insert(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item1Key
				},
				0
			);
			expect(result).toBe(false);
			expect(bar.data.ids).not.toContain(item1Key);
		});

		it('should insert the item at the specified index in the bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.insert(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item2Key
				},
				0
			);
			expect(result).toBe(true);
			expect(bar.data.ids[0]).toBe(item2Key);
			expect(bar.data.ids[1]).toBe(item1Key);
		});
	});

	describe('swap', () => {
		it("should return false if the bar doesn't exist", () => {
			const result = TransferHandler.swap(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: 'nonexistent',
					itemId: item1Key
				},
				item2Key
			);
			expect(result).toBe(false);
		});

		it("should return false if the item doesn't exist in the bar", () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.swap(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: 'nonexistent'
				},
				item2Key
			);
			expect(result).toBe(false);
			expect(bar.data.ids).not.toContain(item2Key);
		});

		it('should swap the items in the bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key, item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.swap(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item1Key
				},
				item2Key
			);
			expect(result).toBe(true);
			expect(bar.data.ids[0]).toBe(item2Key);
			expect(bar.data.ids[1]).toBe(item1Key);
		});
	});

	describe('nudge', () => {
		it('should return false if the location is floating', () => {
			const bar = FloatingBarState.add();
			FloatingBarState.add();
			const result = TransferHandler.nudge(
				{
					location: 'floating',
					barId: bar.id,
					itemId: item1Key
				},
				1
			);
			expect(result).toBe(false);
		});

		it("should return false if the bar doesn't exist", () => {
			HorizontalBarState.add({ data: [item1Key] }, HorizontalBarPosition.WindowBlockStart);
			HorizontalBarState.add({ data: [item1Key] }, HorizontalBarPosition.WindowBlockStart);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: 'nonexistent',
					itemId: item1Key
				},
				1
			);
			expect(result).toBe(false);
		});

		it("should return false if the item doesn't exist in the bar", () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			HorizontalBarState.add({ data: [item1Key] }, HorizontalBarPosition.WindowBlockStart);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: 'nonexistent'
				},
				1
			);
			expect(result).toBe(false);
		});

		it('should return false if there are less than 2 bars in the location', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item1Key
				},
				1
			);
			expect(result).toBe(false);
		});

		it('should return false if the item should be transferred before the first bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item1Key
				},
				-1
			);
			expect(result).toBe(false);
			expect(bar.data.ids).toContain(item1Key);
			expect(bar2.data.ids).toContain(item2Key);
		});

		it('should return false if the item should be transferred after the last bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar2.id,
					itemId: item1Key
				},
				1
			);
			expect(result).toBe(false);
			expect(bar.data.ids).toContain(item1Key);
			expect(bar2.data.ids).toContain(item2Key);
		});

		it('should create a new interstitial bar if the item already exists in the target bar', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key, item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item2Key
				},
				1
			);

			expect(result).toBe(true);

			const bars = HorizontalBarState.bars(HorizontalBarPosition.WindowBlockStart);
			expect(bars).toHaveLength(3);
			expect(bars[0].id).toBe(bar.id);
			expect(bars[1].id).toBe(bar2.id);
			expect(bar.data.ids).toEqual([item1Key]);
			expect(bars[2].data.ids).toEqual([item2Key]);
			expect(bar2.data.ids).toEqual([item2Key]);
		});

		it('should remove the item from one bar and add it to the next bar in the case of a positive nudge', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item1Key
				},
				1
			);
			expect(result).toBe(true);
			expect(bar.data.ids).not.toContain(item1Key);
			expect(bar2.data.ids).toContain(item1Key);
		});

		it('should remove the item from one bar and add it to the previous bar in the case of a negative nudge', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar2.id,
					itemId: item2Key
				},
				-1
			);

			expect(result).toBe(true);
			expect(bar2.data.ids).not.toContain(item2Key);
			expect(bar.data.ids).toContain(item1Key);
		});

		it('should create a new bar in the positive direction after the current target if the item cannot fit', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key, item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item3Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar3 = HorizontalBarState.add(
				{ data: [item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar.id,
					itemId: item1Key
				},
				1
			);

			expect(result).toBe(true);

			const bars = HorizontalBarState.windowBlockStart;
			expect(bars).toHaveLength(4);
			expect(bars[0].id).toBe(bar.id);
			expect(bars[1].id).toBe(bar2.id);
			expect(bars[3].id).toBe(bar3.id);
			expect(bar.data.ids).toEqual([item2Key]);
			expect(bar2.data.ids).toEqual([item3Key]);
			expect(bars[2].data.ids).toEqual([item1Key]);
			expect(bars[3].data.ids).toEqual([item2Key]);
		});

		it('should create a new bar in the negative direction before the current target if the item cannot fit', () => {
			const bar = HorizontalBarState.add(
				{ data: [item1Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar2 = HorizontalBarState.add(
				{ data: [item3Key] },
				HorizontalBarPosition.WindowBlockStart
			);
			const bar3 = HorizontalBarState.add(
				{ data: [item1Key, item2Key] },
				HorizontalBarPosition.WindowBlockStart
			);

			const result = TransferHandler.nudge(
				{
					location: HorizontalBarPosition.WindowBlockStart,
					barId: bar3.id,
					itemId: item1Key
				},
				-1
			);

			expect(result).toBe(true);

			const bars = HorizontalBarState.windowBlockStart;
			expect(bars).toHaveLength(4);
			expect(bars[0].id).toEqual(bar.id);
			expect(bars[2].id).toEqual(bar2.id);
			expect(bars[3].id).toEqual(bar3.id);
			expect(bars[0].data.ids).toEqual([item1Key]);
			expect(bars[1].data.ids).toEqual([item1Key]);
			expect(bars[2].data.ids).toEqual([item3Key]);
			expect(bars[3].data.ids).toEqual([item2Key]);
		});
	});
});
