# Pagination PR change log

Read [current context](context.md) for today's contracts and limitations. Start one cumulative entry per PR under `In progress`. Update that entry as work changes. Keep the changes, reasons, tests and limits ready to read before merge. Do not append commit logs or session diaries.

After a confirmed merge, move the entry to `Merged PRs` in chronological merge order. Finalize only verified status, date and link metadata. Dates use GitHub's UTC `merged_at`, not local commit dates. Historical entries retain their API evidence. Never invent a PR or merge date.

## In progress

### `bh/phase-2-plugin-transition` — Stage 2 baseline readiness, formatting boundary and shared tasks

**Status: In progress / unmerged.** Branch: `bh/phase-2-plugin-transition`. No PR identity or merge date is known.

#### Context

This branch separates feature services and reusable tasks from the general plugin host. Owner-approved Parts 3A–3B also add word-processing APIs and behaviors. A behavior is a ProseMirror plugin installed through that API. Its connection owns it and removes it when the connection closes. The existing page model and reflow algorithms remain in place. See [current context](context.md) for the editing and pagination terms used below.

#### What changed and why

**Reliable undo baselines.** Formatting/reflow range tests now show the first page and wait for fitting content before recording its split. A smoke trace had recorded an unpaginated offscreen page containing all 4,340 characters. Undo then correctly produced a 1,792-character split, which did not match that baseline. This test correction does not weaken assertions or change selection helpers or production pagination algorithms.

**Feature-owned formatting.** Formatting contracts and the code that connects formatting to ProseMirror moved to `src/lib/editor/prosemirror/menu/basic/`. The general host no longer requires formatting.

The feature-local `scope-formatting-service.ts` handles ownership:

- It copies data and requests.
- It registers subscription cleanup through `context.own`.
- It uses `context.signal` to stop access when the plugin stops.

The approved Part 3A then replaces service injection from the route. `createFormattingPlugin()` resolves a required word-processing provider. A provider exposes an API to consuming plugins. Formatting creates `FormattingService(provider)` for each activation, meaning each enabled lifetime of the plugin.

The move preserves existing behavior:

- Requests still check the active view and revision to reject stale work.
- Peer-paragraph traversal remains safe. Resources are still acquired only when needed.
- Cleanup, error isolation and the full bridge test suite remain.
- Basic Menu still owns commands that do nothing at a caret, mutually exclusive marks and commands that account for paragraph continuations.

Stopping the provider does not destroy editor views owned by its sources. No generic service bus or external permission model is introduced.

**Shared tasks, Part 1.** Private `@writers-ide/tasks` owns generic `WorkQueue` mechanics. It provides iteration, generator, async and bundled-worker helpers. The library has no shared global queue or editor dependency.

Queue ownership stays explicit:

- The app keeps its queue instance and compatibility exports. `createApplicationPluginHost` shares that instance by default.
- Standalone hosts can receive `workQueue`. Otherwise they create independent queues.
- Pagination invalidation, layout revisions, catch-up UI, budget, fairness and model-mutating algorithms are unchanged.

`context.tasks` belongs to one plugin activation. It adds no contribution capabilities. Its ownership rules are:

- Task replacement keys stay within that activation. They cannot replace another activation's work.
- Cooperative tasks yield between small steps. Their helpers acquire and release queue leases. A lease keeps the queue running until released.
- Async and worker tasks need no lease.
- Handles expose progress and errors as they change. Outcome promises do not reject.
- Unloading a plugin cancels only its work.

Task errors appear in management. They do not disable plugins or fail an otherwise successful deactivation. Activation and host-cleanup failures still affect lifecycle success.

Short commands and hooks stay immediate. The soft budget cannot interrupt a running step. Editor results require synchronous current-state validation and application after yielding. Parts 1–2 and 3A–3B are implemented but unmerged. Part 3C custom content/schema work and Part 4 external loading/native enforcement retain separate approval gates. No pagination redesign is authorized. See the [plugin entry](../plugins/change-log.md) and [task guide](../../packages-js/tasks/README.md).

