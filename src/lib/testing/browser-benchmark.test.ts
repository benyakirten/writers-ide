import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	installBenchmark,
	type BenchmarkOptions,
	type BrowserBenchmark,
} from './browser-benchmark';

function deferred() {
	let resolve!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function fixture(overrides: Partial<BrowserBenchmark> = {}): BrowserBenchmark {
	return {
		prepare: vi.fn(),
		reset: vi.fn(),
		run: vi.fn(() => ({ value: 1 })),
		verify: vi.fn(),
		...overrides,
	};
}

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const cleanups: (() => void)[] = [];
const minimal: BenchmarkOptions = { variants: ['one'], warmups: 0, samples: 1 };
let clock = 0;

function fontsReady(ready: Promise<void>) {
	Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
}

function install(benchmark = fixture()) {
	const cleanup = installBenchmark(benchmark);
	cleanups.push(cleanup);
	const bridge = window.__browserBenchmark;
	if (!bridge) {
		throw new Error('Benchmark bridge was not installed.');
	}
	return { bridge, cleanup };
}

beforeEach(() => {
	clock = 0;
	fontsReady(Promise.resolve());
	vi.spyOn(performance, 'now').mockImplementation(() => clock);
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn((callback: FrameRequestCallback) => {
			queueMicrotask(() => callback(clock));
			return 1;
		}),
	);
});

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (originalFonts) {
		Object.defineProperty(document, 'fonts', originalFonts);
	} else {
		Reflect.deleteProperty(document, 'fonts');
	}
});

