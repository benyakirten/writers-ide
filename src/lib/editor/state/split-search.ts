/** True means the offset fails to fit. Hybrid search requires false values before true values. */
export type SplitFailurePredicate = (offset: number) => boolean;

/** Search [0, end); return the first failing offset, or end without probing that sentinel. */
export interface SplitSearchStrategy {
	(end: number, fails: SplitFailurePredicate): number;
}

export const sequentialSplitSearch: SplitSearchStrategy = (end, fails) => {
	for (let offset = 0; offset < end; offset++) {
		if (fails(offset)) {
			return offset;
		}
	}
	return end;
};

export const hybridSplitSearch: SplitSearchStrategy = (end, fails) => {
	const initialEnd = Math.min(end, 10);
	for (let offset = 0; offset < initialEnd; offset++) {
		if (fails(offset)) {
			return offset;
		}
	}

	let low = initialEnd;
	// high is either a known failing offset or the unmeasured exclusive end sentinel.
	let high = end;
	while (high - low > 10) {
		const middle = low + Math.floor((high - low) / 2);
		if (fails(middle)) {
			high = middle;
		} else {
			low = middle + 1;
		}
	}
	for (let offset = low; offset < high; offset++) {
		if (fails(offset)) {
			return offset;
		}
	}
	return high;
};
