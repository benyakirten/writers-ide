# Plugin implementation plan

## Status and scope

**Parts 1–2 and Part 3A are owner-authorized and implemented on `bh/phase-2-plugin-transition` (in progress / unmerged; no PR known). Parts 3B/3C and 4 retain separate review/approval gates; 3A is not all of Part 3.** The owner explicitly approved live ProseMirror `EditorState`/`EditorView` access inside synchronous callbacks, with the provider owning edits. Contracts remain private and evolving, not a published stable API. Behavioral reconfiguration, schema lifecycle and native-enforcement designs are not authorized by this roadmap.

Read [context.md](context.md) for current implementation and accepted architectural direction, [change-log.md](change-log.md) for cumulative PR outcomes, and [project context](../project-context.md) for repository-wide constraints. Update this plan as scopes are approved or completed; do not treat it as evidence that a feature exists.

## Principles

- Official and third-party plugins use the same public APIs, without privileged built-in shortcuts.
- Frontend plugins are trusted code. Ordinary Svelte and external network calls are allowed in principle; frontend DOM isolation is deferred.
- Backend/native access remains highly restrictive. Frontend trust must not imply unrestricted native authority.
- Reuse pagination's cooperative scheduler. Encourage adoption through useful helpers and APIs, not a generator or execution-mode declaration required for every action.
- General execution mechanics, plugin lifecycle ownership, and word-processing APIs are separate responsibilities.
- Preserve current model-mutating pagination unless a redesign is separately approved.
- Do not enable external loading merely because lifecycle interfaces or capability declarations exist.

## Sequence at a glance

| Part                 | Main outcome                                                    | Explicitly excluded                                    |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| 1. Tasks             | Shared scheduler and ergonomic managed execution                | Editor migration, external loading                     |
| 2. Providers         | Versioned inter-plugin APIs and dependency lifecycle            | Universal service bus, automatic installation          |
| 3. Editor extensions | Replaceable formatting, ProseMirror wrappers, Svelte node views | Pagination redesign, unrestricted live schema toggling |
| 4. External loading  | Installation, trust UX, verified native restrictions            | Frontend sandbox guarantees                            |

Parts 1–2 and 3A are implemented in the current working tree. Parts 3B/3C/4 remain a roadmap with separate design and approval gates, not one authorized migration.

## Part 1 — Shared scheduler and managed tasks

**Goal:** plugins can use the existing cooperative scheduler easily, without writing generators for ordinary actions.

### Implemented scope (unmerged)

- Private `@writers-ide/tasks` exports the extracted `WorkQueue`, `createTaskService` and contracts; it has no singleton or editor/plugin-host dependency. Pagination invalidation, revision tracking and UI remain in the application.
- `src/lib/editor/state/work-queue.svelte.ts` preserves compatibility exports and the same application singleton. `createApplicationPluginHost` passes it by default; generic `PluginHost` accepts optional `workQueue`, otherwise allocating an independent queue. Application plugins do not receive separate frame budgets.
- The common context now exposes `signal`, `own`, `contributions`, and `tasks`. Toolbar/view/command capabilities are unchanged; tasks require no extra capability and do not introduce feature services or a generic service bus.
- Per-activation services expose `forEach`, `cooperative`, `async`, and `worker`, with caller/owner cancellation, replacement keys isolated across activations, reactive status/progress/errors, and nonrejecting completed/cancelled/failed outcomes. Cooperative helpers own queue leases and expose pause/resume; async/worker work acquires no scheduler lease. Disposal cancels only owned work and revokes submissions.
- Task errors appear in management with `phase: 'task'` and label/key attribution. They do not disable the plugin or make successful deactivation fail; activation and host cleanup failures still do.
- Keep short synchronous actions as ordinary functions. No mandatory execution-mode declaration or scheduler path is introduced.

The library owns execution mechanics; the plugin host supplies a scoped service. Editor concepts do not belong in the tasks package. Authors should not manage queue start leases or remember plugin-unload cleanup.

Worker support uses dedicated one-shot bundled modules, explicit inputs/outputs and optional transfer lists. `@writers-ide/tasks/worker` exports the independent `defineTaskWorker` protocol helper without Svelte or application/DOM runtime imports. The service handles result/error messages, transport/application failures, termination and late responses; synchronous `apply` runs at most once while active. Pooling, worker progress and timeouts are deferred. No arbitrary function serialization is supported: `toString()` does not preserve imports/closures or provide messaging.