**Word-processing provider, Part 3A.** The owner approved callbacks that use live `EditorState` and `EditorView` objects synchronously. Edits go through the provider. Private `@writers-ide/word-processing` has no app imports.

`createWordProcessingPlugin(sources = defaultWordProcessingSources)` connects the API to existing views, active tabs and editor updates. These inputs are called sources. The route registers provider and formatting. Formatting's required dependency activates the provider.

Stopping the provider also stops its dependents and revokes their API resources. It does not destroy views owned by the sources. History, the fixed schema and model-mutating pagination stay intact.

Exact result targets contain `{ viewId, documentId, revision }`. Revision tokens increase across service restarts within the module. These editor-state revisions differ from layout revisions. A selection-only change makes an editor target stale without invalidating layout.

The editor API checks requests before using them:

- `inspect`, `edit`, `runCommand`, command registration/execution/listing and `applyResult` check that the target is current. They also check cancellation signals, lifetime, editability and any active-view requirement.
- Stale task/worker results are discarded. They are not mapped to new positions or redirected to another view.
- Commands capture at most one transaction. They apply only after returning boolean `true` synchronously and passing another validation.
- These commands belong to the editor service. They are not ProseMirror plugin registrations.
- Nested inspection is allowed. Nested edits and edits during notifications return `busy`.

Cleanup releases subscriptions to editor sources and reactive updates. It also releases connection callbacks and registry resources.

Callbacks remain trusted code. Rejecting a Promise-like return cannot undo an already-started async body or raw dispatch. Do not retain transactions or live objects. `tr.before` checks document identity, not the originating state. An old same-document transaction with a fresh target can pass that check while violating the contract.

Independent opt-in QuickFormat uses the public provider and upstream `toggleMark`. It supports `bold`/`strong`, including stored marks for future typing. Only its browser fixture registers it; the default app does not. See [plugin context](../plugins/context.md), the [plan](../plugins/implementation-plan.md) and the same cumulative [plugin branch entry](../plugins/change-log.md).

**Behavior reconfiguration, Part 3B.** Owner-approved `EditorState.reconfigure` changes the installed plugins without recreating the editor view. It keeps the same schema, document, selection, stored marks and history. It creates no transaction or undo entry.

Each connection owns its behaviors. A factory creates a behavior for a view. Factories and cancellation signals are per view. An optional list of view IDs restricts where a behavior is installed.

Ordering stays predictable:

- Managed plugins run before the baseline, meaning the plugins already installed by the editor.
- Higher priority runs first. Equal priorities keep insertion order.
- Baseline plugin objects and their order remain unchanged.

Plugin state is associated with a key. Surviving plugins keep that key and their state. This includes generated keys from upstream plugins that did not declare an explicit key. Surviving factories and wrapped Plugin objects also remain the same objects. ProseMirror may still recreate resources attached to plugin views.

`nodeViews` and `markViews`, which customize node and mark rendering, remain rejected pending Part 3C.

**Accepted transaction events.** App dispatch now uses `applyTransaction`. The root is the transaction sent to dispatch. A filter can reject it. Plugins can also append transactions after accepted changes.

Events follow this order:

1. ProseMirror calculates the accepted transactions. If the root is rejected, there is no `PreUpdate` event or DOM update.
2. Every accepted root or append emits `PreUpdate`. PageObserver reads each transaction's own before/after documents and positions. It must not interpret appended positions against the root's starting document.
3. One final update changes the rendered DOM.

The unchanged `normalizePageIndexes` helper moved to `view/page-indexes.ts`. Optional synchronous `sources.prepareTransaction` prepares managed appended transactions. Preparation happens before application and the check against the current document. The app combines it with page-index and stored-mark normalization. This is not schema migration or a pagination redesign.

**Behavior lifetime and failures.** Reconciliation brings installed behaviors into line with current registrations and editor sources. It runs in a microtask, after the current synchronous work finishes. It runs outside plugin hooks. This also happens when sources arrive without ordinary subscribers.

Before applying changes across views, staging checks whether sources, lifecycle or input state changed. It preserves transactions dispatched during plugin-view setup or update. If reconciliation does not settle within 16 passes, it quarantines all still-active registrations. Quarantine stops their callbacks immediately. Removal of the installed plugins happens later.

