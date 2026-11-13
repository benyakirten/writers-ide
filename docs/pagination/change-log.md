# Pagination merged PR history

Completed, confirmed merged PRs affecting document pagination, in chronological merge order. Dates use GitHub's UTC `merged_at`, not local commit dates. Each entry links the authoritative API metadata; its `merged: true` and `merge_commit_sha` identify the merge. See [current context](context.md) for today's contracts and limitations.

## 2026-11-08 — [#64: Break prose mirror into pages](https://github.com/benyakirten/writers-ide/pull/64)

- Introduced model-mutating pagination (`doc → page+ → block+`): overflow/underflow moves content between pages, explicit breaks constrain movement, and estimated line counts enforce widow/orphan settings. Peer paragraphs retain continuity across page boundaries and are reunited before reflow; formatting commands account for those fragments.
- Added per-view observation and a revision-aware valid prefix through the furthest visible page plus one. Edits invalidate from the predecessor to allow backward flow; document/view identity is separate, but synchronized same-document editing was not implemented.
- Added the shared cooperative generator work queue, scoped cancellation, priorities/progress, and dismissible catch-up UI. DOM measurement stays on the main thread, so yielding between steps does not make an individual measurement preemptible or guarantee the soft frame budget.
- Added numbered sample cases, mocked-geometry unit coverage, and real-browser geometry/content-marker checks at standard and Retina pixel densities, including independently scrolled panes. This did not establish complete selection/undo fidelity, general non-text layout, footnotes, headers/footers, collaboration, or whole-document virtualization.
- The owner described model page mutation as the quickest straightforward starting point. Automatic reflow is excluded from user history; this is not evidence that all user undo mappings were already correct (see #76 below).

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/64), `merged_at: 2026-11-08T13:23:10Z`, merge commit `b11d0d6`.

## 2026-11-12 — [#74: Add docs, remove custom editor attempt](https://github.com/benyakirten/writers-ide/pull/74)

- Established the pagination guide's source/test map, transaction and scheduling contracts, limitations, and explicit distinction between current implementation and accepted future direction; removed the abandoned custom-editor attempt.
- Recorded ProseMirror-based rich text as the live model and retained the existing model-mutating pagination engine. Derived per-view boundaries remain a research/prototype direction requiring owner approval, not an implemented migration or authorization to rewrite pagination.
- Recorded that footnotes should reduce available body height rather than physical sheet size, and that future collaborative views should default to nonpaginated mode with an override. Neither feature shipped in this documentation PR; print fidelity and the 8 GB responsiveness baseline remained goals rather than verified guarantees.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/74), `merged_at: 2026-11-12T04:03:49Z`, merge commit `46ff1b3`.

## 2026-11-12 — [#75: Use binary search to detect where pages overflow](https://github.com/benyakirten/writers-ide/pull/75)

- Replaced exhaustive character probing in production text splitting with hybrid search: probe the first ten UTF-16 offsets sequentially, binary-narrow the remaining range to at most ten offsets, then finish sequentially. A shared DOM text-node/range mapper supports production and benchmark measurement.
- Preserved the rounded line-count predicate and unmeasured exclusive end sentinel, relying on a monotonic predicate. Bounded predicate probes reduce measurement work but do not bound DOM collection, mapper construction, or browser layout time within a synchronous step.
- Added a focused real-Chromium comparison against sequential search and an independent old-loop baseline, with correctness/probe-bound gates and diagnostic timing rather than wall-clock thresholds. This does not substitute for page-geometry tests or demonstrate end-to-end editor responsiveness; see the [browser-performance context](../browser-performance/context.md) for benchmark contracts and limitations.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/75), `merged_at: 2026-11-12T05:23:49Z`, merge commit `e842b17`.

## 2026-11-12 — [#76: Update dependencies](https://github.com/benyakirten/writers-ide/pull/76)

- Changed pagination reflow from whole-page replacement/text delete-and-reinsert to structural splits and joins so ProseMirror step maps retain logical selections and user undo/redo mappings. Peer reunion crosses page/paragraph boundaries and restores the page boundary; a temporary empty paragraph keeps sole-peer pages valid under the production `block+` schema.
- Preserved explicit stored typing marks through reflow and dispatch-time index normalization. Selection mapping stays inside synchronous transactions rather than restoring a stale selection across cooperative yields.
- Added production-schema selection/history regressions with mocked geometry and Chromium/WebKit regressions for typing carets through new-page overflow and forward/reversed ranges through formatting reflow, reunion, and undo, including exact text/marked-text preservation. Browser helpers wait for `selectionchange` before formatting to respect ProseMirror's event processing.
- Extended app smoke and existing pagination/stylesheet checks across Chromium and WebKit. The goal is fitting/preserved content in each engine, not identical breaks. These are browser-engine checks, not native Tauri/WebView or minimum-macOS validation. Structural selections whose selected node is itself split/merged still use ProseMirror's normal fallback; non-text layout and print fidelity are not exhaustively covered.
- The model-mutating pagination architecture remained intact. General dependency/toolchain policy stays in [dependencies.md](../dependencies.md); benchmark-specific context stays in [browser performance](../browser-performance/context.md).

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/76), `merged_at: 2026-11-12T13:44:11Z`, merge commit `16b722a`.

## 2026-11-12 — [#77: Upgrade macos runner](https://github.com/benyakirten/writers-ide/pull/77)

- Moved the macOS WebKit smoke CI job from macOS 14 to macOS 15, keeping browser-engine smoke coverage (including pagination selection regressions) on the updated runner. Pagination behavior and the application's macOS 13.3 minimum did not change.
- Runner coverage is not packaged-app validation or proof of layout compatibility on the oldest supported native WKWebView. The Windows Chromium and Linux WebKit smoke jobs remain part of the engine-family matrix.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/77), `merged_at: 2026-11-12T13:54:56Z`, merge commit `87b67fa`.