### Completion evidence and remaining validation

- Queue budget/fairness and pagination behavior remain unchanged; compatibility exports retain the original queue regression suite.
- Service and host tests cover isolated keys, cross-mode replacement, leases, cancellation/reentrancy, cleanup failures, rollback, reactivation and late results. Plugin unload leaves other owners and pagination intact.
- The [task guide](../../packages-js/tasks/README.md) documents convenient iteration, advanced generators, async work, worker modules and exact outcome semantics; [contracts](../../packages-js/tasks/src/contracts.ts) are the type reference.
- `e2e/tasks.test.ts` and `e2e/fixtures/tasks/` exercise real emitted workers, transfers, started-worker cancellation, errors/recovery and shared queue ownership through `playwright.tasks.config.ts` / `pnpm test:tasks`. Browser Smoke CI adds a task step for its selected engine, separate from app smoke/pagination.
- Validation: 909 unit tests in 43 files, the exact `CI=true pnpm test:smoke` command, 16 pagination/stylesheet cases and 8 dedicated task cases passed across Chromium/WebKit with production builds. Lint, local Markdown target checks and whitespace checks passed. `pnpm check` reports only the existing Modal type error and five DnD warnings. See the [cumulative entry](change-log.md) for details; no native verification is claimed.

### Limits to communicate

Iteration helpers manage checkpoints, not callback cost. Each unit must remain short; the queue's soft budget cannot interrupt a running step. Async functions do not offload CPU work. Async cancellation is cooperative; dedicated workers can be terminated. No mutable editor transaction should survive an async boundary or cooperative yield.

## Part 2 — Versioned provider APIs and plugin dependencies

**Goal:** plugins consume another plugin's public functionality without importing its private implementation.

### Implemented scope (owner-authorized / unmerged)

- `definePluginApi<T>({ id, major })` defines a frozen nonempty ID and positive safe-integer major. Providers declare `provides: [{ id, major }]`; consumers pin `dependencies: [{ provider, api, major, optional? }]` to an exact provider ID/API ID/major, not a package-version range. Self/duplicate dependencies fail validation.
- Providers publish each declared contract once through `context.apis.provide(contract, factory)` during synchronous activation only. `get`/`subscribe` require the consumer's matching declaration. Optional absence yields `null`; subscriptions deliver immediately and on provider arrival/removal/reactivation. Optional dependencies never auto-activate providers and consumers remain active on optional removal.
- Required activation preflights the entire registered-only required graph before activators run, rejects missing/incompatible contracts and required cycles, and activates dependencies first. Optional edges allow cycles between distinct plugins and do not affect activation ordering. Graph mutations are serialized and notification callbacks must defer lifecycle changes. Newly enabled providers stay enabled after downstream failure; only the failed activation is rolled back.
- Synchronous factories return plain method-only objects with own string-named methods, no data fields, getters/accessors, symbols, class/prototype methods, promises or `then`. Frozen top-level facades are cached per consumer activation/provider activation/contract and throw after either endpoint stops. Nested return values and method-returned promises/functions are not recursively revoked.
- Connections expose `consumerId`, `signal`, `own`, and `guard`. Either endpoint stopping revokes/aborts the connection and releases owned resources in reverse order. Cleanup is idempotent, late ownership disposes immediately, and cleanup errors are provider-attributed. Providers must own registrations and guard callbacks or honor cancellation; `guard` suppresses late calls with `undefined`, honestly returning `Result | undefined`, without catching live callback failures or retracting returned results.
- Frozen management snapshots include active provider identities and dependency availability: `missing`, `incompatible`, `inactive`, `available`. Availability does not guarantee successful factory construction. Errors distinguish `dependency` preflight/downstream failures, `provider` factory/connection-cleanup and subscription errors, and existing `task`, `activation`, `cleanup` phases. Provider/task errors do not disable active plugins or fail otherwise successful deactivation; activation/dependency/host-cleanup failures retain lifecycle consequences.
- `planDeactivation` returns the transitive active-required-dependent-first plan. Disabling with affected dependents requires explicit `{ cascade: true }` consent; optional consumers receive removal instead. The manager shows impact, focuses Cancel, rechecks the plan before confirmation, requires renewed review on changes, protects `requiredPluginIds` throughout the plan and restores launcher focus on cancel/completion. This required-ID protection is UI policy, not an ambient authority boundary.

