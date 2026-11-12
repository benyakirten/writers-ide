# Project context

This is durable project memory for contributors and agents, not a specification that every described feature already implements. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for development conventions and [pagination.md](pagination.md) when working on pagination, layout geometry, or cooperative editor work.

Implementation baseline inspected: commit `22c02b0` (`Switch to oxc (#73)`). The decisions below were confirmed with the project owner during this documentation work. Source code remains the authority for current behavior; update this document when that behavior or an accepted decision changes.

## Status vocabulary and maintenance

- **Current:** implemented and connected in source; not a claim that every interaction has been verified.
- **Accepted direction:** owner-approved product or architectural intent, not necessarily implemented.
- **Open:** a choice requiring research and discussion; do not silently treat it as a requirement or authorization.
- **Tentative priority:** guidance, not a release commitment.

Run every important architectural decision by the owner before implementing it. Explain the problem, alternatives, tradeoffs, and proposed choice. Accepted long-term direction does not authorize a large migration without a concrete design discussion.

Keep context focused on lasting behavior, constraints, decisions, rationale, and useful source entry points. Do not append session transcripts or duplicate the entire codebase. Update the relevant topic document when substantive changes land. Separate proposals from accepted decisions and remove or label superseded statements. GitHub issues provide feature ideas and historical context, not automatically current specifications or a complete roadmap.

## Product and principles

**Accepted direction:** Writer's IDE is a highly extensible, local-first word processor with an IDE-like workspace for writers. Fiction authors are the first audience because the owner writes fiction, but other writing use cases are welcome. This is a personal project with no time pressure to release; do not impose an artificial minimal scope at the expense of the intended architecture.

A useful first release should let an author import an existing work in progress, organize and continue writing chapters, prepare print and ebook versions, and export material to an editor. Inspiration includes Scrivener, Ulysses, Novlr, Word, and Pages; these are references, not a promise to clone every feature.

The application and official features will always be free, with no paid tiers or official paid-plugin marketplace. The purpose is cooperation and creativity, not revenue. Encourage sharing improvements and contributing upstream rather than monopolizing them. This is a community principle, **not a restriction on commercial reuse**: retain the existing MIT licensing terms and freedom to fork, extend, and redistribute. Do not invent a noncommercial license restriction.

Essential writing and project workflows must work locally, offline, without an account. Optional cloud services or integrations such as pushing projects to GitHub may be explored later. Collaboration should preferably be peer-to-peer, without requiring a central authority that can terminate access.

## Accepted technology and platform boundaries

- **Firm technology choices:** Tauri, Svelte 5, ProseMirror, and a Rust backend. Do not reopen the stack choice based solely on old exploratory issues.
- The core should be as small as practical. It includes layout infrastructure, import/export infrastructure, internationalization, and the platform capabilities necessary to host extensions safely. Exact package/API boundaries remain open.
- Word processing, its formatting bars, and other feature views should be plugins. Built-in features must use the same extension APIs offered to third parties; avoid privileged feature-only shortcuts.
- Most functionality should eventually live in small packages within this monorepo. Package boundaries, naming, publication, and dependency rules are not yet designed.

## Project and content model

### Accepted direction

A project is a Scrivener-style container for potentially many kinds of content, including plugin-defined data. It may contain several books in a series, shared character notes, chapters/scenes, research, media, and relationships. Do not assume a project is one manuscript or one ProseMirror document. Media-heavy projects may become large; responsiveness and incremental access matter more than arbitrary content-size restrictions.

Use an **extensible project model containing ProseMirror-based rich-text content**, rather than inventing a second live rich-text model upfront. ProseMirror's structure and editing semantics are valuable. Other views can work with project organization, relationships, and metadata without continuously translating the entire manuscript.

Plan for versioned rich-text structures and schema evolution; concrete persistence formats and migration APIs remain open. A conversion intermediate representation can be separate from the live editing model. Avoid a full-document import/export translation after every edit.

Calculated page boundaries should ultimately be derived layout data, potentially per-view state/cache, while explicit page/section breaks, layout settings, text, formatting, and footnote semantics remain authored information. **The current implementation still stores page nodes and splits paragraphs in the ProseMirror model. Keep it working.** Any separation requires research, a prototype, and owner approval; see [pagination.md](pagination.md).

### Open storage decisions

Documents/projects are expected to comprise multiple pieces of content, assets, and connecting metadata. A directory, database such as SQLite, compressed archive/package, or combination may be appropriate. None is selected. Stable identities, asset handling, incremental loading, transactions, schema migration, and recovery require design. Do not claim that SQLite, a ZIP format, or Git has been adopted merely because it was discussed.

## Workspace and extension UX

**Accepted direction:** IDE-style tabs in resizable split panes, including independently scrolled views of the same content. The default should feel familiar to word-processor users while exposing an approachable opportunity to discover the more flexible workspace; exact default composition is open.

