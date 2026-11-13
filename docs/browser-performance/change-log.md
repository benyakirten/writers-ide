# Browser performance PR change log

See [current context](context.md) for the working contracts, fixture/API guide and limitations. Start one consolidated PR entry under `In progress` when work begins and update it with every commit, keeping cumulative changes, rationale, outcomes, verified validation, and follow-ups complete before merge. Mark it **In progress / unmerged** and link the PR or use its branch name; never invent merge metadata or append a commit/session diary.

After confirmed merge, move the completed entry into `Merged PRs` in chronological merge order and finalize status/date/link metadata. Dates are UTC dates from GitHub PR metadata (`merged_at`), not local commit dates. Existing historical entries retain their authoritative API evidence.

## In progress

No in-progress browser-performance entries are currently recorded.

## Merged PRs

### 2026-11-12 — [#75: Use binary search to detect where pages overflow](https://github.com/benyakirten/writers-ide/pull/75)

- Added the real-Chromium performance suite against isolated static Storybook fixtures, a typed explicit story catalog and safe primitive argument serializer, and the story-only `installBenchmark({ prepare, reset, run, verify })` bridge. Preparation/reset/verification stay outside the timer; warmups and rotating variant order reduce measurement bias. Reports retain raw samples, summaries and environment metadata for interpretation rather than enforcing noisy elapsed-time thresholds.
- Added the paragraph search fixture comparing sequential and production hybrid split search using real DOM `Range` geometry. An independent old-loop baseline and known edge answers guard against shared-implementation bugs; verification also checks that text and text nodes remain unchanged. Nine cases cover empty/short text, early/middle/late splits, spans, Unicode, none-fit and all-fit. Correct answers and bounded predicate probes gate changes, not timing or claimed speedup.
- Production search keeps the first ten probes linear, narrows a larger remaining window with binary search, then finishes linearly. The shared DOM mapper preserves UTF-16 offsets, text-node boundaries and the unmeasured exclusive end sentinel. This reduces probes for long searches while retaining short-input behavior; it still assumes a monotonic fit predicate. See [pagination history](../pagination/change-log.md) for the editor integration side of this change.
- Added a separate Ubuntu 22.04 CI workflow using Node.js 22 and pnpm 9 at merge, frozen dependencies, matching Playwright Chromium and failure-retained artifacts. Dedicated Storybook and static-only preview configurations avoid dependence on an earlier application build or unrelated documentation stories.
- Limits: no end-to-end editor performance fixture, typing/startup/memory target verification, Tauri WebView measurement, pinned font or hardware guarantee. Fewer probes do not bound mapper construction, DOM layout cost or synchronous frame time; existing browser pagination geometry tests remain necessary.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/75) reports `merged: true`, `merged_at: 2026-11-12T05:23:49Z`, and merge commit `e842b17c3aa302bd6def6599ee6d9ff8c746f9f9` (matching local `main` history).

### 2026-11-12 — [#76: Update dependencies](https://github.com/benyakirten/writers-ide/pull/76)

- Updated the performance CI toolchain to Node.js 24 and pnpm 12.4.1 alongside the dependency/lockfile upgrade. This supersedes #75's Node.js 22/pnpm 9 environment, not its correctness/probe gates or diagnostic-only timing policy. General maintenance guidance lives in [dependencies.md](../dependencies.md).
- Adapted the isolated Storybook configuration to the upgraded Svelte tooling: disabled HMR through `compilerOptions` and placed Svelte compilation before Storybook's docgen plugins so docgen receives compiled JavaScript rather than Svelte markup. Updated story types to use Svelte components directly without the previous compatibility cast.
- Retained the isolated static fixture/preview architecture and the distinction between focused search measurements and full editor geometry/integration checks. See [pagination history](../pagination/change-log.md) for selection-preserving reflow and related browser coverage shipped in the same PR.
- Comparison limit: updated dependencies and the lockfile-selected browser can change measured results independently of search-algorithm changes. Compare controlled runs with matching browser/font/toolchain environments; the upgrade itself is not evidence of a performance improvement or a verified latency budget.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/76) reports `merged: true`, `merged_at: 2026-11-12T13:44:11Z`, and merge commit `16b722ad11836557810e3b295a2e9cbbf5644d49` (matching local `main` history).