The host resolves only declared integrations, not a universal event bus. These are trusted-code lifecycle contracts, not a frontend security sandbox, automatic installation or backend permission grants. Part 2 alone did not migrate the editor; the subsequently authorized Part 3A below migrates formatting to a word-processing provider.

### Evidence and validation

- `src/lib/plugins/plugin-dependencies.test.ts` and manager tests cover dependency/facade lifecycle and consent behavior. The dependency suite includes 52 core cases and manager coverage includes five new consent/metadata cases; the full unit suite passes 966 tests in 45 files.
- `e2e/plugin-dependencies.test.ts` and `e2e/fixtures/plugins/` provide a production-built provider/consumer and management fixture through `playwright.plugins.config.ts` / `pnpm test:plugins`, separate from app e2e. Browser Smoke CI runs it for the selected Chromium/WebKit engine. All 8 provider browser cases passed across Chromium/WebKit, as did 114 app e2e cases, 20 smoke cases and 8 task fixture cases, including production builds. Lint, local Markdown links and whitespace checks passed. `pnpm check` remains blocked only by the existing Modal type error and five DnD warnings.
- These are Parts 1–2 validation results, not final validation of the current 3A working tree. No native-runtime enforcement, frontend isolation or performance guarantee is established.

This dependency infrastructure now supports Part 3A's word-processing provider, consumed by formatting and the independent QuickFormat example.

## Part 3 — Word-processing extension API

**Goal:** capable alternative formatting plugins and deep ProseMirror integrations use the same APIs for official and third-party code.

### 3A — Editor commands, observations, and result application

**Owner-approved and implemented / unmerged.** Live `EditorState`/`EditorView` callbacks are synchronous-only; the provider owns edits. This approval does not authorize 3B reconfiguration or 3C schema changes.

- Private `@writers-ide/word-processing` supplies source contracts, `createWordProcessingService` and connection facades without app imports. The app adapter `createWordProcessingPlugin(sources = defaultWordProcessingSources)` supplies existing view/active-tab/update sources. The route registers provider and formatting, activates formatting through required-provider resolution, and cascades provider teardown. API cleanup does not destroy source-owned views.
- Data-only snapshots/subscriptions and `inspect`, `edit`, `runCommand`, `registerCommand`, `executeCommand`, `commands`, `applyResult` support explicit targets and provider-owned dispatch. Command registrations belong to this service/connection, not the ProseMirror plugin registry or automatic shortcut routing.
- Exact targets are `{ viewId, documentId, revision }`; module-wide monotonic tokens survive service/provider restarts. Even selection-only state changes invalidate targets. Caller/connection signals, target freshness, lifetime, editability and optional active-view requirements are rechecked around callbacks and dispatch. Async/worker/cooperative results are strictly discarded when stale, not mapped or retargeted; recomputation is explicit.
- Do not retain live objects/transactions/dispatch callbacks or directly dispatch through the raw view. Thenable callbacks throw but cannot undo an async body already started or raw dispatch. `tr.before` verifies the current document, not transaction-origin state: a retained transaction from another state with the same document can pass with a fresh target and violates the contract.
- Commands return a synchronous boolean, capture at most one transaction, and dispatch only after invocation/revalidation for `true`. Nested inspection is allowed; nested edits and editing during notifications return `busy`. Connections own command/subscription cleanup and guard late callbacks; lazy shared source/effect resources are released when unused or disposed.
- `createFormattingPlugin()` has no injected argument: it resolves its required provider and builds `FormattingService(provider)` per activation. Feature policies stay in Basic Menu, including caret mark no-ops, exclusivity and continuation-aware commands. The app dispatch pipeline, history, schema and model-mutating pagination are unchanged; no editor reconfiguration is added.
- **Independent proof:** `menu/quick-format/` consumes only the public provider API and upstream `toggleMark`, supporting production `bold` and conventional `strong`, caret stored marks, both orientations and a connection-owned command. It is registered only in the dedicated browser fixture, not the default app, and does not depend on Basic Menu.

