# Project context

Writer's IDE is a word processor with an extensible workspace. Writers can use rich-text documents, movable toolbars and multiple views of their work. Fiction authors are the first audience. Other writing uses are welcome.

This page is the starting point for contributors. It separates working code from planned features. Read the relevant topic guide before changing a subsystem.

## Status vocabulary and maintenance

The documentation uses four status labels:

- **Current:** implemented and connected to the application. This does not mean every use case has been tested.
- **Accepted direction:** approved by the owner, but not necessarily implemented.
- **Open:** still needs a decision.
- **Tentative priority:** a preference, not a release commitment.

Ask the owner before making an important architectural change. Approval of a long-term goal does not approve every migration needed to reach it.

For documentation updates:

1. Read this overview and the relevant topic's `context.md`.
2. Read only the history needed for the task.
3. Update the topic's description when its behavior changes.
4. Keep one entry per pull request (PR) in each affected `change-log.md`. Update that entry as the work develops.
5. Keep unmerged entries under **In progress**. Use the branch name until a PR is known.
6. After a confirmed merge, move the entry to **Merged PRs**. Use the verified PR link and merge date.

Write the explanation before merge. Do not use changelogs as session transcripts or repeated test logs. Preserve historical decisions as records of their time. Explain later changes in a new entry.

[AGENTS.md](../AGENTS.md) contains the full update rules. [CONTRIBUTING.md](../CONTRIBUTING.md) covers code style and validation. [docs.md](../docs.md) is the documentation index. GitHub issues provide ideas and history, not authoritative specifications.

## Topic index

| If you are working on…                                    | Read…                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Bars, floating toolbars and drag-and-drop                 | [Docking context](dnd/context.md) and [change log](dnd/change-log.md)                                                               |
| Pagination, footnotes, page geometry or shared scheduling | [Pagination context](pagination/context.md) and [change log](pagination/change-log.md)                                              |
| Plugins, public APIs or reusable packages                 | [Plugin context](plugins/context.md), [implementation plan](plugins/implementation-plan.md) and [change log](plugins/change-log.md) |
| Browser benchmarks or Storybook test fixtures             | [Browser-performance context](browser-performance/context.md) and [change log](browser-performance/change-log.md)                   |
| Toolchain upgrades or dependency checks                   | [Dependency guide](dependencies.md)                                                                                                 |
| Persistence, history, collaboration or conversion         | The sections below. Most of this work is still planned.                                                                             |

Use an existing topic for related work. New substantial topics need a context page and a changelog. Existing standalone guides can move into this structure when relevant work requires it.

## Product and principles

**Accepted direction:** essential writing workflows must run locally, offline and without an account. A project should remain usable without a cloud service.

A useful first release should let an author:

- Import existing work.
- Organize and write chapters.
- Prepare print and ebook versions.
- Export material for an editor.

Scrivener, Ulysses, Novlr, Word and Pages are references, not specifications to copy. This is a personal project with no fixed release deadline. Do not reduce the intended architecture merely to create an artificial minimal release.

The application and official features will remain free. There are no planned paid tiers or official paid-plugin marketplace. Cooperation and creativity guide the project.

This is not a restriction on commercial reuse. Preserve the MIT license and the freedom to fork, modify and redistribute the software.

Optional cloud integrations may be useful later. Collaboration should preferably connect users directly rather than require a central account service.

## Accepted technology and platform boundaries

The technology choices are settled:

- **Tauri** provides the desktop application and system integration.
- **Svelte 5** provides the user interface.
- **ProseMirror** provides the baseline rich-text document model and editing behaviors. The word-processing layer and plugins build on that baseline.
- **Rust** provides backend functionality.

Old exploratory issues do not reopen these choices.

The macOS minimum is **13.3 Ventura**. Tauri's configuration enforces this requirement. The application uses the operating system's browser engine, not a bundled engine version. Page layout may therefore differ between platforms.

Keep the application core small. It provides shared workspace, translation, import/export and plugin-hosting infrastructure. The accepted direction is to implement word processing and feature interfaces as plugins. Official and third-party features must use the same public extension APIs.

Reusable code should live in cohesive packages. Do not create a package for every small helper. Package publication and broader extraction still need decisions.

## Project and content model

### Accepted direction

A project is more than one manuscript. It may contain several books, chapters, scenes, character notes, research, media and plugin-defined data. Large media collections should load incrementally rather than force the whole project into memory.

