# Bars, docking, and drag-and-drop — PR change log

Read [context.md](context.md) for current behavior and terms. Create one cumulative entry per PR when work starts. Update that entry as work changes so its reasons, outcomes, tests and limits are ready before merge. Keep unmerged work separate from merged history. Do not append per-commit entries, session diaries or repeated test logs. See [AGENTS.md](../../AGENTS.md) for the required workflow.

## In progress

### `bh/phase-2-plugin-transition` — Stage 2 reusable layout and tooltip integration

**Status: In progress / unmerged.** Branch: `bh/phase-2-plugin-transition`. No PR identity or merge date is known.

#### Context

This branch moves reusable layout mechanics into a private package. The application keeps its rendering and workbench composition. Features keep their own services. Existing placement, capacity and cancellation rules stay intact.

#### What changed and why

Private `@writers-ide/layout` now owns reusable layout mechanics:

- The registry associates item IDs with presentations and capacity costs.
- Item and bar state hold the ordered layout. Transfers validate moves before changing it.
- Floating geometry keeps bars positioned inside the app.
- Shared feedback colors and drag/target components support interaction.

Each workbench receives its registry, ID and title helpers, and the factory that creates items. Independent instances need not import shared app state or ProseMirror.

The owner approved the existing public root exports and supporting types as advanced shared plugin-library APIs. The [library guide](../../packages-js/layout/README.md#advanced-use-in-a-plugin) explains independent layout construction and author-owned rendering, geometry, drag context, focus and cleanup. This supplies no host workbench handle and does not replace toolbar contribution APIs. The owner also approved the `@dnd-kit-svelte/core` public root as an advanced shared import in `writers-ide.frontend/1`, initially version `0.0.11`. Independent drag providers and shared layout primitives must use one module instance for matching Svelte contexts. Other DnD packages/internal paths are not automatically shared imports. Bundle layout `dock-colors.css` into emitted plugin CSS and declare the verified output through manifest `styles`, not a JavaScript CSS import-map entry or a new runtime CSS API. Module/context identity, independent layouts and stylesheet lifecycle still need browser/packaged validation. The [plugin topic entry](../plugins/change-log.md) records the runtime-profile decision. This documentation update changes no layout implementation. Formatting and whitespace checks cover the documentation, not external loading or packaged drag behavior.

The repository-wide [TypeScript declaration convention](../../CONTRIBUTING.md#use-types-for-data-and-interfaces-for-behavior) also applies here. Droppable props are a data type. Layout services and the drop-validation controller are behavioral interfaces. Members and runtime behavior are unchanged. The [plugin entry](../plugins/change-log.md#typescript-declaration-convention) records the audit and validation.

The app keeps its shared instance in `src/lib/editor/state/workbench.svelte.ts`. Existing state paths adapt or re-export it for compatibility. Custom bar and feature rendering stay in the app. `Editor.svelte` still connects gesture detection, target selection, preview and committing the move.

The extraction preserves existing rules:

- A bar holds at most three logical capacity units. Costs use the destination's horizontal or vertical orientation.
- Cancellation and placement identity stay unchanged.
- Disabled items keep their declared capacity costs.

It adds neither saved layout storage nor a general way to transfer state held inside component instances. See [current context](context.md) for these layout contracts.

Private `@writers-ide/components` supplies tooltip state and a provider component. The provider makes the chosen manager available to child components. App wrappers keep the shared manager.

Suppression leases keep tooltips hidden during a drag. Each lease holds suppression until released. The route supplies the manager around `Editor` without drawing another pointer.

The base bar forwards the action that opens the host-owned Plugins dialog. Feature contributions do not own management UI. See the [plugin entry](../plugins/change-log.md).

The owner's feature-neutral contract correction uses `defineSveltePresentation(component, props)`. Props are the inputs passed to a component. The descriptor checks their types without imposing a fixed plugin context. Shared context goes only to components that need it. The general host no longer has a formatting service.

The correction initially used `createFormattingPlugin(service)` with a feature-owned service. The subsequent Part 3A migration replaces that injection. `createFormattingPlugin()` now resolves the required word-processing provider, which exposes the editor API. It creates the formatting service for each activation, meaning each enabled lifetime of the plugin. The linked plugin entry covers service lifetime and its connection to ProseMirror.

These changes preserve docking identity, placement, orientation costs, cleanup and disabled capacity. They do not add a generic service bus, permission model or component-state transfer. The layout extraction does not itself migrate the word processor.

The pagination and docking guides also explain terms and state ownership in shorter sentences. This editorial revision changes no runtime behavior.

The opt-in application component assembly now connects the internal host to real bar/tab registries, the shared application queue and real UI locale source. The owner approved one shared workspace filtered by project ownership. Disabled contributions retain visibility ownership as well as toolbar costs. This prevents inactive-project placeholders and error tabs from leaking into the selected project. Identity-based removal protects replacement registrations and preserves placement and tab records.

Production renderers filter inactive tabs, item controls and insertion gaps. Non-empty docked/floating shells hide when all items are invisible. Truly empty bars and selected-project disabled placeholders remain visible. Filtering preserves underlying IDs, insertion indexes and capacity costs. Hidden items still consume capacity, preventing a later project switch from overfilling a bar. Application presentations stay mounted across unrelated host snapshots. The opt-in browser fixture uses production `MainView`, docked bars and floating bars, with the existing presentation/tooltip tree and no duplicate renderer. The default bundled host and Basic Menu are unchanged. See the [plugin entry](../plugins/change-log.md#internal-ui-routing-and-opt-in-application-assembly).

Separate full per-project layouts remain a deferred investigation, not promised or implemented. This assembly adds no layout persistence, external imports/loader, manifest-to-runtime native integration, native authority, settings persistence or persistent project registrations.

#### Tests and recorded validation

`src/lib/testing/layout-library.svelte.test.ts` and `components-library.svelte.test.ts` add library integration and independence coverage. Existing state/transfer tests and browser docking regressions remain.

Validation recorded after the feature-neutral contract correction passed:

- All 856 unit tests in 40 files.
- All 78 docking/feedback/destination cases and 20 smoke cases across Chromium/WebKit, including production builds.
- Lint.

Type checking remained blocked by the pre-existing `Modal.svelte` typing error and five old generic DnD warnings. These are historical results for that correction. They are not new totals or checks rerun for this editorial revision. The [plugin entry](../plugins/change-log.md) records later cumulative branch outcomes and limits.

Application assembly validation passed all 1,235 application unit tests, 476 SDK tests and SDK TypeScript checking. Browser validation passed 40 plugin tests, 22 smoke tests and 78 docking tests across Chromium and WebKit. Lint, production build and whitespace checks passed. The existing `Modal.svelte:4` error and five DnD warnings still block `pnpm check`. These results do not verify packaged runtimes or native integration.

#### Limits

These results do not verify native WebViews, real touch hardware or complete accessibility. Layout persistence and general component-local-state transfer remain unimplemented. The branch remains unmerged with no known PR or merge date.

## Merged PRs

### 2026-11-13 — [#78: Add drag and drop support](https://github.com/benyakirten/writers-ide/pull/78)

#### Context and changes

This PR connected the installed Svelte drag-and-drop kit to whole-bar and individual-item handles. It added edge/gap targets around the workbench and floating placement inside the app. Hover moved a lightweight preview, not committed layout state. It did not mount duplicate feature component trees.

Transfers checked capacity using destination-orientation costs, with a maximum of three logical units. Invalid interior drops cancelled. Explicit gaps created bars for extracted items. Whole-bar moves preserved identity, ordered contents, title and remembered geometry. They did not implicitly merge, split or discard items. Floating bars supported both orientations and correction back into bounds.

Larger persistent insertion slots and proximity-expanded hit areas made destinations easier to reach without shifting editor layout. Colors and live release descriptions distinguished side, top/bottom, floating and invalid targets. Tooltips were suppressed during a drag and resumed only on fresh hover or focus. At this merge, the main floating surface was tinted. #79 later removed that tint.

The PR added mouse/touch activation constraints, keyboard dragging and cancellation, and destination focus restoration. Collision checks resolved the visible surface before choosing a target. Docking auto-scroll was disabled. Existing relocation menus kept using validated transfers.

It also established topic-oriented context/history documents and the agent reading workflow.

#### Tests

State tests and real Chromium/WebKit regressions covered transfers, rejected capacity, preservation, ordering, floating orientation/bounds, handles, feedback and tooltip lifetime.

The caret regression selected its formatting suffix with existing logical-range helpers. It no longer assumed a fixed number of native arrow presses across physical page boundaries. Typing, caret and content assertions stayed intact.

#### Limits

This PR did not implement layout persistence/undo, native floating windows, arbitrary split/tab docking, general plugin component-state transfer or minimized-floater restoration. Browser tests did not validate packaged Tauri, actual touch hardware or comprehensive accessibility.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/78) reports `merged: true`, `merged_at: 2026-11-13T05:58:21Z`, and merge commit `155adaab149724ee0d56db995b173277dfd15870`.

### 2026-11-13 — [#79: Remove highlighting in main area for dnd](https://github.com/benyakirten/writers-ide/pull/79)

**Status: Merged 2026-11-13.** Branch: `bh/fix-dnd-main-area`.

#### Context and changes

The workbench-wide drag tint and outline added visual clutter. This PR removed them but kept the floating drop target and validity metadata. Side and top/bottom targets stayed highlighted. The preview still described floating placement with a red accent and release text. Transfer rules and keyboard targeting did not change.

The existing floater browser scenario gained a pointer-repositioning check before redocking. Visibility and bounding-box guards reported missing geometry as a failed assertion rather than dereferencing null. The assertion followed repository formatting rules. Application movement behavior stayed unchanged.

Documentation instructions also changed. Each PR was to have a consolidated entry during implementation, with reasons and outcomes ready before merge. `In progress` and `Merged PRs` stayed separate. After merge, only verified status/date/link metadata remained to finalize. The entry was not to become an implementation diary.

#### Tests and recorded validation

During implementation, 78 docking cases passed across Chromium/WebKit for neutral-background feedback. The latest visibility/bounding-box test edit passed five repeats per engine, for 10 runs. Repository `pnpm lint` passed after its formatting correction. The documentation workflow update passed formatting, local Markdown file-link and whitespace checks.

#### Limits

These local results did not establish that every CI environment passed. A separately reported macOS WebKit pagination-selection test failed during initial document replacement. This PR did not claim to fix it or expand the selection-helper infrastructure.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/79), verified by the parent agent: `merged: true`, `merged_at: 2026-11-13T22:04:54Z`, merge commit `2116288ecf49ea0428cfbc9d3f1219d8cbc4286c`.

### 2026-11-14 — [#80 — Bundled plugin presentations and disabled capacity](https://github.com/benyakirten/writers-ide/pull/80)

**Status: Merged 2026-11-14.** Branch: `bh/add-plugin-interface-js`.

#### Context and changes

Bar renderers gained a trusted plugin-presentation path. At this merge, it passed the scoped plugin context instead of legacy editor/workspace props. Formatting registered through the bundled plugin host. Drag gestures, transfers, ordering, capacity rules and geometry stayed unchanged. The later working-branch contract correction is described above, not applied retroactively to this merged design.

Disabled toolbars kept their placement IDs and declared horizontal/vertical costs. Placeholders reserved that capacity. Inserting items while a toolbar was disabled could not overfill its bar on re-enable. Default legacy deregistration and registry clearing still released retained metadata.

#### Tests and recorded validation

Tests covered presentation routing/cleanup, collisions and replacement ownership, repeated disable/re-enable across bars, and destination-orientation capacity. Registry, bar, transfer and application-adapter tests passed 88 cases in the focused run. The final cross-engine browser rerun and full-suite results are in the [plugin PR entry](../plugins/change-log.md).

#### Limits

This PR did not add layout persistence or a general feature-state transfer lifecycle. The linked plugin entry contains the complete implementation and validation summary. Historical test results were not rerun for this editorial revision.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/80), verified by the parent agent: `merged: true`, `merged_at: 2026-11-14T19:08:58Z`, merge commit `4b39895c5218498fd1c0e79c99b1ea8012f1b67a` (recorded as matching `main` HEAD at verification).