**Validation:** all 1,025 unit tests in 47 files passed, including 53 core service cases. All 12 Chromium/WebKit cases (six scenarios) passed via the dedicated `test:word-processing` configuration. Its production-built fixture uses the actual app provider adapter, generic host, real ProseMirror views/history and a bundled worker, with no Basic Menu import or registration. It covers selection/caret formatting, focus/remount/undo, stale/cancelled/closed-view results, same-document view isolation, cascade revocation and fresh reactivation. The full app suite passed 116 browser cases, including actual provider cascade/content/undo preservation; dedicated provider and task fixtures each passed 8 cases. Production builds, lint, local Markdown links and whitespace checks passed. `pnpm check` remains blocked only by the existing Modal type error and five DnD warnings. No native/runtime checks were run. See [context](context.md#word-processing-provider-part-3a-implemented--unmerged), the [author guide](../../packages-js/word-processing/README.md) and the [existing branch entry](change-log.md).

### 3B — Behavioral extensions

**Proposed; separate owner approval required.** Add lifecycle-owned registrations for a selected set of ProseMirror behaviors, validated by:

1. An input-rule wrapper.
2. A decoration-based feature.
3. A worker-backed analysis feature applying results against current state.

Define ordering and removal, especially for transaction hooks. Genuinely synchronous hooks remain synchronous.

**Approval gate:** decide editor reconfiguration behavior before implementing registrations. Adding an extension must not silently recreate a document or discard history.

### 3C — Custom content and Svelte node views

**Proposed; separate owner approval required.** Prototype a small custom node rendered with ordinary Svelte. Cover mount/update/destroy, selection/events, editable content integration where needed, serialization, copy/paste, pagination interaction, and missing-plugin preservation.

**Approval gate:** schema lifecycle is a separate design. Before shipping arbitrary node/mark registration, decide when schemas are assembled, what provider changes mean for open documents, and how unsupported content survives. Removing content support is not equivalent to toggling a toolbar.

Do not start with editable columns plus LaTeX: that combines multiple unresolved systems. A smaller node should validate the boundary first. No iframe-per-node rendering or bespoke UI DSL is required by the accepted frontend direction.

## Part 4 — External packages and user-facing trust

**Goal:** move beyond bundled plugins without implying isolation that does not exist.

Before external loading:

- Audit Tauri commands and native capabilities reachable from frontend code.
- Establish restrictive native access and test it in packaged applications.
- Define package identity, entry points, compatibility, and dependency metadata.
- Add installation/removal and persistent activation preferences.
- Present clear frontend trust and document/network disclosures. Document access plus network access permits exfiltration; informational declarations are not enforced restrictions.
- Build on the implemented dependency-impact manager and task error reporting; design any additional external-package/task-status UX separately.
- Prevent project data from automatically installing or executing extensions.

Frontend DOM isolation remains deferred. No iframe or ShadowRealm work is necessary for the preceding parts. If a claimed native restriction cannot be enforced, resolve that before external loading rather than hiding the gap behind a manifest checkbox.

## Validation and documentation

For each part:

- Keep topic context and the cumulative in-progress PR entry current alongside implementation.
- Start with focused unit/integration tests, then run the relevant checks from [CONTRIBUTING.md](../../CONTRIBUTING.md).
- Scheduler changes require pagination browser regressions, not only mocked queue tests.
- Editor changes require typing, selection, formatting, undo, and lifecycle coverage in real browsers where geometry is involved.
- Native restrictions require packaged-runtime verification; browser tests cannot establish Tauri enforcement.
- Report what passed, failed, or could not be run. Distinguish proposed behavior from implementation and verified guarantees.

## Decisions needed before implementation

Parts 1–2's task/provider policies and Part 3A's synchronous live access, provider-owned edits and formatting migration are authorized and implemented, not pending approval. Remaining gates:

1. Before Part 3B, approve behavioral registration, ordering/removal and editor reconfiguration contracts; Part 3A does not authorize installing arbitrary ProseMirror plugins or recreating editors.
2. Before Part 3C/custom content or Part 4/external loading, approve schema-preservation and native-enforcement designs respectively.
3. Require separate justification/approval for broader extraction or task/provider features beyond Parts 1–2/3A; API publication/stability and performance targets are not established.
