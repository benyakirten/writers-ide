import { describe, expect, it } from 'vitest';
import { hybridSplitSearch, sequentialSplitSearch, type SplitSearchStrategy } from './split-search';

const strategies: [string, SplitSearchStrategy][] = [
	['sequential', sequentialSplitSearch],
	['hybrid', hybridSplitSearch],
];

function searchWithProbes(strategy: SplitSearchStrategy, end: number, firstFailure: number) {
	const probes: number[] = [];
	const result = strategy(end, (offset) => {
		if (!Number.isInteger(offset) || offset < 0 || offset >= end) {
			throw new Error(`Out-of-domain probe: ${offset} for end ${end}`);
		}
		probes.push(offset);
		return offset >= firstFailure;
	});
	return { result, probes };
}

describe('split search', () => {
	it.each(strategies)(
		'%s finds every possible monotone boundary for lengths 0 through 256',
		(_name, strategy) => {
			for (let end = 0; end <= 256; end++) {
				for (let firstFailure = 0; firstFailure <= end; firstFailure++) {
					const { result, probes } = searchWithProbes(strategy, end, firstFailure);
					expect(result).toBe(firstFailure);
					expect(new Set(probes).size).toBe(probes.length);
					if (strategy === hybridSplitSearch) {
						const budget =
							Math.min(end, 10) +
							Math.max(0, Math.ceil(Math.log2(Math.max(1, (end - 10) / 10)))) +
							10;
						expect(probes.length).toBeLessThanOrEqual(budget);
					}
				}
			}
		},
	);

	it('sequential probes in order and stops at the first failure', () => {
		expect(searchWithProbes(sequentialSplitSearch, 20, 3)).toEqual({
			result: 3,
			probes: [0, 1, 2, 3],
		});
		expect(searchWithProbes(sequentialSplitSearch, 3, 3)).toEqual({ result: 3, probes: [0, 1, 2] });
	});

	it('hybrid keeps early failures sequential with no extra probes', () => {
		for (let firstFailure = 0; firstFailure < 10; firstFailure++) {
			const { result, probes } = searchWithProbes(hybridSplitSearch, 1_000_000, firstFailure);
			expect(result).toBe(firstFailure);
			expect(probes).toEqual(Array.from({ length: firstFailure + 1 }, (_, index) => index));
		}
	});

	it('hybrid bounds probes for long inputs including all-fit and the last measurable offset', () => {
		for (const end of [11, 20, 21, 31, 1000, 100_000, 1_000_000]) {
			for (const firstFailure of [0, 9, 10, Math.floor(end / 2), end - 1, end]) {
				const { result, probes } = searchWithProbes(hybridSplitSearch, end, firstFailure);
				expect(result).toBe(firstFailure);
				expect(probes.slice(0, Math.min(10, firstFailure + 1))).toEqual(
					Array.from({ length: Math.min(10, firstFailure + 1) }, (_, index) => index),
				);
				expect(probes.length).toBeLessThanOrEqual(
					20 + Math.max(0, Math.ceil(Math.log2(Math.max(1, (end - 10) / 10)))),
				);
				expect(new Set(probes).size).toBe(probes.length);
			}
		}
	});
});
