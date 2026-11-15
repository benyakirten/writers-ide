# Plugins, reusable libraries, and core responsibilities

## Status and scope

This topic distinguishes plugins, reusable libraries, and the application core. **Stage 1 merged in [#80](https://github.com/benyakirten/writers-ide/pull/80) on 2026-11-14. Stage 2 is implemented on `bh/phase-2-plugin-transition` (unmerged; no PR known). Stage 3 remains planned.** Stage 2 adds private layout/component libraries and a host-owned plugin manager, not a sandbox or published SDK. Public API stabilization, broader extraction, isolation mechanisms, and storage designs remain open and require owner approval.

Read [project context](../project-context.md) for accepted product direction and security requirements. See [change-log.md](change-log.md) for the current documentation change.

## The distinction

**Plugin versus core describes responsibility within the application. Library versus application-specific code describes reuse and packaging. These are different axes.** A core service can use a reusable library; a plugin can also use reusable libraries.

| Role             | Purpose                                                                                                                                                                                              | Example                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Plugin           | An independently identifiable feature that contributes through declared extension points, receives scoped capabilities, and has a managed lifecycle.                                                 | Formatting toolbar or word-processing view.                                                      |
| Reusable library | Functionality imported by other code, with explicit dependencies and a useful contract independent of Writer's IDE application state. It does not inherently have a plugin lifecycle or permissions. | Docking components, scheduling, or editing helpers.                                              |
| Application core | The host responsibilities that compose features, enforce shared rules, and keep the application safe and usable independently of any particular feature plugin.                                      | Extension hosting, workspace coordination, permission enforcement, and shared platform services. |

A plugin is not necessarily a UI component, a library is not necessarily framework-independent, and a package is not necessarily a plugin. Internal reuse does not require publishing a package.

### Plugin terminology

- A **plugin package** is the unit of feature identity, compatibility, activation, and permissions. Packaging and loading formats are not selected.
- A **contribution** is something the plugin provides: a bar item, central view, command, or provider. One plugin may provide several contributions.
- A **capability** in the current bundled host authorizes a contribution kind: `contributions.toolbar`, `contributions.view`, or `contributions.command`. These declarations do not grant data access or sandbox JavaScript. Permission-checked access to content/platform services remains Stage 3 design work; injecting a trusted feature dependency is not a generic security grant.
- A **ProseMirror plugin** is an editor implementation mechanism, not an application-plugin identity or security boundary. An application plugin may use several ProseMirror plugins or none; unrestricted ProseMirror hooks are not automatically safe external APIs.

## Responsibility boundaries

The accepted direction is a small core with word processing, formatting bars, and other feature views implemented as plugins. Built-in features must use the same extension APIs offered to third parties, without feature-only privileged shortcuts. Exact extraction boundaries remain open.

The core hosts contributions and enforces their contracts. Its responsibilities include workspace layout infrastructure, internationalization, import/export infrastructure, and safe access to platform and project services. Features contribute their own behavior and presentation rather than directly mutating host internals.

For example, a formatting toolbar contributes horizontal and vertical presentations, observes formatting summaries, and invokes commands. The workbench owns docking, capacity checks, placement, and focus routing. Moving the toolbar is not the toolbar's responsibility; feature state must not depend solely on a presentation instance surviving relocation.

### Libraries underneath these boundaries

The Stage 2 `@writers-ide/layout` library implements registry, capacity, transfer, floater, and drag primitives without manuscript, ProseMirror, or application-singleton dependencies. Explicit dependency injection supports independent workbenches. Writer's IDE retains compatibility state facades, feature rendering, and `Editor.svelte` DnD composition as application adapters.

Libraries should not import Writer's IDE application singletons or assume access to its project state. Framework-specific libraries are valid: a Svelte library need not acquire a framework-independent abstraction without a real use case. Extract cohesive functionality rather than creating a package for every utility or thin dependency wrapper.

## Accepted direction: editor extensions and package wrappers

**Accepted direction, not current implementation:** official and third-party plugins must use the same public extension APIs. There must be no official-feature-only escape hatch for raw editor or application access. The goal is broad, open-ended editor extensibility, not just alternate toolbar layouts or a closed list of formatting commands.

The generic platform owns hosting and cross-plugin relationships; subsystem providers define their own domain APIs. A future word-processing extension API should support alternative formatting interfaces and workflows, plus deeper editor behavior and document semantics. Formatting concepts remain outside the generic plugin package. Shared editing/toolkit functionality should be reusable without requiring the default formatting toolbar to be enabled.

### Wrapping existing ProseMirror packages

A Writer's IDE plugin may wrap an existing ProseMirror package rather than reimplement it. The wrapper is the application plugin; the upstream package is a library dependency. Both official and third-party wrappers use the same supported extension points.

A wrapper adapts configuration and registers the package's functionality through those APIs, connects state and lifecycle, and supplies content serialization, migrations or fallback behavior where applicable. This is not permission to modify another plugin's internals or directly install arbitrary callbacks into the host editor.

Compatibility may require a thin adapter, translation between models, or a partial integration. Some packages may need upstream changes or remain unsupported. Broad ecosystem compatibility is a goal, not a guarantee that every existing ProseMirror plugin can run unchanged.

Candidate extension domains to design within the word-processing subsystem include:

| Domain                         | Intended kinds of contributions                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Commands and editing workflows | Actions, availability checks, keybindings, parameterized operations and grouped edits.             |
| Document content               | Nodes, marks, attributes, validation, parsing, serialization and schema evolution.                 |
| Editor behavior                | Input rules, plugin state, supported transaction-processing hooks and decorations.                 |
| Presentation and layout        | Custom content views, controls, measurement and layout behavior.                                   |
| Conversion                     | Import/export handlers and format-specific representations, through conversion-provider contracts. |

These domains are design goals, not implemented registrations or approved signatures. Synchronous hooks require explicit ordering, execution and invariant contracts; live schema changes require compatibility and preservation rules rather than ordinary UI toggles.

### Cross-plugin contracts and dependencies

Plugins should be able to provide versioned contracts that other plugins depend on or extend. A library dependency shares implementation code; a runtime plugin dependency requires a compatible, active provider. Interaction should use explicit APIs, events and owned registrations, not private imports or mutable singleton references. This direction does not reintroduce a universal context containing every feature's services.

For example, a columns extension could depend on the word processor, while an optional columns-to-LaTeX adapter also uses a LaTeX conversion provider. Columns need not require LaTeX when useful independently. This is a motivating design example, not implemented columns, a selected content representation, a chosen compiler, or approval to redesign pagination. LaTeX conversion does not imply arbitrary native-process execution.

Dependency compatibility, required/optional relationships, activation order, cycle policy, provider removal and dependent cleanup still need a concrete design. Dependency declarations must not automatically install code, execute project-supplied requirements, or grant data access. Disabling a provider must preserve its saved content, independently of whether its implementation is available.

### Execution boundary and design validation

A wrapper supplies compatibility, not isolation. Installing an upstream ProseMirror `Plugin` directly into an application editor executes its callbacks with that environment's authority. Official and third-party wrappers must use the same supported APIs, but frontend code is trusted rather than sandboxed under the revised direction below.

The next design work should exercise a simple input-rule package, a decoration-based feature, and a Svelte custom-node/node-view integration. Use these concrete wrapper cases to identify API and execution requirements before implementing the deeper extension model. Hook ordering, permissions, schema lifecycle, and dependency contracts remain open architectural decisions requiring owner approval.

## Accepted direction: frontend trust and native restrictions

**Owner-approved revision to the original isolation plan; not a new runtime implementation:** frontend plugins may use ordinary Svelte, their own DOM rendering, and supported deep editor APIs. Preventing access to the application's or other plugins' DOM is deferred, not a prerequisite for the next frontend extension APIs. Same-environment frontend JavaScript is trusted code and can reach ambient browser facilities. Public APIs remain the supported integration path; plugins should not modify another plugin's UI or private state, but this is a behavioral contract, not an enforced DOM boundary.

External network calls are allowed in principle under an explicit user trust model. A plugin able to read manuscript content and make requests can exfiltrate that content; copied snapshots, contribution declarations, wrappers, and DOM boundaries do not prevent this. Permission disclosures must distinguish informational declarations from enforced restrictions. Exact installation review and network disclosure UX remain open. This decision does not enable an external loader today.

Backend/native extensions must remain highly restrictive. Frontend trust must not imply unrestricted Tauri IPC, filesystem, shell/process, native-library, or other backend authority. Define and verify narrow native APIs and their actual enforcement before external loading; do not mistake TypeScript interfaces or frontend checks for that boundary. Project-supplied requirements must not automatically install or execute code or grant permissions.

Ordinary Svelte node views are a design goal without requiring iframe-per-node rendering or a bespoke UI DSL. No iframe, ShadowRealm, secure DOM membrane, separate-process runtime, or future isolation mechanism is selected. Frontend DOM isolation can be investigated later without claiming present security guarantees.

## Accepted direction: actions and cooperative execution

**Accepted design, not implemented plugin APIs:** reuse the [pagination work queue](../pagination/context.md#generic-work-queue) as shared cooperative infrastructure. Provide useful, ergonomic helpers and APIs that consume them rather than requiring a generator for every action or routing every UI callback through a queue. Plugin authors choose the appropriate execution mode:

| Mode                    | Intended use                                                   | Contract                                                                   |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Immediate synchronous   | Small editing commands and hooks requiring an immediate answer | Keep callbacks short; scheduling cannot preempt them.                      |
| Async                   | Network requests and other asynchronous APIs                   | Promises do not offload CPU work; cancellation is cooperative.             |
| Cooperative main-thread | Incremental DOM-dependent work and other bounded tasks         | Yield between short units; edits and cancellation can occur between units. |
| Worker                  | CPU-heavy computation over cloneable/transferable inputs       | No live DOM, editor state, or transaction crosses the worker boundary.     |

### Make the cooperative path attractive

- Offer iteration/batching helpers that manage yielding and progress, with an advanced generator API when authors need explicit checkpoints. No mandatory generator or mandatory execution-mode declaration for every UI action is approved.
- Let contributed commands and higher-level APIs use task helpers so a Svelte button or shortcut can invoke the same managed operation without implementing scheduling itself. Ordinary short actions remain straightforward.
- The host scopes task ownership, cancellation, labels/errors and replacement keys to plugin activation. Authors should not manage queue start leases or remember unload cleanup. Link per-task cancellation to plugin lifetime and, where appropriate, document/view closure; cancelling one task must not abort all plugin work.
- Share the application scheduler with pagination rather than giving every plugin a separate frame allowance. Preserve fairness and cancellation; exact APIs, quotas and priority policy remain open.
- Keep each unit short. The current queue has an 8 ms **soft** frame budget and cannot interrupt an executing generator step. A callback wrapper cannot make an arbitrary loop cooperative. Slow-step diagnostics and concrete responsiveness measurements are useful follow-up work, not existing guarantees.

These are convenience and performance contracts, not sandbox enforcement. Trusted frontend code can still put expensive work in event handlers or Svelte effects. The approach is a carrot: good examples, useful helpers, and natural consumers rather than pretending to intercept all JavaScript execution. Truly synchronous ProseMirror hooks remain synchronous; do not defer event-handling decisions or browser operations requiring user activation indiscriminately.

### Computation, cancellation and result application

Task utilities should separate capture/computation from result application. When results are ready, obtain current editor state, validate the target, and construct/apply a transaction synchronously. Do not retain a mutable transaction or assume a live selection remains valid across `await` or a cooperative yield. Current state alone does not make an old result applicable: map and validate captured targets, discard stale results, or recompute according to the operation's semantics. Multiple incremental edits need explicit partial-completion and undo-grouping behavior.

Prefer bundled worker modules with a small worker-side protocol helper over `calcFn.toString()` blobs: function serialization loses imports/closures and does not supply a messaging protocol. A managed worker task should handle result payloads, errors, cancellation, late-result rejection, termination and resource cleanup. Dedicated one-shot workers are a simple starting proposal; pooling/reuse is not selected. Worker computation may also update plugin-local UI without producing an editor transaction.

Async task cancellation requires the operation to honor its signal; a dedicated worker can be terminated. Main-thread synchronous work cannot be interrupted while it blocks. Check cancellation before starting and before applying results, and surface failures with plugin/task identity. Latest-request-wins behavior and progress are useful optional helpers. If an API exposes both an immediate and eventual result, it must define whether the latter replaces or supplements the former to avoid duplicate application; no such signature is finalized.

General queue/task mechanics belong in reusable infrastructure, plugin lifecycle scoping belongs in the host, and current-state validation/transaction application belongs in the word-processing subsystem. Formatting commands do not belong in these generic APIs. This direction does not authorize redesigning model-mutating pagination.

## Accepted implementation stages

Stages 1 and 2 support trusted, bundled plugins only. The owner subsequently revised Stage 3's original frontend-isolation prerequisite: frontend DOM isolation is deferred, while external loading still requires a concrete trust/installation design and verified native restrictions. These stages are not release dates or claims of completed work.

### Stage 1 — Contracts, host, and formatting plugin

**Merged in #80:** contracts, bundled lifecycle host, registry/rendering adapters, and the formatting toolbar migration; see the contracts below.

- Establish plugin identity, API compatibility, lifecycle, and contribution contracts for toolbar items, commands and central views. Stage 1 also introduced formatting-state/command interfaces; the owner-approved Stage 2 correction below moves those feature contracts out of the general plugin package.
- Keep data and command contracts independent of Svelte and ProseMirror; place Svelte presentation types in a separate adapter entry point.
- Implement explicit bundled-plugin registration, contribution ownership, duplicate-ID validation, activation-failure rollback, and deactivation cleanup of contributions and subscriptions.
- Migrate the basic formatting toolbar to formatting summaries and validated commands instead of raw editor views, selections, documents, or mutable workspace references. Preserve horizontal/vertical presentations, capacity rules, formatting behavior, and docking behavior.
- Keep the existing ProseMirror editor behind the formatting service initially. Do not simultaneously extract the whole word processor or redesign pagination.
- Test lifecycle/cleanup and existing formatting behavior.

### Stage 2 — Reusable libraries and plugin management UI

**Current `bh/phase-2-plugin-transition` working tree / unmerged:** the scoped libraries, manager, and owner-requested feature-neutral contract correction below are connected in source. PR identity is not yet known. Verified validation and remaining limits are recorded in the current changelog entry.

- Extract cohesive docking/workbench infrastructure into `packages-js/layout`, removing ProseMirror and application-singleton dependencies from the reusable layer.
- Extract the UI components and service pieces needed by the formatting plugin into `packages-js/components`, with explicit dependencies. Keep packages private to the workspace initially; publication and stable public-package APIs are not part of this stage.
- Keep the shared plugin architecture feature-neutral: lifecycle context consists only of `signal`, `own`, and `contributions`. Formatting contracts, the ProseMirror bridge, and activation scoping belong to the formatting feature, not a required general host service. This accepted owner correction removes feature coupling without adding a generic service bus or extensible permission model.
- Leave scheduling, shortcut handling, and editing-helper extraction until a demonstrated consumer justifies it.
- Add a user-facing plugin-management view backed by the host's public management API. Distinguish this UI from the developer-facing plugin API.
- List bundled plugins with descriptions, versions, enabled/disabled/failed states, declared capabilities and contributions, and actionable activation errors. Allow enabling/disabling optional plugins.
- Clearly identify bundled plugins as trusted. Capability declarations and narrow interfaces do not sandbox in-process JavaScript. Do not offer installation from files or URLs yet.
- Disabling a plugin removes its active contributions, not its saved data. Keep the management shell host-owned so a failing plugin cannot prevent users from disabling it.

### Stage 3 — Third-party loading, trust and native enforcement

- Define external-package validation, compatibility, installation review and explicit frontend trust/network disclosures before enabling external loading.
- Approve and verify restrictive backend/native access, runtime request validation, revocation and failure handling. Do not promise that same-environment frontend JavaScript is confined by capability declarations.
- Support ordinary Svelte and shared official/third-party extension APIs. Frontend DOM isolation is deferred; no iframe or alternative runtime is required or selected by this plan.
- Add dependency/provider lifecycle and extension contracts through separately approved designs; test native denial and actual lifecycle guarantees rather than nonexistent frontend isolation.

Keep transferable data, scoped IDs, explicit requests and lifecycle ownership where useful. Direct Svelte components are trusted execution, whether supplied by an official or third-party feature. Shared APIs must not introduce official-feature-only privileged shortcuts. The task/scheduler direction above is accepted, but exact implementation scope and public signatures remain to be designed.

The undo-tree plugin remains a future consumer once host history plumbing exists. These stages do not select a history/storage model or implement durable branching history.

## Examples and candidate boundaries

The table illustrates responsibility boundaries. The staged plan above approves formatting-plugin migration and scoped layout/component extraction; the remaining examples are candidates, not additional extraction tasks or a publication roadmap.

| Area                   | Likely responsibility                                                                            | Possible library reuse / constraint                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting toolbar     | Feature plugin contributing bar presentations and invoking formatting commands.                  | Optional shared UI components; toolbar need not own editing semantics.                                                                                                             |
| Word-processing view   | Feature plugin hosted in a central-view container.                                               | ProseMirror editing helpers where schema assumptions are explicit. Current editor assembly remains coupled.                                                                        |
| Workbench docking      | Core workspace service used by plugin contributions.                                             | Implemented as private `@writers-ide/layout` in Stage 2, with application-specific rendering/composition remaining in the host. See [DnD context](../dnd/context.md).              |
| UI foundations         | Shared presentation services and optional plugin-facing components.                              | Stage 2 extracts tooltip/icon-button primitives into private `@writers-ide/components`; broader components remain in the application.                                              |
| Cooperative scheduling | Shared execution infrastructure, not a feature plugin.                                           | Candidate library; currently Svelte-reactive. Cooperative steps must remain short and do not offload CPU work or isolate malicious code.                                           |
| Shortcut handling      | Shared routing; feature commands and default bindings are contributions.                         | Potential reusable normalization/routing module; focus scopes and conflict policies still need design.                                                                             |
| Pagination             | Currently a coupled word-processing subsystem, not an independently replaceable external plugin. | Possible later specialized library. Preserve current model-mutating behavior; extraction does not authorize a layout redesign. See [pagination context](../pagination/context.md). |
| Undo-tree view         | Future plugin presenting and navigating host-managed history.                                    | History algorithms may eventually form a library; durable branching history is not implemented.                                                                                    |

### Undo tree as a boundary example

The host history service would record and preserve changes, maintain stable identities, reconstruct authorized historical content, and validate navigation. An undo-tree plugin would visualize that history, request previews, and request navigation through public APIs. Disabling the view must not disable recovery or delete history.

Reading history metadata, reading historical content, navigating history, and destructively pruning it are distinct authorities. Permission to read current content should not automatically expose deleted historical content. A history library, application history service, and undo-tree presentation are potential separate layers, not a selected storage or branching design. Existing ProseMirror undo is not durable project history.

## Safety and data contracts

Packaging is not isolation. In-process frontend components and imported libraries execute with their environment's authority; frontend DOM isolation is deferred and external network calls are allowed in principle. Treat document access plus network access as the ability to disclose that document.

Public APIs should favor versioned data, scoped handles and validated requests over mutable application singletons. Deep editor access must be designed within the word-processing API for both official and third-party features. Native permission enforcement belongs below frontend code; TypeScript types and declared capabilities alone do not enforce it. Frontend trust does not grant unrestricted filesystem, shell, native execution, or backend access.

Schema-owning features require versioning and missing-plugin preservation contracts before extraction. Removing a toolbar is different from removing the implementation of saved content. Preserve plugin-owned data when a plugin is disabled or unavailable; basic preservation must not require executing it.

## Current contracts and limitations

- `@writers-ide/plugins` is a private, source-exported workspace package. Root contracts have no framework/editor imports, `Formatting*` types, formatting-specific names, or `context.formatting`. The common context exposes only `signal`, `own`, and `contributions`; contribution capabilities are `contributions.toolbar`, `contributions.view`, and `contributions.command`. The general host requires no formatting service. API compatibility currently means exact `apiVersion: 1`, not a version-range negotiation scheme. See the [general package guide](../../packages-js/plugins/README.md), which links to the [feature-local formatting guide](../../src/lib/editor/prosemirror/menu/basic/README.md).
- The synchronous bundled host explicitly registers, activates, deactivates, and reports metadata/errors for plugins. It checks manifest/capability declarations and contribution IDs, rolls back failed activation, aborts/revokes a context before reverse-order cleanup, and continues cleanup after disposer failures. Contributions and `own()` resources are activation-owned; retained contribution handles cannot act after deactivation or a later reactivation. Feature-specific subscription ownership is implemented by the feature through this common lifecycle.
- These checks govern host API use, not ambient JavaScript authority. Only trusted bundled plugins execute. There is no external loader, sandbox, user-grant UI, package discovery, or persistent activation preference.
- Stage 2 exposes `PluginManagementService` (`list`, `subscribe`, `activate`, `deactivate`) with reactive frozen snapshots. The host-owned `PluginManager.svelte` accepts `management` and optional `requiredPluginIds`; it lists metadata, lifecycle status, declared capabilities, active contributions, and activation/cleanup errors, with enable/disable/retry actions and a bundled-trusted warning. The route owns its native `<dialog>` and passes `onplugins` through `Editor` to the Plugins button in `HorizontalBaseBar`, explicitly restoring launcher focus on close for keyboard and pointer use. This adds no installation workflow or new plugin i18n contract.
- Trusted presentations have a local Svelte boundary with a fallback for rendering/effect failures, leaving the host-owned manager available for disable/re-enable. Shared tooltip snippets have their own local boundary because they render outside the plugin view; replacing the descriptor/content or dismissing the tooltip allows recovery. This is presentation-error containment, not protection from arbitrary JavaScript errors, event-handler failures, malicious code, or ambient host access.
- Stage 2 `@writers-ide/components` exports `TooltipState`, `TooltipProvider`, `IconButton`, `Tooltip`, and `Pointer` with explicit state/context dependencies and no application singleton. Legacy app wrappers share the application tooltip manager; the route wraps `Editor` with that manager and `renderPointer={false}` because the app still renders its pointer. Drag suppression uses the same manager.
- The application adapts toolbar/view contributions to existing registries and command contributions to host-owned command handles. `defineSveltePresentation(component, props)` checks explicit feature props before type erasure; the descriptor/rendering adapter has no hardcoded context prop. A component receives the common context only if it needs it and the plugin explicitly supplies it. Formatting receives only its scoped formatting service, not legacy workspace/editor props. Central-view instance metadata and contributed shortcut routing are not implemented. The built-in word processor still uses the legacy path; its extraction is intentionally deferred.
- `createFormattingPlugin(service)` receives a trusted singleton from the route, injected only into this plugin rather than the general host. Feature-local `scopeFormattingService` clones snapshot data and requests, owns subscriptions through `context.own`, and revokes callbacks/requests through `context.signal`. It preserves early release, initial-listener failure cleanup, disposer/error behavior, and stale-activation rejection. This is trusted feature dependency injection, not a generic service bus, new extensible permission model, or external security grant; Stage 3 loading/native enforcement remain open and frontend DOM isolation is deferred.
- Formatting delivers immediate, copied, data-only snapshots: view ID, monotonic revision, mark/block ratios, and command availability. Requests specify view ID, revision, and command. The service validates live active view/state/editability, rejecting stale requests even before a reactive flush; tab document IDs are resolved to distinct registered view IDs. Existing caret mark no-ops, superscript/subscript exclusion, and continuation-aware paragraph commands are preserved. Unavailable/no-op controls are disabled.
- Formatting subscriptions start the shared bridge lazily and release its bus/effect resources when unused. Availability queries inspect content without generating speculative transactions. Peer grouping must safely traverse page boundaries, final leaf blocks and document-end selections; errors in this query can otherwise escape a ProseMirror update before subscriber notification. Update-listener failures are reported without interrupting other subscribers or editor dispatch. No rich-text content or mutable editor reference crosses the formatting boundary.
- Disabling a toolbar removes its presentation but retains placement IDs and declared orientation costs, avoiding overfill on re-enable. Missing-item placeholders remain, and reactivation restores the registered presentations. Registry `clear()` releases retained metadata. This is in-memory preservation, not durable layout or plugin-state storage.
- Relocation remounts formatting presentations against the same scoped service and current snapshot. No general arbitrary component-local-state transfer, custom schema lifecycle, or durable project history is introduced.

## Source and test entry points

These are private, evolving contracts and internal discovery points, not a stable published SDK:

- `packages-js/plugins/index.ts`, `svelte.ts`, and [README](../../packages-js/plugins/README.md): data/lifecycle contracts, trusted presentation descriptor, API reference.
- `src/lib/plugins/plugin-host.ts`: lifecycle, ownership, revocation, rollback, and reactive management; `plugin-host.test.ts` covers those contracts.
- `src/lib/plugins/PluginManager.svelte`, `PluginManager.svelte.test.ts`: host-owned management panel and service/action failures. Formatting declares only the toolbar contribution capability; the manager makes no formatting-permission claims. `PluginPresentation.svelte`, `plugin-presentation.svelte.test.ts`, and `generic-presentation.svelte.test.ts`: explicit-prop rendering, feature-neutral presentations, local presentation-failure fallback and recovery.
- `src/lib/plugins/application-plugin-host.ts`, `PluginPresentation.svelte`: application registry adapters and restricted-prop rendering; `application-plugin-host.svelte.test.ts` covers collisions, rendering, ownership, disable/re-enable and capacity preservation.
- `src/lib/editor/prosemirror/menu/basic/contracts.ts`, `formatting-service.svelte.ts`, `scope-formatting-service.ts`: feature-owned data/command contract, ProseMirror active-editor bridge, and activation-scoping helper. The full bridge regression suite moved alongside the bridge as `formatting-service.svelte.test.ts`, retaining stale requests, separate tab/view IDs, summaries, availability, peer paragraphs, subscription cleanup/error isolation, and quiet-query coverage. `scope-formatting-service.test.ts` owns formatting-specific lifecycle regressions; generic host lifecycle tests are feature-neutral.
- `src/routes/+page.svelte`: injects the trusted formatting singleton into `createFormattingPlugin(service)`, registers/activates it, and deactivates it on teardown; still directly registers the ProseMirror view.
- `src/lib/editor/prosemirror/menu/basic/`: formatting plugin definition and explicit-service-prop, snapshot/command-only presentations; `menu.test.ts` covers both orientations and command routing. See the [feature guide](../../src/lib/editor/prosemirror/menu/basic/README.md).
- `src/lib/editor/state/bar-item-registry.svelte.ts`, `bar-items.svelte.ts`, and `tab-state-registry.svelte.ts`: existing registries with trusted plugin presentation adapters and retained disabled-toolbar sizes.
- `src/lib/editor/state/shared.types.ts`: legacy broad injected props, no longer supplied to the formatting plugin.
- `src/lib/editor/prosemirror/plugins.svelte.ts` and `view/editor.ts`: ProseMirror factory registration and editor construction, separate from the bundled application-plugin host.
- `src/lib/editor/bars/`, `src/lib/dnd/`, and bar/floater/transfer state: application rendering/composition and compatibility adapters over the layout library; `e2e/docking.test.ts` includes real formatting-button and docking regressions. The CI smoke command includes `e2e/smoke.test.ts`, `e2e/pagination-selection.test.ts`, and `e2e/plugin-manager.test.ts`; validating only smoke plus docking misses the multi-page selection/reflow/undo and management regressions.
- `packages-js/layout/index.ts`, `src/`: injected workbench engine and drag primitives; `src/lib/editor/state/workbench.svelte.ts` composes the app compatibility instance. See [DnD context](../dnd/context.md).
- `packages-js/components/index.ts`, `src/`: explicit tooltip state/provider and shared controls. `src/lib/testing/layout-library.svelte.test.ts` and `components-library.svelte.test.ts` cover library integration and instance independence.
- The root and all three private packages are workspace members in Stage 2. Scheduling, shortcuts, broader UI/services, and editing helpers remain application code; no bulk extraction is implied.

## Open implementation decisions

- Detailed package boundaries and names within the approved scope, dependency rules, and any later publication strategy. Initial packages are private workspace packages.
- Extensions beyond the synchronous lifecycle and API version 1, user-grant policy, persistent activation preferences, and richer contribution/view-instance contracts.
- Subsystem-provided versioned APIs and required/optional runtime dependencies, including compatibility, ordering, cycles, provider removal and cleanup.
- The shared word-processing extension API and ProseMirror wrapper compatibility: supported hooks, synchronous execution, schema lifecycle, and ordinary Svelte node views.
- Task helper signatures, scheduler extraction, worker protocol, cancellation/result policies, and performance diagnostics; cooperation remains encouraged rather than universally mandatory.
- External loading/review and network disclosure UX, restrictive native enforcement, and any later frontend isolation research.
- Document/view ownership and command contracts, schema evolution, and content preservation.
- History scope, granularity, branch/navigation semantics, collaboration, persistence, and retention.

This document establishes vocabulary, responsibility boundaries, and the approved implementation sequence, not a complete API specification. Stage 1 is merged and the described Stage 2 behavior is working-tree implementation; candidate examples outside the approved scope do not authorize additional source migrations or imply runtime guarantees.
