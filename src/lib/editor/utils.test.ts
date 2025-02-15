import { describe, it, expect, test } from 'vitest';
import { clamp, capitalize, capitalizeAllWords } from './utils.js';

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

describe('capitalize', () => {
	describe('capitalize', () => {
		test.each([
			['hello', 'Hello'],
			['world', 'World'],
			['', ''],
			['this is a sentence', 'This is a sentence'],
			['ñandú', 'Ñandú'],
			['über', 'Über'],
			['привет', 'Привет'],
			['你好', '你好'],
			['こんにちは', 'こんにちは']
		])('should capitalize the first letter of the string "%s" to "%s"', (input, expected) => {
			expect(capitalize(input)).toBe(expected);
		});
	});
});

describe('capitalizeAllWords', () => {
	test.each([
		['hello world', 'Hello World'],
		['this is a test', 'This Is A Test'],
		['', ''],
		['ñandú y ñandú', 'Ñandú Y Ñandú'],
		['über alles', 'Über Alles'],
		['привет мир', 'Привет Мир'],
		['你好 世界', '你好 世界'],
		['こんにちは 世界', 'こんにちは 世界']
	])('should convert string "%s" to title case "%s"', (input, expected) => {
		expect(capitalizeAllWords(input)).toBe(expected);
	});
});
