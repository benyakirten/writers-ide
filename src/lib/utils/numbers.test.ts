import { describe, it, expect, test } from 'vitest';
import { clamp } from './numbers.js';

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