describe('browser benchmark lifecycle and timing', () => {
	it('awaits fonts, prepare, reset, frame and verify in order; times only synchronous run', async () => {
		const fonts = deferred();
		fontsReady(fonts.promise);
		const events: string[] = [];
		const result = { value: 42 };
		const benchmark = fixture({
			async prepare() {
				events.push('prepare:start');
				clock += 100;
				await Promise.resolve();
				events.push('prepare:end');
			},
			async reset() {
				events.push('reset:start');
				clock += 30;
				await Promise.resolve();
				events.push('reset:end');
			},
			run(variant) {
				events.push(`run:${variant}`);
				clock += 5;
				queueMicrotask(() => events.push('run:microtask'));
				return result;
			},
			async verify(actual) {
				expect(actual).toBe(result);
				events.push('verify:start');
				clock += 40;
				await Promise.resolve();
				events.push('verify:end');
			},
		});
		vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
			events.push('frame:requested');
			queueMicrotask(() => {
				clock += 7;
				events.push('frame:callback');
				callback(clock);
			});
			return 1;
		});
		const { bridge } = install(benchmark);
		const pending = bridge.measure(minimal);
		await Promise.resolve();
		expect(events).toEqual([]);
		events.push('fonts:ready');
		fonts.resolve();
		const report = await pending;
		expect(events).toEqual([
			'fonts:ready',
			'prepare:start',
			'prepare:end',
			'reset:start',
			'reset:end',
			'frame:requested',
			'frame:callback',
			'run:one',
			'verify:start',
			'run:microtask',
			'verify:end',
		]);
		expect(report.samples).toEqual([{ variant: 'one', durationMs: 5, result }]);
	});

	it('includes awaited asynchronous run work but excludes asynchronous verification', async () => {
		const { bridge } = install(
			fixture({
				async run() {
					clock += 2;
					await Promise.resolve();
					clock += 6;
					return { value: 8 };
				},
				async verify() {
					await Promise.resolve();
					clock += 100;
				},
			}),
		);
		expect((await bridge.measure(minimal)).samples[0].durationMs).toBe(8);
	});

	it('verifies warmups but excludes them from samples and summaries', async () => {
		let calls = 0;
		const benchmark = fixture({
			run() {
				calls++;
				clock += calls;
				return { call: calls };
			},
		});
		const { bridge } = install(benchmark);
		const report = await bridge.measure({ variants: ['one'], warmups: 2, samples: 3 });
		expect(benchmark.prepare).toHaveBeenCalledTimes(1);
		expect(benchmark.reset).toHaveBeenCalledTimes(5);
		expect(benchmark.verify).toHaveBeenCalledTimes(5);
		expect(requestAnimationFrame).toHaveBeenCalledTimes(5);
		expect(report.samples).toEqual(
			[3, 4, 5].map((call) => ({
				variant: 'one',
				durationMs: call,
				result: { call },
			})),
		);
		expect(report.summaries).toEqual({ one: { medianMs: 4, minMs: 3, maxMs: 5 } });
	});

	it('uses two warmup rounds and seven sample rounds by default', async () => {
		const benchmark = fixture();
		const { bridge } = install(benchmark);
		const report = await bridge.measure({ variants: ['a', 'b'] });
		expect(benchmark.run).toHaveBeenCalledTimes(18);
		expect(benchmark.verify).toHaveBeenCalledTimes(18);
		expect(report.samples).toHaveLength(14);
		for (const variant of ['a', 'b']) {
			expect(report.samples.filter((sample) => sample.variant === variant)).toHaveLength(7);
		}
	});

	it('rotates all variants each round, continuing rotation across the warmup boundary', async () => {
		const benchmark = fixture();
		const variants = ['a', 'b', 'c'];
		const { bridge } = install(benchmark);
		const report = await bridge.measure({ variants, warmups: 1, samples: 3 });
		expect(vi.mocked(benchmark.run).mock.calls.map(([variant]) => variant)).toEqual([
			'a',
			'b',
			'c',
			'b',
			'c',
			'a',
			'c',
			'a',
			'b',
			'a',
			'b',
			'c',
		]);
		expect(report.samples.map((sample) => sample.variant)).toEqual([
			'b',
			'c',
			'a',
			'c',
			'a',
			'b',
			'a',
			'b',
			'c',
		]);
		expect(variants).toEqual(['a', 'b', 'c']);
	});

	it.each([
		{ durations: [9, 1, 5], median: 5 },
		{ durations: [9, 1, 5, 3], median: 4 },
	])(
		'summarizes unsorted durations $durations without reordering samples',
		async ({ durations, median }) => {
			let index = 0;
			const { bridge } = install(
				fixture({
					run() {
						const duration = durations[index];
						index++;
						clock += duration;
						return { duration };
					},
				}),
			);
			const report = await bridge.measure({ ...minimal, samples: durations.length });
			expect(report.samples.map((sample) => sample.durationMs)).toEqual(durations);
			expect(report.summaries).toEqual({ one: { medianMs: median, minMs: 1, maxMs: 9 } });
			expect(report.environment).toEqual({
				userAgent: navigator.userAgent,
				devicePixelRatio: window.devicePixelRatio,
				viewport: [window.innerWidth, window.innerHeight],
			});
		},
	);

	it('keeps summaries separate for interleaved variants', async () => {
		const { bridge } = install(
			fixture({
				run(variant) {
					clock += variant === 'fast' ? 2 : 20;
					return { value: variant === 'fast' ? 1 : 10 };
				},
			}),
		);
		const report = await bridge.measure({ variants: ['fast', 'slow'], warmups: 0, samples: 3 });
		expect(report.summaries).toEqual({
			fast: { medianMs: 2, minMs: 2, maxMs: 2 },
			slow: { medianMs: 20, minMs: 20, maxMs: 20 },
		});
	});

	it('stores an accepted __proto__ variant summary as an own property', async () => {
		const { bridge } = install();
		const report = await bridge.measure({ ...minimal, variants: ['__proto__'] });
		expect(Object.prototype.hasOwnProperty.call(report.summaries, '__proto__')).toBe(true);
		expect(JSON.parse(JSON.stringify(report.summaries))).toEqual(
			JSON.parse('{"__proto__":{"medianMs":0,"minMs":0,"maxMs":0}}'),
		);
	});
});

describe('browser benchmark options', () => {
	const invalid: Partial<BenchmarkOptions>[] = [
		{ variants: [] },
		{ variants: ['same', 'same'] },
		...[-1, 0.5, 101, NaN, Infinity].map((warmups) => ({ warmups })),
		...[-1, 0, 0.5, 1001, NaN, Infinity].map((samples) => ({ samples })),
	];

	it.each(invalid)(
		'rejects invalid options %j before running hooks and permits a retry',
		async (options) => {
			const benchmark = fixture();
			const { bridge } = install(benchmark);
			await expect(bridge.measure({ ...minimal, ...options })).rejects.toThrow(
				'Use distinct variants, 0–100 warmups, and 1–1000 samples.',
			);
			expect(benchmark.prepare).not.toHaveBeenCalled();
			expect(benchmark.reset).not.toHaveBeenCalled();
			expect(benchmark.run).not.toHaveBeenCalled();
			expect(benchmark.verify).not.toHaveBeenCalled();
			expect(requestAnimationFrame).not.toHaveBeenCalled();
			await expect(bridge.measure(minimal)).resolves.toMatchObject({
				samples: [expect.any(Object)],
			});
		},
	);

	it('accepts the maximum warmup and sample counts', async () => {
		const benchmark = fixture();
		const { bridge } = install(benchmark);
		const report = await bridge.measure({ variants: ['one'], warmups: 100, samples: 1000 });
		expect(report.samples).toHaveLength(1000);
		expect(benchmark.run).toHaveBeenCalledTimes(1100);
	});
});

