import { describe, it, expect, beforeEach } from 'vitest';

import { TabState } from './tab-state.svelte.js';

describe('TabState', () => {
	let tabState: TabState;

	beforeEach(() => {
		tabState = new TabState();
	});

	describe('createTab', () => {
		it('should create a new tab with no view and return the id of the window', () => {
			const id = tabState.createTab();
			expect(tabState.windows).toHaveLength(1);
			expect(tabState.windows[0].id).toBe(id);
			expect(tabState.windows[0].view).toBeUndefined();
		});
	});

	describe('registerEditor', () => {
		it('should register a tab, assign the data to the view and return a function that removes the editor', () => {
			const id = tabState.createTab();
			const symbol = Symbol('view');
			const unregister = tabState.registerEditor(id, symbol as unknown as null);

			expect(tabState.windows[0].view).toBe(symbol);

			const id2 = tabState.createTab();
			const id3 = tabState.createTab();

			unregister();
			expect(tabState.windows).toHaveLength(2);
			expect(tabState.windows[0].id).toBe(id2);
			expect(tabState.windows[1].id).toBe(id3);
		});
	});

	describe('remove', () => {
		it('should remove a tab', () => {
			const id = tabState.createTab();
			const id2 = tabState.createTab();

			tabState.remove(id);

			expect(tabState.windows).toHaveLength(1);
			expect(tabState.windows[0].id).toBe(id2);
		});
	});

	describe('swap', () => {
		it('should swap two tabs by id', () => {
			const id1 = tabState.createTab();
			const id2 = tabState.createTab();
			const result = tabState.swap(id1, id2);
			expect(result).toBe(true);
			expect(tabState.windows[0].id).toBe(id2);
			expect(tabState.windows[1].id).toBe(id1);
		});
	});

	describe('swapByIndex', () => {
		it('should swap two tabs by index', () => {
			const id1 = tabState.createTab();
			const id2 = tabState.createTab();

			expect(tabState.windows).toHaveLength(2);
			expect(tabState.windows[0].id).toBe(id1);
			expect(tabState.windows[1].id).toBe(id2);

			const result = tabState.swapByIndex(0, 1);
			expect(result).toBe(true);
			expect(tabState.windows[0].id).toEqual(id2);
			expect(tabState.windows[1].id).toEqual(id1);
		});
	});

	describe('moveToPosition', () => {
		it('should move a tab to a new position', () => {
			const id1 = tabState.createTab();
			const id2 = tabState.createTab();
			const id3 = tabState.createTab();
			const result = tabState.moveToPosition(id1, 1);
			expect(result).toBe(true);
			expect(tabState.windows[0].id).toBe(id2);
			expect(tabState.windows[1].id).toBe(id1);
			expect(tabState.windows[2].id).toBe(id3);
		});
	});
});