Use ProseMirror for live rich-text content. Other views can operate on project organization and metadata. Do not translate the entire manuscript into another rich-text model after every edit.

Stored content will need versioning and migration rules. An import/export format may use a separate intermediate representation: a model used to convert between file formats rather than to edit the live document.

**Current pagination changes the ProseMirror document.** It stores page nodes and splits paragraphs across them. Keep this implementation working.

The future direction is to separate calculated page boundaries from authored content. Text, formatting and explicit page breaks would remain stored content. Calculated layout could differ between views. That redesign needs research, a prototype and owner approval. See [pagination context](pagination/context.md).

### Open storage decisions

No project content storage format has been selected. A directory, SQLite database, archive or combination could be appropriate.

SQLite is implemented separately for the internal host plugin-management registry, with owner approval. This foundation is unmerged and is not connected to application startup or management. That registry stores installation records, component choices, project permission associations and staged-update/recovery metadata. Package files remain in separate directories; activation credentials are not persisted. This does not select the project content or plugin-owned data format.

A project-scoped SQLite file/metadata index is also approved direction, not implemented. It stores no file contents and is not an authoritative application-document catalog. Filesystem notifications and periodic reconciliation maintain it; query pages must not retain native enumeration or database resources between requests. Subscribers receive coalesced invalidation after committed index updates. Queries may return cached/partial results with explicit status and revision. The [status shape](plugins/file-index-plan.md#approved-status-shape) is approved. Async `subscribeIndex()` with initial status delivery and paged `queryIndex()` are approved. The host maintains indexing while the project is open and combines reconciliation requests into one pending pass per running scan. Plugins cannot request scans initially. Store each computer's rebuildable index in application-managed local storage outside the project folder, separate from the host-management database. Exact local directory and schema are implementation details. Corrupt or incompatible index caches rebuild automatically, without changing project files, grants or host settings. Recovery reports status/diagnostics, does not serve unusable records and exposes partial replacement results as uninitialized until initialization succeeds. Failed rebuilds remain visible; retries are bounded. Timer, bounded scan/recovery mechanics and native integration remain open. See the [file-index plan](plugins/file-index-plan.md). Project content storage remains undecided.

The content-storage design must address stable IDs, assets, incremental loading, transactions, migrations and recovery. Do not describe a content format or history engine as chosen merely because it has been discussed.

## Workspace and extension UX

**Accepted direction:** use tabs and resizable split panes. Separate views should be able to scroll independently, including views of the same content. The exact default layout is still open.

Toolbars can sit at any edge of the workspace or float inside it. Plugins can supply central views and toolbar items. Both bars and individual items can move. A move must preserve their contents.

The [docking guide](dnd/context.md) explains the three-unit capacity model and current transfer rules. Layout undo, persistent placement and general component-state transfer are not implemented.

Possible future views include storyboards, sticky-note canvases, print layouts and reflowable ebook previews. Analysis features might identify narrative inconsistencies. These are ideas, not selected implementations. They do not imply an LLM or cloud dependency.

## Plugin safety and capability access

### Accepted requirements, not current guarantees

Frontend plugins are trusted code running in the application's JavaScript environment. They may use ordinary Svelte, supported ProseMirror APIs and external network requests.

Frontend DOM isolation is deferred. Plugins are not currently prevented from reaching the application's DOM. Public APIs describe supported integrations; they are not a security sandbox.

A plugin that can read manuscript text and make network requests can send that text elsewhere. Installation disclosures must state this risk. External installation and its review interface are not implemented.

Backend access must remain much more restrictive. Frontend trust must not imply unrestricted filesystem access, process execution, native libraries or Tauri IPC. IPC is the communication mechanism used to call the Rust side of a Tauri application. Narrow system APIs need actual enforcement and packaged-app tests before external loading is enabled.

**Approved direction, not implemented:** native services will attach private, host-issued activation tokens to requests. Rust will resolve the token's plugin/component identity and grants, validate each operation, and reject invalid or revoked credentials. Native calls made during synchronous activation setup wait behind an approved activation gate; Rust permits execution only after successful setup confirmation. Failure/revocation rejects pending calls. Rust-authorized pending activations with one-use, WebView-bound attachment tickets are approved for credential delivery. Redemption checks current authorization and rejects replay or stale package/grant/project-opening associations. The gate and ticket flow are not implemented; exact wire/confirmation and failure handling remain open. Tokens identify whose authority is used; they do not prove which JavaScript code initiated a call in the shared frontend environment. See [native request identity](plugins/context.md#native-request-identity-and-token-enforcement) for the lifecycle, manifest direction and remaining design decisions. Logging is deferred.

A separate application-owned management/recovery WebView with no plugin imports is approved direction, not implemented. Rust will authorize management commands using the actual calling WebView and its capability route. Plugin-hosting WebViews must not grant permissions or impersonate that manager. The one-use attachment model is approved; exact credential-delivery mechanics, persistence and lifecycle failure protocols remain open. This is not isolation between plugins in the editor.

Part 4 will load frontend packages; executable backend components will be designed later. The package model must leave room for multiple frontend/backend components. Mandatory permissions can be declared per package and/or component. Project components use per-project acknowledgement, with an explicit application-wide option. Application components require explicit application-wide approval for their own native requirements; execution scope grants nothing by itself. Initial installation is local, updates are manual, and fresh installs include default feature packages. These are approved plans, not current loading or permission guarantees. See [package direction](plugins/context.md#package-loading-updates-and-defaults). The [consolidated contract draft](plugins/package-api-proposal.md#10-consolidated-review-decisions) identifies the remaining author API, native control, runtime-delivery and Basic Menu decisions. The author SDK assembly and initial structure helper API are approved and source-exported. Remaining native wire/schema details and production integration still need review. The [resource-loading investigation](plugins/resource-loading-investigation.md) records a separate standalone fixture prototype. Its integrated unsigned packaged debug run passed 27 normal and seven recovery checks on macOS 27.0.1 arm64, including native pool stages. Direct worker loading failed; a verified-byte Blob worker succeeded. This is not production loading or native authorization validation. Other platforms and macOS 13.3 remain untested.

Prebuilt packages and SHA-256 integrity verification are approved direction. The internal [Rust integrity module](../src-tauri/src/plugin_integrity/mod.rs) now builds candidate per-file records and returns exact owned bytes after verification against a supplied trusted record. It rejects unsafe file types/paths and bounds resource use. The internal [snapshot pool](../src-tauri/src/plugin_resources/mod.rs) now shares verified buffers, enforces host-supplied limits and checks opaque WebView-lifetime associations. The internal [resource route](../src-tauri/src/plugin_resources/route.rs) now provides canonical snapshot URLs, exact encoded-path lookup, GET/HEAD and read-only response headers. The separate fixture exercises both shared helpers through real Tauri requests and window closures. It verifies shared retention, distinct accepted snapshot IDs, unassociated-request denial and release after the last associated window closes. Packaged checks also cover encoded filenames, response metadata, binary MIME and WebAssembly in the main WebView and Blob worker. JavaScript evaluation and ordinary remote script loading remain blocked in that fixture. Recovery imports no packages and retains no snapshots. These are fixture results, not a production URL or lifecycle API contract. The production application still has no runtime pool owner, requester adapter or close-event wiring. Production numerical defaults remain deferred. Accepted-record persistence is implemented in the separate internal registry. Installation, registered application resource routes, browser loading and native-request enforcement remain unimplemented. Future loading must consume verified bytes, not reopen source paths. Hashes detect changes against trusted records; they do not authenticate publishers or establish code safety. Publisher signing remains separate. See [package integrity](plugins/context.md#package-integrity-and-publisher-identity).

No arbitrary native-plugin loading is approved. Frontend plugins currently run in the application's JavaScript environment without isolation.

Project files must not automatically install code, execute plugin requirements or grant permissions. This also matters when receiving data from collaborators.

Project writes should participate in recoverable history. History can help recover damaged content. It cannot undo data theft or protect the user's computer from unrestricted system access.

### Missing plugins and data preservation

When a plugin is disabled or unavailable:

- Preserve its saved data.
- Keep unrelated project content usable.
- Show a placeholder or saved preview where possible.
- Offer inspection, enabling a trusted plugin or conversion of a copy.
- Make destructive removal a separate, explicit action.

A plugin may eventually supply migrations or fallback exporters. Basic preservation must not require executing the missing plugin.

### Current plugin APIs

The internal Rust [`plugin_manifest` module](plugins/manifest-resolution.md) implements strict manifest parsing and deterministic static dependency resolution. It validates approved byte/field/count rules and exact entry/style membership in verified snapshots. It reports profile and required-dependency blockers without blocking healthy siblings. It has no app commands or runtime callers. Static eligibility is not enablement, active availability, a permission grant or authority to import code.

The private workspace SDK now exports approved `FrontendContext`/entry/contribution contracts, alias-based provider/endpoint types, identity/project/locale types, four-role command types and definition/error helpers. `/svelte` adds frontend aliases; `/native` exports approved native service/data/error contracts and a guard. The root still includes legacy bundled types. The default bundled host still supplies its unchanged `PluginContext`, not `FrontendContext`. The separate opt-in internal application assembly supplies a complete typed `FrontendContext` with frozen `{ projectFiles: null, externalLinks: null }` native groups and no native authority. Native project services and application registration are not implemented. Persistent registration records exist in the internal registry, with only test constructors for native-location prerequisites. The [runtime profile fixture](plugins/runtime-profile.md) generates curated artifacts and tests an independently compiled plugin against the same runtime graph as its trusted host. Its 27 exact mappings and runtime exports are browser-tested. Its runtime-builder type facades still use workspace source. The separate [portable SDK builder](plugins/portable-sdk.md) now emits five private declarations-only packages with exact curated exports and Svelte props/snippets/generics. A standalone sample checks them outside the checkout with real dependencies and build tools, strict Svelte checking and an audit of every compiler source. The same sample builds and runs against the current shared profile. The internal SQLite registry foundation is implemented but not application-integrated. A production release profile, loader, native authorizer and installer remain unfinished. See the [execution checklist](plugins/implementation-plan.md#foundation-slice-and-remaining-execution-checklist).

An [isolated command dispatcher](plugins/command-dispatcher.md) now implements dependency-bound execution, availability, validation, copies, reservations, cancellation and safe diagnostics. It uses internal payload/accounting primitives. An internal component lifecycle harness now validates API/command publication, creates activation-owned command bindings and provider connections, and plans required-consumer activation/removal for host-selected slots. Its complete no-native context includes frozen identity, alias-based provider APIs with endpoint metadata, managed tasks and activation-owned UI locale delivery. Internal `createApplicationComponentHost` defaults to real bar/tab registries, the shared application `workQueue` and `createApplicationLocale` over `LocaleManager` (`en`/`fr`, both `ltr`). It now also implements [in-memory project references, scope routing and independent leases](plugins/project-connections.md). Project/application context combinations stay fixed, and copied/foreign/stale references are rejected. It also stages toolbar/view registrations with component-scoped runtime identities and stable placement identities. Project selection changes visibility without retargeting or stopping activations. Opt-in production adapters use one shared workspace that filters project-owned UI while retaining placement, capacity and open-tab records. Registering a view does not open a tab. See [UI routing](plugins/command-dispatcher.md#ui-contributions-and-workspace-mounting). The opt-in browser fixture uses production `MainView`, docked and floating bars. Application project-registration integration, layout/settings persistence, manifest-to-runtime integration and native access remain unimplemented. Internal registry records are separate from the in-memory references. There is no bundled-host integration or author-facing host-construction entry point. Typed arrays use approved [binary-only semantics](plugins/command-contract.md#typed-array-binary-semantics-and-inspection-limits), excluding custom properties without enumerating indices. General reflection and responsiveness limitations remain. The SDK exports `CommandInvocationError` as an `Error` subclass with a required diagnostic ID; diagnostic storage and application integration remain separate work.

The generic host manages activation, cleanup, toolbar/view/command contributions and task utilities. It does not contain formatting commands or a formatting service.

A **provider** is a plugin exposing an API that other plugins can use. Consumers declare the provider, contract name and exact API-major version they need. Required providers activate first. Optional integrations can be absent. Removing a required provider needs confirmation because its consumers must stop first.

Provider API objects become unusable when either plugin stops. This prevents retained API methods from acting after cleanup. It does not restrict arbitrary browser JavaScript. See [provider contracts](plugins/context.md#cross-plugin-contracts-and-dependencies) for versioning, notifications and error-reporting rules.

The word-processing provider lets consumers inspect live editor state and build edits inside synchronous callbacks. It validates the chosen view and revision before dispatch. Background results use the same validation. Changed state, including a selection change, makes an old target stale. Results are discarded rather than applied to another location.

Do not retain a mutable transaction across `await` or a cooperative yield. The provider cannot prove where a retained transaction came from if its original document is unchanged. It also cannot undo direct edits made through a raw `EditorView`.

Plugins can register ProseMirror **behaviors**, such as input rules, decorations and transaction hooks. Registration updates the existing editor state with the same schema. It preserves the document, selection, history and state of surviving plugins. Managed behaviors run before the existing host plugins. Failed behaviors are disabled and reported. These guards cannot interrupt arbitrary loops or undo callback side effects.

Basic Menu now uses this provider. Its formatting rules remain part of the feature. Quick Format and the [behavior examples](../src/lib/editor/prosemirror/behaviors/README.md) demonstrate independent consumers. They are opt-in examples, not enabled in the default application.

Plugins can register node and mark renderers for existing schema types. This first Part 3C slice is implemented and unmerged. Dedicated APIs own conflicts, connection cleanup, and registration-wide quarantine with schema fallback. An optional Svelte adapter supports ordinary components and stable ProseMirror-owned editable content. Ordinary behaviors still cannot supply renderer maps. Optional layout invalidation connects renderer-set and dimension changes to PageObserver without invalidating on every source notification.

Read the [plugin context](plugins/context.md#existing-content-renderers-part-3c-first-slice-implemented--unmerged) and [word-processing guide](../packages-js/word-processing/README.md#part-3c-renderers-for-existing-content) for complete rules. The [renderer examples](../e2e/fixtures/word-processing/README.md) are opt-in, not enabled in the default app. The current editor still uses the existing schema and pagination model. New node/mark types, schema lifecycle, and missing-content preservation need separate approval.

The [runtime profile guide](plugins/runtime-profile.md) explains the generated artifacts, independent plugin build and fixture limits. It links the tooling and browser source. Ordinary `FrontendContext.tasks` now accepts module-only worker requests. The internal host binds exact per-activation package URLs to trusted byte reads, and the library owns Blob Worker cleanup. Explicit service construction returns `AdvancedTaskService` with synchronous factory support; legacy bundled `PluginContext` retains that advanced service. Production native authorized byte-source and profile integration remain separate work.

## Plugin developer experience

**Accepted direction:** ordinary Svelte should be easy to use. Other UI frameworks should remain possible. Do not require Svelte for every future third-party interface. Current editor renderer APIs accept standard ProseMirror constructors, with an optional Svelte adapter. Broader cross-framework UI integration still needs design.

Developer tooling priorities are:

- A scaffolding command.
- A development host with hot reload.
- Typed APIs and sample projects.
- Automated integration tests.
- Packaging and compatibility tools.
- Documentation for both people and agents.

The optional shared UI library should provide useful components without forcing every author to use it. Grafana's plugin workflow is a reference, not a dependency decision.

Translation support belongs to the core platform. Approved direction is for the host to supply selected locale, text direction and change notifications through the same public API for official and third-party plugins. Plugins own their messages and fallbacks, but may reuse supported translation libraries or provider APIs. The [`context.locale` snapshot/subscription contract](plugins/package-api-proposal.md#4-the-activation-context) has exported `LocaleSnapshot` and `PluginLocale` types and activation-owned delivery. The opt-in component assembly reads the real `LocaleManager`; English and French both use left-to-right direction. An optional shared translation provider service is a future candidate, not a Part 4 requirement; its API and catalog behavior are undecided. Paraglide is connected to the app; its private generated messages are not the plugin API. The default bundled host has not migrated to this locale service.

## History and collaboration

**Accepted direction:** durable project history with named branches and alternate versions. It should cover text, formatting, organization, notes, research, assets and plugin data. Workspace layout and preferences may be tracked separately or optionally.

Users should be able to understand what a history entry means. Grouping work by chapter or character may be more useful than showing every low-level transaction.

The relationship between typing undo, snapshots, named branches and these groups is undecided. Git is a candidate, not a selected history engine.

Collaboration should work between users' computers where possible. Offline work should remain useful. Identity, transport, conflict handling and shared data structures are not selected. Neither simultaneous editing nor durable branching project history is implemented.

Pagination should default off in future collaborative sessions, with an explicit override. Different views may need different layouts. This policy is not implemented because collaboration is not implemented.

## Import/export and compatibility UX

**Accepted direction:** use a conversion model between file formats. Visual fidelity is the main priority. No conversion framework is selected.

Potential formats include DOCX, EPUB, LaTeX, OpenDocument and Typst. Supported subsets and priorities still need validation. ProseMirror's extensibility does not guarantee faithful editing or export of every layout.

The intended workflow is:

1. Choose an output format and profile.
2. Check compatibility.
3. Export directly when supported.
4. Otherwise explain recommended conversions and offer detailed review.
5. Distinguish exact preservation, visual approximation, reduced editability and omitted content.
6. Apply lossy changes to a copy or output, not the original project.
7. Offer previews, reusable profiles and an expandable report where practical.

For unsupported imported content, preserve source data where feasible. Explain the limitation and offer a usable fallback. Do not silently discard content. The exact fallback representation is still open.

Link users to [GitHub issues](https://github.com/benyakirten/writers-ide/issues) for concrete format requests. Ask for small, non-sensitive examples, not private manuscripts.

Conversion decisions should be repeatable for the same content, profile, converter version and resources. Font availability and browser layout can still produce different page breaks.

## Performance requirements

**Accepted target:** responsive operation on a computer with **8 GB RAM**, including large books and multi-book projects. This is a target, not a verified capacity claim.

- Start quickly and make useful content editable early.
- Load offscreen content incrementally.
- Render only needed items in large collections where practical. This is called virtualization; full document virtualization is not implemented.
- Keep DOM measurement work close to the visible area. Current pagination focuses on visible pages, but that is not full virtualization.
- Split main-thread work into short cooperative steps. Other edits and cancellation can occur between steps.
- Use one shared scheduler for pagination and plugin tasks. Do not give each plugin a separate frame allowance.
- Encourage task helpers, but do not require a generator for every action. Short commands and synchronous hooks stay immediate.
- Use Web Workers for suitable CPU-heavy frontend work. Promises alone do not move computation off the UI thread.
- Use asynchronous request/result workflows for backend work. The backend must also avoid blocking the UI through synchronous calls.

No end-to-end startup or latency target has been verified. No maximum project size is established. The [browser performance suite](browser-performance/context.md) checks paragraph split search and limits measurement probes. It does not enforce timing thresholds or measure the whole editor.

## Current implementation map

Paths are relative to the repository root. They are source entry points, not stable plugin APIs.

### Application and workspace

| Area                        | Start here                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Startup and app composition | `src/routes/+page.svelte`, `src/routes/+layout.svelte`, `src/routes/+layout.ts`, `vite.config.ts` |
| Workspace shell             | `src/lib/editor/Editor.svelte`, `src/lib/editor/MainView.svelte`, `src/lib/editor/Tab.svelte`     |
| Central views and tabs      | `src/lib/editor/state/tab-state.svelte.ts`, `src/lib/editor/state/tab-state-registry.svelte.ts`   |
| Bars and floating placement | `src/lib/editor/state/`, `src/lib/editor/bars/`, `packages-js/layout/`                            |
| Plugin host and manager     | `packages-js/plugins/`, `src/lib/plugins/`                                                        |
| Shared UI and tooltips      | `packages-js/components/`, `src/lib/components/`, `src/lib/services/tooltip.svelte.ts`            |

The route registers the word-processing provider and formatting plugin. It also still registers the editor view directly. The provider owns API resources, not the editor views themselves.

The workspace shows central windows side by side. A complete tab/split interface is not finished. Bars retain placement and capacity information while a plugin is disabled. Layout persistence and restoring minimized floating bars remain incomplete.

App state files provide compatibility access to the layout library. Toolbar registries use explicit component props. Unknown toolbar IDs show placeholders. In the opt-in component assembly, project visibility ownership survives disablement. Inactive tabs, item controls/gaps and all-invisible non-empty bar shells are hidden without changing IDs, insertion indexes or costs. Truly empty bars and selected-project disabled placeholders remain visible. Separate full per-project layouts remain a [deferred investigation](plugins/implementation-plan.md#deferred-work-and-future-candidates), not a promised feature.

### Editor and extension implementation

Most editor source is under `src/lib/editor/prosemirror/`:

| Area                           | Entry points                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Registered editor views        | `prose-mirror-editor.svelte.ts`                                                                     |
| View, schema and dispatch      | `view/ProseMirrorView.svelte`, `view/editor.ts`, `view/schema.ts`, `view/nodes.ts`, `view/marks.ts` |
| Editing compatibility wrappers | `view/actions.ts`, `view/selection.ts`                                                              |
| Provider adapter               | `word-processing.svelte.ts`                                                                         |
| Default formatting             | `menu/basic/`                                                                                       |
| Independent examples           | `menu/quick-format/`, `behaviors/`                                                                  |
| Existing plugin assembly       | `plugins.svelte.ts`, `view/editor.ts`                                                               |

The editor currently loads sample content. View IDs differ from document IDs. Multiple views of one document do not synchronize edits.

`packages-js/word-processing/` contains public editor contracts and reusable service code. It supports synchronous access, commands, strict result validation, behavior registration, and dedicated existing-type node/mark renderers. Its `svelte` entry supplies component adapters. Its public `/structure` entry exports read-only block grouping extracted unchanged from PageLayout, whose old methods delegate to it. Basic Menu owns formatting actions, selection coverage and policy; legacy app wrappers delegate to them. `splitParagraph` remains app-owned. Basic Menu still uses private UI translations/icons/string utilities and is not separately packaged. Package implementation starts in `src/rendering-manager.svelte.ts`, `src/renderers.ts`, `src/svelte-views.svelte.ts`, and `src/renderer-layout.ts`. Renderer service, adapter, and layout tests are linked in the [plugin source map](plugins/context.md#editor-and-feature-integrations). New behaviors update existing editor states. Accepted root and appended transactions pass through app dispatch; `view/page-indexes.ts` normalizes page indexes.

Pagination lives in `src/lib/editor/state/page-layout.svelte.ts`, `src/lib/editor/state/page-observer.svelte.ts` and `src/lib/components/pagination/`. The app's `src/lib/editor/state/work-queue.svelte.ts` exports its shared queue from `packages-js/tasks/`.

### Other platform code

- Rust startup is in `src-tauri/src/lib.rs` and `src-tauri/src/main.rs`. The backend currently has the Tauri greeting command and opener plugin, not project storage or conversion services. Internal `src-tauri/src/plugin_integrity/` and `plugin_resources/` implement verified bytes and resource helpers. `src-tauri/src/plugin_manifest/` contains normalized declarations, strict parsing, limited SemVer matching and static resolution, with parser/resolver tests. These modules do not implement production installation, loading or native authorization.
- The owner-approved internal `src-tauri/src/plugin_registry/` foundation implements typed async operations, a bounded FIFO worker/lifecycle, schema version 1 with 20 tables, transactional installation/permission/scope records, SQLite-aware backup and restore staging. Canonical destination ownership uses a persistent `.registry-lock` sidecar, not application single-instance forwarding. Publication/location/import/runtime-use prerequisites have test-only constructors. Private migration infrastructure tests synthetic upgrades; only schema 1 is actually supported and unknown schemas reject. No application startup owner, generation publisher, installer or native authority is wired. See the [registry implementation and source/test map](plugins/registry-implementation-review.md).
- Shared reactive services live in `src/lib/editor/state/` and `src/lib/services/`. Most still use module-level instances. `src/lib/utils/observable.ts` supports events and shortcuts.
- Localization uses `project.inlang/settings.json`, `messages/`, `src/lib/i18n.ts`, `src/lib/services/locale-manager.svelte.ts` and generated `src/lib/paraglide/` code. Browser language falls back to English. French messages still include English text, and some UI text is hard-coded. `LocaleManager` independently starts in English. Saved language preferences are not implemented.
- UI code uses Tailwind 4 with compatibility styles, Bits UI menus, icons, toasts and theme variables. This is not a finished theme/settings platform.
- `pnpm-workspace.yaml` lists the root and five private packages: plugins, layout, components, tasks and word processing. None is a published SDK. Reusable library instances do not import application singletons.

### Current gaps that must not be described as completed

These features remain unfinished or unimplemented:

- Durable save/load and a project storage schema.
- Import/export conversion services.
- Branching project history and collaboration.
- Synchronized views of the same document.
- External plugin loading and enforced native permissions.
- New content-type registration, schema lifecycle, and missing-content preservation.
- Complete extraction of editor assembly into plugins.
- Frontend isolation, if pursued later.
- A complete central tab/split interface.
- Complete translations and saved workspace/settings.
- Full document virtualization for very large projects.

## Validation and topic navigation

Run checks from the repository root. [CONTRIBUTING.md](../CONTRIBUTING.md) explains the commands and supported toolchain. [Dependency maintenance](dependencies.md) covers upgrades and outstanding advisories.

```sh
pnpm check
pnpm lint
pnpm test:unit:ci
pnpm test:smoke
pnpm test:tasks
pnpm test:plugins
pnpm test:plugin-profile
pnpm test:word-processing
pnpm test:e2e
pnpm test:performance
pnpm build
```

For internal native registry/integrity work, run from `src-tauri`:

```sh
cargo test --lib plugin_registry
cargo test --lib plugin_integrity
cargo test --lib
cargo fmt -- --check
cargo clippy --lib --tests -- -D warnings
```

Library tests do not prove generation publication or packaged native authorization. The [registry guide](plugins/registry-implementation-review.md#source-tests-and-validation) links the tested modules and remaining boundaries.

Choose checks that exercise the changed behavior:

| Check                  | What it covers                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests             | State, transfer rules, commands, scheduling, pagination logic and plugin APIs                                                          |
| App smoke/e2e          | Real typing, selection, undo, geometry, docking, focus, locale fallback and plugin management                                          |
| `test:tasks`           | Built workers, buffer transfers, cancellation and shared queue ownership                                                               |
| `test:plugins`         | Provider dependencies, removal confirmation, API invalidation and error reporting                                                      |
| `test:plugin-profile`  | Independent plugin and portable sample builds, shared runtime identity, CSS/assets, cancellation and ordinary module task Blob workers |
| `test:word-processing` | Editor access, independent formatting, behavior registration, input rules, decorations and workers                                     |
| `test:performance`     | Focused Storybook paragraph-search benchmarks                                                                                          |

The dedicated task, plugin, runtime-profile and editor fixtures build separately from the app. Run their commands explicitly; the main app e2e configuration excludes their test files. Browser Smoke CI runs each suite for its selected engine. `test:unit:ci` also includes SDK runtime/type checks, Node profile/build/server checks and portable SDK/sample checks. Run `pnpm test:plugin-sdk` for focused declarations and external sample validation. `pnpm build:plugin-sdk` writes private declarations-only packages to `node_modules/.cache/plugin-sdk`; these are not published SDK packages. The runtime-profile fixture relies on an immutable server and trusted transport for native imports and stylesheet fetches. Its prefetch checks cannot bind later fetch bytes. It implements the ordinary `module: URL` worker API and snapshot-bound byte-source adapter, not production native resource authorization or release-profile integration.

Unit tests use jsdom, which does not calculate browser layout. Use real-browser tests for geometry. The docking suite covers pointer and keyboard moves, capacity limits, floating bars, cancellation, overlapping bars and viewport changes. Pagination tests cover page creation, content preservation, forward/reverse selections and undo.

These tests do not establish complete accessibility, real-touch behavior, native plugin permissions or packaged-app safety. Playwright Chromium and WebKit represent Tauri's engine families, not the installed WebView2, WKWebView or WebKitGTK runtimes. Firefox is outside the Tauri browser matrix. Tests also do not verify the oldest supported macOS version.

Browser timing results are diagnostic. They are not Tauri timings or comparable limits for arbitrary machines. Storybook is not yet a complete plugin development host or end-to-end performance test environment.

See the [plugin changelog](plugins/change-log.md) for recorded test results, existing diagnostics and the intermittent selection-timing limitation. Results are evidence for a particular change, not a promise that every future checkout passes.

SvelteKit configuration lives in its Vite plugin. Deployment remains static and client-only. `$lib` and `@/*` remain compatibility aliases.

## Tentative priorities and issue references

The earlier tentative sequence was pagination, drag-and-drop, then import/export. It is not a fixed milestone or release commitment.

Useful issue references include:

- Editing: [#15](https://github.com/benyakirten/writers-ide/issues/15), [#24](https://github.com/benyakirten/writers-ide/issues/24), [#72 headers/footers](https://github.com/benyakirten/writers-ide/issues/72).
- Workspace: [#20](https://github.com/benyakirten/writers-ide/issues/20), [#41 drag-and-drop](https://github.com/benyakirten/writers-ide/issues/41), [#45 central views](https://github.com/benyakirten/writers-ide/issues/45), [#71 shared-document views](https://github.com/benyakirten/writers-ide/issues/71).
- Storage/conversion: [#46](https://github.com/benyakirten/writers-ide/issues/46), [#50](https://github.com/benyakirten/writers-ide/issues/50), [#66](https://github.com/benyakirten/writers-ide/issues/66).
- Developer experience: [#36 translation](https://github.com/benyakirten/writers-ide/issues/36), [#65 shared UI](https://github.com/benyakirten/writers-ide/issues/65), [#12 Storybook](https://github.com/benyakirten/writers-ide/issues/12).

Check each issue's status and the current implementation before using it as a specification.