Runtime failures also stop a registration's callbacks immediately across views. The temporary fallback behavior is specific:

- A filter that fails first rejects the transaction. Later calls through the inactive filter allow it.
- An inactive append hook returns null, adding no transaction.
- Plugin state application temporarily retains its previous value.
- Guarded plugin properties use safe fallback values. Plugin-view cleanup failures are contained.

These measures cannot roll back arbitrary callback effects. They cannot interrupt CPU loops or unlimited ProseMirror append cycles.

Failure reporting stays separate from removal:

- Optional source observers and connection `reportError(error)` receive independent reports.
- The host attributes a report only to the exact consuming plugin activation while it is live.
- Late reports and reports from revoked connections are ignored.
- Reports use phase `provider`. Reporting does not disable the plugin.

Official and third-party features use the same APIs. They do not provide privileged built-in access or a security sandbox. See [behavior contracts](../plugins/context.md#lifecycle-owned-behaviors-part-3b-implemented--unmerged).

**Editorial clarity.** The pagination and docking guides now explain their terms and event flow in shorter sentences. This documentation revision changes no runtime behavior.

#### Tests and recorded validation

Queue regressions remain at the compatibility path. Added library and host tests cover task ownership. A separate production-built fixture uses `e2e/tasks.test.ts`, `e2e/fixtures/tasks/` and `playwright.tasks.config.ts`. It checks emitted module workers, transfers, cancellation after startup, errors/recovery and shared queue ownership. `pnpm test:tasks` is separate from app smoke/e2e. Browser Smoke CI runs it for the selected engine. The worker helper imports no Svelte, app or DOM runtime code.

The Part 3A fixture uses the actual app adapter, generic host, real ProseMirror views/history and a bundled worker. It does not import or register Basic Menu. Its six scenarios cover formatting, focus, orientation remounting, undo, stale/cancelled/closed-view results, independent same-document views, cascade revocation and reactivation. The initial 12 Chromium/WebKit cases passed with the fixture build. The app manager regression also verifies manuscript, formatting and undo preservation through provider disable/re-enable.

Part 3B adds three [opt-in proof consumers](../../src/lib/editor/prosemirror/behaviors/README.md) with public command IDs:

- Upstream ellipsis/em-dash input rules and `undoInputRule` test that plugins without explicit keys keep their original state identity.
- A selection example uses transaction metadata associated with a plugin key. It maps visual decorations to new document positions without adding authored marks.
- A worker example captures at most 32,768 selection model positions and 1,024 chunks. It does not scan the full manuscript or join tokens across nodes. Per-view cancellation signals and exact targets reject stale output. Accepted output is applied through fresh transaction metadata.

`BehaviorFixture.svelte` extends the existing fixture behind explicit opt-in, not on the default route. Six new scenarios/twelve cases join the existing twelve for 24 word-processing cases across Chromium/WebKit. Existing CI includes both files; main app e2e excludes the new file.

Recorded cumulative validation passed:

- 1,111 unit tests in 49 files. These include 79 behavior cases, 53 existing service cases and five actual-dispatch regressions.
- Final Chromium/WebKit app and smoke suites: 116 and 22 cases. They retain pagination geometry, caret/reflow/undo, docking, stylesheet and provider lifecycle coverage.
- Dedicated word-processing, provider and task fixtures: 24, 8 and 8 cases, with production builds.
- Lint, local Markdown target checks and whitespace checks.

`pnpm check` reported only the existing Modal type error and five old DnD warnings. There were no changed-file diagnostics. See the [plugin entry](../plugins/change-log.md) for cumulative outcomes and [docking](../dnd/change-log.md) for layout work. These results were verified during implementation. They were not rerun for the editorial revision.

Editorial validation passed Oxfmt, preserved heading-anchor checks, local file-link and fragment checks, and whitespace checks. No runtime tests were rerun.

#### Limits and follow-up

Initial app validation and a focused repeat hit an intermittent Chromium collapsed-selection timeout while establishing the caret regression's range. Pre-3B dispatch and current dispatch each passed five isolated caret runs. Final full and smoke suites passed without helper or assertion changes. This does not establish the cause or prove selection timing fixed.

The behavior fixture's structural split is not pagination geometry verification. No native checks were run. Trusted callback guards are not security isolation. Parts 3C/4 remain separately gated, and no PR or merge date is assigned.

## Merged PRs

### 2026-11-08 — [#64: Break prose mirror into pages](https://github.com/benyakirten/writers-ide/pull/64)

#### Context

The owner described document page mutation as the quickest straightforward starting point. This PR established that initial pagination implementation.

#### What changed and why

Pagination changed the model using `doc → page+ → block+`. Each document held pages containing blocks. Overflow and underflow moved content between pages. Explicit breaks constrained movement. Estimated line counts enforced widow/orphan settings. Peer paragraphs represented one paragraph across page boundaries. They were reunited before reflow, and formatting commands accounted for the fragments.

Per-view observation tracked a valid prefix through the furthest visible page plus one. A layout revision identified obsolete work. Edits invalidated from the preceding page so content could flow backward. Document and view IDs were separate. Same-document views did not synchronize their edits.

A shared cooperative generator queue added scoped cancellation, priorities, progress and a dismissible catch-up dialog. DOM measurement stayed on the main thread. Automatic reflow did not enter user history.

#### Tests and limits

Numbered sample cases, mocked-geometry unit tests and real-browser checks covered geometry and content markers. Browser cases used standard and Retina pixel densities and independently scrolled panes.

Yielding between steps could not interrupt an individual measurement or guarantee the soft frame budget. History exclusion did not establish correct undo mappings in every case; #76 later addressed mappings. This PR did not establish complete selection/undo fidelity, general non-text layout, footnotes, headers/footers, collaboration or whole-document virtualization.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/64), `merged_at: 2026-11-08T13:23:10Z`, merge commit `b11d0d6`.

### 2026-11-12 — [#74: Add docs, remove custom editor attempt](https://github.com/benyakirten/writers-ide/pull/74)

#### Context and changes

This PR established the pagination source/test map and explained transaction flow, scheduling and limitations. It separated current implementation from accepted future direction. It also removed the abandoned custom-editor attempt.

The guide recorded ProseMirror rich text as the live model and retained model-mutating pagination. Derived per-view boundaries remained a research/prototype direction requiring owner approval. They were not an implemented migration or permission to rewrite pagination.

Footnotes were to reduce body height, not sheet size. Future collaborative views were to default to pagination off, with an override.

#### Validation and limits

Neither footnotes nor collaboration shipped in this documentation PR. Print fidelity and responsiveness on an 8 GB baseline remained goals, not verified guarantees. This entry records no runtime test result.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/74), `merged_at: 2026-11-12T04:03:49Z`, merge commit `46ff1b3`.

