# Plugin implementation plan

A plugin adds an application feature through supported extension points. A library supplies imported code without a plugin lifetime. The core hosts plugins and coordinates shared workspace and platform rules. Both plugins and the core can use libraries.

This plan explains what plugin authors can use now and what needs design approval next. Read [context.md](context.md) for terminology and current contracts. Use the [plugin guide](../../packages-js/plugins/README.md), [task guide](../../packages-js/tasks/README.md), and [word-processing guide](../../packages-js/word-processing/README.md) for API details.

## Status and scope

Bundled plugins can contribute UI and commands, run managed tasks, depend on versioned APIs, and extend existing editors. They can render existing schema nodes and marks through dedicated APIs, including ordinary Svelte components. New content types and external package loading remain separately gated.

Parts 1, 2, 3A, 3B, and the first rendering slice of 3C are owner-approved and implemented, but unmerged. Contracts remain private and evolving, not a published stable SDK. Part 3C's new-content/schema work and Part 4's external-loading design still need separate owner approval. See the [changelog](change-log.md) for branch and PR metadata.

The [changelog](change-log.md) records cumulative branch outcomes and validation. [Project context](../project-context.md) supplies repository-wide constraints. A plan is not evidence that proposed functionality exists.

## Principles

Official and third-party plugins must use the same supported public APIs. Official features must not receive privileged shortcuts into editor or application internals.

Frontend plugins are trusted code in the app's JavaScript environment, not sandboxed code. Ordinary Svelte and network requests are allowed in principle. Preventing access to other DOM is deferred. A plugin with document and network access can disclose the document.

Native access means authority such as Tauri IPC, filesystem operations, processes, and native libraries. It must remain highly restrictive. Frontend trust does not grant that authority. External loading needs an approved trust model and verified native enforcement, not just manifest declarations or TypeScript interfaces.

Keep execution mechanics, plugin lifetime management, and editor APIs separate. Reuse pagination's scheduler for cooperative work, but keep short commands and synchronous hooks immediate. Promises do not offload CPU work. Preserve model-mutating pagination unless a redesign is separately approved.

## Sequence at a glance

The older **stages** describe the architectural rollout: establish a bundled host, extract libraries and add management UI, then support external loading. The **parts** below describe the later implementation sequence. They are not the same numbering scheme. Part 3 is editor extensibility, not Stage 3 external loading.

