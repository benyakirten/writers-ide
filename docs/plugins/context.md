# Plugins, reusable libraries, and core responsibilities

## Status and scope

This topic distinguishes plugins, reusable libraries, and the application core. **Stage 1 merged in [#80](https://github.com/benyakirten/writers-ide/pull/80) on 2026-11-14. Stage 2 is implemented in the `main` working tree (unmerged; no new branch or PR). Stage 3 remains planned.** Stage 2 adds private layout/component libraries and a host-owned plugin manager, not a sandbox or published SDK. Public API stabilization, broader extraction, isolation mechanisms, and storage designs remain open and require owner approval.

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
- A **capability** is authority exposed and enforced by the host, such as observing formatting state or editing authorized content. Contributing UI does not automatically grant access to manuscript text or project data.
- A **ProseMirror plugin** is an editor implementation mechanism, not an application-plugin identity or security boundary. An application plugin may use several ProseMirror plugins or none; unrestricted ProseMirror hooks are not automatically safe external APIs.

## Responsibility boundaries

The accepted direction is a small core with word processing, formatting bars, and other feature views implemented as plugins. Built-in features must use the same extension APIs offered to third parties, without feature-only privileged shortcuts. Exact extraction boundaries remain open.

The core hosts contributions and enforces their contracts. Its responsibilities include workspace layout infrastructure, internationalization, import/export infrastructure, and safe access to platform and project services. Features contribute their own behavior and presentation rather than directly mutating host internals.

For example, a formatting toolbar contributes horizontal and vertical presentations, observes formatting summaries, and invokes commands. The workbench owns docking, capacity checks, placement, and focus routing. Moving the toolbar is not the toolbar's responsibility; feature state must not depend solely on a presentation instance surviving relocation.

### Libraries underneath these boundaries

The Stage 2 `@writers-ide/layout` library implements registry, capacity, transfer, floater, and drag primitives without manuscript, ProseMirror, or application-singleton dependencies. Explicit dependency injection supports independent workbenches. Writer's IDE retains compatibility state facades, feature rendering, and `Editor.svelte` DnD composition as application adapters.

Libraries should not import Writer's IDE application singletons or assume access to its project state. Framework-specific libraries are valid: a Svelte library need not acquire a framework-independent abstraction without a real use case. Extract cohesive functionality rather than creating a package for every utility or thin dependency wrapper.

## Accepted implementation stages

The owner approved the following sequence. Stages 1 and 2 support trusted, bundled plugins only; arbitrary third-party code must not be loaded before Stage 3 isolation and enforcement are implemented. These stages are not release dates or claims of completed work.

### Stage 1 — Contracts, host, and formatting plugin

**Merged in #80:** contracts, bundled lifecycle host, registry/rendering adapters, and the formatting toolbar migration; see the contracts below.

- Create a private workspace package for plugin identity, API compatibility, lifecycle, contribution contracts for toolbar items, commands and central views, and narrow formatting-state/command interfaces.
- Keep data and command contracts independent of Svelte and ProseMirror; place Svelte presentation types in a separate adapter entry point.
- Implement explicit bundled-plugin registration, contribution ownership, duplicate-ID validation, activation-failure rollback, and deactivation cleanup of contributions and subscriptions.
- Migrate the basic formatting toolbar to formatting summaries and validated commands instead of raw editor views, selections, documents, or mutable workspace references. Preserve horizontal/vertical presentations, capacity rules, formatting behavior, and docking behavior.
- Keep the existing ProseMirror editor behind the formatting service initially. Do not simultaneously extract the whole word processor or redesign pagination.
- Test lifecycle/cleanup and existing formatting behavior.

### Stage 2 — Reusable libraries and plugin management UI

**Current `main` working tree / unmerged:** the scoped libraries and manager below are connected in source. Validation results and known limits are recorded in the current changelog entry. No new PR exists yet.

- Extract cohesive docking/workbench infrastructure into `packages-js/layout`, removing ProseMirror and application-singleton dependencies from the reusable layer.
- Extract the UI components and service pieces needed by the formatting plugin into `packages-js/components`, with explicit dependencies. Keep packages private to the workspace initially; publication and stable public-package APIs are not part of this stage.
- Leave scheduling, shortcut handling, and editing-helper extraction until a demonstrated consumer justifies it.
- Add a user-facing plugin-management view backed by the host's public management API. Distinguish this UI from the developer-facing plugin API.
- List bundled plugins with descriptions, versions, enabled/disabled/failed states, declared capabilities and contributions, and actionable activation errors. Allow enabling/disabling optional plugins.
- Clearly identify bundled plugins as trusted. Capability declarations and narrow interfaces do not sandbox in-process JavaScript. Do not offer installation from files or URLs yet.
- Disabling a plugin removes its active contributions, not its saved data. Keep the management shell host-owned so a failing plugin cannot prevent users from disabling it.

### Stage 3 — Isolated third-party plugins

- Approve and implement frontend isolation, messaging, runtime validation, permission enforcement, and isolated UI contributions before enabling external installation/loading.
- Define external-package validation and compatibility checks. Add permission review, revocation, and failure handling to the plugin manager.
- Test that plugins cannot bypass granted access, including through dependencies or ambient browser/native facilities.

Defer the implementation of isolation, not its architectural constraints. From Stage 1, use transferable data, scoped IDs, and explicit requests at the data/command boundary. Direct Svelte component registration is a trusted rendering adapter, not the universal external-plugin interface. The eventual built-in and third-party feature APIs must converge on the accepted shared extension contracts; trusted adapters must not establish feature-only privileged shortcuts.

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

Packaging is not isolation. Current in-process components and imported libraries execute with the authority of their execution environment. Third-party dependencies running inside an isolated plugin must not become a route around that boundary.

Plugin APIs should expose versioned data or scoped handles and validated requests, not mutable references to application singletons or unrestricted editor views. Permission enforcement belongs to the host; TypeScript types and declared capabilities alone do not enforce it. Filesystem, network, shell, native execution, and unrelated project data are not ambient plugin privileges.

Schema-owning features require versioning and missing-plugin preservation contracts before extraction. Removing a toolbar is different from removing the implementation of saved content. Preserve plugin-owned data when a plugin is disabled or unavailable; basic preservation must not require executing it.

## Current contracts and limitations

- `@writers-ide/plugins` is a private, source-exported workspace package. Root contracts have no framework/editor imports; the `/svelte` entry describes trusted component presentations. API compatibility currently means exact `apiVersion: 1`, not a version-range negotiation scheme. See the [package reference](../../packages-js/plugins/README.md).
- The synchronous bundled host explicitly registers, activates, deactivates, and reports metadata/errors for plugins. It checks manifest/capability declarations and contribution IDs, rolls back failed activation, aborts/revokes a context before reverse-order cleanup, and continues cleanup after disposer failures. Contributions, formatting subscriptions, and `own()` resources are activation-owned; retained commands cannot act after deactivation or a later reactivation.
- These checks govern host API use, not ambient JavaScript authority. Only trusted bundled plugins execute. There is no external loader, sandbox, user-grant UI, package discovery, or persistent activation preference.
- Stage 2 exposes `PluginManagementService` (`list`, `subscribe`, `activate`, `deactivate`) with reactive frozen snapshots. The host-owned `PluginManager.svelte` accepts `management` and optional `requiredPluginIds`; it lists metadata, lifecycle status, declared capabilities, active contributions, and activation/cleanup errors, with enable/disable/retry actions and a bundled-trusted warning. The route owns its native `<dialog>` and passes `onplugins` through `Editor` to the Plugins button in `HorizontalBaseBar`, explicitly restoring launcher focus on close for keyboard and pointer use. This adds no installation workflow or new plugin i18n contract.
- Trusted presentations have a local Svelte boundary with a fallback for rendering/effect failures, leaving the host-owned manager available for disable/re-enable. Shared tooltip snippets have their own local boundary because they render outside the plugin view; replacing the descriptor/content or dismissing the tooltip allows recovery. This is presentation-error containment, not protection from arbitrary JavaScript errors, event-handler failures, malicious code, or ambient host access.
- Stage 2 `@writers-ide/components` exports `TooltipState`, `TooltipProvider`, `IconButton`, `Tooltip`, and `Pointer` with explicit state/context dependencies and no application singleton. Legacy app wrappers share the application tooltip manager; the route wraps `Editor` with that manager and `renderPointer={false}` because the app still renders its pointer. Drag suppression uses the same manager.
- The application adapts toolbar/view contributions to existing registries and command contributions to host-owned command handles. The trusted Svelte adapter supplies only the scoped plugin context, not legacy workspace/editor props. Central-view instance metadata and contributed shortcut routing are not implemented. The built-in word processor still uses the legacy path; its extraction is intentionally deferred.
- Formatting delivers immediate, copied, data-only snapshots: view ID, monotonic revision, mark/block ratios, and command availability. Requests specify view ID, revision, and command. The service validates live active view/state/editability, rejecting stale requests even before a reactive flush; tab document IDs are resolved to distinct registered view IDs. Existing caret mark no-ops, superscript/subscript exclusion, and continuation-aware paragraph commands are preserved. Unavailable/no-op controls are disabled.
- Formatting subscriptions start the shared bridge lazily and release its bus/effect resources when unused. Availability queries inspect content without generating speculative transactions. Peer grouping must safely traverse page boundaries, final leaf blocks and document-end selections; errors in this query can otherwise escape a ProseMirror update before subscriber notification. Update-listener failures are reported without interrupting other subscribers or editor dispatch. No rich-text content or mutable editor reference crosses the formatting boundary.
- Disabling a toolbar removes its presentation but retains placement IDs and declared orientation costs, avoiding overfill on re-enable. Missing-item placeholders remain, and reactivation restores the registered presentations. Registry `clear()` releases retained metadata. This is in-memory preservation, not durable layout or plugin-state storage.
- Relocation remounts formatting presentations against the same scoped service and current snapshot. No general arbitrary component-local-state transfer, custom schema lifecycle, or durable project history is introduced.

## Source and test entry points

These are private, evolving contracts and internal discovery points, not a stable published SDK:

- `packages-js/plugins/index.ts`, `svelte.ts`, and [README](../../packages-js/plugins/README.md): data/lifecycle contracts, trusted presentation descriptor, API reference.
- `src/lib/plugins/plugin-host.ts`: lifecycle, ownership, revocation, rollback, and reactive management; `plugin-host.test.ts` covers those contracts.
- `src/lib/plugins/PluginManager.svelte`, `PluginManager.svelte.test.ts`: host-owned management panel and service/action failures. `PluginPresentation.svelte` and `plugin-presentation.svelte.test.ts`: local presentation-failure fallback and recovery.
- `src/lib/plugins/application-plugin-host.ts`, `PluginPresentation.svelte`: application registry adapters and restricted-prop rendering; `application-plugin-host.svelte.test.ts` covers collisions, rendering, ownership, disable/re-enable and capacity preservation.
- `src/lib/plugins/formatting-service.svelte.ts`: scoped active-editor bridge; `formatting-service.svelte.test.ts` covers stale requests, separate tab/view IDs, summaries, availability, peer paragraphs, subscription cleanup, and quiet queries.
- `src/routes/+page.svelte`: explicitly registers/activates the bundled formatting plugin and deactivates it on teardown; still directly registers the ProseMirror view.
- `src/lib/editor/prosemirror/menu/basic/`: formatting plugin definition and snapshot/command-only presentations; `menu.test.ts` covers both orientations and command routing.
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
- Frontend isolation, messaging, and permission enforcement mechanisms.
- Document/view ownership and command contracts, schema evolution, and content preservation.
- History scope, granularity, branch/navigation semantics, collaboration, persistence, and retention.

This document establishes vocabulary, responsibility boundaries, and the approved implementation sequence, not a complete API specification. Stage 1 is merged and the described Stage 2 behavior is working-tree implementation; candidate examples outside the approved scope do not authorize additional source migrations or imply runtime guarantees.
