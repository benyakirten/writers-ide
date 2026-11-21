# Plugins and reusable libraries — PR change log

This page records changes to plugin hosting, reusable packages and editor extension APIs.
Read [context.md](context.md) for the current design and terminology.

## In progress

### `bh/phase-2-plugin-transition` — Stage 2 libraries and plugin management

**Status: In progress / unmerged.** No PR identity or merge date has been verified for this branch.

This branch moves shared layout, UI and task code into reusable packages.
It also lets plugins use one another's APIs and extend the existing editor.
The work includes Parts 1–2, 3A–3B and Part 3C's first rendering slice in the [implementation plan](implementation-plan.md).
New content types and schema lifecycle remain separately gated within Part 3C. Part 4 now has an internal native integrity foundation; external installation and loading are not implemented.

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
Ordinary behavior registrations reject `nodeViews` and `markViews`; dedicated renderer APIs are described below.

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

#### Existing-content rendering — Part 3C first slice

The owner approved dedicated node/mark registration, rejection of overlapping renderers, schema fallback on removal or failure, and reusable Svelte adapters. New content types and schema lifecycle remain outside this slice.

`registerNodeView` and `registerMarkView` accept a type name, optional view allowlist and synchronous per-view constructor factory. Factories receive a cancellation signal and `reportError` for later failures. Connection ownership removes registrations on disable or provider teardown. Renderer IDs share the behavior namespace, but renderer entries are excluded from behavior snapshots. Conflicts include existing direct view props and unmanaged plugin maps; there is no priority-based replacement. Ordinary behavior registrations still cannot supply renderer maps.

One reconciliation engine installs behaviors and renderers. It preserves the schema, document, selection, stored marks, history and surviving keyed state. Guards retain constructor and callback receivers and enforce synchronous results and stable DOM identities. Native mark updates are supported by the installed ProseMirror version and forwarded correctly. Nullable `contentDOM` is accepted. Invalid native DOM is rejected before it can fail outside the owning renderer's guard.

The optional `@writers-ide/word-processing/svelte` entry mounts ordinary components. Its action attaches ProseMirror-owned content to one stable, empty host. Svelte owns surrounding UI only. Adapters update node and mark props, route events and mutations, and unmount resources once. On boundary failure, editable content is rescued before Svelte removes its failed branch. `onError: ctx.reportError` quarantines that registration across views and restores schema rendering without authored edits. Arbitrary event-handler and async failures remain outside the boundary's guarantee.

Optional `sources.invalidateLayout` connects renderer geometry to PageObserver. One lazy resize observer per view tracks renderer resources. Inline renderers include a containing layout box, with a shared child-list observer refreshing targets after mounting or page reparenting. Initial size notifications establish baselines. Actual size and installed-set changes are coalesced without restarting pagination for every source update or resource reconstruction. Provider disposal preserves final fallback invalidation for still-live matching sources. Pagination algorithms and the document schema are unchanged. See the [pagination entry](../pagination/change-log.md).

Opt-in fixtures cover ordinary node/mark rendering and async failure recovery. A separate fixture uses production schema, dispatch, PageObserver and Paginator to verify block UI resizing and inline font changes against real page bounds. The default app does not enable these examples. Tests do not establish real IME, native isolation, general upstream compatibility or responsiveness at large-document scale.

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
Agent instructions also require owner approval for architecture and API design. Agents must explain unresolved choices and tradeoffs rather than assume an answer. Routine implementation details remain autonomous. Documentation maintenance applies to every affected guide in the same change.
The project overview describes ProseMirror as the baseline for document modeling and editing behaviors. Commit and branch-status tracking stays in changelogs rather than a dedicated overview section.
The Part 3C plan separates the implemented existing-type renderers from future new-content/schema work. Current guides explain the approved registration, conflict, fallback and Svelte contracts. Schema lifecycle and unsupported-content preservation still require owner approval.
The owner approved separately packaging Basic Menu as a required outcome by the end of Part 4. The plan requires the same supported loading mechanism and public APIs as third-party plugins, plus real-feature regression coverage. Package format, build, distribution and default installation policy remain open; this approval does not settle those designs. Current context and the Basic Menu guide link to that deliverable.
The owner also approved Part 4 packages demonstrating toolbar UI, editor behavior, workers and custom rendering. The plan reuses current examples where practical and does not require enabling them by default. Full editor extraction, independent pagination packaging and undo-tree history infrastructure remain outside that requirement. The approved first Part 3C slice now implements existing-content rendering; new-content contracts remain open.

