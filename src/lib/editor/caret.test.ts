import { describe, it, expect } from 'vitest';

import { parseElementIndex } from './caret.js';

describe('parseElementIndex', () => {
	it("should parse the index from the data-index attribute if it's parseable as a number", () => {
		const el = document.createElement('div');
		el.setAttribute('data-index', '1');
		expect(parseElementIndex(el)).toEqual([1]);
	});

	it('should parse the index into a series of numbers separated by periods', () => {
		const el = document.createElement('div');
		el.setAttribute('data-index', '1.2.3');
		expect(parseElementIndex(el)).toEqual([1, 2, 3]);
	});

	it('should return null if any of the values cannot be parsed as a number', () => {
		const el = document.createElement('div');
		el.setAttribute('data-index', '1.2.a');
		expect(parseElementIndex(el)).toBeNull();
	});

	it("should return null if the data-index attribute doesn't exist", () => {
		const el = document.createElement('div');
		expect(parseElementIndex(el)).toBeNull();
	});
});
