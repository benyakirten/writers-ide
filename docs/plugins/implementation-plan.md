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

**Remaining API and loading designs need approval before implementation.** The goal is to load external plugins without claiming frontend isolation that does not exist. The owner approved token-based native-request identity and Rust-side enforcement, as described below. The owner also approved separate packaging of Basic Menu and example plugins covering toolbar UI, editor behavior, workers and custom rendering by the end of Part 4.

The [external package specification draft](package-api-proposal.md) contains complete TOML examples, exact proposed SDK contracts, validation rules, budgets, failure mappings and implementation slices. Its [four review groups](package-api-proposal.md#10-consolidated-review-decisions) organize the remaining choices for question-by-question review. Local contribution IDs with host-managed runtime and saved identity are approved. The separate plugin-free management/recovery WebView responsibility boundary is approved. Host-provided locale/direction with plugin-owned translations is approved. Remaining recommended fields, exact connection/locale signatures and native control/persistence protocols still need review. The [resource-loading investigation](resource-loading-investigation.md) identifies production native-route/bootstrap blockers and records an implemented standalone fixture prototype. The integrated packaged run passed 27 normal and seven recovery checks in a debug app on macOS 27.0.1 arm64. Production feasibility, native enforcement and the remaining platform matrix are not established.

### Approved scope and package direction

Part 4 implements frontend package loading. The manifest model must allow multiple components and leave room for frontend-only, backend-only and mixed packages. Executable backend components and their restricted runtime will be designed later. Do not implement backend execution or select a runtime as part of this phase.

Installation identity is separate from execution identity. Packages install and update as a unit, while components activate independently with their own identities and lifetimes. A component's activation failure must not stop unrelated healthy siblings. Required dependencies determine which other components are affected. Keep package-level enable/disable controls as a convenience over component lifecycle management. Authors declare initial component defaults; user selection and dependencies determine activation.

Every component still requires all applicable mandatory permissions before activation. Independent activation does not authorize a partial grant. Existing task or renderer-registration failures do not automatically disable the whole component. Exact component dependency declarations, package-level plan composition and detailed management APIs still need design approval. Component dependency-impact consent follows the approved policy below.

### Component activation scope

**Approved policy:** each component explicitly declares `activation_scope = "project"` or `activation_scope = "application"`. Frontend application scope means once per application window/host, not a shared JavaScript singleton across windows. Project scope means one activation per open project within that host.

Project activations have separate state, tasks, services and credentials bound to that project. Closing the project ends its activations. Switching the active project must not retarget an existing activation's services or credentials. Application-wide permission approval can cover repeated acknowledgements without merging project instances or changing execution scope.

Application components can run without an open project and do not automatically gain native authority over all projects. Host routing must associate project contributions with the appropriate workspace/project. This is a supported API/native authorization boundary, not enforced frontend DOM isolation. Required project dependencies resolve to the consumer's own project. A project component may also require an application component in the same window/host; application components can require other application components there. Do not resolve a required dependency to whichever project happens to be active.

A global feature stays running while its selected-project functionality becomes available or unavailable. It may obtain an explicitly project-bound connection. Project switching releases the old connection and obtains a new one; the old handle never silently changes targets. Project closure ends that connection, not the global feature. Unconditional application-to-project required dependencies and arbitrary cross-project required bindings are outside the initial model. The explicit project-connection API approach is approved: authors subscribe to selection, dispose the previous connection and obtain a new one. Connections are owned by the consumer activation, remain fixed to their project and revoke on project closure. Provider absence does not automatically enable it. Exact API discovery/connection signatures, binding declarations, project contribution routing and concrete local project registration/storage APIs still need design approval.

**Approved independent project connections; not implemented:** each explicit connection has its own API handles, subscriptions and cancellation signal. Disposal revokes its handles, removes its subscriptions and aborts its signal without affecting another connection to the same project/provider. Provider execution and shared state remain shared; a connection does not activate a second copy. Consumer teardown disposes all its connections. Work must use the connection's signal to participate in cancellation. Project references are approved to identify one live opening: closing it invalidates them permanently, and reopening creates fresh references. Saved settings and permission associations use the separate persistent registration. Exact signatures, reference representation and validation mechanics still need review.

**Approved application-command cancellation; not implemented:** every invocation has a signal linked to explicit caller cancellation, caller/provider teardown, command removal and its project-connection lifetime. The host rejects pending invocation promises with recognizable cancellation/revocation errors and suppresses late success when it processes cancellation. It must observe late failures without unhandled rejections. Authors propagate the signal to tasks/native requests and check before further effects. Arbitrary code cannot be preempted, already completed effects do not roll back, and rejection does not prove all work stopped. Do not cancel unrelated provider work/consumers or revoke the provider credential for one cancelled invocation. The invocation signal/context shape is approved in the [command contract](command-contract.md). Exact error codes and remaining lifecycle edge cases still need specification.

**Approved contribution identity; not implemented:** authors register local contribution IDs. The host distinguishes runtime contributions by activation, contribution kind and local ID. Saved placement uses stable package/component/kind/local IDs plus project association, not temporary activation IDs. Duplicate local IDs for one kind in an activation fail. Typed functional dependencies use declared provider APIs, not UI contribution lookup. Application commands are also approved as named actions independent of their UI. Current host-side invocation exists. Cross-plugin command invocation is approved to require declared dependencies: identify package/component/local command, use consumer-local aliases and resolve the correct project/window activation. Required dependencies participate in lifecycle planning; optional commands may be absent and never automatically enable providers. Do not resolve unqualified IDs by registration order. Commands may declare typed arguments, with validation before execution; argument-free commands remain supported. Consumers supply inputs rather than mutating provider state to configure an action. The [shared command contract shape](command-contract.md) is approved: `definePluginCommand` with Standard Schema-compatible argument/result validators, component command declarations, nested dependency-command aliases and typed `context.commands.execute`. Command aliases are local to their dependency. Require exact contract majors independently of package-version ranges; breaking input/output changes need a new major. Publication checks and optional availability reporting still need specification. Awaitable completion is approved: implementations may be synchronous or promise-based, while invocation always returns a promise that settles on actual action completion. Synchronous throws and asynchronous failures reject it. Typed command results are approved: the shared contract declares a result type, and invocation resolves with that validated value. Use `void` for no result and rejection for failure, not a universal handled boolean. Copied data-only arguments/results and the validator/versioning approach are approved. No mandatory validator library is selected. The extended structured-clone value list, schema-transform semantics and resource budgets remain to be specified; raw functions/live handles are not payloads. Per-invocation cooperative cancellation is approved below. Current callbacks remain argument-free and synchronous; the awaitable interface is not implemented. This does not change synchronous activation, ProseMirror hooks or validated editor callbacks. Use existing task helpers for substantial work and fresh synchronous editor operations after computation. This does not approve a command picker or shortcut system. Qualified cross-component references, where supported, identify their owner and project; exact reference APIs remain open. This does not change word-processing registration ID rules or approve a new formatting provider contract.

### Component defaults and required dependencies

**Approved policy:** each component may declare `default_enabled`, which defaults to `false` when omitted. Defaults apply on first configuration only. Persist user selections and restore them when the package is disabled and re-enabled. Updates must not silently override saved choices or enable newly added components. New components require explicit enablement or a dependency activation the user approves. Defaults never bypass mandatory permission acknowledgement.

Authors can declare required component dependencies. A dependent cannot activate or remain active without its required components. If the user disables component A, a component B that requires A cannot run while A remains disabled. Sharing a package is not itself a dependency. Exact reference syntax still needs approval. Do not silently undo an explicit user disable choice.

**Approved consent policy:** enabling a component with disabled required dependencies offers a reviewed activation plan. Show the full affected set, including explicitly disabled dependencies, and obtain consent before changing their selection. Complete required permission acknowledgement before activation. Recheck dependencies and permissions before execution and require renewed review if the plan changed. Successful unrelated components need not stop if the requested consumer subsequently fails.

Disabling a requirement offers a reviewed plan containing all affected required dependents. Obtain explicit cascade consent, then stop dependents before their requirements. Do not leave dependents running or silently stop them. Reject required dependency cycles before activation. Low-level API signatures and the exact review interface remain open.

**Approved dependency aliases; not implemented:** use a consumer-local alias for dependencies on components in the same package or a different package. The manifest identifies the target package and component. Runtime API lookups use that alias and the imported API contract. Authors do not construct activation IDs. Exact manifest fields and duplicate-target rules remain open.

**Approved package compatibility; not implemented:** a dependency identifies its package and component. It may also constrain the package version with an optional range. API dependencies still require an exact API major. Both checks must pass; a matching package version does not replace API compatibility.

Use semantic package versions and a documented, limited range syntax. For example, a consumer could require the `editor` component from `@writers/word-processing`, API major `1`, and package version `>=1.3.0 <2.0.0`. This lets it require a bug fix without changing the API major. This is an example of the intended meaning, not finalized manifest syntax.

An incompatible required dependency blocks activation with an explanation. An incompatible optional integration is unavailable but does not block activation. Check installed versions only. Part 4 does not download dependencies or select among multiple installed versions. The approved initial syntax accepts an exact semantic version or space-separated `>`, `>=`, `<` and `<=` comparisons that must all pass. Comparison ranges exclude prereleases; an exact prerelease version can be requested explicitly. Wildcards, caret/tilde shorthand and OR expressions are outside the initial syntax. Exact manifest fields remain open. See the [range rules](package-api-proposal.md#approved-limited-version-ranges).

### Package and component identity

**Approved manifest parsing policy; not implemented:** validate the entire manifest strictly. Reject unknown fields, including non-permission fields, and report clear validation errors. Require the top-level integer `manifest_version = 1`. Reject missing values, strings such as `"1"` and unsupported integers before importing code. Do not supply a default or coerce the value. Package release versions remain separate semantic versions. A future manifest format requires explicit parser support. Apply this to installation and update candidates. Remaining schema fields and size limits still need approval.

**Approved machine-identifier characters; parser not implemented:** namespace, package machine name, component ID and dependency alias must match `[a-z0-9]+(?:-[a-z0-9]+)*`. Reject uppercase letters, underscores, dots, non-ASCII characters and leading/trailing/repeated hyphens. Do not lowercase or normalize invalid input. Human display names, filenames, API IDs and command IDs have separate rules. No numerical length limit is approved by this decision.

**Approved manifest fields:** `[package]` contains optional `namespace`, stable machine-readable `name`, human-readable `display_name` and separate `version`. Derive the canonical package ID as `@namespace/name` when a namespace is present, or `name` when it is absent. Do not store a second independently editable package ID.

**Approved package display metadata; parser not implemented:** require nonempty plain-text `display_name` and `description`. Both support multilingual text independently of machine-identifier grammar. The host can display them before importing code. Neither grants authority or authenticates a publisher; native permission disclosures remain separate. Text changes do not change package identity. Numerical size limits remain undecided.

**Approved component display metadata; parser not implemented:** require nonempty plain-text `display_name` and `description` on every component. Both support any language and explain that independently managed feature before activation. Background and API-provider components are included. Text changes do not change component identity or replace permission disclosures. Numerical bounds remain undecided.

**Approved component-list requirement; parser not implemented:** require a nonempty `components` array, represented by TOML `[[components]]` records. Reject missing and empty lists. Non-UI API providers and background features are valid components. This does not add independently installed library-only or asset-only packages with no components. Maximum counts and the remaining component fields still need review.

**Approved component kind; parser not implemented:** require explicit `kind = "frontend"`. Missing and unsupported kinds fail whole-manifest validation before any component import, even if other records are frontend components. Do not silently skip unsupported components. Frontend means the JavaScript/WebView runtime; UI is optional, and owned workers and verified WebAssembly remain supported. Backend kinds require a separately implemented restricted runtime, not a declaration-based permission to execute native code.

For example, this identity belongs to package `@org1/query`:

```toml
[package]
namespace = "org1"
name = "query"
display_name = "Query Tools"
version = "0.1.0"

[[components]]
id = "toolbar"
```

This is a partial manifest, not the complete schema. Component IDs are stable and local to their package. Identify an executing component by the package ID and local component ID, with its activation identity separate. `query`, `@org1/query` and `@org2/query` are distinct packages and can be installed independently.

Display names can change without changing identity. Changing a namespace or machine name changes identity and must not silently inherit the former package's grants or saved associations. Versions remain separate from stable identity so future multiple-version installation is not unnecessarily blocked. A shared namespace neither grants permissions across packages nor establishes verified publisher ownership. Replacing an installed identity still requires the explicit update/replacement flow. Identifier character grammar is approved. Length bounds and remaining manifest fields still need review.

### Frontend entry-point contract

**Approved entry field; manifest loading not implemented:** require `entry` on every frontend component. It identifies an exact `.js` or `.mjs` file relative to the package root. Validate that file against the verified snapshot before importing code. Do not guess extensions, search directory indexes or accept external URLs, host filesystem paths or traversal. The output-directory layout remains the author's choice.

**Approved direction:** each frontend component entry module exports a named `activate(context)` function. The host imports the verified entry module after compatibility, permission and dependency checks, then calls this function once per activation. Keep metadata in `manifest.toml`, not duplicated in executable component definitions.

Retain synchronous activation for short setup and provider API publication. The context supplies contribution, provider, task, cancellation and ownership APIs. Use managed tasks for continuing asynchronous work. Cleanup uses `context.own`, cancellation signals and an optional returned synchronous disposer. Module loading can be asynchronous without making `activate` asynchronous. The owner reaffirmed this setup/readiness distinction: a managed initial load can continue after activation succeeds. Retain its handle or pass it to feature state/UI to consume the result later; the task key is not result storage. Loading may be deferred until the feature needs it. The native activation gate is also approved, not implemented: service calls during setup may return pending promises, but native execution waits for successful setup confirmation. Failure/revocation rejects waiting calls without executing them. This gate belongs to native services, not task scheduling; ordinary browser effects are not contained. Rust-authorized one-use, WebView-bound attachment tickets are approved below. Exact IPC handshake fields, pending-request limits, deadlines and disconnection handling still need design.

Authors must put feature setup in activation and keep activation-specific state scoped to that lifetime. Module evaluation executes top-level JavaScript and is not an activation callback; its state is not guaranteed to be recreated on re-enable. The trusted-frontend contract prohibits unmanaged startup work during import, but this is not a sandbox guarantee. The explicit entry-path field is approved. Application loading, remaining import-resolution integration and exact runtime-profile definitions still need work and review.

### Frontend runtime compatibility

**Approved direction:** prebuilt components target a host-defined frontend runtime profile. A profile describes supported shared SDK modules, the Svelte compiler/runtime expectations, core ProseMirror dependencies and exposed module interfaces. Initially provide one supported profile. The host must block importing or activating a component whose declared profile is unsupported.

**Approved field placement and requiredness; manifest loading not implemented:** every frontend component declares its own required `runtime_profile`. It names a host-defined compatibility profile. There is no package-level inheritance or implicit default. This is not a dependency download, permission grant or proof of correct code. The example `writers-ide.frontend/1` and its exact inventory remain draft. This does not approve simultaneous incompatible profiles in one WebView.

**Approved unsupported-profile handling; not implemented:** allow installation or update of an otherwise valid package while blocking unsupported-profile components from import and activation. Required dependents are blocked; optional integrations are unavailable. Compatible components remain eligible. Show component/profile incompatibilities before acceptance, including when none can run. Installation grants no activation authority and does not bypass enablement or native permissions. Unsupported kinds still reject the entire manifest; understood frontend declarations with unsupported profiles are a separate compatibility state.

Build tooling selects the supported compiler/shared dependency combination and emits the profile requirement in the built manifest. Keep profile identity separate from application version, package version and provider API majors. Compatible app releases can retain a profile; incompatible runtime changes require a new target and may require plugin rebuilds. Supporting an older profile must be tested and explicit, not inferred from its identifier or broad dependency ranges.

Authors continue to write ordinary TypeScript/Svelte and can bundle ordinary private dependencies. Shared runtime imports must resolve to the host's supported instances. Provide a template, build tooling and a test harness using the actual profile. Recommend this tooling without requiring it: document the output contract so alternative build systems can comply. Frontend authors need no Rust toolchain, and users need no frontend compiler to install packages.

The `runtime_profile` field is approved. Final profile IDs, exact dependency versions/exports and remaining author-facing module integration still need design. The profile is a compatibility contract, not publisher authentication or security isolation. Workers have separate execution environments; their assets and shared-helper build rules need explicit treatment rather than assuming the main window's module mapping applies.

### Frontend builds and shared dependencies

Provide build tooling with an explicit set of host-supplied dependencies. Control sharing of Svelte and identity-sensitive ProseMirror packages. Authors may bundle ordinary private dependencies. Frontend output uses native ES modules with a host-managed import map for the runtime profile's shared modules. Build output preserves supported shared imports so they resolve to the same actual module instances used by the host. Install the map before importing modules that use it. Private dependencies may be bundled or emitted as package-local modules, loaded only through the verified-resource path. Authors need no custom module-registration or dependency-injection API.

Exact shared versions/exports, import-map URLs and concrete verified resource routes still need design approval. The virtual-resource delivery direction below is approved. Test native ES module/import-map behavior in supported packaged Tauri WebViews. Import maps are resolution contracts, not security isolation. Workers do not inherit the window's import map. Their single-bundle output policy is approved below; concrete loading still requires packaged-runtime validation.

Frontend build output means executable JavaScript, CSS and assets produced from the author's source. Svelte components are compiled before they run in the application. Normal distribution uses a self-contained, prebuilt ZIP archive with `manifest.toml` at the archive root. Do not require an enclosing package-name directory. Ordinary files and directories are allowed; symlinks, special entries and installation scripts are not. The identity fields are approved above; remaining manifest fields, component entry paths and loading details still need decisions. Do not run package installation scripts or compile arbitrary plugin source during normal installation.

ZIP extraction must validate paths, reject duplicate or ambiguous entries, and bound entry counts, expanded sizes and extraction work. Validate in a staging location before accepting or replacing an installation. SHA-256 records describe extracted file contents, not ZIP timestamps or compression metadata. The archive filename does not establish package identity or authenticate a publisher. Detailed extraction APIs and policies remain to be designed.

Developer directory mode is a separate proposal, not an approved installation mechanism. It would let an author explicitly load a local directory containing the manifest and built output. The author's build tool would rebuild that output during development. Whether the app supports this mode, and whether reload is manual or watched, still needs approval.

### Worker build output

**Approved for Part 4:** emit one self-contained ES-module bundle per frontend Web Worker. Authors can organize source across multiple files, but bundle worker dependencies and worker-side SDK helpers into the output. Workers must not depend on the window's import map or shared module instances. Package-local worker module graphs/code splitting are deferred.

Keep the existing managed-task ownership, cancellation, dedicated-worker lifecycle and synchronous result-application contracts. Workers exchange copied/transferred data; construct and validate editor operations in the frontend against current state. A Web Worker is not an executable backend component and gains no native authority from this build policy.

This trades duplicated helper code and potentially larger worker files for simpler resource loading and compatibility tests. Normal bundle/file size limits still apply. **Approved managed-worker loading; not implemented:** always create managed package workers through Blob URLs backed by verified bytes. Authors supply a package-relative worker URL through the managed task API. The host obtains the checked bytes and constructs the worker. Preserve task cancellation and ownership during loading, startup and execution. Cleanup must terminate any created worker and revoke its Blob URL, including failure paths. Do not select direct versus Blob loading by platform. Worker `import.meta.url` is a Blob URL; relative package imports and assets are unsupported. Supply required data through messages or transfers. This defines the supported managed path, not a restriction on arbitrary trusted frontend code. Exact SDK signatures and integration need review; cross-platform packaged validation remains outstanding. Do not infer that a virtual resource URL satisfies Worker origin rules. In the macOS fixture, direct loading failed with `Worker module load failed`; a self-contained Blob worker from verified bytes passed copy/transfer, termination and URL revocation checks. The Blob changes `import.meta.url`, and relative worker assets are unsupported. The fixture supports the chosen loading mechanism; it does not validate a production worker API.

### Verified resource delivery

**Internal snapshot and route foundations implemented; application resource loading remains unwired.** The current [resource route](../../src-tauri/src/plugin_resources/route.rs) builds and parses canonical snapshot URLs and constructs borrowed read-only responses. Origins and path limits come only from trusted native configuration. The adapter can check response budgets before copying the borrowed payload. A fixed list exposes response metadata through CORS; it includes no credentials. HEAD success reports the file's length while its body is empty; denied responses report zero length. Its [tests](../../src-tauri/src/plugin_resources/route_tests.rs) cover once-only decoding, exact lookup, origin validation, GET/HEAD parity, headers, MIME and association denial. No application protocol registration is added.

The current [snapshot pool](../../src-tauri/src/plugin_resources/mod.rs) accepts verified packages, deduplicates their buffers, enforces supplied count/byte limits and tracks opaque WebView-lifetime associations. Its [tests](../../src-tauri/src/plugin_resources/tests.rs) cover reuse, denied access, stale handles, admission failure and last-close release. Snapshot identity is a domain-separated SHA-256 hash of the complete canonical verified record. The internal identity does not select a scheme or hostname. The approved resource path shape is described below.

Still planned for the production application: create one application-owned pool, serialize access and map actual Tauri requesters to live handles. Connect handle cleanup to real WebView closure. Do not expose handle creation or association through a frontend-controlled route. The production application has no runtime owner, actual-requester adapter or close-event wiring.

**Fixture integration implemented:** the standalone harness now uses this production pool. It supplies synchronized ownership, native-requester lookup and cleanup on real `WindowEvent::Destroyed` events. Two associated windows share the primary allocation. Main also retains a distinct second accepted snapshot. A real fetch confirms continued access after the first closes. Closing the last releases the snapshot. An unassociated window receives empty 403 responses despite a spoofed identity header. Recovery admits no snapshots or package imports.

The harness delegates routing to this shared internal code. Its window labels and Rust-controlled lifecycle remain fixture contracts; URL paths now follow the approved snapshot-addressed contract. The sole native command accepts bounded fixture reports; it grants no native service operations or caller-selected setup/close actions. The runner requires completion of the native pool stages. See the [fixture workflow](../../prototypes/plugin-resources/README.md#what-happens).

Serve package modules, CSS, workers and assets through host-controlled virtual resource URLs backed only by verified package bytes. A native resource handler looks up files in an immutable verified snapshot, not arbitrary filesystem paths. There is no unchecked filesystem fallback. These URLs identify content; they are not native-operation permission tokens or publisher authentication.

**Approved dedicated resource origin; production integration not implemented:** keep package-resource serving separate from application-page and built-in-asset serving. Use the approved snapshot path and explicit CORS policy on that endpoint. Exact scheme/hostname spelling is a host-owned implementation detail and may differ by platform. Authors treat the prefix as opaque. The fixture validates this approach on the measured macOS runtime, not all supported platforms. Imported modules still execute in the importing page's environment; this is not isolation.

**Resource path implemented internally and exercised by the fixture:** `/snapshots/<snapshot-id>/<package-relative-path>`. Derive the snapshot ID from the SHA-256 fingerprint of the complete verified record. Do not add package name, namespace or version route segments. Keep them in installation metadata for diagnostics. The host supplies entry URLs; authors treat the generated prefix as opaque and use ordinary relative module/asset references. This applies to regular frontend modules, not Blob workers. Exact platform origin forms require validation; remaining response and CSP details still need review.

**Filename encoding implemented internally and exercised by the fixture:** retain support for portable filenames, including spaces and non-English characters. Encode URL path segments rather than imposing an ASCII-only package naming rule. Decode each requested segment exactly once, validate it and perform an exact verified-snapshot lookup. Reject malformed escapes, encoded separators and traversal. Never repeatedly decode or change filename case or normalization. Existing nonportable-path and filesystem restrictions remain. Add Rust and packaged tests for supported encodings and rejection paths.

**Query policy implemented internally and exercised by the fixture:** reject any query component on a resource URL instead of ignoring it. Serve exact verified files without query-driven transformations or version selection. Author build tooling must resolve conventions such as `?raw` and `?worker` before emitting the package. Add parser and packaged tests for query rejection alongside encoded filename tests. Browser fragments are not transmitted to the native handler; do not claim that rejecting queries also blocks fragments.

**Response-cache headers implemented internally; application integration remains planned:** use `Cache-Control: no-store` on resource responses. Keep verified-byte retention in the Rust pool. Repeated native requests do not require rereading or rehashing files. Do not confuse the browser response cache with its module cache; this header does not unload modules or reset state. Validate packaged behavior rather than assuming the header guarantees access enforcement. Defer browser-response caching until its interaction with WebView associations is verified.

**Content types implemented internally and exercised by the fixture:** use host-defined MIME types for supported formats, including JavaScript, CSS, JSON, images, fonts and WebAssembly. Return unfamiliar extensions as `application/octet-stream` rather than rejecting custom data. Send `X-Content-Type-Options: nosniff` and do not guess types from contents. Authors can fetch unknown formats as bytes. No author-defined MIME override or plugin-HTML application-page support is approved. Implement and test the supported-type mapping, binary fallback and script/style MIME rejection in packaged WebViews.

**GET/HEAD implemented internally and exercised by the fixture:** implement `GET` and `HEAD` through the same association, validation and verified-file lookup path. Return no body for `HEAD`, but preserve corresponding file metadata such as content type and payload length. Do not reveal metadata to unassociated WebViews. Reject other methods, including `POST`, `PUT` and `DELETE`. Add Rust and packaged tests for metadata agreement, body omission and access denial. The package-file route is separate from external HTTP requests and permission-checked native services; this does not restrict their method or operation design.

**Fixed CORS headers implemented internally; application adapter remains planned:** allow cross-origin response reads only from the application-owned plugin-hosting origin. Do not emit wildcard allow-origin or blindly reflect caller-supplied origins. Allow a configured development-server origin only in development builds, never implicitly in packaged builds. Preserve actual-WebView association checks independently of CORS. Test origin handling and development/packaged separation. CORS is not plugin isolation or native authorization and does not decide external network destinations. Exact platform origins and response behavior remain to be verified.

**Approved JavaScript source policy; checked in the fixture, not applied to the application:** permit host code and verified package modules in the supported script-loading path. Do not permit direct remote JavaScript imports or script loads. Authors must bundle executable dependencies or emit package-local modules. Ordinary external data requests remain a separate policy. Test successful local imports and blocked remote script loading without enabling external plugins. Preserve the approved Blob-worker path and document that this is not hostile-code isolation or proof of all execution provenance. WebAssembly follows its separate approved policy below.

**Approved JavaScript evaluation policy; checked in the fixture, not applied to the application:** omit `unsafe-eval` and block JavaScript string evaluation through `eval`, `new Function` and equivalent mechanisms. Preserve ordinary callbacks, commands, hooks and precompiled Svelte rendering. Document compatibility requirements for libraries using runtime code generation. Add packaged positive and negative checks. The policy applies to the hosting WebView, not one isolated plugin. WebAssembly uses its separate approved allowance below.

**Approved frontend WebAssembly; checked in the fixture, application integration outstanding:** allow bundled `.wasm` files through verified resource delivery. Validate compilation and execution with CSP's `wasm-unsafe-eval` allowance while continuing to reject JavaScript `eval` and `new Function`. Never fall back to `unsafe-eval`; report incompatibility if selective support is unavailable. Add small packaged checks for both WebAssembly success and JavaScript evaluation rejection. Recommend managed workers for heavy computation; WebAssembly does not automatically leave the main thread or make it preemptible. This approves no backend components, native libraries, WASI host services or shared-memory threading. Native authority still comes only through approved permission-checked services.

**Approved unknown-field handling; manifest parser not implemented:** reject unknown fields in every manifest table before importing plugin code. Report the field path and explain that the field is unsupported. Do not silently ignore misspelled or newer fields. New fields require explicit host support. Preserve the separate policy for unsupported values of the recognized `runtime_profile` field: block affected components without rejecting an otherwise valid package.

**Approved manifest value types; parser not implemented:** require correct types throughout the manifest without automatic conversion. Reject invalid types before importing plugin code. Errors identify the field path and expected type. Apply optional defaults only to absent fields, not invalid values. Quoted booleans and integers remain strings and fail boolean or integer requirements.

**Approved component ID uniqueness; manifest parser not implemented:** require unique component IDs within each package. Reject the whole manifest before importing any plugin code when IDs repeat. Report the duplicate ID and conflicting declarations. Do not choose a declaration by file order. Different packages may use the same component ID.

**Approved dependency alias uniqueness; manifest parser not implemented:** require unique dependency aliases within each declaring component. Reject the whole manifest before importing any plugin code when aliases repeat. Report the duplicate alias and conflicting declarations. Each alias identifies exactly one dependency; do not disambiguate duplicates using provider identity or API contract. Other components may reuse the same alias.

**Approved dependency target uniqueness; manifest parser not implemented:** within each consumer component, allow one dependency declaration per target package, component and binding. Combine required APIs and commands in that record. Repeated targets with the same binding reject the whole manifest before importing any plugin code, even under different aliases. Report the conflicting declarations. Different bindings remain distinct, and dependencies on different providers remain allowed.

**Approved contribution capability field; manifest parser not implemented:** require a component-level `capabilities` array. Allow `[]`. Accept only `contributions.toolbar`, `contributions.view` and `contributions.command`; reject missing arrays, unknown values and duplicates before activation. Require the corresponding capability when registering a contribution. This preserves the bundled host's explicit contribution checks. It neither grants native permissions nor restricts ordinary browser JavaScript. Numerical list limits remain open.

**Approved stylesheet ownership; not implemented:** frontend components may declare optional `styles`, defaulting to `[]`. Entries are exact package-relative `.css` filenames present in the verified snapshot, not external URLs or inline CSS text. The host loads verified styles before calling activation, tracks ownership across activations and releases ownership on teardown or activation failure. Do not remove a stylesheet while another activation still uses it. Build tooling can generate declarations. Ordinary Svelte classes and dynamic inline styles remain supported. This manages resources, not CSS isolation; trusted plugin CSS may affect other UI. The `styles` field and empty default are approved. Process lists in order, append only unloaded stylesheets and reuse existing links without moving them. Remove a link after its last owner releases it. Shared links can make the resulting order differ from the declared list; there is no global cascade-order guarantee between activations. Do not add an ordering resolver. Authors should bundle order-sensitive CSS into one file and scope their selectors. See the [ordering example and author guidance](package-api-proposal.md#stylesheet-loading-and-ordering). Application loading and broader packaged validation remain outstanding.

Preserve package-relative module and asset references where supported, including standard `import.meta.url` usage. Different accepted snapshots need distinct resource identities so one URL does not silently change contents. This does not by itself provide module unloading or safe live updates.

**Approved URL identity and retention; production runtime delivery not implemented:** reuse resource URLs for the same unchanged verified snapshot across disable/re-enable in one plugin-hosting WebView. Before loading bytes from disk, verify the complete file set, lengths and SHA-256 checksums against the accepted host record. Serve retained verified bytes only. Reusing those immutable bytes does not require rehashing; loading from disk again does. Reject mismatches without replacing expected checksums. Accepted changed contents receive a different resource identity.

Load snapshots only when needed. Use one application-wide Rust pool of immutable verified bytes. Count a retained snapshot once across all associated WebViews. Track associations separately and retain the bytes until the last associated plugin-hosting WebView closes. Browser-cached modules can still reference their resources. Sharing native byte buffers does not share frontend module instances, activation state or native credentials. Disablement ends activation-owned resources and native authority, not resource availability or module state. Bound snapshot count and total retained bytes. **Admission rejection implemented internally; activation and UI handling remain planned:** reject a new snapshot load before admission if it would exceed either limit. Block the affected activation and explain the limit in the plugin manager. Keep existing plugins running; do not evict snapshots, disable unrelated plugins or restart automatically. Reuse of an already retained snapshot does not consume another snapshot allocation. Retained-byte limits do not bound all frontend or worker memory. The owner approved host-configurable limits rather than fixed plugin API guarantees. Implement accounting and enforcement with explicit supplied limits. Use small test limits to exercise rejection and cleanup. Select production defaults later from representative package and multi-window measurements; prototype budgets are not approved defaults. This does not approve a user-facing configuration API or unlimited loading. Earlier eviction is deferred.

**Internal handle checks and fixture adapter implemented; production actual-requester adapter not implemented:** Rust serves a snapshot only when the actual requesting plugin-hosting WebView has a host-established association with it. Never accept a request's claimed WebView identity as authority. A resource URL is not an access credential. Preserve associations until WebView closure, including across disable/re-enable. Do not associate the plugin-free management/recovery WebView with package snapshots. Test denial for unassociated WebViews and continued access for other associated WebViews after one closes. This does not distinguish plugins sharing a WebView or replace native permission enforcement.

The internal route and fixture now cover the approved path, decoding, methods, MIME and response-header policies. The unsigned packaged macOS run passed **27 normal and seven recovery checks**. It covers genuine distinct snapshot IDs, primary deduplication, encoded filenames, GET/HEAD parity, unknown binary MIME and real closure cleanup. WebAssembly runs in the main WebView and Blob worker while JavaScript evaluation remains blocked. Remote script and direct bootstrap import probes require enforced CSP violations. External entry modules have no nonce; the import map alone uses one.

Before application registration, connect authoritative loading/permission state, supply the correct native origins, and preserve plugin-free startup. The helper reads no development configuration automatically. Development-versus-packaged origin selection remains the future owner's responsibility. Keep numerical budgets supplied by the host; production defaults remain undecided.

Repeat packaged validation on the other supported runtimes, including macOS 13.3. A custom resource URL still does not satisfy Worker origin rules on the measured runtime. Use the approved self-contained Blob path without promising relative worker assets or window import maps. Report incompatibilities rather than weakening CSP or integrity checks. Application activation, native authorization and complete failure/cancellation coverage remain outstanding. See the [packaged observations](resource-loading-investigation.md#packaged-observations).

### Package integrity verification

**Internal Rust foundation implemented; installer and loader integration remain open.** The owner approved per-file records, verified-byte consumption and rejection of symlinks/special files as the first slice. The implementation is in [plugin_integrity](../../src-tauri/src/plugin_integrity/mod.rs). It adds no Tauri commands and enables no external code.

`create_record` inspects a host-selected directory and returns a candidate record. `IntegrityRecord::from_json` parses a supplied host record. `verify_package` compares the directory against that record and returns an immutable `VerifiedPackage` containing the exact checked bytes. These internal functions do not persist or accept records. The future installer must store explicitly accepted records outside package directories.

Record version 1 is a JSON object with `format_version: 1` and a `files` map. Each portable relative path maps to `byte_length` and a lowercase hexadecimal SHA-256 digest. Duplicate paths/fields, unknown fields, malformed digests and unsupported versions are rejected. All files are included regardless of extension, including manifest, executable modules, workers, styles and other assets. This record format does not select the plugin manifest schema or archive format.

Verify installed contents before use. The loading design must prevent a file being replaced between verification and consumption. Do not execute an entry point or load an unchecked worker or asset after only checking the manifest. The per-file record format and owned-byte result are implemented. Archive handling, accepted-record storage and application protocol registration remain planned. The internal route and fixture adapter now consume verified bytes. A later loader must consume `VerifiedPackage` bytes rather than reopening filesystem paths.

Reject unexpected changes and require an explicit reinstall or update. Do not silently accept changed files by recomputing their expected digests. Accepted replacement records must follow the update-validation policy and retain the previous version until acceptance.

Hashing establishes that bytes match a trusted expected digest. It does not establish publisher identity or whether code is safe. An attacker who can replace both the package and its host-managed records can defeat this check. Do not describe local integrity records as tamper-proof against compromise of the host itself.

Official packages shipped with the application can have expected digests included in the application's distribution. For unsigned external packages, installation establishes the accepted bytes; it does not authenticate a publisher. Digital signing remains a separate decision covering trusted keys, replacement and revocation. Signatures also do not prove plugin safety.

The directory reader uses capability-based no-follow opens and checks opened file types. It rejects root/descendant symlinks, Windows reparse points, special files, invalid UTF-8 names and nonportable paths. The host must supply a trusted root and ancestors. Collection is not an atomic directory snapshot; verification checks every returned buffer against the trusted record. Empty directories are validated and bounded but do not have file digests.

Default limits are 2,048 files, 16 MiB per file, 64 MiB total file bytes, 1,024 bytes per path and 16 path components. Directory enumeration has a separate derived budget. Callers can supply stricter limits. Inspection and verification are synchronous and bounded, not automatically offloaded from a caller's thread.

Tests cover changed/missing/unexpected files, manifest/worker/assets, plugin-local digest replacement, malformed records, limits, symlink/path-swap handling and immutable bytes after source replacement or deletion. Verification returns no partial package and never rewrites a trusted record. The macOS Rust suite passes; native Windows/Linux validation remains required before integration. This does not establish packaged Tauri enforcement or safe external loading yet.

Optional developer directory mode will need an explicit policy for rebuilt output; it must not silently weaken normal package checks.

### Permissions and acknowledgement

Permissions may be declared at package level, component level or both in `manifest.toml`. A component's effective requirements are the union of common package requirements and its own component requirements. Components cannot subtract package requirements and must not inherit a sibling's component-specific authority. Authors should declare permissions per component unless they are genuinely common requirements.

All effective requirements are mandatory before activation. Refusing a common package requirement blocks all components that inherit it. Refusing a component-specific requirement blocks that component and any required consumers, not unrelated siblings. Adding a package-level requirement affects every component. Do not activate with only a subset of the required grants.

For project-scoped components, users acknowledge requirements per project unless they explicitly choose application-wide approval. Application-level components require explicit application-wide approval for their own native requirements before activation; they do not depend on an unrelated project's grant. Declaring application activation scope itself grants nothing. Components with no native requirements need no native-permission acknowledgement, though frontend trust/enablement review still applies.

**Approved initial service ownership; not implemented:** only project-scoped components may require native `project.files.*` permissions. Application components needing that work use declared project-provider APIs through explicit connections. Both components may live in one package. Application components may require `external.open`. Do not permit an application component to inherit project-file requirements from package-level declarations; mixed-scope packages must put those requirements on their project components. Application-wide consent does not change this service ownership rule.

Application-wide approval remains limited to the declared operations and resource scopes, not unrestricted filesystem/process access or implicit authority over every project. Authors can split global UI from project-scoped native work and connect through approved project services. New authority requested by an update requires renewed approval. Prefer resource-scoped native operations to broad filesystem or process authority.

The additive composition rule and local registration policy below are approved. Separate `operation` and `resource` fields are approved. Initial supported pairs are `project.files.list`/`project`, `project.files.read`/`project` and `external.open`/`http-https`. Listing and reading are separate permissions; neither implies the other. Reject unknown values and unsupported pairs before activation. Remaining manifest details, registry/grant storage, operation-specific revocation behavior and acknowledgement UI still need design approval. Declared frontend permissions are not a sandbox for browser activity; keep the trusted-frontend warning explicit.

### Local project registration

**Approved registry failure policy; not implemented:** corruption, unsupported schema versions or unsafe registry reads enter plugin-free recovery before packaged imports. Preserve existing database/package files and do not use uncertain grants or rebuild trust from on-disk package hashes. Require explicit user action for reset/restoration. Recovered native grants remain inactive until explicitly acknowledged again, even after validated installation records and component choices are restored. Do not silently undo post-backup revocations. Preserve project/application-wide scope and verify package integrity before use. Generic restore consent does not grant native authority; tickets/credentials are not restored. This backup authority policy is approved, not implemented. Exact backup validation and transactional restoration protocols remain open. Normal first launch and temporary lock handling are separate cases; a transient lock must not trigger an automatic destructive reset. This is not the deferred interrupted-startup suggestion feature.

**Approved host registry technology; not implemented:** use SQLite for installation/integrity associations, component choices, project registrations, approved grants and staged-update/recovery records. Store immutable package files separately. Do not persist activation credentials. This does not choose the project document format or plugin-owned data format. Database transactions do not cover filesystem operations; schema/migrations, Rust bindings, durability settings and exact recovery mechanics still need specification and tests. The accepted ordering is file publication before registry acceptance, described below. No database dependency is added yet.

**Approved direction; not implemented.** Keep native permission approvals in host-managed local records, separate from shared project files. Associate approvals with a host-issued local project registration and its approved location. A portable project ID or project name is not sufficient authority to recover grants.

Reopening a known project at its validated approved location reuses unchanged approvals. A copy at another location is a new local registration and requires acknowledgement where application-wide grants do not already cover its requirements. Moving a project can use an explicit **Relink existing project** workflow. The user selects the existing registration and new location, reviews affected approvals, and confirms before associations transfer. Never silently recover grants from an ID found in project files.

The native host validates locations and binds project credentials to the registered project. This is a permission association, not a decision about the full manuscript/project storage format. Registry schema, secure location matching, persistence and relinking API/UI still need design approval.

### Installation, updates, versions and defaults

**Approved acceptance ordering; not implemented:** safely extract/stage and validate the candidate, obtain required installation consent, then durably publish it into a new immutable directory. Do not overwrite an accepted/running artifact. Commit its location, accepted integrity association and installation state together in SQLite only after publication completes. The registry commit is the acceptance point. Incomplete staging or pre-commit orphan directories never authorize loading; confirm no references remain before cleanup. Post-commit contents still require verification, with missing/changed files blocked rather than reaccepted. Updates remain restart-staged. Exact filesystem durability/recovery operations and crash tests still need implementation design. This does not make installation consent a native permission grant.

Start with explicit local package installation and manual updates. Validate and stage accepted updates for the next application start. The running session continues using the old version; do not hot-replace its modules. Keep running and staged artifacts separate and retain the previous version until the replacement is accepted. Recheck compatibility, dependencies and required approvals before the replacement activates.

Show that restart is required, but never restart automatically or discard writing state. Component enable/disable within the loaded version remains available without restart. Recovery follows the approved policy below; exact startup promotion and UI contracts remain open. Preserve plugin-owned saved data on uninstall unless the user explicitly requests its deletion. Automatic updates and a public catalog are later work.

Initially support one active version per package identity. Keep identity and version separate in the design. Do not build unnecessary assumptions that prevent multiple installed versions later; support for that workflow is deferred. Check compatibility before executing code. Report missing dependencies instead of automatically downloading or executing them. Exact compatibility fields, startup promotion and recovery UI contracts remain open. Restart-required updates and explicit recovery are approved.

**Approved update-failure recovery; not implemented:** keep a failed component disabled and show its error in the plugin manager. Keep unrelated healthy components running; required dependencies determine which consumers cannot run. Do not automatically execute the previous package version.

Retain the previous accepted package as an explicit recovery option. Restoring it applies to the whole package and is staged for the next restart. Show affected components and dependencies before confirmation. Recheck integrity, compatibility, dependencies and permissions before activation. Restoring code does not undo saved-data changes made by the failed version. Explain that older code may not understand that data; do not promise automatic data rollback or compatibility.

**Approved recovery launch mode; not implemented:** provide an explicit way to start without importing or activating any packaged plugins, including official packages. Decide this mode before plugin module evaluation; skipping only `activate` is insufficient. An application-owned recovery screen must remain usable without plugin code. It lets users disable components, inspect recorded failures and stage restoration of a retained package. Preserve saved enablement choices unless the user explicitly changes them. Editing may be limited while feature packages are inactive. The concrete launch mechanism and screen contracts remain open.

A timeout in the shared frontend cannot interrupt an infinite loop. Recovery launch mode provides a route back into the application after a restart; it does not stop a frozen session or recover unsaved work. Automatic detection of interrupted startup and recovery suggestions are future work.

Installation and management must show package identity, version, components, requested native authority and frontend trust risks. Fresh application installations will include default feature packages. Basic Menu, undo functionality, and word-count/data features are intended examples of that default set. This does not make unfinished features implemented or require an undo-tree/history redesign in Part 4. The exact initial roster, enablement defaults and permission onboarding still need refinement. Example test packages need not be enabled by default.

Before external loading:

- Audit Tauri commands and native capabilities reachable from frontend code.
- Define the narrow native operations, token issuance protocol and grant scopes within the approved token-enforcement direction. Verify denial in packaged applications.
- Define package identity, entry points, compatibility, and dependency metadata.
- Design installation/removal and persisted activation preferences.
- Explain frontend trust and document/network risks. Distinguish disclosures from enforced restrictions.
- Build on the dependency-impact manager and task error reporting. Review additional external-package or task-status UI separately.
- Prevent project data and plugin requirements from automatically installing or executing extensions.

Frontend DOM isolation remains deferred. If a claimed native restriction cannot be enforced, resolve it before external loading. A manifest checkbox is not a substitute.

### Native request attribution and authorization

**Approved direction; not implemented.** Keep trusted frontends in the application's JavaScript environment. Require host-issued tokens for protected native requests and enforce permissions in Rust. The [native-request contract](context.md#native-request-identity-and-token-enforcement) explains the flow and its limits.

The host issues a fresh token for each activation and revokes it when that activation ends. Service objects keep credentials private and attach them to `invoke` calls. Rust resolves identity and approved grants from its registry. It must not trust a plugin ID supplied as a request argument. Direct use of `invoke` must not bypass checks. Include Tauri plugin commands and other native routes in the audit.

**Approved management boundary; not implemented:** permission/package management and recovery run in a separate app-owned WebView that never imports plugins. Rust accepts management commands only from the actual authorized WebView identity and capability route, not a supplied label. Plugin-host WebViews cannot grant authority, issue arbitrary credentials or create/navigate/impersonate the management WebView. Audit alternate native routes before external loading. This does not isolate plugins within the editor. Exact control commands, delivery, persistence and lifecycle coordination remain open.

**Approved credential attachment; not implemented:** Rust resolves an exact activation authorization from accepted snapshot/component/scope, target WebView, dependencies and grants. Complete required management review for changed authority or dependency enablement; unchanged approved startup needs no repeated prompt. Create a pending activation and one-use attachment ticket bound to that authorization. The intended host redeems it; Rust checks the real invoking WebView and current authorization, rejects replay/foreign use/stale snapshot-grants-opening associations and supplies a private activation credential. Successful synchronous setup confirmation releases the native gate; failure/closure/revocation invalidates pending authority. Tickets and credentials are temporary. This does not authenticate hostile JavaScript callers in a shared WebView. Exact wire/confirmation details, expiry, response-loss handling and cleanup still need design and tests.

Before implementing issuance or native services, specify remaining details:

- How the host establishes installed package and component identities before issuing credentials.
- The `manifest.toml` fields and effective grant rules within the approved policy: package and/or component declarations, mandatory grants for activation, per-project acknowledgement and an explicit application-wide option. Declarations are requests, not grants.
- Exact service signatures and remaining validation details for the approved operation/resource pairs below.
- Token issuance and delivery, activation/component binding and revocation. The package model leaves room for multiple frontend and backend components. Backend execution identity and its restricted runtime are deferred to later backend design.
- Per-operation cancellation checkpoints and commit behavior within the approved revocation policy below.

**Approved provider authority policy; not implemented:** providers use their own credentials and grants for exposed feature operations. Consumers need declared API dependencies, not duplicate native grants for the provider's underlying work. Rust attributes native requests to the provider whose credential is used. Providers must validate inputs and preserve project/resource boundaries. Prohibit general native-command proxies and credential exposure in supported APIs. Explain in permission review that providers may share feature results with declared consumers. This author contract is not enforced hostile-caller isolation in the shared frontend. Revoking a consumer connection prevents further supported calls through it, but neither retracts delivered results nor automatically revokes the provider's separate authority.

**Approved initial native services; not implemented:**

- **Read registered project files.** Provide bounded directory listing and file reads as bytes. Accept only project-relative paths. Rust must enforce containment within the approved project location, resource limits, authorization and cancellation. Whole-project read scope is approved: a grant may cover saved files throughout the registered project directory, within host-enforced limits. Directory-specific grants are deferred. These services read saved bytes. Plugins use the word-processing API for live or unsaved editor content.
  Native project-file services must not follow symbolic links or Windows junctions/reparse points, even for targets inside the project. Reject file reads and directory traversal through them. Enforce this during filesystem access so a link swap cannot bypass an earlier check. Safe internal-link support is a future candidate. Listings include identified links/reparse points and other special files as `kind = 'unsupported'`, without targets or contents. Such entries do not themselves fail the listing. Reads/traversal fail, while an actual failure to inspect an entry remains an error. This representation is approved, not implemented. This approved policy is not implemented and does not change broader import or project-storage behavior.

  Initial directory listing is nonrecursive and paged. Return bounded pages for the requested directory, with an opaque continuation cursor for further pages. Callers request subdirectories separately and can cancel between requests. Listings are not consistent filesystem snapshots. Recursive listing in bounded batches is planned for later; traversal limits, partial failures and changes during traversal need separate design. Single-use continuation cursors are approved: Rust consumes a cursor on accepting the request. Success returns a fresh cursor or completion; failure/cancellation releases enumeration resources and requires restarting. Concurrent reuse is rejected. Restarted listings may repeat entries, and retryable enumeration is a future candidate. Exact response fields, cursor expiry and numerical limits remain open.

- **Open external HTTP/HTTPS links.** Require permission. Rust must validate the URL and scheme. Reject filesystem paths and unsupported schemes.

**Approved native service availability; not implemented:** unavailable service groups are `null`. Expose the project-file group only with at least one file grant and the external-link group only with its grant. Each method still needs its specific permission; listing permission does not authorize reading. Components with no native requirements receive neither service group. Calls do not prompt for missing grants. Rust checks every request independently of frontend object availability. Retained objects still revoke when their activation ends.

**Approved native failure contract; not implemented:** asynchronous native services reject promises with structured SDK errors carrying stable codes. Provide an SDK helper for recognizing these errors in `catch` blocks. Authors must not parse error messages. Normalize native IPC errors at the SDK boundary and do not assume arbitrary caught exceptions are native-service errors. Uncaught rejections in managed task callbacks follow existing task-failure reporting; task cancellation retains its existing cancellation semantics. Keep the synchronous word-processing result API unchanged. Exact exported error/helper names and the complete code vocabulary remain open.

Permission fields and initial operation/resource pairs are approved above. Exact service method names and remaining contracts are open. Native file writes are outside the initial scope. Future writes will use host-assigned plugin storage separated by project/application scope, not arbitrary project paths. See [deferred work](#deferred-work-and-future-candidates).

Validation must cover missing, invalid and revoked tokens; attempts to supply a different plugin identity; requests beyond approved operation/resource scopes; old services after disable/re-enable; and alternate native entry points. Verify token issuance cannot be used to impersonate a different package or grant new privileges. Test enforcement in packaged Tauri runtimes, not only mocked IPC or browser tests.

**Approved revocation policy:** reject new native requests immediately when authority is revoked. Cancel queued work and signal cancellation to running work. Stop preparation/computation at safe checkpoints and recheck authority before final effects where the operation supports that boundary. An already committed or safely uninterruptible step may finish; completed effects cannot be undone automatically. Suppress late result delivery to revoked activations where the host still controls delivery, without claiming to retract already delivered data.

Rust owns native resource cleanup. Do not require a disabled component to make another authenticated request with its revoked credential to release resources. Apply this policy on component disablement, project closure and permission revocation. Cancellation is cooperative, not immediate preemption of arbitrary operating-system calls. Each native service must document its specific cancellation and commit behavior.

Successful attribution means a request used a particular activation's credential. It is not proof of the originating JavaScript code against malicious same-environment interference or deliberate delegation. Logging remains deferred and is not a prerequisite for deciding this attribution contract.

**Approved translation responsibility; not implemented:** the host supplies selected locale, text direction and activation-owned change subscriptions. Plugins own their messages and fallbacks. They may reuse supported libraries or declared provider APIs for translation work; a shared translation provider service is a future candidate, not a Part 4 requirement. Its exact operations, catalog ownership and fallback behavior need later design. No particular new translation library or catalog service is selected. Official packages use the same public locale API as third parties. Exact signatures still need review. Do not expose private app-generated messages as the plugin interface.

### Required outcome: separately packaged Basic Menu

**Approved helper boundary; not implemented:** extract the minimal continuation-aware selection/grouping helpers into an explicitly imported reusable library surface. Read the caller's ProseMirror state without DOM measurement, dispatch or app singletons. Formatting rules stay in Basic Menu; other plugins may reuse the helpers. Preserve current model-mutating pagination semantics. Exact module names, exports and result shapes still need review. Provider-supplied structure queries are a future candidate, not required for this extraction.

Basic Menu is currently a bundled application plugin under `src/lib/editor/prosemirror/menu/basic/`. By the end of Part 4, its feature implementation must live in a separate plugin package. A separate directory or an app-specific activation wrapper alone does not satisfy this requirement.

The package must use the supported package-loading mechanism and public APIs available to third-party plugins. It must not depend on private application imports or privileged formatting hooks. The word-processing provider remains its declared editor API dependency. Shared controls can come from reusable libraries.

Validate the packaged plugin's horizontal and vertical controls, formatting behavior, disable/re-enable cleanup, docking capacity and undo preservation. Use it as a real-feature test of the package-loading system, not only a synthetic fixture.

Basic Menu is an approved separately packaged deliverable and a default package for fresh installations. Host-controlled shared dependencies and author build tooling are approved direction. The exact package format, runtime versions, distribution location, loading contracts and permission onboarding still need design approval. Separate packaging does not require public registry publication. Part 3C's new-content and schema work remains separately gated. Existing-type rendering is implemented.

### Required outcome: packaged extension examples

Package examples that exercise the main extension capabilities through the same supported loading mechanism as Basic Menu:

- Toolbar UI: Quick Format or an equivalent independent formatting example.
- Editor behavior: the smart-punctuation and selection-highlighting examples.
- Workers: the word-analysis example, including its emitted worker assets.
- Custom rendering: the node/mark-view example developed during Part 3C.

Reuse the existing examples where practical. Their purpose is to verify public APIs, package assets and lifecycle behavior. Packaging does not make them finished user-facing features or require enabling them in the default app. Exact example boundaries and distribution details can be refined later.

This requirement does not include extracting the entire word-processing editor, independently packaging pagination, or implementing history plumbing for an undo-tree plugin.

## Deferred work and future candidates

This list keeps later possibilities visible without making them Part 4 deliverables. **Deferred** means deliberately outside the initial scope. **Candidate** means useful to revisit if a concrete need justifies it, not a promised feature or release date. Update the list when scope changes. Move implemented capabilities into current guidance. Keep rejected alternatives only in changelogs.

| Area                                                               | Initial scope                                                                                   | Later work or decision                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin-owned native storage writes — deferred                      | Initial native file services are read-only.                                                     | Restrict writes to host-assigned plugin directories, separated by project/application scope. Directory layout, component sharing, migrations and write APIs need later approval. |
| Automatic startup recovery suggestions — deferred                  | Explicit recovery launch without packaged plugin imports.                                       | Detect incomplete startup and offer recovery before imports. Distinguish interruption from proof that a plugin failed.                                                           |
| Directory-specific native read grants — deferred                   | Read grants cover the whole registered project directory within host limits.                    | Narrow grants to selected subdirectories; define declaration, consent and directory-move behavior.                                                                               |
| Retryable directory enumeration — candidate                        | Single-use continuation cursors; restart after accepted-request failure/cancellation.           | Consider retry-safe pages with bounded retained state, expiry and concurrent-request semantics.                                                                                  |
| Recursive directory listing — deferred                             | Nonrecursive directory listing in bounded pages with continuation cursors.                      | Add recursive listing in bounded batches. Define traversal/depth limits, partial failures, cancellation and changes during traversal.                                            |
| Safe internal-link support — candidate                             | Native project-file services do not follow symbolic links or reparse points.                    | Consider following links only within the approved project using race-safe containment; preserve cross-platform enforcement.                                                      |
| Direct project-file handles for application components — candidate | Project components own native file services; global features connect through provider APIs.     | Design explicit project-bound native-service acquisition, grants, credentials and revocation without silently retargeting handles.                                               |
| Automatic selected-project API helper — candidate                  | Explicit connections and author-managed switching.                                              | A convenience subscription that releases old connections and supplies the selected project's API without silently retargeting handles.                                           |
| Independently optional API groups — candidate                      | One dependency declaration per target package/component/binding within each consumer component. | Consider separate optional groups of APIs or commands from one provider. Define version requirements, optionality and availability rules before adding them.                     |
| Backend components — deferred                                      | Frontend execution only; package model leaves room for backends.                                | Select a restricted backend runtime, lifecycle and communication contract.                                                                                                       |
| Live package updates — deferred                                    | Stage validated updates for the next app start.                                                 | Design safe replacement of running components, dependencies and resources.                                                                                                       |
| Developer directory mode — candidate                               | Normal installation uses prebuilt ZIPs.                                                         | Explicit local build-directory loading and manual or watched reload.                                                                                                             |
| Multiple installed versions — deferred                             | One active version per package identity; keep identity/version separate.                        | User-facing installation and selection of multiple versions. Simultaneous activation is a separate decision.                                                                     |
| Richer version-range syntax — candidate                            | Exact versions or explicit comparison conjunctions; exact-only prerelease matching.             | Consider shorthand, wildcards, OR expressions or richer prerelease matching without changing existing expressions.                                                               |
| Worker code splitting — deferred                                   | One self-contained module per worker.                                                           | Verified package-local worker module graphs and shared chunks.                                                                                                                   |
| Automatic updates — deferred                                       | Explicit manual updates and acknowledgement of new authority.                                   | Update discovery, consent, scheduling and recovery policies.                                                                                                                     |
| Public catalog — deferred                                          | Local package installation.                                                                     | Discovery, distribution and publisher/namespace policies.                                                                                                                        |
| Publisher signatures — separate decision                           | SHA-256 against host-accepted records, without publisher authentication.                        | Trusted keys, signing, key replacement and revocation.                                                                                                                           |
| Logging — deferred                                                 | Native-request attribution contract only.                                                       | Logging scope, privacy, retention and diagnostics. No tamper-proof frontend provenance claim.                                                                                    |
| Additional runtime profiles — candidate                            | One supported frontend profile.                                                                 | Explicitly tested compatibility for additional targets if needed.                                                                                                                |
| Provider-supplied document structure queries — candidate           | Plugins import continuation-aware selection/grouping helpers.                                   | Consider queries on the connected word-processing provider that hide model-specific grouping details; define methods, result shapes and document-model compatibility later.      |
| Shared translation service — candidate                             | Host locale/direction notifications; plugins own messages and fallback choices.                 | Consider an optional provider API for reusable translation functionality. Define operations, catalog ownership, dependency/lifecycle rules and fallback behavior later.          |
| Richer task/worker helpers — candidates                            | Existing dedicated workers and task utilities.                                                  | Pooling, worker progress, timeouts, quotas and slow-step diagnostics when justified.                                                                                             |
| Frontend isolation research — candidate                            | Trusted shared frontend environment.                                                            | Reconsider only through separate design approval; no current sandbox guarantee.                                                                                                  |

Future plugin storage is distinct from exporting a document to an arbitrary user-selected destination. Derive storage ownership from authenticated host identity, not caller-supplied plugin IDs or paths. Preserve saved data on uninstall unless deletion is explicitly requested. The storage decision does not authorize arbitrary project-file writes or unrestricted exports.

New node/mark registration, schema lifecycle and missing-content preservation remain the separate Part 3C design gate. Full editor extraction, independently replaceable pagination and undo-tree history plumbing remain outside Part 4. They are not silently included in package-loading work.

**Not deferrable for convenience:** Rust-side native authorization, trusted token issuance, mandatory grant handling, verified-byte delivery, safe extraction and required packaged-runtime validation must be addressed before external loading is enabled. Open details needed for the agreed Part 4 scope remain in [Decisions needed before implementation](#decisions-needed-before-implementation), not in this deferred list.

Cross-project required dependencies are another future candidate. Initial required resolution uses the same project or the same window's application service. Explicitly binding application features to required project instances or linking requirements across projects needs separate configuration, lifetime and recovery design. Global features can still use selected-project connections without making that project a condition of their own lifetime.

## Validation and documentation

Implementation changes must update current context and the same cumulative in-progress changelog entry. Keep proposed behavior, implemented behavior, and verified guarantees distinct. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for checks.

Start with focused unit/integration tests. Scheduler changes also need pagination browser regressions. Editor changes need typing, selection, formatting, undo, and lifecycle coverage. Geometry needs a real browser. Native restrictions need packaged-runtime verification; Playwright cannot establish Tauri enforcement.

Report passed, failed, and unavailable checks. Keep verified results in the changelog. The [source/test map](context.md#source-and-test-entry-points) links the relevant suites.

## Decisions needed before implementation

The task/provider policies and current synchronous editor access, provider-owned edits, provider-based formatting, behavioral ordering/removal, in-place reconfiguration, and existing-type renderer registration with Svelte adapters are approved and implemented. They do not need a new approval decision.

Remaining gates are:

1. **New custom content, Part 3C:** approve new node/mark registration, schema lifecycle, and missing-content preservation. Existing-type rendering does not need a new approval decision.
2. **External loading, Part 4:** the policies above are approved, including strict manifests, aliases/ranges, component scope, mandatory additive grants, explicit project connections, native service boundaries, failure handling, stylesheet ownership and recovery. Review the [consolidated draft](package-api-proposal.md#10-consolidated-review-decisions) for exact author contracts, native control/durable state, runtime-profile delivery and Basic Menu's remaining dependencies. Issuance protocol, crash-safe persistence and installation/recovery flows need concrete designs after responsibility boundaries are approved. ZIP, SHA-256 and verified-byte consumption are approved; the internal integrity foundation is implemented. Production extraction, accepted-record persistence and browser delivery are not. Review the fixture's measured limitations and repeat the remaining packaged platform tests before finalizing URL/worker mechanics. Developer directory mode and publisher signing remain future work, not prerequisites. Verify native enforcement and packaged behavior before external loading.
3. **Broader work:** separately justify and approve extraction or features beyond the implemented scope. API publication, stability, universal upstream compatibility, and performance targets are not established.
