# Plugin implementation plan

## Status and scope

**Parts 1–2 are owner-authorized and implemented on `bh/phase-2-plugin-transition` (in progress / unmerged; no PR known). Parts 3–4 remain proposed for separate review and approval.** The frontend trust model and opt-in cooperation are accepted; task/provider contracts remain private and evolving, not a published stable API. Part 2's provider/dependency policies are approved; live ProseMirror callback access, schema lifecycle and native-enforcement designs are not authorized by this roadmap.

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

Parts 1–2 are implemented in the current working tree. Parts 3–4 remain a roadmap with separate design and approval gates, not one authorized migration.

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

The host resolves only declared integrations, not a universal event bus. These are trusted-code lifecycle contracts, not a frontend security sandbox, automatic installation or backend permission grants. Formatting still uses its feature-local injected service; no editor migration is included.

### Evidence and validation

- `src/lib/plugins/plugin-dependencies.test.ts` and manager tests cover dependency/facade lifecycle and consent behavior. The dependency suite includes 52 core cases and manager coverage includes five new consent/metadata cases; the full unit suite passes 966 tests in 45 files.
- `e2e/plugin-dependencies.test.ts` and `e2e/fixtures/plugins/` provide a production-built provider/consumer and management fixture through `playwright.plugins.config.ts` / `pnpm test:plugins`, separate from app e2e. Browser Smoke CI runs it for the selected Chromium/WebKit engine. All 8 provider browser cases passed across Chromium/WebKit, as did 114 app e2e cases, 20 smoke cases and 8 task fixture cases, including production builds. Lint, local Markdown links and whitespace checks passed. `pnpm check` remains blocked only by the existing Modal type error and five DnD warnings.
- No native-runtime enforcement, frontend isolation or performance guarantee is established. Parts 3–4 remain proposed.

This precedes proposed editor extraction because the word processor would provide APIs consumed by formatting and other plugins.

## Part 3 — Word-processing extension API

**Goal:** capable alternative formatting plugins and deep ProseMirror integrations use the same APIs for official and third-party code.

### 3A — Editor commands, observations, and result application

Introduce a word-processing provider with document/view identity and lifecycle, observations/subscriptions, supported command registration/invocation, synchronous current-state editing callbacks, and a task-result application helper that checks cancellation and target lifetime.

**Proposal requiring approval:** expose live ProseMirror objects inside documented synchronous editor callbacks. This supports wrappers and sophisticated commands without inventing a weaker editing language. Do not retain mutable transactions across async/cooperative boundaries. Current state alone does not validate an old result: map and validate targets, discard stale results, or recompute as appropriate.

Migrate formatting to this provider. Keep formatting-specific command names, UI, and policies in the formatting feature, not the generic plugin architecture.

**Proof case:** a small alternative formatting presentation uses the same provider without depending on the default toolbar.

### 3B — Behavioral extensions

Add lifecycle-owned registrations for a selected set of ProseMirror behaviors, validated by:

1. An input-rule wrapper.
2. A decoration-based feature.
3. A worker-backed analysis feature applying results against current state.

Define ordering and removal, especially for transaction hooks. Genuinely synchronous hooks remain synchronous.

**Approval gate:** decide editor reconfiguration behavior before implementing registrations. Adding an extension must not silently recreate a document or discard history.

### 3C — Custom content and Svelte node views

Prototype a small custom node rendered with ordinary Svelte. Cover mount/update/destroy, selection/events, editable content integration where needed, serialization, copy/paste, pagination interaction, and missing-plugin preservation.

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

Parts 1–2's private package boundary, task lifecycle/results and provider compatibility/dependency-removal policies are authorized and implemented, not pending approval. Remaining gates:

1. Before Part 3, approve synchronous live ProseMirror access and concrete registration/reconfiguration contracts; Part 2 does not authorize editor migration.
2. Before custom content or external loading, approve schema-preservation and native-enforcement designs respectively.
3. Require separate justification/approval for broader extraction or task/provider features beyond Parts 1–2; API publication/stability and performance targets are not established.
