export type BenchmarkResult = Record<string, number>;

export interface BrowserBenchmark<Result extends BenchmarkResult = BenchmarkResult> {
	prepare(): void | Promise<void>;
	reset(): void | Promise<void>;
	run(variant: string): Result | Promise<Result>;
	verify(result: Result): void | Promise<void>;
}

export interface BenchmarkOptions {
	variants: string[];
	warmups?: number;
	samples?: number;
}

export interface BenchmarkSample {
	variant: string;
	durationMs: number;
	result: BenchmarkResult;
}

export interface BenchmarkReport {
	samples: BenchmarkSample[];
	summaries: Record<string, { medianMs: number; minMs: number; maxMs: number }>;
	environment: { userAgent: string; devicePixelRatio: number; viewport: [number, number] };
}

declare global {
	interface Window {
		__browserBenchmark?: { measure(options: BenchmarkOptions): Promise<BenchmarkReport> };
	}
}

/** Story-only bridge; no benchmark instrumentation is installed in the application. */
export function installBenchmark<Result extends BenchmarkResult>(
	benchmark: BrowserBenchmark<Result>,
) {
	if (window.__browserBenchmark) {
		throw new Error('Only one benchmark may be installed per story.');
	}
	let running = false;
	const bridge = {
		async measure({
			variants,
			warmups = 2,
			samples = 7,
		}: BenchmarkOptions): Promise<BenchmarkReport> {
			if (running) {
				throw new Error('A benchmark is already running.');
			}
			if (
				variants.length === 0 ||
				new Set(variants).size !== variants.length ||
				!Number.isInteger(warmups) ||
				warmups < 0 ||
				warmups > 100 ||
				!Number.isInteger(samples) ||
				samples < 1 ||
				samples > 1000
			) {
				throw new Error('Use distinct variants, 0–100 warmups, and 1–1000 samples.');
			}
			running = true;
			try {
				await document.fonts.ready;
				await benchmark.prepare();
				const measurements: BenchmarkSample[] = [];
				for (let round = 0; round < warmups + samples; round++) {
					// Rotate ordering so one strategy does not always benefit from going second.
					for (let index = 0; index < variants.length; index++) {
						const variant = variants[(index + round) % variants.length];
						await benchmark.reset();
						await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
						const start = performance.now();
						const pending = benchmark.run(variant);
						// Avoid a microtask in the measured path for synchronous operations.
						const result = pending instanceof Promise ? await pending : pending;
						const durationMs = performance.now() - start;
						await benchmark.verify(result);
						if (round >= warmups) {
							measurements.push({ variant, durationMs, result });
						}
					}
				}
				const summaries: BenchmarkReport['summaries'] = Object.create(null);
				for (const variant of variants) {
					const times = measurements
						.filter((sample) => sample.variant === variant)
						.map((sample) => sample.durationMs)
						.sort((a, b) => a - b);
					const middle = Math.floor(times.length / 2);
					const medianMs =
						times.length % 2 === 0 ? (times[middle - 1] + times[middle]) / 2 : times[middle];
					summaries[variant] = { medianMs, minMs: times[0], maxMs: times[times.length - 1] };
				}
				return {
					samples: measurements,
					summaries,
					environment: {
						userAgent: navigator.userAgent,
						devicePixelRatio: window.devicePixelRatio,
						viewport: [innerWidth, innerHeight],
					},
				};
			} finally {
				running = false;
			}
		},
	};
	window.__browserBenchmark = bridge;
	return () => {
		if (window.__browserBenchmark === bridge) {
			delete window.__browserBenchmark;
		}
	};
}
