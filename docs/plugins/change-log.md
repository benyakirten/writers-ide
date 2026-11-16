# Plugins and reusable libraries — PR change log

This page records changes to plugin hosting, reusable packages and editor extension APIs.
Read [context.md](context.md) for the current design and terminology.

## In progress

### `bh/phase-2-plugin-transition` — Stage 2 libraries and plugin management

**Status: In progress / unmerged.** No PR identity or merge date has been verified for this branch.

This branch moves shared layout, UI and task code into reusable packages.
It also lets plugins use one another's APIs and extend the existing editor.
The work includes Parts 1–2 and 3A–3B of the [implementation plan](implementation-plan.md).
Custom content and schema changes remain Part 3C. External plugin loading remains Part 4.

#### Shared layout and UI libraries

`@writers-ide/layout` now contains the reusable registry, capacity, transfer, floating-bar and drag code.
Its dependencies are supplied explicitly, so independent workspaces do not share hidden state.
It does not import manuscript code, ProseMirror or application singletons.

The app still owns its bar rendering and drag-and-drop composition.
Existing state files provide compatibility access to the library.
This is not a complete workspace or word-processor migration.
See the [docking entry](../dnd/change-log.md).

`@writers-ide/components` supplies tooltip state, a tooltip provider, `IconButton`, `Tooltip` and `Pointer`.
Callers supply state or obtain it through Svelte context.
The library does not create an application-wide manager.

Existing app wrappers retain the shared tooltip manager.
The route passes it to `TooltipProvider` with `renderPointer={false}` because the app already renders a pointer.
This preserves drag suppression and avoids rendering two pointers.

#### Plugin hosting and management

The shared plugin context contains `signal`, `own`, `contributions`, `tasks` and `apis`.
Formatting types and commands no longer belong to the generic plugin package.
There is no `context.formatting` or required host formatting service.
This keeps feature-specific APIs out of the common host contract.

`defineSveltePresentation(component, props)` checks the component's props before creating a rendering description.
There is no mandatory `context` prop.
Plugins pass only the dependencies their components need.

`PluginManagementService` supplies `list`, `subscribe`, `activate`, `planDeactivation` and `deactivate`.
Its subscriptions return frozen status data, not executable plugin objects.
The app-owned manager shows versions, declared capabilities, contributions, dependencies and errors.
Users can enable, disable or retry bundled plugins.

The route owns the manager's native dialog.
The Plugins button in `HorizontalBaseBar` reaches it through `Editor`'s `onplugins` callback.
Closing the dialog explicitly restores launcher focus, including after WebKit pointer activation.

Local Svelte error boundaries show fallbacks for presentation and tooltip rendering failures.
The manager remains available for recovery.
These boundaries do not catch every event-handler or asynchronous failure and are not a sandbox.

Disabled toolbar items retain their placement IDs and orientation costs.
A user cannot disable an item, fill its reserved space and overfill the bar by enabling it again.
This preservation is in memory only.

#### Shared task utilities — Part 1

`@writers-ide/tasks` contains the extracted `WorkQueue` and task helpers.
The library has no application singleton or editor dependency.
The app's compatibility module keeps its existing shared queue.
Application plugins and pagination use that same queue and frame budget.
A standalone `PluginHost` can receive a queue or create an independent one.

Each activation receives `context.tasks`:

- `forEach` processes short units and yields between them.
- `cooperative` supports algorithms that need explicit generator steps.
- `async` manages promise-based operations.
- `worker` runs a bundled module in a dedicated worker.

Short synchronous commands remain ordinary functions.
No generator or scheduling helper is mandatory.
The original soft budget and fairness rules are unchanged.
A running step still cannot be interrupted.

Task handles expose reactive status, progress and errors.
Their completion promises resolve to completed, cancelled or failed outcomes instead of rejecting.
Repeated local keys replace previous work across all modes.
Internal activation-specific keys prevent collisions between plugins.

Cooperative helpers manage queue start/release handles for the caller.
Async and worker tasks do not need those handles.
Caller cancellation affects one task. Plugin teardown cancels only that plugin's work.
Cleanup failures are recorded even if the task outcome has already settled.

