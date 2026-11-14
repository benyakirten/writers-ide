# Plugins, reusable libraries, and core responsibilities

## Status and scope

This topic establishes the conceptual distinction between plugins, reusable libraries, and the application core. It does not implement a plugin runtime or approve package extractions. Concrete package boundaries, public APIs, isolation mechanisms, and storage designs remain open and require owner approval before implementation.

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

A reusable docking library could implement layout and transfer mechanics without knowing about manuscripts or formatting commands. Writer's IDE would integrate it into the core and supply feature content and application policies. The same library could support another application's toolbars.

Libraries should not import Writer's IDE application singletons or assume access to its project state. Framework-specific libraries are valid: a Svelte library need not acquire a framework-independent abstraction without a real use case. Extract cohesive functionality rather than creating a package for every utility or thin dependency wrapper.

## Examples and candidate boundaries

These examples guide discussion; they are not approved extraction tasks or a publication roadmap.

| Area                   | Likely responsibility                                                                            | Possible library reuse / constraint                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting toolbar     | Feature plugin contributing bar presentations and invoking formatting commands.                  | Optional shared UI components; toolbar need not own editing semantics.                                                                                                             |
| Word-processing view   | Feature plugin hosted in a central-view container.                                               | ProseMirror editing helpers where schema assumptions are explicit. Current editor assembly remains coupled.                                                                        |
| Workbench docking      | Core workspace service used by plugin contributions.                                             | Strong candidate for a reusable Svelte docking/workbench library, separated from application state. See [DnD context](../dnd/context.md).                                          |
| UI foundations         | Shared presentation services and optional plugin-facing components.                              | Candidate component library with explicit styling and service dependencies; do not duplicate upstream libraries without added value.                                               |
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

## Current implementation and source entry points

These paths are internal discovery points, not stable public APIs:

- `src/routes/+page.svelte`: manually registers the basic menu and ProseMirror view.
- `src/lib/editor/prosemirror/menu/basic/`: current orientation-specific formatting presentations and shared snippets.
- `src/lib/editor/state/bar-item-registry.svelte.ts` and `tab-state-registry.svelte.ts`: trusted in-process contribution registries.
- `src/lib/editor/state/shared.types.ts`: broad injected component props, including mutable workspace/editor services; not a restricted capability contract.
- `src/lib/editor/prosemirror/plugins.svelte.ts` and `view/editor.ts`: ProseMirror factory registration and editor construction, not an external plugin lifecycle.
- `src/lib/editor/bars/`, `src/lib/dnd/`, and bar/floater/transfer state: current application-coupled docking implementation.
- `src/lib/editor/state/work-queue.svelte.ts`: cooperative scheduling with progress, priorities, and cancellation.
- `src/lib/components/` and `src/lib/services/`: UI components and shared services to evaluate for reuse.
- `packages-js/components/` and `packages-js/layout/`: manifest/license scaffolds, not extracted implementations. `pnpm-workspace.yaml` currently includes only the root package.

## Open implementation decisions

- Exact package boundaries, names, publication strategy, and dependency rules.
- Plugin manifests, lifecycle, compatibility, contribution ownership, and capability grants.
- Frontend isolation, messaging, and permission enforcement mechanisms.
- Document/view ownership and command contracts, schema evolution, and content preservation.
- History scope, granularity, branch/navigation semantics, collaboration, persistence, and retention.

This document establishes vocabulary and responsibility boundaries, not a complete API specification. No source migration or runtime guarantee follows from documenting a candidate.
