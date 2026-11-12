import { afterEach, describe, expect, it, vi } from 'vitest';
import { hybridSplitSearch, sequentialSplitSearch, type SplitSearchStrategy } from './split-search';
import { createTextSplitMeasurement, findTextSplitOffset } from './text-split-measurement';

function mockGeometry(height: (range: Range) => number) {
	const createRange = document.createRange.bind(document);
	const measurements: Range[] = [];
	vi.spyOn(document, 'createRange').mockImplementation(() => {
		const range = createRange();
		range.getBoundingClientRect = () => {
			measurements.push(range.cloneRange());
			return { height: height(range) } as DOMRect;
		};
		return range;
	});
	return measurements;
}

function textNodes(parts: string[]) {
	const host = document.createElement('p');
	return parts.map((part) => {
		const span = document.createElement('span');
		const text = document.createTextNode(part);
		span.append(text);
		host.append(span);
		return text;
	});
}

// Independent copy of the original loop, including empty nodes and node-boundary endpoints.
function legacySplit(nodes: Node[], lineHeight: number, linesToKeep: number) {
	const range = document.createRange();
	let offset = 0;
	for (const node of nodes) {
		for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
			range.setStart(nodes[0], 0);
			range.setEnd(node, index);
			if (Math.round(range.getBoundingClientRect().height / lineHeight) - 1 >= linesToKeep) {
				return offset;
			}
			offset++;
		}
	}
	return offset;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('text split measurement', () => {
	it('maps every UTF-16 offset across marked text and empty nodes exactly like the old loop', () => {
		const nodes = textNodes(['', 'a😀', '', '', 'e\u0301', 'z', '']);
		const probes = mockGeometry(() => 0);
		const measurement = createTextSplitMeasurement(nodes);
		expect(measurement.length).toBe(6);
		for (let offset = 0; offset < measurement.length; offset++) {
			measurement.measure(offset);
		}
		expect(probes.map((range) => [range.endContainer, range.endOffset])).toEqual([
			[nodes[1], 0],
			[nodes[1], 1],
			[nodes[1], 2],
			[nodes[4], 0],
			[nodes[4], 1],
			[nodes[5], 0],
		]);
		for (const range of probes) {
			expect(range.startContainer).toBe(nodes[0]);
			expect(range.startOffset).toBe(0);
		}
		expect(document.createRange).toHaveBeenCalledTimes(1);
		for (const invalid of [-1, 0.5, 6, NaN, Infinity]) {
			expect(() => measurement.measure(invalid)).toThrow(RangeError);
		}
	});

	it.each([{ parts: [] }, { parts: ['', '', ''] }])(
		'returns zero without measuring empty input $parts',
		({ parts }) => {
			const nodes = textNodes(parts);
			const probes = mockGeometry(() => {
				throw new Error('Empty input must not measure');
			});
			expect(findTextSplitOffset(nodes, 10, 0)).toBe(0);
			expect(createTextSplitMeasurement(nodes).length).toBe(0);
			expect(() => createTextSplitMeasurement(nodes).measure(0)).toThrow(RangeError);
			expect(probes).toEqual([]);
			expect(document.createRange).not.toHaveBeenCalled();
		},
	);

	it('matches the original loop for every boundary across many nodes, including all/none fit', () => {
		const nodes = textNodes(['', 'abc😀', '', 'def'.repeat(10), '', 'ghij'.repeat(10), '']);
		const starts = new Map<Node, number>();
		let length = 0;
		for (const node of nodes) {
			starts.set(node, length);
			length += node.length;
		}
		let firstFailure = 0;
		mockGeometry((range) =>
			starts.get(range.endContainer)! + range.endOffset >= firstFailure ? 20 : 10,
		);
		for (firstFailure = 0; firstFailure <= length; firstFailure++) {
			const legacy = legacySplit(nodes, 10, 1);
			expect(legacy).toBe(firstFailure);
			expect(findTextSplitOffset(nodes, 10, 1, sequentialSplitSearch)).toBe(legacy);
			expect(findTextSplitOffset(nodes, 10, 1, hybridSplitSearch)).toBe(legacy);
			expect(findTextSplitOffset(nodes, 10, 1)).toBe(legacy);
		}
	});

	it('preserves rounded line counting and the minus-one threshold', () => {
		const nodes = textNodes(['abcdef']);
		mockGeometry((range) => [0, 10, 14.9, 15, 24.9, 25][range.endOffset]);
		for (const strategy of [sequentialSplitSearch, hybridSplitSearch]) {
			expect(findTextSplitOffset(nodes, 10, 0, strategy)).toBe(1);
			expect(findTextSplitOffset(nodes, 10, 1, strategy)).toBe(3);
			expect(findTextSplitOffset(nodes, 10, 2, strategy)).toBe(5);
			expect(findTextSplitOffset(nodes, 10, 3, strategy)).toBe(6);
		}
	});

	it('lets a benchmark count probes by wrapping the injected predicate; production defaults to hybrid', () => {
		const nodes = textNodes(['a'.repeat(10_000)]);
		const measurements = mockGeometry((range) => (range.endOffset < 9000 ? 10 : 20));
		let probes = 0;
		const countingStrategy: SplitSearchStrategy = (end, fails) =>
			hybridSplitSearch(end, (offset) => {
				probes++;
				return fails(offset);
			});
		expect(findTextSplitOffset(nodes, 10, 1, countingStrategy)).toBe(9000);
		expect(probes).toBe(measurements.length);
		expect(probes).toBeLessThanOrEqual(30);
		const countedProbes = probes;
		measurements.length = 0;
		expect(findTextSplitOffset(nodes, 10, 1)).toBe(9000);
		expect(measurements.length).toBe(countedProbes);
	});
});