describe('browser benchmark ownership and failures', () => {
	it('rejects duplicate installation and makes cleanup idempotent without removing a replacement', () => {
		const first = install();
		expect(() => installBenchmark(fixture())).toThrow(
			'Only one benchmark may be installed per story.',
		);
		expect(window.__browserBenchmark).toBe(first.bridge);
		first.cleanup();
		expect(window.__browserBenchmark).toBeUndefined();
		const second = install();
		first.cleanup();
		expect(window.__browserBenchmark).toBe(second.bridge);
		second.cleanup();
		second.cleanup();
		expect(window.__browserBenchmark).toBeUndefined();
	});

	it('rejects concurrent calls while awaiting fonts and accepts a call after completion', async () => {
		const fonts = deferred();
		fontsReady(fonts.promise);
		const { bridge } = install();
		const first = bridge.measure(minimal);
		await expect(bridge.measure(minimal)).rejects.toThrow('A benchmark is already running.');
		fonts.resolve();
		await first;
		await expect(bridge.measure(minimal)).resolves.toMatchObject({ samples: [expect.any(Object)] });
	});

	it('keeps the running guard until asynchronous verification finishes', async () => {
		const entered = deferred();
		const verified = deferred();
		const { bridge } = install(
			fixture({
				async verify() {
					entered.resolve();
					await verified.promise;
				},
			}),
		);
		const pending = bridge.measure(minimal);
		await entered.promise;
		await expect(bridge.measure(minimal)).rejects.toThrow('A benchmark is already running.');
		verified.resolve();
		await pending;
	});

	it('cleanup detaches an in-flight bridge without cancelling it or disturbing a new installation', async () => {
		const fonts = deferred();
		fontsReady(fonts.promise);
		const first = install();
		const pending = first.bridge.measure(minimal);
		first.cleanup();
		const second = install();
		fonts.resolve();
		await Promise.all([pending, second.bridge.measure(minimal)]);
		first.cleanup();
		expect(window.__browserBenchmark).toBe(second.bridge);
	});

	for (const stage of ['prepare', 'reset', 'run', 'verify'] as const) {
		it.each(['sync', 'async'] as const)(
			`releases running after ${stage} %s failure`,
			async (mode) => {
				const failure = new Error(`${stage} failed`);
				const benchmark = fixture();
				const hook = vi.spyOn(benchmark, stage);
				if (mode === 'sync') {
					hook.mockImplementationOnce(() => {
						throw failure;
					});
				} else {
					hook.mockImplementationOnce(async () => {
						throw failure;
					});
				}
				const { bridge } = install(benchmark);
				await expect(bridge.measure(minimal)).rejects.toBe(failure);
				await expect(bridge.measure(minimal)).resolves.toMatchObject({
					samples: [expect.any(Object)],
				});
			},
		);
	}

	it('releases running after font readiness rejects', async () => {
		const fonts = deferred();
		fontsReady(fonts.promise);
		const benchmark = fixture();
		const { bridge } = install(benchmark);
		const failure = new Error('Fonts failed');
		const assertion = expect(bridge.measure(minimal)).rejects.toBe(failure);
		fonts.reject(failure);
		await assertion;
		expect(benchmark.prepare).not.toHaveBeenCalled();
		fontsReady(Promise.resolve());
		await expect(bridge.measure(minimal)).resolves.toMatchObject({ samples: [expect.any(Object)] });
	});

	it('releases running after requesting an animation frame throws', async () => {
		const failure = new Error('Frame failed');
		vi.mocked(requestAnimationFrame).mockImplementationOnce(() => {
			throw failure;
		});
		const benchmark = fixture();
		const { bridge } = install(benchmark);
		await expect(bridge.measure(minimal)).rejects.toBe(failure);
		expect(benchmark.run).not.toHaveBeenCalled();
		await expect(bridge.measure(minimal)).resolves.toMatchObject({ samples: [expect.any(Object)] });
	});
});