Task errors appear in management with phase `task`.
They do not disable an active plugin or turn otherwise successful deactivation into failure.
The host does not keep a separate task-history registry; callers retain handles when needed.

The separate `@writers-ide/tasks/worker` entry has no Svelte runtime dependency.
It handles request, result and error messages, buffer transfers and cleanup.
Workers terminate after completion, failure or cancellation.
Late results cannot apply after cancellation.
A synchronous result handler runs at most once while its task is active.

No function serialization, worker pool, worker-progress protocol or timeout API is added.
The guide explains why computation must be separated from synchronous result application.
It also explains stale results and cancellation limits.
Position mapping and undo grouping remain outside the task library.

#### Provider APIs and dependencies — Part 2

A provider is a plugin exposing an API for another plugin to use.
`definePluginApi<T>({ id, major })` creates a frozen contract identity.
The major version is a positive safe integer.

Providers declare `provides: [{ id, major }]` and publish every declared API once during activation.
Consumers declare `{ provider, api, major, optional? }` dependencies.
The host matches exact plugin IDs, API IDs and major versions.
This is not package-version range negotiation or automatic installation.
Self-dependencies and duplicate declarations are rejected.

Before enabling a consumer, the host checks its whole required dependency graph.
Missing contracts, incompatible versions and required cycles fail before activators run.
Required providers activate before consumers.
A provider that enabled successfully stays enabled if a later consumer fails.

Optional dependencies never activate providers automatically.
A consumer can remain active without them.
`get` returns `null` for an unavailable optional integration.
Owned subscriptions deliver current availability immediately, then report arrival, removal or reactivation.
Optional cycles between distinct plugins are allowed.

API factories run synchronously when a consumer first requests a connection.
They return plain objects containing only own string-named methods.
Fields, getters, symbols, class methods, promises and `then` methods are rejected.
The host caches a frozen API object for that consumer and provider activation.
Its methods reject calls after either plugin stops.
Returned objects and functions are not recursively wrapped.

A connection provides cancellation, owned cleanup and guarded callbacks.
Guarded callbacks return `undefined` after cleanup; their type reflects that possibility.
`reportError(error)` attributes a failure to the exact connected consumer activation.
Old reporting functions cannot report against a new activation or a different plugin.
These reports use phase `provider` and do not disable the plugin.

Management distinguishes missing, incompatible, inactive and available dependencies.
An available provider may still fail when constructing a particular consumer's API.
Dependency failures affect activation status.
Provider and task errors remain visible without independently failing plugin lifecycle status.

`planDeactivation` lists active required dependents before their provider.
The host refuses to disable such a provider without explicit cascade consent.
The manager shows the list and focuses Cancel.
It checks the list again before acting and asks for renewed confirmation if it changed.
Optional consumers stay enabled and receive a removal notification.

`requiredPluginIds` protects any listed plugin in the affected dependency chain.
This is a manager UI rule, not a security permission.
Lifecycle changes during notifications must be deferred until the callback returns.

#### Editor access and formatting — Part 3A

The owner approved live `EditorState` and `EditorView` access inside synchronous callbacks.
`@writers-ide/word-processing` provides these contracts and reusable service code without app imports.
There are now five private workspace packages.

The app's `createWordProcessingPlugin()` supplies registered views and active-tab/update notifications.
The route registers the provider and Basic Menu.
Enabling Basic Menu resolves its required provider first.
Route teardown stops the provider and its consumers without destroying source-owned views.

The API supplies observations, inspection, edits, commands and result application.
Targets contain `{ viewId, documentId, revision }`.
Revision numbers increase across service restarts.
A state change, including a selection-only change, makes an old target stale.
The service checks the target, cancellation, editability and optional active-view requirement around callbacks and dispatch.
It discards stale background results rather than mapping or retargeting them.

Commands capture at most one transaction.
The service applies it only after synchronous success and another validity check.
Retained dispatch callbacks stop working after the invocation ends.
Nested inspection is allowed. Nested edits and edits during notifications return `busy`.
Command registrations and subscriptions are removed with their connection.

