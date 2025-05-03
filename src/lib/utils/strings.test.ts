import { describe, test, expect } from 'vitest';

import { capitalize, capitalizeAllWords } from './strings';

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
