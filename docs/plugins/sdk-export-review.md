# Plugin SDK export review

This review proposes which Writer's IDE library exports external plugin authors should receive. It is based on the current package entry points and their application, feature and test consumers. It does not change any exports or approve new APIs.

The approved direction is an explicit author-facing SDK. Application setup APIs remain separate. Shared Svelte modules and the four foundational ProseMirror packages have their own approved inventory in the [runtime profile proposal](package-api-proposal.md#candidate-runtime-profile-inventory).

## How to read this proposal

- **Recommend for authors:** useful when implementing an ordinary plugin or provider. These are recommendations, not an approved export list.
- **Application setup:** needed to construct or connect application infrastructure. Preserve access for application code, but do not automatically expose these through the external runtime profile.
- **Needs a decision:** useful functionality whose public boundary or lifetime needs review.

Type exports matter too. A public callback or returned object can expose more operations than the top-level export list suggests. Excluding a TypeScript type does not revoke access to an object already supplied at runtime. This review is a compatibility proposal, not a security boundary.

## 1. Plugin contracts and Svelte presentations

Current sources: [`plugins/index.ts`](../../packages-js/plugins/index.ts) and [`plugins/svelte.ts`](../../packages-js/plugins/svelte.ts).

| Current export                                                                                          | Recommendation                                                                                         | Why authors need it                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definePluginApi`, `PluginApi`, `PluginApiIdentity`                                                     | Recommend for authors.                                                                                 | Define shared, typed provider contracts identified by API ID and major.                                                                                                 |
| `Dispose`, `PluginApiConnection`                                                                        | Recommend for authors.                                                                                 | Release resources and bind provider-created resources to a consumer connection.                                                                                         |
| `PluginApis`, `PluginContext`, `PluginCapability`                                                       | Author-facing roles; update their shapes for the approved external contract before finalizing exports. | Describe activation services, declared dependencies and contribution capabilities.                                                                                      |
| `ToolbarContribution`, `ViewContribution`, `PluginContributions`                                        | Author-facing roles; apply the approved ownership and identity rules.                                  | Describe UI contributions registered during activation.                                                                                                                 |
| `CommandContribution`                                                                                   | Do not freeze its current shape as the external contract.                                              | It currently exposes a synchronous boolean callback. The approved [shared command design](command-contract.md) adds typed arguments/results, awaiting and cancellation. |
| `defineSveltePresentation`, `SveltePresentation`, `SvelteToolbarContribution`, `SvelteViewContribution` | Recommend for authors.                                                                                 | Describe ordinary Svelte UI and type-check the props supplied to it.                                                                                                    |
| `SveltePluginContext`                                                                                   | Author-facing role; align it with the external activation context.                                     | Type Svelte feature activation without exposing application registries.                                                                                                 |
| `PluginManifest`, `PluginDependency`, `BundledPlugin`, `SveltePlugin`                                   | Keep current bundled descriptors separate from the external manifest and entry-module contract.        | Current bundled definitions combine an in-memory manifest with activation. External packages use `manifest.toml` and a named activation export.                         |
| `ContributionRegistry`, `PluginRegistries`, `SveltePluginRegistries`                                    | Application setup.                                                                                     | Adapt feature registrations to application-owned registries.                                                                                                            |
| `PluginManagementService`, `PluginInfo`, `PluginStatus`, `PluginError`, `ContributionKind`              | Application management contracts; do not include automatically in the initial author list.             | Current consumers include the application plugin manager. A future plugin-management feature API would need its own approved contract.                                  |

The actual `PluginHost` class is in application source, not an export of `@writers-ide/plugins`. Moving it to a new public entry point is not required by this review.

**Representative consumers:** [`plugin-host.ts`](../../src/lib/plugins/plugin-host.ts), [`application-plugin-host.ts`](../../src/lib/plugins/application-plugin-host.ts), [`PluginManager.svelte`](../../src/lib/plugins/PluginManager.svelte), and [`Basic Menu`](../../src/lib/editor/prosemirror/menu/basic/menu.ts).

The external activation context, shared command helpers, native-service types, locale API and project connections include planned contracts not exported today. Their names and signatures must follow their approved designs and remaining reviews. Do not present them as existing exports merely by adding them to this inventory.

## 2. Word-processing extensions

Current sources: [`word-processing/index.ts`](../../packages-js/word-processing/index.ts), [`contracts.ts`](../../packages-js/word-processing/src/contracts.ts), and [`word-processing/svelte.ts`](../../packages-js/word-processing/svelte.ts).

### Recommend for authors

| Export group             | Exact current symbols                                                                                                                 | What it enables                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Provider contract        | `wordProcessingApi`, `WordProcessingApi`                                                                                              | Connect to the existing editor provider through a declared dependency.                                     |
| Observations and targets | `EditorTarget`, `EditorSnapshot`, `WordProcessingSnapshot`, `EditorContext`                                                           | Observe available views and inspect a specific editor revision in a synchronous callback.                  |
| Edits and results        | `EditorReadOptions`, `EditorEditOptions`, `EditorFailureReason`, `EditorResult`                                                       | Build edits and handle stale, unavailable, cancelled or otherwise rejected operations.                     |
| Editor commands          | `EditorCommandRegistration`, `EditorCommandSnapshot`                                                                                  | Register and invoke synchronous ProseMirror commands. These are distinct from shared application commands. |
| Behaviors                | `EditorBehaviorContext`, `EditorBehaviorRegistration`, `EditorBehaviorSnapshot`                                                       | Install editor plugins with per-view creation and lifecycle ownership.                                     |
| Renderers                | `EditorRendererContext`, `EditorNodeViewRegistration`, `EditorMarkViewRegistration`                                                   | Render existing schema types through managed node and mark views.                                          |
| Svelte view helpers      | `defineSvelteNodeView`, `defineSvelteMarkView`, `SvelteContentDOM`, `SvelteNodeViewProps`, `SvelteMarkViewProps`, `SvelteViewOptions` | Write renderer UI in Svelte while leaving editable document content under ProseMirror ownership.           |

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

### Recommend for authors

- Task service and handles: `TaskService`, `TaskHandle`, `CooperativeTaskHandle`, `TaskOutcome`.
- Callback inputs and options: `TaskContext`, `TaskOptions`, `CooperativeTaskOptions`, `ForEachTaskOptions`, `AsyncTaskOptions`, `WorkerTaskOptions`.
- Progress metadata: `WorkPriority`, `WorkProgress`, `WorkStatus`.
- Worker-only entry: `defineTaskWorker` and `TaskWorkerScope` from `@writers-ide/tasks/worker`.

The host supplies an activation-owned task service through the activation context. Authors can run cooperative main-thread work, asynchronous operations and worker work without constructing their own scheduler. Each task returns a handle for results, progress and cancellation. The current `TaskService` also has `dispose()`; it disposes that service's tasks, not the shared queue. Exporting the service contract includes that operation unless a separate reviewed contract changes it.

The worker entry is bundled into each self-contained worker. It is not a window import-map entry and imports no Svelte runtime. The approved verified-byte Blob worker path still needs production integration. The current `WorkerTaskOptions.createWorker` callback does not by itself define that future package-worker loading API.

### Setup and separate-library candidates

`createTaskService`, `TaskServiceOptions` and `TaskFailure` currently describe service construction and host error reporting. `WorkQueue`, `WorkOptions` and `WorkHandle` expose the lower-level scheduler. The application uses one shared queue for pagination and plugin work.

Recommend keeping these out of the initial shared author profile. Preserve them as reusable library functionality for independent hosts and tests. If plugins need independent queues, review that as a separate supported use case. Constructing a private queue does not give it activation cleanup or make it participate in the host's shared scheduling budget.

**Representative consumers:** [`plugin-host.ts`](../../src/lib/plugins/plugin-host.ts), the [task library guide](../../packages-js/tasks/README.md#host-integration), [`TasksFixture.svelte`](../../e2e/fixtures/tasks/TasksFixture.svelte), and [`uppercase.worker.ts`](../../e2e/fixtures/word-processing/uppercase.worker.ts).

## 4. Optional UI components

Current root exports: [`components/index.ts`](../../packages-js/components/index.ts).

Recommend `IconButton`, `Tooltip` and the `TooltipData` type as the ordinary author-facing controls. Basic Menu already imports them directly. Authors supply their labels, icons and action callbacks; these controls contain no formatting rules or native authority.

The remaining exports need an ownership decision: `TooltipProvider`, `TooltipState`, `Pointer`, `getTooltipManager` and `provideTooltipManager`.

They can be useful for plugin-owned UI trees, previews and custom controls. They are not inherently application-only. However, exporting them commits to more than a small constructor:

- `TooltipState` exposes mutable tooltip and DOM state, its debouncer, timing fields and positioning methods. Review that full reachable surface before approving it as an author contract.
- Tooltip controls need either an explicit manager or a provider in their Svelte context. The context key comes from a shared module instance. Duplicating the components package can break context lookup.
- The current application provides a manager around the editor and renders one pointer separately. It suppresses that manager during docking. External presentation context and suppression guarantees still need explicit review.
- A new Svelte root does not inherit context merely because it is mounted inside the same DOM subtree.
- Providers and controls select their manager during initialization. Changing a manager prop later does not switch their context lifetime.
- A pointer clears its manager when it unmounts. Mounting an extra pointer over a shared manager can interfere with other controls.

**Recommendation:** approve ordinary controls separately from advanced tooltip composition. Do not promise host tooltip context or freeze the entire `TooltipState` class without reviewing ownership. Hiding the class's exported name alone would not remove it from component props that still accept the class.

**Evidence:** [`Tooltip.svelte`](../../packages-js/components/src/Tooltip.svelte), [`TooltipProvider.svelte`](../../packages-js/components/src/TooltipProvider.svelte), [`tooltip-context.ts`](../../packages-js/components/src/tooltip-context.ts), [`tooltip-state.svelte.ts`](../../packages-js/components/src/tooltip-state.svelte.ts), [`+page.svelte`](../../src/routes/+page.svelte), and [`Snippets.svelte`](../../src/lib/editor/prosemirror/menu/basic/Snippets.svelte).

## 5. Layout library

`@writers-ide/layout` is already a reusable library with explicit construction dependencies. That does not make it an API for changing the application's workbench.

Its exports include `createWorkbench`, `BarItemRegistry`, `BarItems`, `HorizontalBarState`, `VerticalBarState`, `FloaterBarState`, `BarTransferHandler`, `LayoutServices`, `DockDraggable`, `DockTarget`, `getDockColor` and their supporting types. It also exposes `@writers-ide/layout/dock-colors.css`.

A plugin could use these to build an independent storyboard or research workspace. That workspace would need its own rendering, drag context, geometry, focus policy and cleanup. Sharing the library does not supply the application's workbench instance. The drag components also depend on `@dnd-kit-svelte/core`, which needs its own runtime/context review.

**Recommendation:** leave layout outside the initial shared profile pending a separate decision. Retain its reusable-library role. The feature contribution APIs remain the supported way to add toolbars to the application's workspace. No final layout-distribution or private-bundling policy is selected here.

**Evidence:** [`layout/index.ts`](../../packages-js/layout/index.ts), [`layout/package.json`](../../packages-js/layout/package.json), [`application workbench setup`](../../src/lib/editor/state/workbench.svelte.ts), [`Editor.svelte`](../../src/lib/editor/Editor.svelte), and [`independent-workbench tests`](../../src/lib/testing/layout-library.svelte.test.ts). See the [layout context](../dnd/context.md) for the library's contracts.

## Review sequence

1. Review the proposed contract, editor and Svelte-adapter export groups. Current bundled descriptors must not be mistaken for the external manifest API.
2. Decide whether task construction and low-level scheduler exports belong only to separate library/setup use, or also to the author profile.
3. Decide tooltip composition and host context guarantees before approving the complete UI export list.
4. Decide layout's shared-profile inclusion separately from access to the host workbench.
5. Approve exact entry-point names after these boundaries are settled. No `/host` paths are approved by this document.

The audit used source, export-map and consumer inspection. It did not run tests, change runtime code, or verify production profile artifacts. Existing tests cited here show intended coverage, not new passing results.
