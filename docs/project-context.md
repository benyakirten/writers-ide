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

No project storage format has been selected. A directory, SQLite database, archive or combination could be appropriate.

The design must address stable IDs, assets, incremental loading, transactions, migrations and recovery. Do not describe SQLite, ZIP or Git as chosen merely because they have been discussed.

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

**Approved direction, not implemented:** native services will attach private, host-issued activation tokens to requests. Rust will resolve the token's plugin/component identity and grants, validate each operation, and reject invalid or revoked credentials. Tokens identify whose authority is used; they do not prove which JavaScript code initiated a call in the shared frontend environment. See [native request identity](plugins/context.md#native-request-identity-and-token-enforcement) for the lifecycle, manifest direction and remaining design decisions. Logging is deferred.

Part 4 will load frontend packages; executable backend components will be designed later. The package model must leave room for multiple frontend/backend components. Mandatory permissions can be declared per package and/or component. Project components use per-project acknowledgement, with an explicit application-wide option. Application components require explicit application-wide approval for their own native requirements; execution scope grants nothing by itself. Initial installation is local, updates are manual, and fresh installs include default feature packages. These are approved plans, not current loading or permission guarantees. See [package direction](plugins/context.md#package-loading-updates-and-defaults).

Prebuilt packages and SHA-256 integrity verification are approved direction. The internal [Rust integrity module](../src-tauri/src/plugin_integrity/mod.rs) now builds candidate per-file records and returns exact owned bytes after verification against a supplied trusted record. It rejects unsafe file types/paths and bounds resource use. Accepted-record persistence, installation, browser loading and native-request enforcement are not implemented. Future loading must consume verified bytes, not reopen source paths. Hashes detect changes against trusted records; they do not authenticate publishers or establish code safety. Publisher signing remains separate. See [package integrity](plugins/context.md#package-integrity-and-publisher-identity).

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

The generic host manages activation, cleanup, toolbar/view/command contributions and task utilities. It does not contain formatting commands or a formatting service.

A **provider** is a plugin exposing an API that other plugins can use. Consumers declare the provider, contract name and exact API-major version they need. Required providers activate first. Optional integrations can be absent. Removing a required provider needs confirmation because its consumers must stop first.

Provider API objects become unusable when either plugin stops. This prevents retained API methods from acting after cleanup. It does not restrict arbitrary browser JavaScript. See [provider contracts](plugins/context.md#cross-plugin-contracts-and-dependencies) for versioning, notifications and error-reporting rules.

The word-processing provider lets consumers inspect live editor state and build edits inside synchronous callbacks. It validates the chosen view and revision before dispatch. Background results use the same validation. Changed state, including a selection change, makes an old target stale. Results are discarded rather than applied to another location.

Do not retain a mutable transaction across `await` or a cooperative yield. The provider cannot prove where a retained transaction came from if its original document is unchanged. It also cannot undo direct edits made through a raw `EditorView`.

Plugins can register ProseMirror **behaviors**, such as input rules, decorations and transaction hooks. Registration updates the existing editor state with the same schema. It preserves the document, selection, history and state of surviving plugins. Managed behaviors run before the existing host plugins. Failed behaviors are disabled and reported. These guards cannot interrupt arbitrary loops or undo callback side effects.

Basic Menu now uses this provider. Its formatting rules remain part of the feature. Quick Format and the [behavior examples](../src/lib/editor/prosemirror/behaviors/README.md) demonstrate independent consumers. They are opt-in examples, not enabled in the default application.

Plugins can register node and mark renderers for existing schema types. This first Part 3C slice is implemented and unmerged. Dedicated APIs own conflicts, connection cleanup, and registration-wide quarantine with schema fallback. An optional Svelte adapter supports ordinary components and stable ProseMirror-owned editable content. Ordinary behaviors still cannot supply renderer maps. Optional layout invalidation connects renderer-set and dimension changes to PageObserver without invalidating on every source notification.

Read the [plugin context](plugins/context.md#existing-content-renderers-part-3c-first-slice-implemented--unmerged) and [word-processing guide](../packages-js/word-processing/README.md#part-3c-renderers-for-existing-content) for complete rules. The [renderer examples](../e2e/fixtures/word-processing/README.md) are opt-in, not enabled in the default app. The current editor still uses the existing schema and pagination model. New node/mark types, schema lifecycle, and missing-content preservation need separate approval.

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

Translation support belongs to the core platform. Paraglide is connected to the app, but the plugin translation API and responsibility for choosing the locale remain open.

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

App state files provide compatibility access to the layout library. Toolbar registries use explicit component props. Unknown toolbar IDs show placeholders.

### Editor and extension implementation

Most editor source is under `src/lib/editor/prosemirror/`:

| Area                      | Entry points                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Registered editor views   | `prose-mirror-editor.svelte.ts`                                                                     |
| View, schema and dispatch | `view/ProseMirrorView.svelte`, `view/editor.ts`, `view/schema.ts`, `view/nodes.ts`, `view/marks.ts` |
| Shared editing helpers    | `view/actions.ts`, `view/selection.ts`                                                              |
| Provider adapter          | `word-processing.svelte.ts`                                                                         |
| Default formatting        | `menu/basic/`                                                                                       |
| Independent examples      | `menu/quick-format/`, `behaviors/`                                                                  |
| Existing plugin assembly  | `plugins.svelte.ts`, `view/editor.ts`                                                               |

The editor currently loads sample content. View IDs differ from document IDs. Multiple views of one document do not synchronize edits.

`packages-js/word-processing/` contains public editor contracts and reusable service code. It supports synchronous access, commands, strict result validation, behavior registration, and dedicated existing-type node/mark renderers. Its `svelte` entry supplies component adapters. Package implementation starts in `src/rendering-manager.svelte.ts`, `src/renderers.ts`, `src/svelte-views.svelte.ts`, and `src/renderer-layout.ts`. Renderer service, adapter, and layout tests are linked in the [plugin source map](plugins/context.md#editor-and-feature-integrations). New behaviors update existing editor states. Accepted root and appended transactions pass through app dispatch; `view/page-indexes.ts` normalizes page indexes.

Pagination lives in `src/lib/editor/state/page-layout.svelte.ts`, `src/lib/editor/state/page-observer.svelte.ts` and `src/lib/components/pagination/`. The app's `src/lib/editor/state/work-queue.svelte.ts` exports its shared queue from `packages-js/tasks/`.

### Other platform code

- Rust startup is in `src-tauri/src/lib.rs` and `src-tauri/src/main.rs`. The backend currently has the Tauri greeting command and opener plugin, not project storage or conversion services.
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
pnpm test:word-processing
pnpm test:e2e
pnpm test:performance
pnpm build
```

Choose checks that exercise the changed behavior:

| Check                  | What it covers                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Unit tests             | State, transfer rules, commands, scheduling, pagination logic and plugin APIs                      |
| App smoke/e2e          | Real typing, selection, undo, geometry, docking, focus, locale fallback and plugin management      |
| `test:tasks`           | Built workers, buffer transfers, cancellation and shared queue ownership                           |
| `test:plugins`         | Provider dependencies, removal confirmation, API invalidation and error reporting                  |
| `test:word-processing` | Editor access, independent formatting, behavior registration, input rules, decorations and workers |
| `test:performance`     | Focused Storybook paragraph-search benchmarks                                                      |

The three dedicated task/plugin/editor fixtures build separately from the app. Run their commands explicitly; the main app e2e configuration excludes their test files. Browser Smoke CI runs all three for its selected engine.

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
