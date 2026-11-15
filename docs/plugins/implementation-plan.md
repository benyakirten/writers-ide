# Plugin implementation plan

## Status and scope

**Proposed implementation plan, recorded for review.** This document does not authorize all four parts or finalize public API signatures. The owner has accepted the frontend trust model and opt-in cooperative execution direction; package names, dependency policies, live ProseMirror callback access, and the concrete implementation scopes below remain proposals until approved.

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

Part 1 is the recommended next implementation scope. The later parts are a roadmap with separate design and approval gates, not one large migration.

## Part 1 — Shared scheduler and managed tasks

**Goal:** plugins can use the existing cooperative scheduler easily, without writing generators for ordinary actions.

### Implementation

- Extract the generic `WorkQueue` into a private reusable workspace package, tentatively `@writers-ide/tasks`.
- Keep pagination-specific invalidation, revision tracking, and UI in the application.
- Preserve one shared application queue and its current scheduling behavior. Do not allocate a separate frame budget per plugin.
- Add a plugin-scoped task service that handles activation-owned cancellation and cleanup, task identity, namespaced replacement keys, progress/status, attributed errors, and optional caller cancellation.
- Provide cooperative iteration over bounded units, advanced generator jobs, lifecycle-managed async tasks, and worker tasks using bundled worker modules with a small request/result protocol.
- Keep short synchronous actions as ordinary functions. Do not require every command to declare an execution mode or pass through the scheduler.

The library owns execution mechanics; the plugin host supplies a scoped service. Editor concepts do not belong in the tasks package. Authors should not manage queue start leases or remember plugin-unload cleanup.

Worker support should initially use dedicated one-shot workers, explicit inputs/outputs, and optional transfer lists. Pooling is deferred until justified by a consumer. Do not serialize arbitrary functions with `toString()`: imports/closures and messaging are not preserved that way.

### Completion criteria

- Pagination still uses the shared queue and behaves unchanged.
- Identical plugin-local task keys cannot collide across plugins.
- Plugin unload cancels its tasks without affecting other plugins or pagination.
- Tests cover replacement, cleanup, errors, cancellation, and late results.
- An example demonstrates both convenient iteration and an advanced generator.

### Limits to communicate

Iteration helpers manage checkpoints, not callback cost. Each unit must remain short; the queue's soft budget cannot interrupt a running step. Async functions do not offload CPU work. Async cancellation is cooperative; dedicated workers can be terminated. No mutable editor transaction should survive an async boundary or cooperative yield.

## Part 2 — Versioned provider APIs and plugin dependencies

**Goal:** plugins consume another plugin's public functionality without importing its private implementation.

### Proposed initial policies

| Concern              | Initial proposal                                              |
| -------------------- | ------------------------------------------------------------- |
| Provider identity    | Named contract with a declared version                        |
| Compatibility        | Explicit API-major compatibility; manifest syntax to finalize |
| Required dependency  | Must be available before consumer activation                  |
| Optional dependency  | Consumer remains active without it                            |
| Cycles               | Reject required dependency cycles with a useful error         |
| Disabling a provider | Show affected required dependents before disabling them       |
| Cleanup order        | Dependents stop before required providers                     |
| Communication        | Public methods, subscriptions, and owned registrations        |

The host resolves dependencies and exposes providers declared by the consumer. These are integration contracts, not a frontend security sandbox. Do not build a universal event bus or put every subsystem service on the common plugin context.

### Completion criteria

- A provider/consumer fixture exercises activation and cleanup.
- Optional-provider arrival/removal has defined notifications.
- Missing/incompatible dependencies produce actionable manager errors.
- Retained handles reject calls after provider deactivation.
- Dependency declarations do not automatically install code or grant permissions.

This precedes editor extraction because the word processor will provide APIs consumed by formatting and other plugins.

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
- Extend the manager with dependency impact and task status where useful.
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

1. Approve Part 1's scope and the tentative private `@writers-ide/tasks` boundary.
2. Finalize task API shapes and lifecycle/result semantics while keeping cooperation opt-in.
3. Before Part 2, approve provider compatibility and dependency-removal policies.
4. Before Part 3, approve synchronous live ProseMirror access and concrete registration/reconfiguration contracts.
5. Before custom content or external loading, approve schema-preservation and native-enforcement designs respectively.