### 2026-11-12 — [#75: Use binary search to detect where pages overflow](https://github.com/benyakirten/writers-ide/pull/75)

#### Context and changes

Production text splitting previously probed every character. Hybrid search tested the first ten UTF-16 offsets in order, used binary search to narrow the rest to at most ten offsets, then finished in order. UTF-16 offsets are JavaScript string positions. Production and benchmarks shared a DOM text-node/range mapper.

The change preserved the rounded line-count test and an exclusive end marker that was not measured. It relied on a monotonic fit test: once an offset failed, later offsets could not fit.

#### Tests and limits

A focused real-Chromium benchmark compared sequential and hybrid searches with an independent old-loop baseline. Correctness and probe bounds gated changes. Timings were diagnostic, with no wall-clock thresholds.

Bounding probes did not bound DOM collection, mapper construction or browser layout time inside a synchronous step. This was not a replacement for page-geometry tests or evidence of end-to-end responsiveness. See [browser-performance context](../browser-performance/context.md).

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/75), `merged_at: 2026-11-12T05:23:49Z`, merge commit `e842b17`.

### 2026-11-12 — [#76: Update dependencies](https://github.com/benyakirten/writers-ide/pull/76)

#### Context and changes

Reflow had replaced whole pages or deleted and reinserted text. It changed to structural splits and joins. ProseMirror step maps could then preserve logical selection positions and user undo/redo mappings.

