import { describe, expect, it } from 'vitest';
import { paginationSampleDocument } from './sample-data';

describe('default pagination samples', () => {
	it('provides a schema-valid document with many varied source pages', () => {
		expect(() => paginationSampleDocument.check()).not.toThrow();
		expect(paginationSampleDocument.childCount).toBeGreaterThanOrEqual(40);
		let emptyParagraphs = 0;
		let breaks = 0;
		paginationSampleDocument.descendants((node) => {
			if (node.type.name === 'paragraph' && node.content.size === 0) {
				emptyParagraphs++;
			}
			if (node.type.name === 'pageEnd') {
				breaks++;
			}
		});
		expect(emptyParagraphs).toBeGreaterThan(0);
		expect(breaks).toBeGreaterThanOrEqual(20);
	});

	it('labels cases and paragraphs uniquely in source order', () => {
		const text = paginationSampleDocument.textContent;
		const cases = [...text.matchAll(/CASE (\d{2}) —/g)].map((match) => match[1]);
		expect(cases).toEqual(
			Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0')),
		);
		const labels = [...text.matchAll(/\[(\d{2}\.\d{2})\]/g)].map((match) => match[1]);
		expect(labels.length).toBeGreaterThan(100);
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels).toEqual([...labels].sort());
	});
});
