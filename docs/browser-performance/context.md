# Browser performance tests

The browser performance suite measures focused operations in real Chromium using static Storybook fixtures. It is separate from the application geometry tests and from unit tests. Correctness and deterministic work bounds gate changes; elapsed timings are diagnostic, **not pass/fail thresholds**.

See the [merged PR history](change-log.md) for shipped decisions and the [project context](../project-context.md) for the broader performance target. This suite does not verify that target.

## Running the suite

Use the toolchain specified in [CONTRIBUTING.md](../../CONTRIBUTING.md) and [package.json](../../package.json): pnpm 12.4.1 and Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`. CI uses Node.js 24. General dependency maintenance remains in [dependencies.md](../dependencies.md).

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium --with-deps
pnpm check:performance
pnpm test:performance
```

[playwright.performance.config.ts](../../playwright.performance.config.ts) builds static Storybook using the isolated [performance configuration](../../.storybook/performance/main.ts), then serves `storybook-static` with Vite preview at `http://127.0.0.1:6006`. Preview uses a [separate static-only Vite configuration](../../.storybook/performance/vite.preview.config.ts), not the application's `vite.config.ts`, so it does not load SvelteKit plugins or require `.svelte-kit/output/server` from an earlier application build. The suite does not reuse an existing server; leave port 6006 free. It runs Chromium with one worker, no retries, a 1280 × 900 viewport and device scale factor 1. This is not the development Storybook server or the application preview on port 4173.

Results go to `performance-results/`, with the HTML report in `performance-report/` and traces retained on failure. Open the report with:

```sh
pnpm exec playwright show-report performance-report
```

Each successful `page.benchmark()` call attaches JSON containing raw samples, per-variant median/minimum/maximum milliseconds, numeric operation results, the story URL and arguments, user agent, viewport, DPR, browser version, platform and Node version. An operation that throws before returning a report cannot produce that benchmark attachment.

## Current coverage and gates

[performance/pagination-search.test.ts](../../performance/pagination-search.test.ts) visits `Performance/Pagination search/Paragraph` and compares `sequential` and `hybrid` searches across nine cases: empty, short, long early/middle/late splits, formatting spans, Unicode, none-fit and all-fit. A separate test checks that unknown story arguments are rejected. [storybook-fixture.test.ts](../../performance/storybook-fixture.test.ts) verifies primitive URL-argument round trips in a real story, including booleans, null, empty strings, spaces and omitted undefined overrides.

The [paragraph fixture](../../src/stories/performance/PaginationSearch.svelte) uses real DOM `Range` geometry. Preparation computes an **independent old-loop baseline**, without the shared range mapper or search strategies, and checks known edge answers. Both timed variants use the shared production DOM range mapper. Verification checks the split offset against the independent baseline and ensures fixture text and text nodes have not changed.

Tests require equal variant results and bound hybrid predicate probes by `20 + ceil(log2(max(1, textLength)))`. Inputs of at most ten UTF-16 units must use the same probe count as sequential search; cases needing more than 100 sequential probes must use fewer hybrid probes. These deterministic gates are not timing or speedup assertions.

The production text splitter probes the first ten offsets linearly, narrows the remaining range with binary search until its window is at most ten, then finishes linearly. This assumes a monotonic fit predicate. The shared mapper preserves UTF-16 offsets, text-node boundary behavior and the unmeasured exclusive end sentinel. See [pagination context](../pagination/context.md) for integration and remaining limitations.

**There is no end-to-end editor performance fixture yet.** This suite measures paragraph split search, not a full pagination transaction, typing latency, scrolling, scheduler responsiveness, memory use or startup. Existing [pagination geometry tests](../../e2e/pagination.test.ts) remain separate and necessary; search correctness does not replace page-bound and editor integration coverage.

## Benchmark lifecycle

[src/lib/testing/browser-benchmark.ts](../../src/lib/testing/browser-benchmark.ts) provides the generic story-only bridge:

```ts
installBenchmark({ prepare, reset, run, verify });
```

Install it on component mount and return its disposer for teardown, as the paragraph fixture does with Svelte `onMount`. Only one bridge may be installed per story; concurrent measurements are rejected. No benchmark bridge is installed in the application.

For each measurement request:

1. Await `document.fonts.ready`, then await `prepare()` once. Build deterministic fixture state, compute independent expected results and perform setup here.
2. Run two warmup rounds and seven recorded rounds by default. Each round visits every requested variant, rotating which variant goes first to reduce ordering bias.
3. Before each variant, await `reset()` and one animation frame. Restore equivalent state here; do not leave earlier variants' mutations in place.
4. Time **only `run(variant)`**, including its returned promise if asynchronous. Return numeric operation results such as offsets and probe counts. Synchronous runs avoid an extra measured microtask.
5. Await `verify(result)` outside the timer, including for warmups. Throw on incorrect results or fixture corruption. Warmup measurements are discarded; recorded samples produce the summaries.

