import { describe, it, expect, test } from 'vitest';

import { clamp, mod } from './numbers';

describe('clamp', () => {
	test.each([
		[5, 1, 10, 5],
		[0, 1, 10, 1],
		[15, 1, 10, 10],
		[Number.POSITIVE_INFINITY, 1, 10, 10],
		[Number.NEGATIVE_INFINITY, 1, 10, 1]
	])('should clamp %i within the range %i to %i to %i', (value, min, max, expected) => {
		expect(clamp(value, min, max)).toBe(expected);
	});

	it('should return NaN if the value is NaN', () => {
		expect(clamp(NaN, 1, 10)).toBeNaN();
	});

	describe('clamp', () => {
		test.each([
			[5, 1, 10, 5],
			[0, 1, 10, 1],
			[15, 1, 10, 10],
			[Number.POSITIVE_INFINITY, 1, 10, 10],
			[Number.NEGATIVE_INFINITY, 1, 10, 1]
		])('should clamp %i within the range %i to %i to %i', (value, min, max, expected) => {
			expect(clamp(value, min, max)).toBe(expected);
		});

		it('should return NaN if the value is NaN', () => {
			expect(clamp(NaN, 1, 10)).toBeNaN();
		});
	});
});

describe('mod', () => {
	test.each([
		[5, 3, 2],
		[-5, 3, 1],
		[5, -3, -1],
		[-5, -3, -2],
		[10, 5, 0],
		[7, 1, 0],
		[0, 3, 0],
		[3, 0, NaN] // Division by zero should return NaN
	])('should compute %i mod %i as %i', (n1, n2, expected) => {
		const result = mod(n1, n2);
		if (isNaN(expected)) {
			expect(result).toBeNaN();
		} else {
			expect(result).toEqual(expected);
		}
	});
});
