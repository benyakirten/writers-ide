import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TabState } from './tab-state.svelte';
import eventBus, { ProseMirrorEventBusEventType } from './event-bus.svelte';

describe('TabState', () => {
	let tabState: TabState;

	beforeEach(() => {
		tabState = new TabState();
	});

	afterEach(() => {
		tabState.close();
	});

	describe('create', () => {
		it('creates a named tab with a generated ID and activates the first tab', () => {
			tabState.create('prosemirror');
			expect(tabState.windows).toHaveLength(1);
			expect(tabState.windows[0].id).toEqual(expect.any(String));
			expect(tabState.windows[0].name).toBe('prosemirror');
			expect(tabState.active).toBe(tabState.windows[0].id);
		});

		it('stores supplied data and returns a disposer that removes only its tab', () => {
			const data = { title: 'Example' };
			const unregister = tabState.create('prosemirror', 'first', data);
			tabState.create('prosemirror', 'second');
			tabState.create('prosemirror', 'third');
			expect(tabState.windows[0]).toEqual({ id: 'first', name: 'prosemirror', data });
			unregister();
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second', 'third']);
			expect(tabState.active).toBe('second');
			unregister();
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second', 'third']);
		});

		it('rejects duplicate IDs without replacing the existing tab', () => {
			tabState.create('prosemirror', 'first');
			expect(() => tabState.create('other', 'first')).toThrow('already exists');
			expect(tabState.windows).toEqual([{ id: 'first', name: 'prosemirror', data: undefined }]);
		});
	});

	describe('remove', () => {
		it('removes a tab and activates a surviving tab', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			tabState.remove('first');
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second']);
			expect(tabState.active).toBe('second');
		});

		it('ignores missing IDs and preserves the current active tab', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			tabState.activate('second');
			tabState.remove('missing');
			tabState.remove('first');
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second']);
			expect(tabState.active).toBe('second');
		});

		it('clears the active tab when the last tab is removed', () => {
			const unregister = tabState.create('prosemirror', 'first');
			unregister();
			expect(tabState.windows).toEqual([]);
			expect(tabState.active).toBeUndefined();
		});
	});

	describe('activation', () => {
		it('activates tabs by ID or index and preserves activation on an invalid request', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			expect(tabState.activate('second')).toBe(true);
			expect(tabState.active).toBe('second');
			expect(tabState.activate(0)).toBe(true);
			expect(tabState.active).toBe('first');
			expect(tabState.activate('missing')).toBe(false);
			expect(tabState.activate(2)).toBe(false);
			expect(tabState.active).toBe('first');
			tabState.deactivate();
			expect(tabState.active).toBeUndefined();
		});

		it('handles event-bus activation and unsubscribes on close', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			eventBus.update({ id: 'second', event: { type: ProseMirrorEventBusEventType.SetActiveTab } });
			expect(tabState.active).toBe('second');
			tabState.close();
			eventBus.update({ id: 'first', event: { type: ProseMirrorEventBusEventType.SetActiveTab } });
			expect(tabState.active).toBe('second');
		});
	});

	describe('swap', () => {
		it('swaps two tabs by ID', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			expect(tabState.swap('first', 'second')).toBe(true);
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second', 'first']);
		});

		it('does not reorder tabs when an ID is missing', () => {
			tabState.create('prosemirror', 'first');
			expect(tabState.swap('missing', 'first')).toBe(false);
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['first']);
		});
	});

	describe('swapByIndex', () => {
		it('swaps two tabs by index', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			expect(tabState.swapByIndex(0, 1)).toBe(true);
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second', 'first']);
		});
	});

	describe('moveToPosition', () => {
		it('moves a tab to a new position', () => {
			tabState.create('prosemirror', 'first');
			tabState.create('prosemirror', 'second');
			tabState.create('prosemirror', 'third');
			expect(tabState.moveToPosition('first', 1)).toBe(true);
			expect(tabState.windows.map((tab) => tab.id)).toEqual(['second', 'first', 'third']);
		});
	});
});