These rules do not enforce safe use of raw objects.
An async body or direct `EditorView.dispatch` call may already have acted before an error is detected.
`tr.before` checks the transaction's document, not its original `EditorState`.
A retained transaction can therefore pass that check against an unchanged document while still violating the callback contract.

`createFormattingPlugin()` no longer receives a route-injected singleton.
It resolves the provider and creates `FormattingService(provider)` for each activation.
Formatting contracts and policies remain in `menu/basic/`.
The existing copied-summary/request interface, stale checks and subscription cleanup remain intact.
Caret no-ops, mutually exclusive marks and continuation-aware paragraph commands are preserved.

Quick Format is an independent consumer using the same public API and upstream `toggleMark`.
It supports the production `bold` mark, conventional `strong`, caret stored marks and both orientations.
It does not import Basic Menu.
Only the dedicated fixture registers this opt-in example.

#### Editor behaviors — Part 3B

The owner separately approved updating existing editor states to add and remove ProseMirror plugins.
The public API adds `registerBehavior`, `behaviors` and `subscribeBehaviors`.
A behavior factory runs once for each matching live view/document instance and returns Plugin objects.
An optional view-ID list limits where it applies.
Each instance receives an abort signal.

Managed plugins run before the existing host plugins.
Higher priority runs first; ties use registration order.
The host plugins keep their identities and relative order.
Duplicate registration IDs fail.
Duplicate plugin keys fail the new registration, even if it has higher priority.

`EditorState.reconfigure` keeps the same schema, document, selection, stored marks, history and surviving keyed plugin state.
Reconfiguration does not create an undo entry or replace the editor view.
It does change the strict editor revision.
ProseMirror may recreate plugin-view resources when the plugin list changes.
Surviving factories, wrapped Plugin objects and signals remain stable.

Wrappers preserve original generated keys, including keys of upstream plugins that did not specify one.
This preserves `getState` and transaction metadata behavior.
`nodeViews` and `markViews` are rejected until Part 3C.

A dedicated observer detects views being added, replaced or closed.
Source-driven updates run after the current JavaScript call stack, not inside an editor hook.
Candidate states are checked before installation across views.
Changes to sources or input state cause stale candidates to be rebuilt.
Newer dispatches from plugin-view setup are retained.

Reconfiguration stops after 16 unsuccessful stabilization passes.
It then disables the still-active registrations conservatively.
This does not identify every possible source of arbitrary callback side effects.
It also does not stop an infinite callback or an unbounded ProseMirror append loop.

Runtime errors disable the affected registration across views immediately.
Physical removal waits until it is safe to update plugin lists.
A failing filter rejects the current transaction.
A failing append hook returns no transaction.
State apply temporarily retains its previous value until removal.
Other supported callbacks use documented safe fallbacks.
Cleanup continues after plugin-view errors.

Failures are sent independently to the connection and an optional source observer.
One reporter throwing does not suppress the other.
Late connection reports are ignored after revocation, but source observers may still receive cleanup errors.
See the [word-processing guide](../../packages-js/word-processing/README.md) for the complete callback rules.

#### Accepted transactions and pagination

App dispatch now uses `applyTransaction` to obtain accepted root and appended transactions.
A filtered root produces neither `PreUpdate` nor a DOM update.
Every accepted transaction emits `PreUpdate` before the final DOM update.
PageObserver can therefore inspect appended edits in their own document coordinates.

The unchanged page-index helper moved to `view/page-indexes.ts`.
The app uses `sources.prepareTransaction` to normalize managed appended transactions before application.
It preserves incoming stored marks and validates the current document.
The schema and model-mutating pagination design are unchanged.
See the [pagination entry](../pagination/change-log.md).

#### Behavior examples and developer guides

Three independent examples use only the public provider API:

- Upstream ellipsis/em-dash input rules, including `undoInputRule`.
- Selection highlights stored as mapped `DecorationSet` state, not authored marks.
- Worker analysis of selected text, limited to 32,768 model positions and 1,024 text-node chunks.

Worker analysis does not scan the whole manuscript or match tokens across text-node boundaries.
It uses per-view cancellation and strict-target result application.
The root dependency is `prosemirror-inputrules` `^1.6.0`, locked to `1.6.0`.