Stage 1 merged in [#80](https://github.com/benyakirten/writers-ide/pull/80) on 2026-11-14. The current branch implements Stage 2, including Parts 1, 2, 3A, 3B, and Part 3C's existing-content rendering slice. Part 3C's new-content/schema work remains proposed. Part 4 addresses the remaining Stage 3 external-loading work. See the [stage history](context.md#accepted-implementation-stages).

| Work                       | Outcome                                                                | Status                          |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| Part 1: managed tasks      | Shared scheduling and owned execution                                  | Implemented, unmerged           |
| Part 2: provider APIs      | Declared plugin dependencies and connection lifetimes                  | Implemented, unmerged           |
| Part 3A: editor operations | Observations, commands, and strict result application                  | Implemented, unmerged           |
| Part 3B: editor behaviors  | Managed ProseMirror plugins in existing editors                        | Implemented, unmerged           |
| Part 3C: custom content    | Existing-type renderers and Svelte adapters; schema work remains gated | Rendering implemented, unmerged |
| Part 4: external packages  | Installation, trust disclosures, native restrictions                   | Proposed; approval required     |

## Part 1 — Shared scheduler and managed tasks

**Goal:** plugins can schedule incremental work through lifecycle-owned task helpers.

### Implemented scope (unmerged)

Private `@writers-ide/tasks` exports `WorkQueue`, `createTaskService`, and task contracts. It has no singleton, editor, or plugin-host dependency. Pagination invalidation, revisions, and UI remain application responsibilities.

The application queue module supplies the shared queue singleton. `createApplicationPluginHost` shares it with plugins by default. A generic `PluginHost` accepts an optional `workQueue`; otherwise it creates an independent queue. Application plugins do not get separate frame budgets.

Each activation receives `context.tasks`. Activation is the period from enabling a plugin until it is stopped or fails. Its task service owns cancellation and cleanup for that period. Tasks require no extra capability declaration. The common context contains `signal`, `own`, `contributions`, `tasks`, and `apis`; it does not contain feature-specific services.

Authors choose a helper to suit the work:

- `forEach` processes items in short synchronous units. It yields control between units so the UI can respond.
- `cooperative` uses synchronous generators with explicit points for yielding control.
- `async` manages asynchronous APIs. It does not move CPU work off the main thread.
- `worker` runs computation in a separate worker thread.

Helpers manage cancellation, replacement keys, status, progress, and completed/cancelled/failed outcomes. A replacement key identifies work that should replace an earlier task with the same key.

Cooperative work needs a request to keep the queue running. This request is called a queue start lease. Helpers acquire and release it automatically and support pause/resume. Async and worker tasks need no scheduler lease. Disposing a task service stops only its owned work and rejects new submissions.

Each worker task starts a fresh dedicated worker from a module included in the build. Inputs and outputs are explicit. Optional transfer lists move supported values to the other thread instead of copying them. The separate `@writers-ide/tasks/worker` entry exports `defineTaskWorker`. It imports no Svelte, application, or DOM runtime code.

Worker result application is synchronous and runs at most once while the task is active. There is no worker pooling, progress protocol, or timeout support.

Task errors use management phase `task` with label/key attribution. They do not disable an active plugin or fail otherwise successful deactivation. Activation and host-cleanup failures still affect lifecycle status. See the [task guide](../../packages-js/tasks/README.md) for exact handles, outcomes, cancellation, and cleanup rules.

### Completion evidence and remaining validation

Queue compatibility tests retain the original scheduling and pagination coverage. Service and host tests cover keys, cross-mode replacement, leases, cancellation, cleanup, rollback, reactivation, and late results. `e2e/tasks.test.ts` and `e2e/fixtures/tasks/` test emitted workers, transfers, cancellation, recovery, and shared ownership. Run them with `pnpm test:tasks` using `playwright.tasks.config.ts`. Browser Smoke CI runs the fixture for its selected engine, separately from app tests.

See the [changelog](change-log.md) for recorded validation results and outstanding diagnostics.

### Limits to communicate

Each scheduler frame has an 8 ms soft time budget and a 1,000-step cap. Soft means the scheduler checks time between steps. It cannot interrupt a running step. Iteration helpers provide points to yield control, but cannot limit the cost of the callback between those points. Each unit must remain short.

Async cancellation requires the underlying operation to honor its signal. A dedicated worker can be terminated. Main-thread CPU work cannot be interrupted. Do not retain mutable editor transactions across `await` or cooperative yields. Quotas and slow-step diagnostics are not implemented.

## Part 2 — Versioned provider APIs and plugin dependencies

**Goal:** plugins use another plugin's public functionality without importing its private implementation.

### Implemented scope (owner-authorized / unmerged)

A provider publishes a named API. A consumer declares the exact provider plugin ID, API ID, and positive safe-integer major it needs. This is separate from package `version` and the host's exact `apiVersion: 1`. There is no version-range negotiation, automatic provider discovery, or installation.

Providers declare contracts during registration. During activation, they publish factory functions that create API objects synchronously. Consumers can request or subscribe only to declared dependencies. A factory returns a plain object containing methods only. The host reuses one frozen API object for each consumer activation, provider activation, and contract.

Required dependencies follow these rules:

- The host checks all required relationships, including dependencies of dependencies, before activation functions run. Only registered plugins participate.
- Missing or incompatible contracts fail the check.
- A cycle, where required relationships lead back to the same plugin, also fails.
- Dependencies activate before consumers. If a later consumer fails, successfully enabled providers stay enabled.

Optional dependencies never activate a provider. Optional cycles between distinct plugins are allowed. Subscriptions deliver the API or `null` immediately, then on provider arrival, removal, or reactivation. Optional consumers stay active when the provider stops.

Stopping either the provider or consumer ends their connection. This is revocation. Top-level API methods then throw, the signal aborts, and registered cleanup runs in reverse order. Returned values, nested functions, and promises are not automatically revoked.

Providers must register resource cleanup and either guard callbacks or honor cancellation signals. `guard` suppresses late calls and returns `undefined` after revocation. It does not catch errors from callbacks that run while live.

Connection `reportError` can report only against its exact consumer activation while both endpoints remain live. Late reports are ignored.

The manager shows dependency availability and errors. Stopping a provider may also require stopping its active consumers, including consumers of those consumers. The user must explicitly approve this cascade. The plan stops consumers before the providers they require.

The manager initially focuses Cancel and rechecks the plan before acting. It protects required IDs throughout the plan, not just on the clicked row. Cancellation or completion restores launcher focus. Required-ID protection is UI policy, not a security boundary.

See [current dependency contracts](context.md#cross-plugin-contracts-and-dependencies) and the [provider guide](../../packages-js/plugins/README.md#share-a-versioned-api-with-another-plugin) for object-shape restrictions, serialized lifecycle changes, error attribution, and cleanup rules. These contracts do not grant data or native permissions or create a universal service bus.

### Evidence and validation

`src/lib/plugins/plugin-dependencies.test.ts` covers provider and connection lifetimes. Manager tests cover metadata and cascade consent. `e2e/plugin-dependencies.test.ts` and `e2e/fixtures/plugins/` provide the production-built fixture. Run `pnpm test:plugins` using `playwright.plugins.config.ts`. It is separate from app e2e and runs in Browser Smoke CI for the selected engine.

Recorded validation results are in the changelog. These tests establish no native, isolation, or performance guarantee.

This infrastructure supports the word-processing provider used by formatting and independent consumers.

## Part 3 — Word-processing extension API

**Goal:** alternative formatting plugins and deeper editor integrations use the same APIs as official features.

A ProseMirror `Plugin` is an editor extension object, not an application plugin with a host identity and lifecycle. Its hooks are callbacks invoked by the editor, for example to handle a key or append a transaction. Behavioral registrations connect those editor objects to an application consumer's lifetime.

### 3A — Editor commands, observations, and result application

**Implemented and owner-approved; unmerged.** Consumers observe editors, inspect live state, build edits, register commands, and apply computed results. The provider owns dispatch. Live `EditorState` and `EditorView` access is approved only inside synchronous callbacks.

Private `@writers-ide/word-processing` contains contracts and service mechanics without app imports. The app's `createWordProcessingPlugin(sources = defaultWordProcessingSources)` supplies registered-view, active-tab, and update sources. The route activates formatting through its required provider and cascades provider teardown. Cleanup does not destroy source-owned views.

Targets are exactly `{ viewId, documentId, revision }`. Tokens increase across provider restarts within the module. Selection-only state changes also invalidate them. The service checks signals, lifetime, editability, freshness, and any active-view requirement around callbacks and dispatch. Stale computed results are discarded, not mapped or retargeted.

Do not retain live callback objects or transactions, or dispatch through the raw view. Callbacks must return immediately, not return a promise. Other objects with a callable `then` method are also promise-like; they are called thenables. Detecting such a result cannot undo an async body already started or a direct raw-view dispatch.

A matching `tr.before` proves only that the transaction starts from the current document. It does not prove which editor state created that transaction. An old transaction from the same document can pass with a fresh target. Supplying it violates the contract.

Commands return a boolean synchronously and capture at most one transaction. After the command returns, the provider checks the target again. It dispatches only for `true`. A callback can inspect the editor again, but cannot start a nested edit. Nested edits and editing during notifications return `busy`.

Connections own commands and subscriptions. Shared source resources are released when unused.

Formatting creates an activation-owned `FormattingService(provider)`. Basic Menu retains its own policies. Independent QuickFormat uses the public API and upstream `toggleMark`, including caret stored marks, without importing Basic Menu. It is enabled only in the dedicated browser fixture. Editor assembly, history, schema, and model-mutating pagination remain in the app.

See [current editor contracts](context.md#word-processing-provider-part-3a-implemented--unmerged) and the [author guide](../../packages-js/word-processing/README.md). Part 3A's 53 service cases and six original scenarios remain in the expanded suite below. The production-built fixture uses the actual app adapter, generic host, real views/history, and a bundled worker.

### 3B — Behavioral extensions

**Implemented and owner-approved; unmerged.** Consumers register synchronous per-view factories that return actual ProseMirror Plugins. Registrations can target a view-ID allowlist and receive per-instance cancellation signals. IDs are service-global.

The editor has plugins installed outside behavioral registrations. These form the current **baseline**. Managed plugins run before them without changing baseline identities or order. Managed priority sorts from highest to lowest; ties keep insertion order. Duplicate keys fail the new registration, not the existing one.

A ProseMirror plugin's key identifies its state and transaction metadata. It can be an explicit `PluginKey` or an automatically generated key. Wrappers preserve the original keys, so upstream packages can still retrieve their state. Callbacks keep the `this` value expected by the upstream implementation.

The approved `EditorState.reconfigure` changes the existing editor's plugin list using the same schema. It preserves:

- Document and selection.
- Stored marks, which control formatting for subsequently typed text.
- History.
- State for plugins whose keys remain in the list. This is surviving **keyed state**.

Reconfiguration creates no transaction or undo entry and does not recreate the view. Surviving behaviors keep their factory, wrapped Plugin identity, and signal. ProseMirror may still destroy and recreate resources from a plugin's `view()` callback when the list changes. Ordinary behaviors still reject `nodeViews` and `markViews`; renderers use the dedicated Part 3C APIs.

When views arrive, change identity, or close, the service updates their installed behaviors. This process is called reconciliation. Source-driven changes wait for a microtask, which runs after the current synchronous call stack returns. This keeps reconfiguration outside editor hooks.

Removal immediately disables callbacks. Removing the plugins from editor state is a separate step. Signal-driven removal always waits for a microtask. Explicit removal also waits while managed hooks or service operations are running. Registration changes inside callbacks or notifications must be explicitly deferred.

Before installation, the service prepares candidate states for matching views. This is staging. It checks that the input views, states, and lifetimes are still current. It also retains transactions dispatched during plugin-view setup or update, rather than overwriting them with older prepared states.

Updating behaviors can trigger more source changes. The service repeats reconciliation at most 16 times in one run. If changes still do not settle, it disables all still-active registrations, aborts their instances, and retains removable failed metadata. This is called quarantine.

A registration is also quarantined across all views when its callback throws, returns an invalid value, or returns a promise or other thenable. Callback guards stop it immediately. Physical removal waits until outside the executing hook. During that wait:

- A failing transaction filter rejects the transaction on its first error. Its disabled guard then allows later transactions until removal.
- Other hooks return safe fallback values. The exact values are listed in [behavior contracts](context.md#failures-and-diagnostics).
- Cleanup continues after errors. Source and connection reporters are independent, so one throwing does not prevent the other from receiving the error.

Errors retain their owner attribution without automatically disabling the application plugin. The 16-pass bound applies only to reconciliation. It does not limit ProseMirror's separate loop of appended transactions. That loop can still be unbounded.

The initially submitted transaction is the root. ProseMirror can reject it or accept it and append further transactions. The app uses `applyTransaction` to obtain the accepted sequence. It emits `PreUpdate` for each accepted root and append before one DOM state update. A rejected root causes neither notification nor DOM update.

Optional synchronous `sources.prepareTransaction` prepares transactions returned by managed append hooks. Preparation happens before ProseMirror applies them and before the service checks their starting document. The app uses unchanged page-index and stored-mark normalization from `view/page-indexes.ts`. PageObserver interprets positions using each transaction's own documents. This changes neither schema nor pagination algorithms.

Three opt-in examples exercise real upstream input rules/undo, mapped keyed decorations, and bounded worker analysis of selected chunks. Analysis captures at most 32,768 model positions and 1,024 chunks. Tokens do not span nodes or chunks. It uses per-view cancellation and strict-target synchronous result application, not a full-manuscript scan. `prosemirror-inputrules` is declared as `^1.6.0` and locked to `1.6.0`.

See the [example guide](../../src/lib/editor/prosemirror/behaviors/README.md) for commands and fixture controls. The fixture enables behaviors only on request, not in the default app. Part 3B added twelve behavior cases to the original twelve Chromium/WebKit cases. The dedicated configuration now also includes the renderer and production-pagination tests. The existing CI step uses that configuration; main app e2e excludes these files. Structural edits in this fixture do not establish real pagination geometry.

See the [cumulative entry](change-log.md) for recorded validation results and outstanding diagnostics. Browser selection tests have shown intermittent collapsed-selection failures with an unestablished cause. No native/security guarantee is inferred from these suites.

The service cannot undo arbitrary side effects, started async bodies, or raw dispatch. It cannot preempt CPU loops or guarantee append-loop termination. See [behavior contracts](context.md#lifecycle-owned-behaviors-part-3b-implemented--unmerged) for exact ordering, fallbacks, diagnostics, staging, and cleanup, and the [package guide](../../packages-js/word-processing/README.md#part-3b-lifecycle-owned-editor-behaviors) for author details.

### 3C — Custom content and Svelte node views

**First rendering slice implemented and owner-approved; unmerged.** Rendering existing schema types is available. Registering new content types remains a separate design gate.

#### Rendering existing content versus defining new content

ProseMirror's schema defines allowed nodes and marks. A **node view** customizes an existing node's editor DOM and interactions. A **mark view** customizes the wrapper around marked content. Both support `update` in the installed ProseMirror version. Marks do not have node-specific selection callbacks.

The implemented slice renders existing types without changing the schema. It does not register new nodes or marks. Schema rules still define serialization and copy/paste. Renderer UI is not a saved document format.

#### Registration and conflict policy

`registerNodeView({ id, name, nodeType, views?, create })` and `registerMarkView({ id, name, markType, views?, create })` are dedicated connection-owned APIs. Ordinary behaviors still forbid `nodeViews` and `markViews`. Factories synchronously return standard ProseMirror constructors for each matching live view/document identity. `EditorRendererContext` extends the behavior context with `reportError(error)` for later failures.

IDs share one namespace with behaviors. View allowlists may be disjoint. Overlapping scopes for the same type name reject the new registration, including a node/mark name collision in ProseMirror's shared renderer map. Existing baseline renderer props also block registration. There is no priority-based replacement. Later source conflicts or unknown types quarantine the affected registration.

#### Svelte adapter and DOM ownership

`@writers-ide/word-processing/svelte` exports `defineSvelteNodeView` and `defineSvelteMarkView`. These helpers mount ordinary Svelte components and return standard constructors. Direct DOM renderers use the same registration API.

Authors supply explicit `props`, an optional outer `tag`, and `onError: ctx.reportError`. Nodes can enable `contentDOM`; marks always have editable content. The component attaches the supplied action to one stable, empty, unconditional host. ProseMirror alone owns its editable children. The adapter owns component UI, updates props synchronously, preserves DOM identities, routes editable mutations to ProseMirror, and tears down component resources once.

The adapter supports reactive mark updates. Only node views receive node selection props and callbacks. See the [author guide](../../packages-js/word-processing/README.md#part-3c-renderers-for-existing-content) for complete examples, options, and event rules.

#### Ownership, removal and failures

Registrations follow consumer connection ownership and per-view signals through opening, closure, replacement, removal, disable, and provider teardown. Installation/removal preserves the existing schema, content, selection, stored marks, history, and surviving keyed state. Removed renderers return to schema rendering without deleting content.

Factory, constructor, and guarded callback failures quarantine the registration across all views. Guards stop immediately; physical removal is deferred outside executing callbacks. Invalid results, thenables, and changed DOM identities also fail. Source and connection reporters retain owner attribution. The Svelte boundary rescues editable content before a failed component branch is removed. Passing `onError: ctx.reportError` connects later boundary failures to quarantine. Arbitrary event/async failures are not universally caught, and arbitrary side effects cannot be rolled back.

#### New content types and schema lifecycle

Before arbitrary node or mark registration, approve:

- How schema definitions are assembled and how type identities are chosen.
- When schema changes can take effect and what they mean for open documents.
- How documents identify required content support.
- How unsupported content survives when its provider is absent.
- What disabling a content provider means for editing, serialization and recovery.

Removing support for a content type is not equivalent to disabling a toolbar or replacing its renderer. Do not remove unsupported content merely because its plugin is unavailable.

#### Browser and pagination validation

The opt-in [renderer fixtures](../../e2e/fixtures/word-processing/README.md) cover editing, selection, controls, serialization, history, lifecycle, conflicts, and synchronous/async-boundary failure recovery. Composition coverage uses synthetic events, not a real IME. Test references describe coverage, not a claim that validation passed.

Optional `sources.invalidateLayout(viewId)` connects renderer changes to host layout. The app calls `PageObserver.invalidate`. One lazy resize observer per editor view is shared across renderers. Inline renderers include a containing layout box. A shared child-list observer refreshes those targets after attachment or page reparenting. Initial size deliveries establish baselines only. Actual renderer-set changes and subsequent dimension changes request coalesced frame invalidation. Ordinary source notifications and selection changes do not each restart pagination.

The paginated fixture uses the production schema, `createView`, and `Paginator`. Its browser tests measure page-content bounds after installation, component-only growth/shrink, removal, edits, and undo. Current model-mutating pagination remains intact. Arbitrary structures such as columns still require separate layout design.

#### Recommended investigation sequence

1. Keep existing-type renderer contracts and focused examples covered as the private API evolves.
2. Design new node/mark registration separately. Approve schema lifecycle and missing-content preservation before implementing it.
3. Evaluate complex content such as columns only after approval of its layout and conversion design.

## Part 4 — External packages and user-facing trust

**Design approval required before implementation.** The goal is to load external plugins without claiming frontend isolation that does not exist. The owner has approved separate packaging of Basic Menu and example plugins covering toolbar UI, editor behavior, workers and custom rendering by the end of Part 4.

Before external loading:

- Audit Tauri commands and native capabilities reachable from frontend code.
- Approve restrictive native APIs and verify denial in packaged applications.
- Define package identity, entry points, compatibility, and dependency metadata.
- Design installation/removal and persisted activation preferences.
- Explain frontend trust and document/network risks. Distinguish disclosures from enforced restrictions.
- Build on the dependency-impact manager and task error reporting. Review additional external-package or task-status UI separately.
- Prevent project data and plugin requirements from automatically installing or executing extensions.

Frontend DOM isolation remains deferred. If a claimed native restriction cannot be enforced, resolve it before external loading. A manifest checkbox is not a substitute.

### Required outcome: separately packaged Basic Menu

Basic Menu is currently a bundled application plugin under `src/lib/editor/prosemirror/menu/basic/`. By the end of Part 4, its feature implementation must live in a separate plugin package. A separate directory or an app-specific activation wrapper alone does not satisfy this requirement.

The package must use the supported package-loading mechanism and public APIs available to third-party plugins. It must not depend on private application imports or privileged formatting hooks. The word-processing provider remains its declared editor API dependency. Shared controls can come from reusable libraries.

Validate the packaged plugin's horizontal and vertical controls, formatting behavior, disable/re-enable cleanup, docking capacity and undo preservation. Use it as a real-feature test of the package-loading system, not only a synthetic fixture.

The outcome is approved, but the package format, build and Svelte dependency handling, distribution location, default installation policy and detailed loading contracts still need design approval. Separate packaging does not require public registry publication. Part 3C's new-content and schema work remains separately gated. Existing-type rendering is implemented.

### Required outcome: packaged extension examples

Package examples that exercise the main extension capabilities through the same supported loading mechanism as Basic Menu:

- Toolbar UI: Quick Format or an equivalent independent formatting example.
- Editor behavior: the smart-punctuation and selection-highlighting examples.
- Workers: the word-analysis example, including its emitted worker assets.
- Custom rendering: the node/mark-view example developed during Part 3C.

Reuse the existing examples where practical. Their purpose is to verify public APIs, package assets and lifecycle behavior. Packaging does not make them finished user-facing features or require enabling them in the default app. Exact example boundaries and distribution details can be refined later.

This requirement does not include extracting the entire word-processing editor, independently packaging pagination, or implementing history plumbing for an undo-tree plugin.

## Validation and documentation

Implementation changes must update current context and the same cumulative in-progress changelog entry. Keep proposed behavior, implemented behavior, and verified guarantees distinct. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for checks.

Start with focused unit/integration tests. Scheduler changes also need pagination browser regressions. Editor changes need typing, selection, formatting, undo, and lifecycle coverage. Geometry needs a real browser. Native restrictions need packaged-runtime verification; Playwright cannot establish Tauri enforcement.

Report passed, failed, and unavailable checks. Keep verified results in the changelog. The [source/test map](context.md#source-and-test-entry-points) links the relevant suites.

## Decisions needed before implementation

The task/provider policies and current synchronous editor access, provider-owned edits, provider-based formatting, behavioral ordering/removal, in-place reconfiguration, and existing-type renderer registration with Svelte adapters are approved and implemented. They do not need a new approval decision.

Remaining gates are:

1. **New custom content, Part 3C:** approve new node/mark registration, schema lifecycle, and missing-content preservation. Existing-type rendering does not need a new approval decision.
2. **External loading, Part 4:** approve installation/trust disclosures and a verified restrictive native-enforcement design.
3. **Broader work:** separately justify and approve extraction or features beyond the implemented scope. API publication, stability, universal upstream compatibility, and performance targets are not established.