Bars can live above, below, or on either side of the main content area, or float. Plugins may contribute central views as well as bars. Plugin authors are responsible for mapping shared feature state into appropriate horizontal, vertical, and floating presentations, as the existing basic formatting menu attempts to do. Relocation should not silently discard state or content. The exact overflow/capacity and state-transfer contracts remain to be designed.

Future views may include storyboard, sticky-note canvas, print layout, reflowable ebook, and other perspectives. Semantic analyses could use project data to flag narrative inconsistencies, such as a vampire appearing outdoors in daylight. These analysis features are deliberately not well defined yet and follow the interface/platform foundations; do not assume they require an LLM, cloud service, or a chosen analysis engine.

## Plugin safety and capability access

### Accepted requirements, not current guarantees

Third-party plugins are untrusted. They must not gain ambient access to the host filesystem, network, shell/process execution, native libraries, or unrestricted application internals. Define explicitly allowed capabilities and expose narrow, permission-checked host APIs rather than allowing arbitrary code with a broad permission prompt.

Plugins should be able to integrate deeply with project and platform state through those APIs, including i18n helpers, commands, document operations, layout contributions, and subscriptions. This does not mean granting direct mutable references to all internal singleton state or access to unrelated projects.

Plugin frontends must be isolated. A plain DOM mount point is not isolation. A restricted iframe may be an option, but frontend isolation, messaging, origins, and the backend execution model remain open architectural decisions. Native Rust code executing inside the host process cannot be assumed safe; no arbitrary native-plugin loading design has been approved.

The threat model includes malicious host-file deletion, exfiltration, and propagation to collaborators. Receiving project data or plugin requirements must **not** automatically install/execute plugin code or grant permissions. Project data and executable extension packages are separate trust domains.

Project writes should participate in recoverable history. The intended damage boundary is granted project data, not the user's computer; even within a project, minimize access to what is needed. History is recovery protection, **not a sandbox**, and cannot undo data theft or host compromise. The exact grantable capabilities and enforcement mechanisms still require design.

### Missing plugins and data preservation

- Preserve plugin-owned data when a plugin is unavailable, disabled, or removed.
- Keep unrelated project content usable; do not require a destructive conversion merely to open the project.
- Show a useful placeholder or safe saved preview when available, without executing untrusted content.
- Offer enabling/installing a trusted plugin, inspection, or converting a copy to a supported representation.
- Make destructive removal an explicit, separate action.
- Plugins may supply migrations/fallback exporters through the restricted execution model. Basic preservation must not depend on executing an unavailable plugin.

## Plugin developer experience

**Accepted direction:** framework-flexible UI with a paved path for Svelte 5 and/or web components. Do not enforce Svelte for every third-party UI. Isolation and typed host APIs matter more than a shared rendering framework.

Highest priorities are a scaffolding command, a ready-to-use development host with hot reload, and typed APIs. Also provide sample projects/fixtures, automated integration tests, packaging and compatibility tooling, and documentation usable by both humans and agents. A shared optional UI library should express the product language and provide useful basic components without forcing authors to build everything themselves. Grafana's plugin development workflow is a reference, not a dependency decision.

Internationalization belongs to the core platform and must be available to extensions. Paraglide is currently wired into the app, but the final plugin translation contract and locale authority are not settled.

## History and collaboration

**Accepted direction:** durable, navigable, branching project history for alternate versions and what-if exploration. It should include manuscript text/formatting, ordering, notes, characters, research, assets, and plugin data. Workspace layout and personal preferences can be tracked optionally.

Expose meaningful zones of interest or categorized work, such as “working on character X” or “adding chapter 10,” rather than overwhelming users with an undifferentiated transaction tree. The relationship between typing undo, snapshots, named branches, and these groupings remains open. Git is a candidate implementation, **not a chosen history engine**.

Collaboration should support people working from their own computers, preferably peer-to-peer and offline-capable rather than account/server-dependent. Synchronization, conflict handling, identity, transport, and collaboration data structures are undecided. Branch-based alternate versions and simultaneous collaboration are goals, not implemented features.

Pagination should default off in multiplayer/collaborative mode, with an explicit override. Different views may have different layout needs. This policy is future behavior; collaboration and automatic mode switching do not currently exist.

## Import/export and compatibility UX

**Accepted direction:** conversion through an intermediate representation, with visual fidelity as the primary conversion priority. Reuse existing tools/libraries when appropriate, but no converter framework has been selected. Target ideas include DOCX, EPUB, LaTeX, OpenDocument, and possibly Typst. Priorities and supported subsets need validation.

Do not promise universal fidelity. ProseMirror's extensibility does not automatically provide an editor, pagination, or exporter for every possible layout.

Preferred workflow:

