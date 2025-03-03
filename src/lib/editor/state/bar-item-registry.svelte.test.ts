import { describe, it, expect, beforeEach } from 'vitest';
import { BarItemRegistry, type BarItem } from './bar-item-registry.svelte.js';

describe('BarItemRegistry', () => {
	let registry: BarItemRegistry;
	let mockItem: BarItem;

	beforeEach(() => {
		registry = new BarItemRegistry();
		mockItem = {
			// @ts-expect-error: Test mock
			vertical: { Component: () => null, size: 2 },
			// @ts-expect-error: Test mock
			horizontal: { Component: () => null, size: 3 }
		};
	});

	describe('register', () => {
		it('should register an item and return its id', () => {
			const [id, deregister] = registry.register(mockItem);
			expect(registry.items.has(id)).toBe(true);

			const item = registry.items.get(id);
			expect(item).toBe(mockItem);

			deregister();
			expect(registry.items.has(id)).toBe(false);
		});
	});

	describe('deregister', () => {
		it('should remove an item from the registry', () => {
			const [id, deregister] = registry.register(mockItem);
			expect(registry.items.has(id)).toBe(true);

			deregister();
			expect(registry.items.has(id)).toBe(false);
		});
	});

	describe('size', () => {
		it('should return the correct size for vertical and horizontal items', () => {
			const [id] = registry.register(mockItem);
			expect(registry.size(id, true)).toBe(mockItem.vertical.size);
			expect(registry.size(id, false)).toBe(mockItem.horizontal.size);
		});

		it('should return size 1 if id is null or item is not found', () => {
			expect(registry.size(null, true)).toBe(1);
			expect(registry.size('non-existent-id', true)).toBe(1);
		});
	});

	describe('isAllowed', () => {
		it('should return true if the id is null', () => {
			const got = registry.isAllowed(null);
			expect(got).toBe(true);
		});

		it('should return true if the item is registered', () => {
			const [id] = registry.register(mockItem);
			expect(registry.isAllowed(id)).toBe(true);
		});

		it('should not allow an item if id is not registered', () => {
			expect(registry.isAllowed('non-existent-id')).toBe(false);
		});
	});
});
