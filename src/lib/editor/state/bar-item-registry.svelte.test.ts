import { describe, it, expect, beforeEach } from 'vitest';
import { BarItemRegistry, type BarItem } from './bar-item-registry.svelte';
import type { ModularComponent } from './shared.types';

const MockComponent: ModularComponent = () => ({});

describe('BarItemRegistry', () => {
	let registry: BarItemRegistry;
	let mockItem: BarItem;

	beforeEach(() => {
		registry = new BarItemRegistry();
		mockItem = {
			title: 'Test item',
			vertical: { Component: MockComponent, size: 2 },
			horizontal: { Component: MockComponent, size: 3 },
		};
	});

	describe('register', () => {
		it('should register an item and return its id', () => {
			const [id, deregister] = registry.register(mockItem);
			expect(Object.hasOwn(registry.items, id)).toBe(true);

			const item = registry.items[id];
			expect(item).toEqual(mockItem);

			deregister();
			expect(Object.hasOwn(registry.items, id)).toBe(false);
		});
	});

	it('should register an item under an explicit id', () => {
		const [id, deregister] = registry.register(mockItem, 'custom-id');

		expect(id).toBe('custom-id');
		expect(registry.items[id]).toEqual(mockItem);
		deregister();
		expect(Object.hasOwn(registry.items, id)).toBe(false);
	});

	describe('clear', () => {
		it('should remove all registered items and restore fallback sizes', () => {
			registry.register(mockItem, 'first');
			registry.register(mockItem, 'second');

			registry.clear();

			expect(registry.items).toEqual({});
			expect(registry.size('first', true)).toBe(1);
			expect(registry.size('second', false)).toBe(1);
		});
	});

	describe('deregister', () => {
		it('should remove an item from the registry', () => {
			const [id] = registry.register(mockItem);
			expect(Object.hasOwn(registry.items, id)).toBe(true);

			registry.deregister(id);
			expect(Object.hasOwn(registry.items, id)).toBe(false);
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
});