1. Choose an output format/profile and analyze compatibility.
2. Export directly when supported.
3. Otherwise offer deterministic **recommended conversions** or an optional detailed review.
4. Distinguish exact preservation, visual approximation, appearance preserved with reduced editability, and omissions.
5. Preserve the original project; apply lossy transformations to the output or a copy.
6. Provide preview where practical, an expandable report, and reusable profiles/overrides so ordinary users need minimal input and experts can control precise behavior.

For unsupported imported layouts, preserve original source/unsupported data where feasible, explain limitations, and offer usable fallback/conversion paths rather than silently discarding content or simply refusing the whole document. The exact fallback representations are open. Link users to [GitHub issues](https://github.com/benyakirten/writers-ide/issues) to request concrete layout/format support; encourage minimal, non-sensitive reproductions instead of asking them to publish private manuscripts.

Determinism means the same content, profile, converter version, and relevant resources produce the same conversion decisions. Font availability and rendering engines also affect visual output; deterministic rules alone do not guarantee identical pagination across machines.

## Performance requirements

**Accepted target, not a verified present capability:** a sleek, responsive experience on a baseline computer with **8 GB RAM**, including very large books and multi-book projects. Do not normalize visible frontend stalls as unavoidable because a project is large.

- Aim for nearly instantaneous startup into a useful workspace and make visible content editable quickly.
- Load/process offscreen content incrementally in the background; virtualize large collections and investigate document virtualization where appropriate.
- Keep DOM work proportional to what the user needs now. Distinguish viewport-limited pagination from full document virtualization; only the former currently exists.
- Use short cooperative steps for DOM-dependent work; cancellation/invalidation must account for intervening edits.
- Prefer Web Workers for suitable frontend CPU work and explicit asynchronous request/result or event workflows for work handed to the Rust backend.
- Promises do not themselves move CPU work off the main thread. Backend work also needs appropriate concurrency rather than blocking the UI through a synchronous call pattern.
- Establish measurements and regression tests as features develop. No fixed startup/latency benchmark, maximum project size, or complete virtualization design has been chosen.

## Current implementation map

Paths below are relative to the repository root. These are discovery entry points, not stable public plugin APIs.

| Area                    | Entry points                                                                                                                                                                       | Current behavior / limits                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap               | `src/routes/+page.svelte`, `src/routes/+layout.svelte`, `src/routes/+layout.ts`, `svelte.config.js`                                                                                | Registers basic menu and ProseMirror view; static, prerendered/client-only SvelteKit app for Tauri. Global keyboard events feed shortcuts.                                                                                                                                |
| Rust host               | `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`                                                                               | Tauri 2 starter greeting command and opener plugin. No project persistence, history, collaboration, or converter backend yet.                                                                                                                                             |
| Workbench               | `src/lib/editor/Editor.svelte`, `MainView.svelte`, `Tab.svelte`                                                                                                                    | Composes bars, central views, toasts/tooltips, pagination UI. Base bars contain development/test controls. All central windows currently render side by side, not a complete tab/split interface.                                                                         |
| Toolbar extensions      | `src/lib/editor/state/bar-item-registry.svelte.ts`, `bar-items.svelte.ts`, `shared.types.ts`                                                                                       | Orientation-specific Svelte components, injected capabilities, ordered item IDs and capacity units. Unknown IDs render fallbacks. These are trusted in-process components today, not sandboxed plugins.                                                                   |
| Bar layout              | `src/lib/editor/state/vertical-bar-state.svelte.ts`, `horizontal-bar-state.svelte.ts`, `floater-state.svelte.ts`, `bar-transfer-handler.svelte.ts`; `src/lib/editor/bars/`         | Docked/floating geometry, resizing and menu-based transfers. DnD handlers in `Editor.svelte` log events; docking by DnD is unfinished. Minimized floaters have no completed restore UI. Cross-orientation reconstruction/capacity is not a lossless persistence contract. |
| Central views           | `src/lib/editor/state/tab-state.svelte.ts`, `tab-state-registry.svelte.ts`                                                                                                         | Named component registry and view instances, active state, reordering/disposal. Generic `data` exists but built-in editor loads sample data instead.                                                                                                                      |
| Rich-text editor        | `src/lib/editor/prosemirror/prose-mirror-editor.svelte.ts`, `view/editor.ts`, `view/ProseMirrorView.svelte`, `view/schema.ts`, `view/nodes.ts`, `view/marks.ts`, `view/actions.ts` | ProseMirror registration, transactions, fixed schema, formatting, history, sample content. View IDs differ from document IDs; same-document views do not synchronize edits.                                                                                               |
| Editor extension hooks  | `src/lib/editor/prosemirror/plugins.svelte.ts`, `view/editor.ts`, `node/SvelteViewNode.svelte.ts`                                                                                  | Plugin factories read at editor creation; transaction-handler registry exists. No unified external plugin lifecycle, live schema registry, or complete Svelte node-view integration.                                                                                      |
| Basic menu example      | `src/lib/editor/prosemirror/menu/basic/`                                                                                                                                           | Registered horizontal/vertical formatting components following the active editor. Useful example, not proof of a finished public SDK.                                                                                                                                     |
| Pagination / scheduling | `src/lib/editor/state/page-layout.svelte.ts`, `page-observer.svelte.ts`, `work-queue.svelte.ts`; `src/lib/components/pagination/`                                                  | Viewport-driven cooperative pagination; see [pagination.md](pagination.md). Not whole-document rendering virtualization.                                                                                                                                                  |
| Reactive state/services | `src/lib/editor/state/`, `src/lib/services/`, `src/lib/utils/observable.ts`                                                                                                        | Mostly module-level singleton classes with Svelte runes; observables remain for events/shortcuts. No established durable workspace/settings storage.                                                                                                                      |
| Localization            | `project.inlang/settings.json`, `messages/`, `src/lib/i18n.ts`, `src/lib/services/locale-manager.svelte.ts`, `src/lib/paraglide/`                                                  | Paraglide wiring, English/French catalogs; French currently contains English text and some UI is hard-coded English. Locale preference and plugin i18n strategy remain incomplete.                                                                                        |
| UI foundations          | `src/lib/components/`, `src/app.css`, `components.json`                                                                                                                            | Tailwind, shadcn/bits-ui dropdowns, icons, toasts, tooltips, theme tokens. Not a finished theme/settings platform.                                                                                                                                                        |
| Package scaffolds       | `packages-js/components/`, `packages-js/layout/`, `pnpm-workspace.yaml`, `src/lib/index.ts`                                                                                        | Manifests/licenses but no extracted implementation; only root is currently included in workspace config. Not usable published SDK packages.                                                                                                                               |
| Test/dev infrastructure | `vite.config.js`, `playwright.config.ts`, `src/**/*.test.ts`, `e2e/`, `.storybook/`, `src/stories/`, `.github/workflows/unit_test.yml`                                             | jsdom unit tests, real-browser pagination tests, starter Storybook examples. CI workflow runs lint/unit tests, not the full validation set.                                                                                                                               |

### Current gaps that must not be described as completed

Durable save/load, a project storage schema, conversion pipeline, history trees, peer-to-peer collaboration, synchronized same-document views, untrusted plugin isolation/permissions, external plugin packaging/loading, finished drag-and-drop docking, conventional tabs/split controls, complete translations, and large-project virtualization are not implemented.

## Validation and topic navigation

Run commands from the repository root. Use [CONTRIBUTING.md](../CONTRIBUTING.md) as the source for code style and validation conventions:

```sh
pnpm check
pnpm lint
pnpm test:unit:ci
pnpm test:e2e
pnpm build
```

Unit tests cover much of bar state/transfers, shortcuts, toast/tooltip behavior, editor actions, scheduling and pagination logic. jsdom cannot establish layout correctness. Use the browser tests and commands in [pagination.md](pagination.md) for actual pagination geometry. Shell DnD, complete workspace interactions, accessibility, and plugin isolation do not have equivalent established end-to-end coverage. Storybook is currently starter content, not a finished editor/plugin development host.

This document describes source inspection, not a standing claim that these checks pass. Report actual validation results for each change.

## Tentative priorities and issue references

Owner's tentative sequence: finish pagination, then drag-and-drop interfaces, then importing/exporting. No fixed next milestone or release date is committed.

Useful open issues from the inspection (not a frozen backlog):

- [#15 editor feature umbrella](https://github.com/benyakirten/writers-ide/issues/15), [#24 WYSIWYG features](https://github.com/benyakirten/writers-ide/issues/24), [#72 headers/footers](https://github.com/benyakirten/writers-ide/issues/72).
- [#20 main editor layout](https://github.com/benyakirten/writers-ide/issues/20), [#41 drag-and-drop](https://github.com/benyakirten/writers-ide/issues/41), [#45 plugin central content](https://github.com/benyakirten/writers-ide/issues/45), [#71 shared-document views](https://github.com/benyakirten/writers-ide/issues/71).
- [#46 save/load](https://github.com/benyakirten/writers-ide/issues/46), [#50 format converters](https://github.com/benyakirten/writers-ide/issues/50), [#66 format-specific views](https://github.com/benyakirten/writers-ide/issues/66).
- [#36 i18n](https://github.com/benyakirten/writers-ide/issues/36), [#65 shared UI package](https://github.com/benyakirten/writers-ide/issues/65), [#12 editor Storybook](https://github.com/benyakirten/writers-ide/issues/12).

Old native/custom-editor exploration issues do not supersede the confirmed stack decision. Recheck issue status and actual implementation when starting related work.
