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
			registry.deregister('first', true);
			expect(registry.size('first', false)).toBe(3);

			registry.clear();

			expect(registry.items).toEqual({});
			expect(registry.size('first', true)).toBe(1);
			expect(registry.size('second', false)).toBe(1);
		});
	});

	describe('deregister', () => {
		it('retains only orientation sizes when requested, including repeated removal', () => {
			registry.register(mockItem, 'plugin');
			registry.deregister('plugin', true);
			expect(registry.items).toEqual({});
			expect(registry.size('plugin', false)).toBe(3);
			expect(registry.size('plugin', true)).toBe(2);
			registry.deregister('plugin', true);
			expect(registry.size('plugin', false)).toBe(3);
			expect(registry.size('plugin', true)).toBe(2);
			registry.deregister('plugin');
			expect(registry.size('plugin', false)).toBe(1);
			expect(registry.size('plugin', true)).toBe(1);
		});

		it('uses re-registered sizes and snapshots their latest values on subsequent removal', () => {
			registry.register(mockItem, 'plugin');
			registry.deregister('plugin', true);
			const [, deregister] = registry.register(
				{
					title: 'Replacement',
					horizontal: { size: 2 },
					vertical: { size: 3 },
				},
				'plugin',
			);
			expect(registry.size('plugin', false)).toBe(2);
			expect(registry.size('plugin', true)).toBe(3);
			registry.deregister('plugin', true);
			expect(registry.size('plugin', false)).toBe(2);
			expect(registry.size('plugin', true)).toBe(3);
			deregister();
			expect(registry.size('plugin', false)).toBe(1);
			expect(registry.size('plugin', true)).toBe(1);
		});

		it('should remove an item from the registry', () => {
			const [id] = registry.register(mockItem);
			expect(Object.hasOwn(registry.items, id)).toBe(true);

			registry.deregister(id);
			expect(Object.hasOwn(registry.items, id)).toBe(false);
			expect(registry.size(id, false)).toBe(1);
			expect(registry.size(id, true)).toBe(1);
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
