import { describe, it, expect, beforeEach } from 'vitest';

import { TabState } from './tab-state.svelte.js';

describe('TabState', () => {
	let tabState: TabState;

	beforeEach(() => {
		tabState = new TabState();
	});

	it('should create a new tab', () => {
		const id = tabState.createTab();
		expect(tabState.windows).toHaveLength(1);
		expect(tabState.windows[0].id).toBe(id);
	});

	it('should register an editor', () => {
		const id = tabState.createTab();
		const unregister = tabState.registerEditor(id, null);
		expect(tabState.windows[0].view).toBeNull();
		unregister();
		expect(tabState.windows).toHaveLength(0);
	});

	it('should remove a tab', () => {
		const id = tabState.createTab();
		tabState.remove(id);
		expect(tabState.windows).toHaveLength(0);
	});

	it('should swap two tabs by id', () => {
		const id1 = tabState.createTab();
		const id2 = tabState.createTab();
		const result = tabState.swap(id1, id2);
		expect(result).toBe(true);
		expect(tabState.windows[0].id).toBe(id2);
		expect(tabState.windows[1].id).toBe(id1);
	});

	it('should swap two tabs by index', () => {
		tabState.createTab();
		tabState.createTab();
		const result = tabState.swapByIndex(0, 1);
		expect(result).toBe(true);
		expect(tabState.windows[0].id).toBe(tabState.windows[1].id);
	});

	it('should move a tab to a new position', () => {
		const id1 = tabState.createTab();
		const id2 = tabState.createTab();
		const result = tabState.moveToPosition(id1, 1);
		expect(result).toBe(true);
		expect(tabState.windows[0].id).toBe(id2);
		expect(tabState.windows[1].id).toBe(id1);
	});
});