The [example guide](../../src/lib/editor/prosemirror/behaviors/README.md) lists commands and limits.
`BehaviorFixture.svelte` enables these examples through an explicit test control.
The default app and existing fixture scenarios leave them disabled.
The fixture's structural split is not a test of real pagination geometry.

The package guides, feature guides, architecture pages and roadmap have also been rewritten for new readers.
They now introduce terms before using them and separate current behavior from future work.
The five writing rules are prominent in `AGENTS.md` and `CONTRIBUTING.md`. They require simple sentences, clarity, little assumed context, explicit API usage context, and removal of discarded designs from current guides.
The task guide explains who calls `activate(context)`, when activation happens, and how application setup registers a plugin. Its example supplies its own inputs. Current guides describe the supported design without unreleased migration commentary or rejected alternatives. Changelogs retain the history.
This editorial pass changes no runtime code or contracts.

#### Tests and known limits

These are the recorded implementation results before the documentation-only rewrite:

| Check                                                          | Recorded result               |
| -------------------------------------------------------------- | ----------------------------- |
| Unit tests                                                     | 1,111 passed in 49 files      |
| Full app browser suite                                         | 116 passed in Chromium/WebKit |
| Exact smoke command                                            | 22 passed                     |
| Word-processing browser fixture                                | 24 passed                     |
| Provider browser fixture                                       | 8 passed                      |
| Task/worker browser fixture                                    | 8 passed                      |
| Production builds, lint, local Markdown targets and whitespace | Passed                        |

Unit coverage includes 79 behavior cases, 53 existing service cases and five actual-dispatch regressions.
The provider suite includes 54 graph/API/reporting cases.
Manager tests cover confirmation, changed dependency lists and protected plugins.

The app manager regression checks provider disable/re-enable, manuscript preservation and undo history.
Other app tests cover docking, tooltips, capacity, formatting, pagination geometry, selections and stylesheet compatibility.
The exact CI smoke command includes manager and pagination-selection regressions.

The dedicated fixtures have separate production builds.
`test:word-processing` includes its original six scenarios plus six behavior scenarios, for 24 engine-specific cases.
The existing Browser Smoke CI step runs both files.
Main app e2e excludes all dedicated-fixture files.

`pnpm check` reported the existing `Modal.svelte` `$props` type-argument error and five older DnD warnings.
It reported no diagnostics in changed implementation files.

Initial app validation and a focused repeat hit an intermittent Chromium collapsed-selection timeout.
Both pre-3B and current dispatch passed five isolated caret runs.
The final full and smoke runs passed without changing the helper or assertions.
The cause remains unestablished; selection timing is not claimed fixed.

No packaged Tauri, native-permission, real-touch or performance-target validation is claimed.
The documentation-only pass passed Oxfmt, local link and heading-fragment checks, and whitespace checks.
Original heading anchors were preserved.
Only Markdown files changed. Runtime suites were not rerun for this editorial work.

#### Security decisions and remaining work

Official and third-party plugins must use the same public APIs.
Wrappers around upstream ProseMirror packages provide compatibility, not isolation.

The owner revised the original frontend-isolation plan.
Frontend code may use ordinary Svelte, editor APIs and network requests.
It is trusted JavaScript, not sandboxed code.
Document access plus network access permits data disclosure.
Backend/system access must still be restricted before external loading is added.

This branch does not add external installation, persistent activation preferences, native permission grants or schema migration.
It also does not add general component-state transfer, durable history storage, full editor extraction or plugin translations.
New manager/fallback text remains English.
Parts 3C and 4 need separate design approval.
PR and merge metadata remain to be verified.

## Merged PRs

### 2026-11-14 — [#80 — Stage 1 bundled plugins and formatting boundary](https://github.com/benyakirten/writers-ide/pull/80)

**Status: Merged 2026-11-14.** Branch: `bh/add-plugin-interface-js`.

This PR introduced the first bundled-plugin contracts and moved Basic Menu onto them.
The following describes that PR, not the later branch behavior above.

#### Design and scope

The documentation distinguished plugin responsibilities, core responsibilities and reusable libraries.
Formatting, docking and a future undo-tree view illustrated those differences.
The undo-tree example did not select or implement history storage.

