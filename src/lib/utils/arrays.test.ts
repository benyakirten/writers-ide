import { describe, it, expect } from 'vitest';
import { swap, toSwapped } from './arrays';

describe('swap', () => {
	it('should swap two elements in an array', () => {
		const array = [1, 2, 3, 4];
		const result = swap(array, 1, 3);
		expect(result).toEqual([1, 4, 3, 2]);
	});

	it('should handle swapping the same index', () => {
		const array = [1, 2, 3, 4];
		const result = swap(array, 2, 2);
		expect(result).toEqual([1, 2, 3, 4]);
	});

	it('should modify the original array', () => {
		const array = [1, 2, 3, 4];
		swap(array, 0, 2);
		expect(array).toEqual([3, 2, 1, 4]);
	});

	it('should throw an error if indexes are out of bounds', () => {
		const array = [1, 2, 3, 4];
		expect(() => swap(array, -1, 2)).toThrow();
		expect(() => swap(array, 1, 5)).toThrow();
	});
});

describe('toSwapped', () => {
	it('should return a new array with two elements swapped', () => {
		const array = [1, 2, 3, 4];
		const result = toSwapped(array, 1, 3);
		expect(result).toEqual([1, 4, 3, 2]);
		expect(result).not.toBe(array); // Ensure a new array is returned
	});

	it('should handle swapping the same index', () => {
		const array = [1, 2, 3, 4];
		const result = toSwapped(array, 2, 2);
		expect(result).toEqual([1, 2, 3, 4]);
	});

	it('should not modify the original array', () => {
		const array = [1, 2, 3, 4];
		toSwapped(array, 0, 2);
		expect(array).toEqual([1, 2, 3, 4]);
	});

	it('should throw an error if indexes are out of bounds', () => {
		const array = [1, 2, 3, 4];
		expect(() => toSwapped(array, -1, 2)).toThrow();
		expect(() => toSwapped(array, 1, 5)).toThrow();
	});
});