#### TypeScript declaration convention

The owner requires `type` for struct-like data and `interface` for behavioral contracts. `AGENTS.md` and the [contributor guide](../../CONTRIBUTING.md#use-types-for-data-and-interfaces-for-behavior) now state this rule. Callback-bearing options, registrations, props and context records remain data types. Service, lifecycle and callable function contracts use interfaces. Declaration-merging interfaces remain where TypeScript requires them.

The repository-wide audit applies this distinction to plugin manifests, dependency metadata, contributions, host options, formatting data, editor targets and snapshots, renderer props, benchmark data and browser fixture arguments. Named callback contracts use callable interfaces. Existing member names, generics, modifiers and callback signatures are preserved. Inherited data shapes use intersections. No runtime behavior changes are intended. Related records are in the [docking](../dnd/change-log.md), [pagination](../pagination/change-log.md) and [browser-performance](../browser-performance/change-log.md) entries.

Validation for the declaration refactor passed all 1,191 unit tests, `pnpm check:performance`, repository lint, local Markdown file/fragment links and whitespace checks. Emitted JavaScript was identical for all 20 changed TypeScript/Svelte files, excluding comments. `pnpm check` still reports the existing Modal error and five DnD warnings, with no new diagnostics. Browser runtime suites were not rerun for this declaration-only refactor; earlier browser results below remain evidence for the renderer implementation.

#### Native package integrity foundation — Part 4 first slice

The owner approved an internal Rust implementation before installer/loader integration. `src-tauri/src/plugin_integrity/` now creates candidate records, parses supplied host records and verifies installed file sets. Version-1 JSON records map relative file paths to byte lengths and lowercase SHA-256 digests. Object-only parsing rejects duplicate paths/fields, unknown fields, malformed hashes and unsupported versions.

`verify_package` returns immutable owned bytes only after every file matches. Later source overwrite, deletion or replacement cannot alter that result. Missing or unexpected files fail the whole operation. Candidate creation and verification neither persist nor replace accepted records. A plugin-local checksum file has no special authority. The future loader must consume verified bytes rather than reopen paths.

The directory reader rejects root/descendant symlinks, Windows reparse points, special files, invalid UTF-8 names and nonportable paths. Capability-based no-follow opens and opened-handle checks protect against replacement after classification. Unix opens are nonblocking before type validation so a FIFO swap cannot block the reader. The host supplies trusted root ancestors. Collection is not an atomic filesystem snapshot; every returned buffer still has to match the trusted record. Empty directories are checked and bounded but not hashed.

Default limits bound file count, depth, path length, directory work and actual bytes read: 2,048 files, 16 MiB per file and 64 MiB total. Work is synchronous and must be scheduled appropriately by the eventual installer. The implementation uses `sha2` 0.10.9, capability filesystem crates locked to 3.4.6, and `tempfile` for tests. The module remains private with no new Tauri commands or loading path.

On macOS, all 31 Rust tests passed with `cargo test --locked --lib`. `cargo fmt --all -- --check` and `cargo clippy --locked --lib --tests -- -D warnings` also passed. Tests cover independent SHA vectors, exact records/file sets, malformed/duplicate JSON, limits, unsafe paths, source replacement, symlink swaps, special files and unchanged trusted records on failure. Validation used Rust/Cargo 1.99.1, not the minimum supported Rust 1.90. Native Windows/Linux execution, packaged Tauri enforcement, archive extraction, host-record persistence and browser delivery remain unverified or unimplemented. Frontend browser suites were not rerun for this internal Rust-only slice; their recorded results below belong to the earlier frontend implementation.

#### Tests and known limits

Recorded frontend validation, including Part 3C's first rendering slice:

| Check                                                          | Recorded result               |
| -------------------------------------------------------------- | ----------------------------- |
| Unit tests                                                     | 1,191 passed in 52 files      |
| Full app browser suite                                         | 116 passed in Chromium/WebKit |
| Exact smoke command                                            | 22 passed                     |
| Word-processing browser fixture                                | 50 passed                     |
| Provider browser fixture                                       | 8 passed                      |
| Task/worker browser fixture                                    | 8 passed                      |
| Production builds, lint, local Markdown targets and whitespace | Passed                        |

Unit coverage includes 59 renderer cases, 16 Svelte adapter cases, five layout-observer cases, 79 behavior cases, 53 existing service cases and five actual-dispatch regressions.
The provider suite includes 54 graph/API/reporting cases.
Manager tests cover confirmation, changed dependency lists and protected plugins.

The app manager regression checks provider disable/re-enable, manuscript preservation and undo history.
Other app tests cover docking, tooltips, capacity, formatting, pagination geometry, selections and stylesheet compatibility.
The exact CI smoke command includes manager and pagination-selection regressions.

The dedicated fixtures have separate production builds.
`test:word-processing` includes editor access, behaviors, renderer lifecycle/failure recovery and production-pagination geometry, for 50 Chromium/WebKit cases.
The existing Browser Smoke CI step runs the dedicated configuration, including the new renderer files.
Main app e2e excludes all dedicated-fixture files.

`pnpm check` reported the existing `Modal.svelte` `$props` type-argument error and five older DnD warnings.
It reported no diagnostics in changed implementation files.

Initial app validation and a focused repeat hit an intermittent Chromium collapsed-selection timeout.
Both pre-3B and current dispatch passed five isolated caret runs.
Part 3C validation also hit the Chromium collapsed-selection timeout once: 115 app cases passed and one failed in the existing range helper. A full repeat passed all 116 cases, and smoke passed all 22. No selection helper or assertion changed. The cause remains unestablished; selection timing is not claimed fixed.

Validation used pnpm 12.4.1 and installed Node 24.6.0. That Node release is below the repository's required `^24.15.0` range, so these runs do not verify the supported Node toolchain.
No packaged Tauri, native-permission, real-touch, real-IME or performance-target validation is claimed.
The earlier documentation-only pass preserved original heading anchors. Current implementation validation includes unit and browser suites, production builds, repository lint and documentation checks. Type checking remains blocked as described above.

#### Security decisions and remaining work

Official and third-party plugins must use the same public APIs.
Wrappers around upstream ProseMirror packages provide compatibility, not isolation.

The owner revised the original frontend-isolation plan.
Frontend code may use ordinary Svelte, editor APIs and network requests.
It is trusted JavaScript, not sandboxed code.
Document access plus network access permits data disclosure.
Backend/system access must still be restricted before external loading is added.

The owner approved native-request attribution through host-issued activation tokens held privately by frontend service objects. Services attach tokens to `invoke` requests. Rust resolves identity and approved grants from its own registry, authorizes operations and validates arguments. Native endpoints must not accept untrusted plugin IDs as identity or allow direct `invoke` calls to bypass checks. Token issuance remains host-controlled. Tokens are revoked on activation end and replaced on reactivation; completed effects are not rolled back.

The package direction allows multiple frontend and backend components and static permission declarations in `manifest.toml`. Part 4 implements frontend loading; backend execution and its restricted runtime are deferred. Permissions may be package-scoped, component-scoped or both. All applicable permissions are mandatory for activation, with per-project acknowledgement or an explicit application-wide grant. Updates requesting more authority need renewed approval. Exact field definitions, grant storage, issuance protocol and native service signatures still need approval. Additive grant composition and cooperative revocation are approved below. Attribution identifies the credential whose authority is exercised, not tamper-proof JavaScript provenance. Logging is deferred. This decision is documented in context, plan and project overview; native enforcement is not implemented.

The owner also approved shared-host dependency build tooling, distinct component execution lifetimes, local installation/manual updates, compatibility checks before execution, preserved plugin data and one initially active version per package identity. The design must avoid unnecessary barriers to multiple installed versions later. Missing dependencies are reported rather than automatically obtained. Fresh installations include default feature packages; the roster and permission onboarding remain to be refined. Basic Menu is a required default package; undo and word-count/data features illustrate the intended default set, not newly implemented features. Prebuilt ZIP distribution is approved, with `manifest.toml` at the archive root and no enclosing package directory. Extraction must reject unsafe, duplicate or ambiguous entries, links and special files; bound expanded size/work; and validate in staging before acceptance. Integrity records cover extracted file bytes, independently of compression metadata. Filename extensions and exact extraction APIs are not selected. Optional developer directory loading remains open.

The owner approved SHA-256 integrity checks for prebuilt packages. Host-managed records hold the digests accepted at installation. Contents are verified before use, including manifest, executable modules, workers, styles and assets. Loading must prevent a verification-to-use replacement gap. Unexpected changes block use pending explicit reinstall/update rather than silently replacing the accepted digest. SHA-256 was chosen instead of MD5 because MD5 is unsuitable for security-sensitive tamper detection. Digests are not publisher authentication or proof of safe code. Publisher signing and key policy remain separate decisions; logging remains deferred.

The earlier documentation-only decision pass checked Oxfmt, whitespace and local links without rerunning runtime suites. The native integrity foundation above now has its own Rust validation. Current context and the plan distinguish that implementation from the installer and loader work still required.

The owner approved package identity fields in `manifest.toml`: optional `namespace`, stable machine-readable `name`, human-readable `display_name` and separate `version`. Canonical IDs are derived as `@namespace/name` or unscoped `name`. Component IDs are local to each package. Shared namespaces do not imply shared permissions or authenticated publishers. Namespaced and unscoped packages coexist; namespace/name changes are identity changes and must not silently inherit grants or saved associations. Display names can change without changing identity. Exact identifier grammar and remaining manifest/lifecycle fields remain open.

The owner approved independent component activation. Installation and updates remain package-wide, but unrelated healthy components survive a sibling's activation failure. Required dependencies determine which consumers are affected. All applicable permissions remain mandatory for each activation. Existing task and renderer-registration failures do not automatically disable the component. Package-level controls can act over component lifecycles. The owner approved author-declared `default_enabled` flags, defaulting to false. Defaults apply on first configuration; saved user selections survive disable/re-enable and are not silently overwritten by updates. New components need explicit enablement or an approved dependency activation. Mandatory grants still apply.

The owner also confirmed required component dependencies: B cannot activate or remain active while its required A is disabled. Shared package membership alone is not a dependency. The owner approved full dependency-impact review for enablement and disablement. Re-enabling disabled requirements needs explicit consent and mandatory grant acknowledgement. Plans are rechecked before execution; changed impact requires renewed review. Disabling requirements needs cascade consent and stops dependents first. No silent re-enable or dependent shutdown is allowed. Required cycles fail before startup. Exact declaration syntax and management APIs remain open.

The owner approved named `activate(context)` exports for frontend component entry modules. Metadata belongs only in `manifest.toml`. Activation retains synchronous setup/provider publication, activation-scoped state, owned cleanup, signals and an optional synchronous disposer. Managed tasks handle continuing asynchronous work. Module import is distinct from activation; authors must not start unmanaged feature work at module evaluation or assume a fresh module on re-enable. Exact entry-path fields and loading remain open. The owner approved a host-defined frontend runtime profile, initially one supported target, covering shared SDK/Svelte/ProseMirror expectations. Build tooling emits the requirement; unsupported profiles fail before import. Profiles are separate from app/package versions and provider API majors, remain stable across compatible app releases and change for incompatible runtime contracts. Recommended author tooling and a test harness should make targeting a profile straightforward, while a documented output contract allows alternative build systems. The owner approved native ES-module output and a host-managed import map installed before imports. Supported shared modules must resolve to the host's actual instances. Private code may be bundled or package-local, with package resources loaded through verified bytes. No custom module registry/injection API is required. Exact profile IDs, manifest fields, shared exports/versions, resource URLs and worker rules remain open; packaged Tauri validation is still required.

The owner approved virtual resource URLs as the primary verified-package delivery model. A native handler serves immutable verified bytes, not unchecked disk paths. Relative module/asset references retain meaningful bases; accepted snapshots receive distinct resource identities and caches must be bounded. Exact scheme/origin, URL/MIME rules, cache lifecycle and worker delivery require prototyping and packaged Tauri validation. Blob URLs may support individual worker/bootstrap cases. Resource URLs do not provide native permission authority, publisher identity, module unloading or automatic live-update safety.

The owner approved one self-contained ES-module output bundle per frontend worker, including dependencies and worker-side SDK helpers. Source may be modular; worker code splitting/package-local module graphs are deferred. Workers do not inherit the main import map or share runtime instances. Existing task ownership, cancellation and frontend result validation remain. Native worker URL/origin, optional Blob bootstrap and asset handling still need packaged-runtime validation. This is frontend work, not deferred backend execution.

The owner approved additive native permission requirements: common package requirements plus each component's own declarations. Components cannot subtract inherited requirements or gain a sibling's component-specific permissions. Every effective requirement is mandatory. Refusing a package requirement blocks inheriting components; refusing a component-specific requirement affects it and required consumers, not unrelated siblings. Authors should use component-level declarations unless a requirement is genuinely common. Exact vocabulary, resource scopes, storage and acknowledgement UI remain open.

The owner approved restart-required updates for Part 4. Validate and stage replacements while the session continues using the old version, then recheck compatibility/dependencies/grants before activation at the next application start. Do not hot-replace modules, force restart or discard writing state. Running/staged versions are distinct, and component toggles remain available for the loaded version. The owner approved explicit recovery after update failure. Keep failed components disabled and report errors in the manager; unrelated healthy components remain active, subject to required dependencies. Never automatically execute the previous version. Retain the previous accepted package for user-confirmed package-wide restoration at the next restart. Review affected components/dependencies and recheck integrity, compatibility, dependencies and permissions. Restoring code does not restore saved data or guarantee older-version data compatibility. Exact startup promotion and recovery UI contracts remain open. This policy is not implemented.

After reviewing the original Stage 1 command scaffold, the owner confirmed the purpose of application-command contributions: named actions independent of a particular UI, useful for cooperation. Current host registration/invocation/revocation is implemented, but there is no user-facing command routing or plugin-facing invocation API. Callbacks are synchronous, take no arguments and carry no implicit editor target or native authority. The owner approved cross-plugin invocation through declared dependencies, using qualified package/component/local-command identity and consumer-local aliases. Resolve the appropriate project/window activation, not the first registered generic ID. Required command dependencies participate in lifecycle planning; optional commands can be unavailable without automatically enabling providers. The owner approved declared typed arguments validated before action execution, while retaining argument-free commands. Consumers supply inputs rather than configuring the provider through private state. No argument UI is generated automatically. The owner approved the concrete contract shape in the [shared command guide](command-contract.md): Standard Schema-compatible validators and inferred types, `definePluginCommand`, manifest command declarations, nested dependency-command aliases and `context.commands.execute` using both aliases and a shared contract. Command aliases are local to their dependency. Match exact contract majors independently of package ranges; breaking argument/result changes need a new major. No validation dependency is added. Publication checks and optional availability reporting remain to be specified. The owner subsequently approved awaitable command completion: implementations may complete synchronously or return a promise; invocation always returns a promise that settles when the defined action finishes. Starting background work is not completion. Synchronous throws and asynchronous failures reject it. The owner approved typed command results declared in the shared contract and validated before delivery. Invocation resolves with the typed result, or `void` for no value. Failures reject rather than using a universal handled/success boolean. Copied data-only arguments/results and exact-major compatibility are approved. Raw functions and live service/editor/DOM handles are excluded. The extended structured-clone value list, schema transforms and resource budgets remain to be specified. The owner approved per-invocation cooperative cancellation linked to caller cancellation, caller/provider teardown, command removal and project-connection lifetime. Abort its signal, reject the pending caller promise when the host processes cancellation, suppress late success and observe late failure. Authors must propagate the signal and check before further effects. This cannot preempt arbitrary code, prove all underlying work stopped or undo completed effects. One invocation's cancellation must not affect unrelated provider work/consumers or revoke its credential. The callback context and execution options carry the invocation signal as in the approved contract. Exact error codes and lifecycle edge cases still need specification. Existing task helpers remain the path for substantial work. Activation, ProseMirror hooks and editor callbacks stay synchronous, with fresh validated edits after asynchronous computation. The current argument-free synchronous implementation is unchanged. The command guide records the approved shape separately from the larger specification. The main draft now includes command metadata and invocation surfaces. Current runtime code remains unchanged. This approval does not add a command picker, shortcut system, editor command or provider API. Earlier contribution-identity approval was not blanket approval of those mechanisms.

The owner approved nullable native service groups. The project-file group is present only with at least one file grant; the external-link group requires its own grant. Components with no native requirements receive both as `null`. Per-operation checks remain mandatory, including rejecting reads by list-only components. Calls do not prompt for missing authority. Rust checks every request, and retained services revoke with their activation. This is not implemented.

The owner approved independent lifetimes for explicit project connections. Each owns its API handles, subscriptions and cancellation signal. Disposal revokes those handles, removes subscriptions and aborts its signal without affecting another connection to the same running provider. Provider execution and feature state remain shared; no extra provider activation is created. Consumer teardown disposes all connections. Caller work must use the connection signal for cancellation. The owner approved references bound to one live project opening. Closure permanently invalidates references and connections; reopening creates fresh opening identity/references. Persistent registration remains separate for saved settings and permission associations. Exact signatures, reference fields and validation/copy mechanics remain under review. This is not implemented.

The owner approved local contribution IDs with host-managed runtime uniqueness and stable saved placement identity. Runtime keys include activation, kind and local ID; saved keys use package/component/kind/local identity plus project association. Duplicate IDs for one kind within an activation remain errors. Functional interaction uses declared provider APIs, not UI contribution lookup. Qualified cross-component contribution-reference APIs remain open. This does not change editor-provider registration IDs or approve a new Basic Menu formatting API. The draft remains reference material for question-by-question review; unapproved recommendations are still gated.

The [external package specification draft](package-api-proposal.md) now consolidates the agreed policy into exact recommended manifest and TypeScript contracts. It covers live-opening project references, independent connection leases, component-local contribution IDs, native error/cursor behavior and bounded defaults. Four review groups identify the remaining author-contract, native control/persistence, runtime-profile and Basic Menu decisions. The owner approved a separate plugin-free management/recovery WebView. Rust must validate the actual calling WebView and capability route for permission/package-management commands. Plugin hosts must not grant authority, issue arbitrary credentials or create/navigate/impersonate that WebView. This does not isolate editor plugins or establish hostile JavaScript provenance. Exact control, delivery, persistence and lifecycle protocols still need review and enforcement tests. The owner approved host-provided locale/direction with activation-owned change subscriptions and plugin-owned messages/fallbacks. Plugins can reuse supported libraries or declared provider APIs rather than implement all translation tooling. The owner asked to retain an optional shared translation provider service as a future candidate, not a Part 4 deliverable. Its operations, catalog ownership, dependency/lifecycle rules and fallback behavior remain for later design. The consolidated future-work list records it. No specific new translation library or catalog service is selected. Exact locale signatures remain under review. The built-in editor descriptor also requires project-filtered sources; its current global source adapter cannot be reused unchanged across projects.

The [resource-loading investigation](resource-loading-investigation.md) records current Tauri/bootstrap facts and a bounded fixture-only prototype plan. The current opener capability and injected link handling provide alternate native routes; existing static feature imports also prevent recovery-before-import. Shared module identity must use the host's actual runtime artifacts. No runtime prototype, packaged loading or native enforcement is claimed. The owner approved an imported reusable library surface for minimal continuation-aware selection/grouping helpers. Helpers read supplied ProseMirror state without DOM measurement, dispatch or app singletons; formatting rules stay in the feature package. Preserve existing pagination semantics. Exact exports and result shapes remain under review. Provider-supplied structure queries are recorded as a future candidate, not a Part 4 requirement. The illustrative API names are not approved exports. Basic Menu still needs the exact helper and locale contracts before independent packaging. These documents do not enable external code or change production behavior.

Contract documentation validation passed: Oxfmt on six touched documentation files, `git diff --check`, and 196 local links/fragments. Six TOML blocks parsed; two complete manifests passed structural assertions. Six TypeScript blocks passed syntax parsing, not SDK type checking or validator execution. The candidate Svelte export maps and nine ProseMirror versions were checked against installed packages during the earlier draft inventory pass. Frontend validation used installed Node 26.8.1. No runtime suites, native builds or packaged prototype tests were run for these documentation changes.

The owner approved nonrecursive directory listing in bounded pages for the first native-service version. Callers use opaque continuation cursors for later pages and request subdirectories separately. Cancellation is possible between requests; listings are not consistent filesystem snapshots. Recursive listing in bounded batches is planned future work and recorded as deferred. Traversal/depth limits, partial failures and changes during recursive traversal need later design. The owner approved single-use continuation cursors. Rust consumes a cursor on accepting the request. Success returns a fresh cursor or completion; failure/cancellation releases enumeration resources and requires restarting. Concurrent reuse is rejected. Restarts may repeat delivered entries. Retryable enumeration is tracked as a future candidate. Exact initial listing fields, cursor expiry and numerical limits remain open. No native directory-listing service is implemented.

The owner approved a no-follow policy for native project-file services. Refuse file reads and directory traversal through symbolic links or Windows junctions/reparse points, even when targets are inside the project. Enforce this during access to prevent link-swap bypasses. Safe internal-link support is tracked as a future candidate. The owner approved including identified links/reparse points and special files as `kind = 'unsupported'` in listings, alongside files/directories. Return no targets or contents and do not traverse them. Their presence does not itself fail a listing, but attempted reads/traversal fail. Inspection failures remain errors rather than unsupported classifications or silently omitted entries. The policy does not select broader application import/storage behavior. Native project-file services are not implemented.

The owner approved strict validation of the entire external plugin manifest. Unknown fields must fail validation with clear errors, including fields outside permission declarations. Require an explicit manifest format version and reject unsupported versions before imports. Installation and update candidates follow the same policy. Exact schema details and format-version representation remain under review. No external manifest parser is implemented.

The owner approved rejected promises with structured SDK errors for asynchronous native-service failures. Errors carry stable codes and have an SDK identification helper; authors must not parse messages or assume every caught value is a native error. The SDK will normalize IPC failures. Uncaught rejections in task callbacks use existing task-failure reporting; cancellation retains managed-task semantics. The synchronous editor result API is unchanged. Exact error/helper names and the full code vocabulary remain open. No native service error adapter is implemented.

The owner approved host-managed stylesheets declared per frontend component. Load verified CSS before activation, track ownership across activations and release ownership on teardown or activation failure. Keep styles in place while another activation uses them. Build tooling may emit declarations; ordinary Svelte classes and dynamic inline styles remain available. This is resource management, not CSS isolation. Exact field syntax, ordering and packaged loading still need specification and validation. No stylesheet loader is implemented.

A new [manifest and author API proposal](package-api-proposal.md) combines the approved Part 4 direction with complete package examples. It proposes explicit dependency aliases, limited semantic-version ranges, activation contexts, selected-project connections, native permissions/services and stylesheet declarations. The owner approved whole-project native read scope during review. A grant may cover saved files throughout the registered project directory within host-enforced limits. Directory-specific grants are deferred in the plan. This does not authorize reads outside the project or sandbox frontend editor access. The owner also approved explicit project connections as the foundational API: subscribe to selection, dispose the old connection and connect to the new project. Connections remain project-bound, revoke on closure and clean up with the consumer activation. Missing providers are not automatically enabled. An automatic switching helper is tracked as a future candidate. The owner approved providers using their own grants and credentials for exposed feature operations. Consumers need declared API dependencies, not duplicate native grants. Rust attributes native work to the provider's credential. Providers must validate inputs and preserve resource/project boundaries; supported APIs must not expose general native-command proxies or credentials. Permission review must explain sharing of feature results with declared consumers. This is not hostile-caller isolation in the shared frontend. Consumer connection revocation does not retract delivered data or automatically revoke provider authority. The owner approved consumer-local dependency aliases for same-package and cross-package component references. Manifests identify provider packages/components; runtime lookup uses the alias and imported contract rather than constructed activation IDs. Exact connection signatures, native service names, manifest fields, duplicate-target rules and enforcement mechanisms remain under review. The remaining proposed contracts are not approved or implemented. The context and plan link to the review document. A stale terminology paragraph now distinguishes package installation from component activation.

The owner approved optional package-version ranges on component dependencies, alongside exact API-major requirements for API dependencies. Package versions use semantic versioning with a documented, limited range syntax. Required mismatches block activation with an explanation; optional mismatches leave the integration unavailable without blocking activation. Resolution checks installed versions only, without automatic downloads or multiple-version selection. The owner approved exact semantic versions or space-separated `>`, `>=`, `<` and `<=` comparisons that must all pass. Comparison ranges exclude prereleases; exact prerelease versions are accepted explicitly. Wildcards, caret/tilde shorthand and OR expressions are outside initial scope. Richer syntax is tracked as a future candidate. Exact manifest fields remain open. Current in-process APIs do not implement this check.

The owner approved an explicit recovery launch mode for Part 4. It skips imports and activation of all packaged plugins, including official packages. Application-owned recovery UI must remain usable without plugin code. Users can disable components, inspect recorded failures and stage restoration of a retained package. Saved enablement choices remain unchanged unless explicitly edited. The launch mechanism and detailed UI contracts remain open. Recovery requires restarting; no interruption of a frozen frontend or recovery of unsaved work is promised. Automatic incomplete-startup detection and recovery suggestions are deferred in the plan. This mode is not implemented.

The implementation plan now consolidates deferred capabilities and optional future investigations, including backend execution, live updates, developer mode, multiple installed versions, worker splitting, automatic updates/catalog, signing, logging, additional runtime profiles, richer tasks and possible isolation research. These are not silently added to Part 4 deliverables. Security enforcement and safe verified loading remain required before external activation.

The owner approved explicit component `activation_scope`: `application` means one frontend activation per window/host; `project` means one per open project within that host. Project services, credentials and owned state remain bound to that project and end on closure. Active-project switching must not retarget them. Application-wide permission acknowledgement does not merge execution instances or authorize all projects. Project contribution routing, discovery APIs and project identity/storage remain open. No frontend DOM isolation is claimed.

The owner confirmed that project features require services from their own project, while global features stay running and connect to a selected project as needed. Project components may require same-host application services; application components may require other application services. Do not resolve required dependencies using whichever project is active. Selected-project connections are explicit and lifetime-bound: switch by releasing/reconnecting, and end the connection when the project closes without stopping the global UI. Ambiguous application-to-project required dependencies and arbitrary cross-project required bindings remain outside the initial model and are tracked as future candidates. Exact discovery/connection APIs remain open.

The owner approved host-managed local project registrations for native approvals. Known validated locations reuse unchanged approvals. Copies create new local permission associations unless application-wide grants cover them. Moves can explicitly relink an existing registration after location validation and review of affected grants. Shared project files, names and portable IDs cannot silently recover authority. Registry schema/storage, secure location matching and relink APIs/UI remain open; this does not select the full project content format.

The owner approved initial native services for bounded directory listing and byte reads within registered projects, plus permission-controlled opening of HTTP/HTTPS links. Project file paths are relative to the approved location. Rust must enforce containment, limits, authorization and cancellation. Reads return saved bytes, not unsaved editor state. Link handling rejects filesystem paths and unsupported schemes. The owner approved separate `operation` and `resource` fields, initially accepting only `project.files.list`/`project`, `project.files.read`/`project` and `external.open`/`http-https`. Listing and reading are separate permissions; neither implies the other. Unknown values and unsupported pairs fail validation before activation. The owner approved limiting native project-file permissions to project-scoped components. Application UI connects to project providers for file work; both components may be in one package. Application components may request `external.open` but cannot declare or inherit project-file requirements. Mixed-scope packages therefore declare file requirements on project components rather than at package level. Direct project-file handles for application components are tracked as a future candidate. Exact service API names and remaining manifest details remain open; these services are not implemented.

Native writes are deferred to plugin-owned persistent storage in host-assigned directories, separated by project/application scope. Ownership must come from authenticated host identity. This does not authorize arbitrary project-file writes or unrestricted exports. Layout, component sharing, migrations and write APIs remain future decisions. Saved data survives uninstall unless explicitly deleted. The plan's deferred-work list records this boundary.

The owner approved safe cooperative cancellation of native work on component disablement, project closure or permission revocation. Reject new requests immediately, cancel queued work, stop running preparation at checkpoints and recheck before final effects where supported. Already committed/safely uninterruptible steps may finish; no automatic rollback is promised. Suppress late results while host-controlled delivery can still be stopped. Rust owns cleanup without requiring a revoked frontend credential. Exact operation checkpoints/commit behavior remain part of the native service design.

The owner approved explicit application-wide native approval for application-level components, which can run without a project. Project components retain per-project acknowledgement with an explicit app-wide alternative. Execution scope grants nothing by itself. Native authority remains limited to declared operations/resources; no native requirements means no native permission prompt, not exemption from frontend trust review. Authors can separate global UI from project-native work. No native permission is inferred from an unrelated project's grant.

This branch does not add external installation, persistent activation preferences, native permission grants or schema migration.
It also does not add general component-state transfer, durable history storage, full editor extraction or plugin translations.
New manager/fallback text remains English.
Part 3C's new-content/schema work and the remaining Part 4 loading/security designs still need separate approval. The token-enforcement direction is approved, but its detailed APIs and enforcement are not implemented.
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
