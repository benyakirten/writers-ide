# Plugin SDK export review

This review records approved exports and proposes the remaining Writer's IDE library exports for external plugin authors. It is based on current package entry points and their application, feature and test consumers. Approval is explicit below; the rest remains proposed. This document does not change runtime exports.

The approved direction is an explicit author-facing SDK. Application setup APIs remain separate. Shared Svelte modules and the four foundational ProseMirror packages have their own approved inventory in the [runtime profile proposal](package-api-proposal.md#candidate-runtime-profile-inventory).

## How to read this proposal

- **Approved for authors:** selected for the external SDK. Production profile integration and any already-approved validation changes may still be outstanding.
- **Recommend for authors:** useful when implementing an ordinary plugin or provider. These are recommendations, not an approved export list.
- **Application setup:** needed to construct or connect application infrastructure. Preserve access for application code, but do not automatically expose these through the external runtime profile.
- **Needs a decision:** useful functionality whose public boundary or lifetime needs review.

Type exports matter too. A public callback or returned object can expose more operations than the top-level export list suggests. Excluding a TypeScript type does not revoke access to an object already supplied at runtime. This review is a compatibility proposal, not a security boundary.

## 1. Plugin contracts and Svelte presentations

Current sources: [`plugins/index.ts`](../../packages-js/plugins/index.ts) and [`plugins/svelte.ts`](../../packages-js/plugins/svelte.ts).

| Current export                                                                                          | Recommendation                                                                                         | Why authors need it                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definePluginApi`, `PluginApi`, `PluginApiIdentity`                                                     | Approved for authors.                                                                                  | Define shared, typed provider contracts identified by API ID and major.                                                                                                 |
| `Dispose`, `PluginApiConnection`                                                                        | Approved for authors.                                                                                  | Release resources and bind provider-created resources to a consumer connection.                                                                                         |
| `PluginApis`, `PluginContext`, `PluginCapability`                                                       | Author-facing roles; update their shapes for the approved external contract before finalizing exports. | Describe activation services, declared dependencies and contribution capabilities.                                                                                      |
| `ToolbarContribution`, `ViewContribution`, `PluginContributions`                                        | Author-facing roles; apply the approved ownership and identity rules.                                  | Describe UI contributions registered during activation.                                                                                                                 |
| `CommandContribution`                                                                                   | Do not freeze its current shape as the external contract.                                              | It currently exposes a synchronous boolean callback. The approved [shared command design](command-contract.md) adds typed arguments/results, awaiting and cancellation. |
| `defineSveltePresentation`, `SveltePresentation`, `SvelteToolbarContribution`, `SvelteViewContribution` | Approved for authors.                                                                                  | Describe ordinary Svelte UI and type-check the props supplied to it.                                                                                                    |
| `SveltePluginContext`                                                                                   | Author-facing role; align it with the external activation context.                                     | Type Svelte feature activation without exposing application registries.                                                                                                 |
| `PluginManifest`, `PluginDependency`, `BundledPlugin`, `SveltePlugin`                                   | Keep current bundled descriptors separate from the external manifest and entry-module contract.        | Current bundled definitions combine an in-memory manifest with activation. External packages use `manifest.toml` and a named activation export.                         |
| `ContributionRegistry`, `PluginRegistries`, `SveltePluginRegistries`                                    | Application setup.                                                                                     | Adapt feature registrations to application-owned registries.                                                                                                            |
| `PluginManagementService`, `PluginInfo`, `PluginStatus`, `PluginError`, `ContributionKind`              | Application management contracts; do not include automatically in the initial author list.             | Current consumers include the application plugin manager. A future plugin-management feature API would need its own approved contract.                                  |

**Approved first export group:** expose `definePluginApi`, `PluginApi<T>`, `PluginApiIdentity`, `Dispose` and `PluginApiConnection` from `@writers-ide/plugins`. The first three define typed contract identities, not implementations. `Dispose` describes a cleanup function. The host supplies `PluginApiConnection` to a provider factory for a particular consumer connection. Its current contract includes `consumerId`, `signal`, `own`, `reportError` and `guard`. Providers can bind subscriptions and work to that connection without ending unrelated consumers. Early-release cleanup handles are idempotent. The approved API ID byte limit still needs implementation. This approval does not finalize the activation context, other export groups or application setup entry points.

**Approved Svelte UI export group:** expose `defineSveltePresentation`, `SveltePresentation`, `SvelteToolbarContribution` and `SvelteViewContribution` from `@writers-ide/plugins/svelte`. Authors supply ordinary Svelte components and explicit props. The helper type-checks those props and creates a descriptor; it does not mount UI. During activation, authors register descriptors through the host-supplied contribution APIs. The workbench controls placement, rendering and removal. Toolbar orientations can use different components. Registering a view presentation does not open a tab. This approval excludes activation-context types and application registries. It does not add DOM isolation or access to another plugin's UI through the supported contribution API.

The actual `PluginHost` class is in application source, not an export of `@writers-ide/plugins`. Moving it to a new public entry point is not required by this review.

**Representative consumers:** [`plugin-host.ts`](../../src/lib/plugins/plugin-host.ts), [`application-plugin-host.ts`](../../src/lib/plugins/application-plugin-host.ts), [`PluginManager.svelte`](../../src/lib/plugins/PluginManager.svelte), and [`Basic Menu`](../../src/lib/editor/prosemirror/menu/basic/menu.ts).

The external activation context, shared command helpers, native-service types, locale API and project connections include planned contracts not exported today. Their names and signatures must follow their approved designs and remaining reviews. Do not present them as existing exports merely by adding them to this inventory.

## 2. Word-processing extensions

Current sources: [`word-processing/index.ts`](../../packages-js/word-processing/index.ts), [`contracts.ts`](../../packages-js/word-processing/src/contracts.ts), and [`word-processing/svelte.ts`](../../packages-js/word-processing/svelte.ts).

### Approved consumer group and remaining recommendations

**Approved consumer exports from `@writers-ide/word-processing`:** `wordProcessingApi`, `WordProcessingApi`, `EditorTarget`, `EditorSnapshot`, `WordProcessingSnapshot`, `EditorContext`, `EditorReadOptions`, `EditorEditOptions`, `EditorResult` and `EditorFailureReason`. These are the provider-contract, observation/target and edit/result rows below. The behavior and renderer export groups are also approved below. The editor-command export group is also approved below.

The consumer API supplies observations and synchronous callbacks for inspection and transaction building. Validate targets and revisions before applying edits. Do not retain callback editor objects or unfinished transactions across asynchronous work or cooperative yields. Raw ProseMirror access remains trusted; these checks do not prevent direct operations outside the provider's supported editing path.

This is a ProseMirror-specific provider contract, not a generic plugin-host requirement. Another editing engine may publish its own typed provider API and consumers may request it through declared dependency aliases. This does not automatically replace the existing editor or establish a shared document model between engines; those integrations need separate design. Service construction and application source wiring are outside this export approval.

| Export group             | Exact current symbols                                                                                                                 | What it enables                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Provider contract        | `wordProcessingApi`, `WordProcessingApi`                                                                                              | Connect to the existing editor provider through a declared dependency.                                     |
| Observations and targets | `EditorTarget`, `EditorSnapshot`, `WordProcessingSnapshot`, `EditorContext`                                                           | Observe available views and inspect a specific editor revision in a synchronous callback.                  |
| Edits and results        | `EditorReadOptions`, `EditorEditOptions`, `EditorFailureReason`, `EditorResult`                                                       | Build edits and handle stale, unavailable, cancelled or otherwise rejected operations.                     |
| Editor commands          | `EditorCommandRegistration`, `EditorCommandSnapshot`                                                                                  | Register and invoke synchronous ProseMirror commands. These are distinct from shared application commands. |
| Behaviors                | `EditorBehaviorContext`, `EditorBehaviorRegistration`, `EditorBehaviorSnapshot`                                                       | Install editor plugins with per-view creation and lifecycle ownership.                                     |
| Renderers                | `EditorRendererContext`, `EditorNodeViewRegistration`, `EditorMarkViewRegistration`                                                   | Render existing schema types through managed node and mark views.                                          |
| Svelte view helpers      | `defineSvelteNodeView`, `defineSvelteMarkView`, `SvelteContentDOM`, `SvelteNodeViewProps`, `SvelteMarkViewProps`, `SvelteViewOptions` | Write renderer UI in Svelte while leaving editable document content under ProseMirror ownership.           |

**Approved editor-command exports from `@writers-ide/word-processing`:** `EditorCommandRegistration` and `EditorCommandSnapshot`. Retain the provider's synchronous editor registry alongside `runCommand()`. These support short ProseMirror editing operations, not the typed asynchronous shared application command protocol. Authors need clear guidance on when each applies. The [command selection guide](command-contract.md#choose-an-editor-command-or-an-application-command) explains direct execution, named editor registration, shared feature workflows and composition of the two APIs. This approval does not add upstream `prosemirror-commands` to the shared runtime profile or choose the implementation of project-owned editing commands. Production external-profile integration remains outstanding.

**Approved behavior exports from `@writers-ide/word-processing`:** `EditorBehaviorContext`, `EditorBehaviorRegistration` and `EditorBehaviorSnapshot`. Authors register supported ProseMirror behaviors through `WordProcessingApi.registerBehavior()`, not by directly reconfiguring editor views. The provider creates behavior instances separately for matching views and owns their installation and removal for the consumer connection's lifetime. Authors may supply plugin state, decorations and supported transaction/event hooks. Hooks requiring an immediate result remain synchronous. This behavior-group approval does not approve schema changes; renderer exports have their separate approval below. Large-document work must remain bounded or incremental; a decoration callback that scans the entire manuscript is not a recommended production pattern.

**Approved renderer exports:** expose `EditorRendererContext`, `EditorNodeViewRegistration` and `EditorMarkViewRegistration` from `@writers-ide/word-processing`. Expose `defineSvelteNodeView`, `defineSvelteMarkView`, `SvelteContentDOM`, `SvelteNodeViewProps`, `SvelteMarkViewProps` and `SvelteViewOptions` from `@writers-ide/word-processing/svelte`. Register views for existing schema types through the provider, which owns conflicts, removal and failure handling. Ordinary ProseMirror constructors remain supported; Svelte is optional. For editable Svelte views, keep one stable, unconditional content host empty of Svelte-rendered children and attach it with `use:contentDOM`. ProseMirror owns the editable subtree; Svelte owns the surrounding UI. This approval does not add schema types, redesign pagination or guarantee pagination support for arbitrary custom layouts. Production external-profile integration remains outstanding.

`Dispose` is also re-exported here today. Prefer documenting its canonical import from `@writers-ide/plugins`; retaining this convenience type alias is an export-list detail to review.

### Application setup candidates

- `createWordProcessingService` constructs a provider over supplied editor sources.
- `createWordProcessingConnection` creates a consumer-scoped facade over that service.
- `WordProcessingSources`, `WordProcessingService` and `EditorBehaviorFailure` describe source integration, service disposal and host error reporting.
- `WORD_PROCESSING_PLUGIN_ID` identifies the current bundled provider. External consumers use manifest package/component references and dependency aliases. Do not carry this constant into the external SDK without a specific use case.

These constructors do not grant access to the application's editor by themselves. Their classification is about responsibility, not power. A third-party feature that needs an independent editor service is a legitimate possible library use case. Review that use case before deciding whether to expose construction helpers through the shared profile or a separate library entry point.

The existing built-in provider uses these helpers in [`word-processing.svelte.ts`](../../src/lib/editor/prosemirror/word-processing.svelte.ts). It supplies editor sources and page-index normalization. Excluding setup helpers from the author profile must not become a reason to give official feature plugins private editing shortcuts. Public editing integrations must remain the same for official and third-party features.

**Other consumers:** [`formatting-service.svelte.ts`](../../src/lib/editor/prosemirror/menu/basic/formatting-service.svelte.ts), [`selection-highlight.ts`](../../src/lib/editor/prosemirror/behaviors/selection-highlight.ts), and the [word-processing guide](../../packages-js/word-processing/README.md).

## 3. Managed tasks and workers

Current sources: [`tasks/index.ts`](../../packages-js/tasks/index.ts), [`contracts.ts`](../../packages-js/tasks/src/contracts.ts), [`work-queue.svelte.ts`](../../packages-js/tasks/src/work-queue.svelte.ts), and [`tasks/worker.ts`](../../packages-js/tasks/worker.ts).

### Approved managed-task exports

Expose the following from `@writers-ide/tasks`:

- Task service and handles: `TaskService`, `TaskHandle`, `CooperativeTaskHandle`, `TaskOutcome`.
- Callback inputs and options: `TaskContext`, `TaskOptions`, `CooperativeTaskOptions`, `ForEachTaskOptions`, `AsyncTaskOptions`.
- Progress metadata: `WorkPriority`, `WorkProgress`, `WorkStatus`.

The host supplies an activation-owned task service through the activation context. Authors can run cooperative main-thread work, asynchronous operations and worker work without constructing their own scheduler. Each task returns a handle for results, progress and cancellation. The current `TaskService` also has `dispose()`; it disposes that service's tasks, not the shared queue. Exporting the service contract includes that operation unless a separate reviewed contract changes it.

Cooperative task callbacks must be short. `forEach()` can yield between items, not midway through a callback; `cooperative()` supplies explicit generator yield points. `async()` handles promise-based operations but does not offload CPU work. Authors supply task inputs; these helpers do not read the manuscript. The approval covers this managed-task export group, not scheduler construction or a final external worker-loading signature. Production profile integration remains outstanding.

### Approved worker-side exports

Expose `defineTaskWorker` and `TaskWorkerScope` from `@writers-ide/tasks/worker`. Authors implement one calculation over supplied input; the helper receives one request and sends a result or serialized error. It accepts synchronous or promise-based calculations and an optional result transfer-list callback. `TaskWorkerScope` is the structural message transport contract, useful for actual workers and test transports. Calculations do not receive the editor, DOM or activation context. Use a fresh worker for each invocation; cancellation terminates it.

The worker entry is bundled into each self-contained worker. It is not a window import-map entry and imports no Svelte runtime. Production verified-byte Blob loading still needs integration. The current `WorkerTaskOptions.createWorker` callback describes current library use, not the approved external selection contract below.

### Approved main-thread package-worker selection

**Approved contract; not implemented:** `context.tasks.worker()` selects a packaged worker with a `module` property accepting a `URL` object. Authors construct it relative to their calling frontend module, for example `new URL('./paragraph-lengths.worker.js', import.meta.url)`. Build tooling must preserve or rewrite the reference to the emitted prebuilt worker file.

The host validates that the URL identifies an allowed file in the caller activation's verified package snapshot. Reject foreign-snapshot, arbitrary filesystem and remote URLs; there is no unchecked fallback. Obtain verified bytes, create a fresh Blob worker, send the supplied task input and return the existing task handle. Cleanup terminates the worker and revokes its Blob URL on completion, failure or cancellation, including loading/startup failures.

The external API uses `module: URL`, not a caller-provided `createWorker()` factory. This approval does not remove the current construction callback from standalone library/test use or choose a separate entry-point name. It does not change self-contained worker bundles or add a main-window mapping for worker-side helpers. Remaining option/type integration must preserve approved task ownership, transfer and cancellation policies.

### Approved advanced queue and service exports

Expose `WorkQueue`, `WorkOptions`, `WorkHandle`, `createTaskService`, `TaskServiceOptions` and `TaskFailure` from `@writers-ide/tasks` as advanced author APIs. They remain reusable for independent hosts and tests too. This adds construction tools alongside the managed API; it does not replace or change `context.tasks`.

Use `context.tasks` for ordinary plugin work. Construct an independent queue only when intentionally building a separate scheduling system, such as an embedded tool reused in other applications. A private queue does not participate in the application's shared scheduling budget or automatically inherit activation cleanup. It still runs cooperative callbacks on the main thread and must keep them short.

Authors must supply cancellation, cleanup and error reporting for independently constructed services. Bind a service to the activation signal and own its disposal. Managed services acquire queue scheduling leases automatically. Raw queue users acquire/release their own leases and cancel owned jobs; releasing the last lease only suspends work. See [advanced queue ownership](../../packages-js/tasks/README.md#advanced-use-create-an-independent-queue) for a complete example. Production external-profile integration remains outstanding.

**Representative consumers:** [`plugin-host.ts`](../../src/lib/plugins/plugin-host.ts), the [task library guide](../../packages-js/tasks/README.md#host-integration), [`TasksFixture.svelte`](../../e2e/fixtures/tasks/TasksFixture.svelte), and [`uppercase.worker.ts`](../../e2e/fixtures/word-processing/uppercase.worker.ts).

## 4. Optional UI components

Current root exports: [`components/index.ts`](../../packages-js/components/index.ts).

**Approved ordinary UI exports:** expose `IconButton`, `Tooltip` and the `TooltipData` type from `@writers-ide/components`. These are optional controls. Basic Menu already imports them directly. Authors supply labels, icons and action callbacks; these controls contain no formatting rules or native authority.

Support rich tooltip content through Svelte snippets, including author-supplied components. The current general-purpose component wraps trigger content and accepts a named `tooltip` snippet, with explicit target association where needed. `IconButton` includes its tooltip and uses its label when no custom tooltip is supplied. Interactive controls need a separately designed popover/focus contract rather than ordinary tooltip behavior. This export approval does not rename props or introduce a parent-inference API.

**Approved future direction:** expand the optional shared library with selects, comboboxes, virtual lists and other reusable controls. Their APIs, accessibility, focus/keyboard behavior, data contracts and performance need separate review. Do not treat these unimplemented controls as current exports or Part 4 prerequisites. See the [future-work list](implementation-plan.md#deferred-work-and-future-candidates).

**Approved presentation context; production external integration outstanding:** the host supplies shared tooltip context to registered Svelte toolbar and workspace-view presentations. The host owns the manager, renderer, overlay placement/stacking, docking suppression and their lifetime. Normal plugin controls supply content and labels without creating a manager or mounting an extra renderer. Presentation mounting must preserve this context using the shared components module instance.

Explicitly owned local tooltip scopes remain allowed for independent UI trees, subject to reviewing their author-facing exports. A separately mounted Svelte root does not inherit host context merely through DOM placement. This approval does not extend that guarantee to arbitrary roots or separately mounted editor node/mark views. Their context integration needs its own review.

The advanced exports still need review of their full public surface and local ownership: `TooltipProvider`, `TooltipState`, `Pointer`, `getTooltipManager` and `provideTooltipManager`.

They can be useful for plugin-owned UI trees, previews and custom controls. They are not inherently application-only. However, exporting them commits to more than a small constructor:

- `TooltipState` exposes mutable tooltip and DOM state, its debouncer, timing fields and positioning methods. Review that full reachable surface before approving it as an author contract.
- Tooltip controls need either an explicit manager or a provider in their Svelte context. The context key comes from a shared module instance. Duplicating the components package can break context lookup.
- The current application provides a manager around the editor and renders one pointer separately. It suppresses that manager during docking. The external presentation context and suppression contract is approved above; production external integration still needs implementation and tests.
- A new Svelte root does not inherit context merely because it is mounted inside the same DOM subtree.
- Providers and controls select their manager during initialization. Changing a manager prop later does not switch their context lifetime.
- A pointer clears its manager when it unmounts. Mounting an extra pointer over a shared manager can interfere with other controls.

**Remaining review:** advanced tooltip composition is separate from the approved ordinary controls. Preserve the approved host tooltip context while reviewing advanced composition. Do not freeze the entire `TooltipState` class without reviewing its public surface and ownership. Hiding the class's exported name alone would not remove it from component props that still accept the class.

**Evidence:** [`Tooltip.svelte`](../../packages-js/components/src/Tooltip.svelte), [`TooltipProvider.svelte`](../../packages-js/components/src/TooltipProvider.svelte), [`tooltip-context.ts`](../../packages-js/components/src/tooltip-context.ts), [`tooltip-state.svelte.ts`](../../packages-js/components/src/tooltip-state.svelte.ts), [`+page.svelte`](../../src/routes/+page.svelte), and [`Snippets.svelte`](../../src/lib/editor/prosemirror/menu/basic/Snippets.svelte).

## 5. Layout library

`@writers-ide/layout` is already a reusable library with explicit construction dependencies. That does not make it an API for changing the application's workbench.

Its exports include `createWorkbench`, `BarItemRegistry`, `BarItems`, `HorizontalBarState`, `VerticalBarState`, `FloaterBarState`, `BarTransferHandler`, `LayoutServices`, `DockDraggable`, `DockTarget`, `getDockColor` and their supporting types. It also exposes `@writers-ide/layout/dock-colors.css`.

A plugin could use these to build an independent storyboard or research workspace. That workspace would need its own rendering, drag context, geometry, focus policy and cleanup. Sharing the library does not supply the application's workbench instance. The drag components also depend on `@dnd-kit-svelte/core`, which needs its own runtime/context review.

**Recommendation:** leave layout outside the initial shared profile pending a separate decision. Retain its reusable-library role. The feature contribution APIs remain the supported way to add toolbars to the application's workspace. No final layout-distribution or private-bundling policy is selected here.

**Evidence:** [`layout/index.ts`](../../packages-js/layout/index.ts), [`layout/package.json`](../../packages-js/layout/package.json), [`application workbench setup`](../../src/lib/editor/state/workbench.svelte.ts), [`Editor.svelte`](../../src/lib/editor/Editor.svelte), and [`independent-workbench tests`](../../src/lib/testing/layout-library.svelte.test.ts). See the [layout context](../dnd/context.md) for the library's contracts.

## Review sequence

1. Review the proposed contract, editor and Svelte-adapter export groups. Current bundled descriptors must not be mistaken for the external manifest API.
2. Preserve the approved advanced task-construction exports alongside the recommended managed service. Keep their queue ownership and cleanup guidance current.
3. Review the ordinary UI exports and advanced tooltip composition under the approved host-context contract. Local manager ownership and the full class surface still need review.
4. Decide layout's shared-profile inclusion separately from access to the host workbench.
5. Approve exact entry-point names after these boundaries are settled. No `/host` paths are approved by this document.

The audit used source, export-map and consumer inspection. It did not run tests, change runtime code, or verify production profile artifacts. Existing tests cited here show intended coverage, not new passing results.