`page.benchmark({ variants, warmups?, samples? })` waits for the bridge, invokes this lifecycle and attaches the report. Variants must be nonempty and distinct; warmups must be an integer from 0 to 100 and samples from 1 to 1000. An async function or promise does **not** offload CPU work from the browser main thread. Keep DOM-dependent work and any cooperative scheduling claims explicit.

## Adding a fixture, story and test

1. Add a deterministic fixture component under `src/stories/performance/`. Export its argument type, keep inputs bounded, define comparable variants and install the generic benchmark bridge. Keep setup/reset/verification outside `run`, unless those operations are deliberately what the benchmark measures. Use an independent oracle or known answers rather than only comparing two implementations that could share a bug.
2. Add a Storybook story with an explicit stable metadata `id`, useful defaults and Controls. The existing [PaginationSearch.stories.ts](../../src/stories/performance/PaginationSearch.stories.ts) is the reference. Controls should select named content fixtures rather than send arbitrary manuscript text through a URL. Specify enum argument types explicitly (as the reference story does): Controls options alone can allow Storybook to silently ignore a URL override. Assert the resulting fixture inputs or known answers in the browser test. The dedicated performance configuration includes only these stories, isolating benchmarks from any future documentation stories and their decorators.
3. Register the display name, argument type, actual story ID and allowed argument keys in [e2e/fixtures/stories.ts](../../e2e/fixtures/stories.ts). The catalog is explicit, not generated by guessing a slug from the title. `page.visit()` verifies that the ID exists as a story in the built `/index.json` and rejects unknown argument keys.
4. Add a test under `performance/`, importing `test` and `expect` from [e2e/fixtures/storybook.ts](../../e2e/fixtures/storybook.ts). Visit the registered story, run variants and assert correctness and stable work bounds. Keep timings in the report rather than introducing noisy wall-clock gates.

The typed visit API supports optional navigation/readiness overrides:

```ts
await page.visit(
	'Performance/Pagination search/Paragraph',
	{ repetitions: 100, spanSize: 25, linesToKeep: 30 },
	{ timeout: 30000, readySelector: '[aria-label="Pagination search benchmark"]' },
);
const report = await page.benchmark({ variants: ['sequential', 'hybrid'] });
expect(report.samples).toHaveLength(14);
```

`visit()` navigates directly to the story iframe, waits for a nonempty `#storybook-root`, optionally waits for `readySelector`, then awaits fonts and two animation frames. It checks for Storybook error displays; the fixture also fails on uncaught browser errors. An application-specific asynchronous fixture may need its own ready selector and preparation logic.

[story-url.ts](../../e2e/fixtures/story-url.ts) serializes safe primitive arguments, not JSON: finite numbers with a plain decimal representation, booleans, null and strings restricted to ASCII letters, digits, spaces, underscores and hyphens (including the empty string). Numeric-looking strings are rejected because Storybook would deserialize them as numbers; numbers rendered in exponent notation and complex values are also rejected. Argument names must start with an ASCII letter and contain only letters, digits or underscores. Undefined optional arguments are omitted by `visit()`. Unsupported strings are rejected rather than silently sanitized; use a named fixture for Unicode, punctuation, complex data or rich text. Do not bypass the serializer with hand-built argument URLs.

## CI and interpreting measurements

[.github/workflows/browser_performance.yml](../../.github/workflows/browser_performance.yml) runs separately from lint/unit CI on pushes, pull requests and manual dispatch. It uses Ubuntu 22.04, Node.js 24, pnpm 12.4.1, a frozen lockfile install and Chromium installed by the locked Playwright package with its system dependencies. Both `performance-results/` and `performance-report/` are uploaded with `if: always()`, including on test failure when files exist.

The frozen lockfile pins resolved package versions; the locked Playwright version selects its matching Chromium revision. Do not independently upgrade the browser when making comparisons. The runner OS label and fixed browser configuration improve repeatability but do not pin the physical runner, load, system packages or font files. The current fixture requests monospace and awaits font readiness; it does not bundle a pinned font. Unicode fallback and font metrics can vary by environment.

Compare repeated runs on the same controlled runner/browser/font setup and inspect raw samples as well as medians and ranges. Shared CI machines have scheduling and resource variance; warmups and rotation reduce some bias, not all noise. Arbitrary local-machine timings are not directly comparable to CI or to another operating system. These are browser measurements, **not Tauri webview measurements** or a verified 8 GB hardware performance guarantee. Fewer range probes do not bound text-node collection, mapper construction, each DOM measurement or browser layout cost, and do not prove that a synchronous pagination step meets its frame budget.
