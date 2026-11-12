import { hybridSplitSearch, type SplitSearchStrategy } from './split-search';

export interface TextSplitMeasurement {
	/** UTF-16 length; also the unmeasured exclusive end sentinel. */
	readonly length: number;
	measure(offset: number): DOMRect;
}

/**
 * Snapshot ordered text-node lengths and reuse one Range for prefix measurements.
 * Recreate after DOM changes. Empty nodes contribute no offsets, but the original
 * first node remains the range start, matching pagination's sequential loop.
 */
export function createTextSplitMeasurement(nodes: readonly Node[]): TextSplitMeasurement {
	const spans: { node: Node; start: number; end: number }[] = [];
	let length = 0;
	for (const node of nodes) {
		const nodeLength = node.textContent?.length ?? 0;
		if (nodeLength > 0) {
			spans.push({ node, start: length, end: length + nodeLength });
			length += nodeLength;
		}
	}
	const range = length > 0 ? nodes[0].ownerDocument!.createRange() : null;
	if (range) {
		range.setStart(nodes[0], 0);
	}

	return {
		length,
		measure(offset) {
			if (!Number.isInteger(offset) || offset < 0 || offset >= length || !range) {
				throw new RangeError('Text split offset must be an integer in [0, length).');
			}
			let low = 0;
			let high = spans.length - 1;
			while (low < high) {
				const middle = low + Math.floor((high - low) / 2);
				if (offset < spans[middle].end) {
					high = middle;
				} else {
					low = middle + 1;
				}
			}
			const span = spans[low];
			// At a node boundary use the next nonempty node at offset zero, not the preceding end.
			range.setEnd(span.node, offset - span.start);
			return range.getBoundingClientRect();
		},
	};
}

/**
 * Preserve the existing rounded line-count test and 0..length-1 measurement domain.
 * A benchmark can wrap the injected strategy's predicate to count probes without
 * adding instrumentation to production measurement.
 */
export function findTextSplitOffset(
	nodes: readonly Node[],
	lineHeight: number,
	linesToKeepOnPage: number,
	strategy: SplitSearchStrategy = hybridSplitSearch,
): number {
	const measurement = createTextSplitMeasurement(nodes);
	return strategy(
		measurement.length,
		(offset) =>
			Math.round(measurement.measure(offset).height / lineHeight) - 1 >= linesToKeepOnPage,
	);
}