The approved sequence at that time was:

1. Establish contracts, a bundled host and formatting migration.
2. Extract private layout/component libraries and add plugin management.
3. Implement isolation, messaging, validation and permissions before third-party loading.

Detailed APIs and isolation mechanisms were still open.
Stages 1 and 2 were for trusted code, not sandboxed external plugins.
The original data/command contracts were designed to be transferable.
Direct Svelte components were treated as trusted rendering adapters.

The guides described existing registries, package scaffolds, data-preservation rules and unresolved decisions.
The new topic was linked from project context and the documentation index.
The package README became a plugin-author guide with goals, API examples, lifecycle advice and host integration.

#### Implementation

The private `@writers-ide/plugins` package added no external dependency or published SDK.
Its data/lifecycle contracts had no framework dependency.
Svelte presentation types used a separate entry point.

The synchronous host checked API versions, declarations and duplicate contribution IDs.
It started plugins, reversed partial activation on failure and cleaned up in reverse order.
Old API handles stopped working after deactivation.
Management received immutable status/error snapshots.

App adapters registered toolbars, views and command handles.
The route enabled formatting at startup and disabled it at teardown.
The legacy word processor remained in place.
View-instance metadata, shortcut routing and full editor extraction stayed deferred.

Horizontal and vertical formatting controls received copied summaries and validated command requests.
Document IDs were resolved to separate view IDs.
Stale active-view or state requests were rejected before reactive updates finished.
The migration preserved mark exclusivity and paragraph-continuation formatting.
Unavailable or no-op controls were disabled.
Subscriptions started lazily and stopped when unused.
Read-only availability queries created no speculative transactions.
Listener failures did not interrupt editor dispatch.

Disabled toolbar placements retained IDs and orientation costs.
This prevented capacity overflow after disable/fill/re-enable.
Layout/state persistence was not added.
The peer-group query's old document debug log was removed.
Related changes are in the [docking](../dnd/change-log.md) and [pagination](../pagination/change-log.md) entries.

#### Page-boundary regression

New availability queries exposed an unsafe peer-paragraph lookup.
A fixed offset could reach a page-closing position, but the old code assumed it was inside a text block.
This caused `Index … out of range` errors during formatting and reflow.

The fix resolved blocks by their actual structure.
It crossed page boundaries explicitly and treated a nonempty selection's end as exclusive.
It identified final blocks by index rather than structural equality.
The browser assertions were not weakened.

Tests covered lifecycle rollback, declarations, duplicate IDs, stale requests and cleanup.
They also covered separate document/view IDs, both toolbar orientations, formatting ratios, exclusivity and reserved capacity.
Production-schema cases included multi-page selections ending in `pageEnd`, reversed ranges and full-document selection.

#### Recorded validation

- All 759 unit tests in 34 files passed.
- The exact smoke command passed 16 Chromium/WebKit cases. Three full repeats passed another 48 cases.
- Production builds passed.
- Lint, local Markdown links and whitespace checks passed.
- Check remained blocked by the existing `Modal.svelte` type-argument error and five DnD warnings.

An earlier 52-case smoke/docking run had omitted the pagination-selection tests used in CI.
The exact CI command reproduced the peer-group exceptions before the fix.

One Chromium caret-range assertion also failed once during verification.
It then passed five focused repeats and the three full-suite repeats without helper changes.
This did not establish that all selection timing issues were fixed.

These local macOS results did not verify Windows/Linux CI, packaged Tauri or third-party isolation.

#### Remaining work at merge

The manager had synchronous snapshots but no reactive subscription yet.
Activation preferences were not saved.
In-process JavaScript was not sandboxed.
Stage 2 libraries/management and Stage 3 enforcement remained future work.

Merge evidence: [GitHub PR metadata](https://api.github.com/repos/benyakirten/writers-ide/pulls/80).
The recorded metadata is `merged: true`, `merged_at: 2026-11-14T19:08:58Z` and merge commit `4b39895c5218498fd1c0e79c99b1ea8012f1b67a`.
That commit matched `main` when the evidence was checked.