Peer reunion joined page and paragraph boundaries, then restored the page boundary. A temporary empty paragraph kept a sole-peer page valid under the one-or-more-block schema rule. Reflow and dispatch-time index normalization preserved stored typing marks. Selection mapped inside synchronous transactions rather than being restored from a stale value after a cooperative yield.

#### Tests and limits

Production-schema tests used mocked geometry for selection/history regressions. Chromium/WebKit tests covered carets through overflow and new pages. They also covered forward/reversed ranges through formatting reflow, reunion and undo, with exact text and marked-text preservation. Browser helpers waited for `selectionchange` before formatting so ProseMirror could process it.

App smoke and existing pagination/stylesheet checks expanded to both engines. They required fitting, preserved content in each engine, not identical breaks. They were not native Tauri/WebView or minimum-macOS validation. Structural selections still used ProseMirror's fallback when their selected node was split or merged. Non-text layout and print fidelity were not exhaustively covered.

The model-mutating architecture stayed intact. Dependency/toolchain policy remains in [dependencies.md](../dependencies.md). Benchmark details remain in [browser performance](../browser-performance/context.md).

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/76), `merged_at: 2026-11-12T13:44:11Z`, merge commit `16b722a`.

### 2026-11-12 — [#77: Upgrade macos runner](https://github.com/benyakirten/writers-ide/pull/77)

#### Context and changes

The macOS WebKit smoke CI job moved from macOS 14 to macOS 15. It kept browser-engine smoke coverage, including pagination selection regressions, on the updated runner. Pagination behavior and the app's macOS 13.3 minimum did not change.

#### Validation and limits

Runner coverage was not packaged-app validation or proof of compatibility with the oldest supported native WKWebView. Windows Chromium and Linux WebKit remained in the engine-family matrix. This entry records no additional test-run count.

Merge evidence: [GitHub API](https://api.github.com/repos/benyakirten/writers-ide/pulls/77), `merged_at: 2026-11-12T13:54:56Z`, merge commit `87b67fa`.

### 2026-11-14 — [#80 — Safe peer-group queries for formatting](https://github.com/benyakirten/writers-ide/pull/80)

**Status: Merged 2026-11-14.** Branch: `bh/add-plugin-interface-js`.

#### Context and changes

The host formatting bridge reused peer-paragraph rules to calculate command availability without trial edits. The helper now ran during ordinary state refreshes, so its unconditional document-node console log was removed.

Peer lookup was corrected for ordinary selection updates. It traversed adjacent blocks and page wrappers explicitly and resolved blocks at their actual depth. Nonempty selections excluded the end boundary. Document-end positions and leaf `pageEnd` nodes were not treated as textblock interiors. A page's last block was identified by index, not equality with an identical node.

The previous fixed traversal offset could throw `Index … out of range` during formatting snapshots. Those exceptions could interrupt reflow and undo updates. The fixes did not change the page model, geometry rules or history policy.

#### Tests and recorded validation

Production-schema model and service regressions covered multi-page forward/reversed ranges, peer pairs, final paragraphs, full-document selection, final `pageEnd`, document-end lookup and identical blocks. Large-selection snapshots also checked that document nodes were not logged.

759 unit tests passed. The exact `CI=true pnpm test:smoke` command passed all 16 cases. Three full repeats passed across Chromium/WebKit for 48 cases, including reflow/undo selection regressions and production builds.

#### Limits

A one-off Chromium caret-range assertion did not recur in five focused and three full repeats. The selection helper stayed unchanged. This did not establish a new geometry benchmark or native-runtime validation. See the [plugin PR entry](../plugins/change-log.md) for cumulative outcomes and limits. These historical results were not rerun for this editorial revision.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/80), verified by the parent agent: `merged: true`, `merged_at: 2026-11-14T19:08:58Z`, merge commit `4b39895c5218498fd1c0e79c99b1ea8012f1b67a` (recorded as matching `main` HEAD at verification).
