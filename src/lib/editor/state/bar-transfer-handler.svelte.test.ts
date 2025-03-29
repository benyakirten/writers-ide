import { describe, it, expect, beforeEach } from 'vitest';
import TransferHandler from './bar-transfer-handler.svelte';
import FloatingBarState from './floater-state.svelte.js';
import HorizontalBarState, { HorizontalBarPosition } from './horizontal-bar-state.svelte.js';
import VerticalBarState, { VerticalBarPosition } from './vertical-bar-state.svelte.js';

describe('BarTransferHandler', () => {
	beforeEach(() => {
		FloatingBarState.bars = [];
		HorizontalBarState.windowBlockStart = [];
		HorizontalBarState.windowBlockEnd = [];
		VerticalBarState.inlineStart = [];
		VerticalBarState.inlineEnd = [];
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
});
