import { describe, it, expect, beforeEach } from 'vitest';
import {
	HorizontalBarState,
	HorizontalBarPosition,
	type HorizontalBar
} from './horizontal-bar-state.svelte';

describe('HorizontalBarState', () => {
	let state: HorizontalBarState;
	const WINDOW_MIN_SIZE = 50;
	const EDITOR_MIN_SIZE = 30;

	beforeEach(() => {
		state = new HorizontalBarState(WINDOW_MIN_SIZE, EDITOR_MIN_SIZE);
	});

	function makeEvent(
		clientY: number,
		{ top = 0, bottom = 0 }: { top: number; bottom: number }
	): MouseEvent {
		const target = document.createElement('div');
		const getBoundingClientRect = () => ({ top, bottom });

		// @ts-expect-error: Test Object
		target.getBoundingClientRect = getBoundingClientRect;

		// @ts-expect-error: Test Object
		return {
			clientY,
			target
		};
	}

	describe('bars', () => {
		it('should return the list of window start bars if the position is WindowBlockStart', () => {
			const windowStartBar: HorizontalBar = {
				data: null,
				id: 'window-start-1',
				visible: true,
				height: 100
			};

			state.add(windowStartBar, HorizontalBarPosition.WindowBlockStart);
			const bars = state.bars(HorizontalBarPosition.WindowBlockStart);
			expect(bars).toEqual([windowStartBar]);
		});

		it('should return the list of window end bars if the position is WindowBlockEnd', () => {
			const windowEndBar: HorizontalBar = {
				data: null,
				id: 'window-end-1',
				visible: true,
				height: 100
			};

			state.add(windowEndBar, HorizontalBarPosition.WindowBlockEnd);
			const bars = state.bars(HorizontalBarPosition.WindowBlockEnd);
			expect(bars).toEqual([windowEndBar]);
		});

		it('should return the list of editor start bars if the position is EditorBlockStart', () => {
			const editorStartBar: HorizontalBar = {
				data: null,
				id: 'editor-start-1',
				visible: true,
				height: 100
			};

			state.add(editorStartBar, HorizontalBarPosition.EditorBlockStart);
			const bars = state.bars(HorizontalBarPosition.EditorBlockStart);
			expect(bars).toEqual([editorStartBar]);
		});

		it('should return the list of editor end bars if the position is EditorBlockEnd', () => {
			const editorEndBar: HorizontalBar = {
				data: null,
				id: 'editor-end-1',
				visible: true,
				height: 100
			};

			state.add(editorEndBar, HorizontalBarPosition.EditorBlockEnd);
			const bars = state.bars(HorizontalBarPosition.EditorBlockEnd);
			expect(bars).toEqual([editorEndBar]);
		});
	});

	describe('add', () => {
		it('should add a bar to the window start list if the position is WindowBlockStart', () => {
			const bar = state.add(
				{ height: 100, id: 'window-start-1' },
				HorizontalBarPosition.WindowBlockStart
			);
			expect(state.windowBlockStart).toEqual([bar]);
		});

		it('should add a bar to the window end list if the position is WindowBlockEnd', () => {
			const bar = state.add(
				{ height: 100, id: 'window-end-1' },
				HorizontalBarPosition.WindowBlockEnd
			);
			expect(state.windowBlockEnd).toEqual([bar]);
		});

		it('should add a bar to the editor start list if the position is EditorBlockStart', () => {
			const bar = state.add(
				{ height: 100, id: 'editor-start-1' },
				HorizontalBarPosition.EditorBlockStart
			);
			expect(state.editorBlockStart).toEqual([bar]);
		});

		it('should add a bar to the editor end list if the position is EditorBlockEnd', () => {
			const bar = state.add(
				{ height: 100, id: 'editor-end-1' },
				HorizontalBarPosition.EditorBlockEnd
			);
			expect(state.editorBlockEnd).toEqual([bar]);
		});
	});

	describe('bar', () => {
		it('should find a bar by id if given a number', () => {
			const bar = state.add(
				{ height: 100, id: 'window-start-1' },
				HorizontalBarPosition.WindowBlockStart
			);
			expect(state.bar(0, HorizontalBarPosition.WindowBlockStart)).toEqual(bar);
		});

		it('should find a bar by id if given a string', () => {
			const bar = state.add(
				{ height: 100, id: 'window-end-1' },
				HorizontalBarPosition.WindowBlockEnd
			);
			expect(state.bar('window-end-1', HorizontalBarPosition.WindowBlockEnd)).toEqual(bar);
		});

		it('should return undefined if the bar does not exist', () => {
			expect(state.bar('non-existent', HorizontalBarPosition.WindowBlockStart)).toBeUndefined();
		});
	});

	describe('height', () => {
		it("should return the height of a bar if it's visible and the height is over the minimum size", () => {
			const bar = {
				height: 100,
				id: 'window-start-1',
				visible: true
			};

			const got = state.height(bar, HorizontalBarPosition.WindowBlockStart);
			expect(got).toBe(100);
		});

		it('should return 0 if the bar is not visible', () => {
			const bar = {
				height: 100,
				id: 'window-start-1',
				visible: false
			};

			const got = state.height(bar, HorizontalBarPosition.WindowBlockEnd);
			expect(got).toBe(0);
		});

		it('should return 0 if the bar is visible but the height is below the minimum size', () => {
			const bar = { height: WINDOW_MIN_SIZE / 2, id: 'window-start-1', visible: true };
			const got = state.height(bar, HorizontalBarPosition.WindowBlockStart);
			expect(got).toBe(0);
		});
	});

	describe('toggleBar', () => {
		it('should toggle the visibility of a bar', () => {
			const bar = state.add(
				{ id: 'window-start-1', visible: true },
				HorizontalBarPosition.WindowBlockStart
			);

			state.toggleBar(bar, HorizontalBarPosition.WindowBlockStart);
			expect(bar.visible).toBe(false);

			state.toggleBar(bar, HorizontalBarPosition.WindowBlockStart);
			expect(bar.visible).toBe(true);
		});

		it("should set the bar's height to the minimum size if the bar is being toggled to visible", () => {
			const bar = {
				height: 0,
				id: 'window-start-1',
				visible: false
			};

			state.toggleBar(bar, HorizontalBarPosition.WindowBlockStart);
			expect(bar.height).toBe(WINDOW_MIN_SIZE);
		});
	});

	describe('toggle', () => {
		it('should toggle the visibility of a bar by index if a number is provided', () => {
			state.add({ id: 'window-start-1', visible: true }, HorizontalBarPosition.WindowBlockStart);

			let got = state.toggle(0, HorizontalBarPosition.WindowBlockStart);
			const [bar] = state.windowBlockStart;
			expect(bar.visible).toBe(false);
			expect(got).toBe(true);

			got = state.toggle(0, HorizontalBarPosition.WindowBlockStart);
			expect(bar.visible).toBe(true);
			expect(got).toBe(true);
		});

		it('should toggle the visibility of a bar by its id if a string is provided', () => {
			state.add({ id: 'window-start-1', visible: true }, HorizontalBarPosition.WindowBlockStart);
			const [bar] = state.windowBlockStart;

			let got = state.toggle('window-start-1', HorizontalBarPosition.WindowBlockStart);
			expect(bar.visible).toBe(false);
			expect(got).toBe(true);

			got = state.toggle('window-start-1', HorizontalBarPosition.WindowBlockStart);
			expect(bar.visible).toBe(true);
			expect(got).toBe(true);
		});

		it('should not toggle a bar if the bar is being resized', () => {
			state.add({ id: 'window-start-1', visible: true }, HorizontalBarPosition.WindowBlockEnd);
			const [bar] = state.windowBlockEnd;

			state.startResize('window-start-1', HorizontalBarPosition.WindowBlockEnd, 0);
			state.resizedSection!.resized = true;

			const got = state.toggle('window-start-1', HorizontalBarPosition.WindowBlockEnd);
			expect(bar.visible).toBe(true);
			expect(got).toBe(false);
		});
	});

	describe('startResize', () => {
		it('should start resizing a bar', () => {
			state.startResize('window-start-1', HorizontalBarPosition.WindowBlockStart, 100);
			expect(state.resizedSection).toEqual({
				id: 'window-start-1',
				position: HorizontalBarPosition.WindowBlockStart,
				y: 100,
				resized: false
			});
		});
	});

	describe('resize', () => {
		function createBarAndStartResizing(
			height: number,
			y: number,
			position: HorizontalBarPosition,
			visible = true
		) {
			const id = crypto.randomUUID();
			const bar = state.add({ height, id, visible }, position);
			state.startResize(id, position, y);
			return bar;
		}

		it('should set the resized property to true, change the height on the bar, change the y coordinate of the resized section', async () => {
			createBarAndStartResizing(150, 150, HorizontalBarPosition.WindowBlockStart);
			const evt = makeEvent(175, { top: 225, bottom: 275 });

			const got = await state.resize(evt);

			const [bar] = state.windowBlockStart;
			expect(got).toBe(true);
			expect(bar.height).toEqual(175);
			expect(state.resizedSection!.resized).toBe(true);
			expect(state.resizedSection!.y).toBe(175);
		});

		it('should subtract the distance from the bar height instead if the bar should be inverted', async () => {
			createBarAndStartResizing(150, 150, HorizontalBarPosition.WindowBlockEnd);
			const evt = makeEvent(175, { top: 225, bottom: 275 });

			const got = await state.resize(evt);

			const [bar] = state.windowBlockEnd;
			expect(got).toBe(true);
			expect(bar.height).toEqual(125);
			expect(state.resizedSection!.resized).toBe(true);
			expect(state.resizedSection!.y).toBe(175);
		});

		it('should set the bar to visible if it was previously not visible and the new size is larger than the minimum size', async () => {
			createBarAndStartResizing(50, 50, HorizontalBarPosition.WindowBlockStart, false);
			const evt = makeEvent(75, { top: 125, bottom: 175 });

			const got = await state.resize(evt);
			const [bar] = state.windowBlockStart;
			expect(got).toBe(true);
			expect(bar.visible).toBe(true);
			expect(bar.height).toBe(75);
		});

		it("should set the bar to 0 height if the new size is below the minimum size and update the resizedSection y to the target's top if it should not invert", async () => {
			createBarAndStartResizing(50, 50, HorizontalBarPosition.WindowBlockStart);
			const evt = makeEvent(25, { top: 75, bottom: 125 });

			const got = await state.resize(evt);
			const [bar] = state.windowBlockStart;
			expect(got).toBe(true);
			expect(bar.height).toBe(0);
			expect(state.resizedSection!.y).toBe(75);
		});

		it("should set the bar to 0 height if the new size is below the minimum size and update the resizedSection y to the target's bottom if it should invert", async () => {
			createBarAndStartResizing(50, 50, HorizontalBarPosition.WindowBlockEnd);
			const evt = makeEvent(75, { top: 75, bottom: 125 });

			const got = await state.resize(evt);
			const [bar] = state.windowBlockEnd;
			expect(got).toBe(true);
			expect(bar.height).toBe(0);
			expect(state.resizedSection!.y).toBe(125);
		});

		it("should not resize the section if the event's target is not an HTMLElement", async () => {
			createBarAndStartResizing(150, 150, HorizontalBarPosition.WindowBlockStart);
			const evt = {
				clientY: 100,
				target: { getBoundingClientRect: () => ({ top: 225, bottom: 275 }) }
			} as unknown as MouseEvent;
			const got = await state.resize(evt);
			expect(got).toBe(false);

			const [bar] = state.windowBlockStart;
			expect(bar.height).toBe(150);
			expect(state.resizedSection!.resized).toBe(false);
			expect(state.resizedSection!.y).toBe(150);
		});

		it("should not resize the section if the bar doesn't exist and return false", async () => {
			state.startResize('window-start-1', HorizontalBarPosition.WindowBlockStart, 200);
			const evt = makeEvent(100, { top: 225, bottom: 275 });

			const got = await state.resize(evt);

			expect(got).toBe(false);
			expect(state.resizedSection!.resized).toBe(false);
			expect(state.resizedSection!.y).toBe(200);
		});

		it('should return false if there is no resized section', async () => {
			createBarAndStartResizing(150, 150, HorizontalBarPosition.WindowBlockStart);
			const evt = makeEvent(100, { top: 225, bottom: 275 });
			await state.endResize();

			const got = await state.resize(evt);
			const [bar] = state.windowBlockStart;

			expect(got).toBe(false);
			expect(bar.height).toBe(150);
		});
	});

	describe('endResize', () => {
		it('should end resizing a bar', async () => {
			state.startResize('window-start-1', HorizontalBarPosition.WindowBlockStart, 100);
			await state.endResize();
			expect(state.resizedSection).toBeNull();
		});
	});

	describe('humanize', () => {
		beforeEach(() => {
			state.add({ id: 'window-start-1', visible: true }, HorizontalBarPosition.WindowBlockStart);
			state.add({ id: 'window-end-1', visible: true }, HorizontalBarPosition.WindowBlockEnd);
			state.add({ id: 'editor-start-1', visible: true }, HorizontalBarPosition.EditorBlockStart);
			state.add({ id: 'editor-end-1', visible: true }, HorizontalBarPosition.EditorBlockEnd);
		});

		it('should return the humanized description for a window start bar by index', () => {
			const description = state.humanize(0, HorizontalBarPosition.WindowBlockStart);
			expect(description).toBe('Window block start #1');
		});

		it('should return the humanized description for a window end bar by index', () => {
			const description = state.humanize(0, HorizontalBarPosition.WindowBlockEnd);
			expect(description).toBe('Window block end #1');
		});

		it('should return the humanized description for an editor start bar by index', () => {
			const description = state.humanize(0, HorizontalBarPosition.EditorBlockStart);
			expect(description).toBe('Editor block start #1');
		});

		it('should return the humanized description for an editor end bar by index', () => {
			const description = state.humanize(0, HorizontalBarPosition.EditorBlockEnd);
			expect(description).toBe('Editor block end #1');
		});

		it('should return the humanized description for a window start bar by id', () => {
			const description = state.humanize('window-start-1', HorizontalBarPosition.WindowBlockStart);
			expect(description).toBe('Window block start #1');
		});

		it('should return the humanized description for a window end bar by id', () => {
			const description = state.humanize('window-end-1', HorizontalBarPosition.WindowBlockEnd);
			expect(description).toBe('Window block end #1');
		});

		it('should return the humanized description for an editor start bar by id', () => {
			const description = state.humanize('editor-start-1', HorizontalBarPosition.EditorBlockStart);
			expect(description).toBe('Editor block start #1');
		});

		it('should return the humanized description for an editor end bar by id', () => {
			const description = state.humanize('editor-end-1', HorizontalBarPosition.EditorBlockEnd);
			expect(description).toBe('Editor block end #1');
		});

		it('should return unknown description if the bar does not exist by index', () => {
			const description = state.humanize(999, HorizontalBarPosition.WindowBlockStart);
			expect(description).toBe('Unknown window block start');
		});

		it('should return unknown description if the bar does not exist by id', () => {
			const description = state.humanize('non-existent', HorizontalBarPosition.WindowBlockStart);
			expect(description).toBe('Unknown window block start');
		});
	});
});
