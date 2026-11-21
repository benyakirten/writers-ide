# Plugins, reusable libraries, and core responsibilities

Writer's IDE separates feature plugins, reusable libraries, and the application core. A plugin adds a feature, such as a formatting toolbar. A library supplies code that other code imports. The core hosts features and coordinates the workspace. A plugin and the core can both use libraries.

This document explains those responsibilities and the current extension contracts. Use the [plugin author guide](../../packages-js/plugins/README.md) to build a bundled plugin. Use the [word-processing guide](../../packages-js/word-processing/README.md) for editor integrations and the [task guide](../../packages-js/tasks/README.md) for managed background work.

## Status and scope

The current implementation supports explicitly registered, trusted bundled plugins. They can contribute toolbars, view presentations, and commands. They can also share versioned APIs, run managed tasks, and extend existing editors. There is no external plugin loader or sandbox. The workspace packages are private and evolving, not a published stable SDK.

The implementation described here includes unmerged work on `bh/phase-2-plugin-transition`. No PR is known. The original host merged in [#80](https://github.com/benyakirten/writers-ide/pull/80) on 2026-11-14.

The [external package specification draft](package-api-proposal.md) consolidates approved Part 4 policy and exact recommended manifest/TypeScript contracts. Its [four review groups](package-api-proposal.md#10-consolidated-review-decisions) cover author contracts, native control/persistence, runtime delivery and Basic Menu extraction. These recommendations are not approved or implemented. The [resource-loading investigation](resource-loading-investigation.md) records source findings and an implemented standalone fixture prototype. The integrated packaged run passed 21 normal and five recovery checks in a debug app on macOS 27.0.1 arm64. This is limited runtime evidence, not production feasibility or native permission enforcement.

Future work includes custom document content and external loading. Both need separate owner approval. The [implementation plan](implementation-plan.md) distinguishes completed work from those proposals. The [implementation stages](#accepted-implementation-stages) group the work by architectural scope. See [project context](../project-context.md) for product direction and [change-log.md](change-log.md) for cumulative branch outcomes and recorded validation.

## The distinction

A **plugin** is an identifiable application feature with declared extension points and a host-managed lifetime. It can supply UI, behavior, or both. A **reusable library** has a useful imported contract outside Writer's IDE application state. Importing it does not give it a plugin lifetime or permissions. The **application core** composes features and enforces shared workspace and platform rules.

These roles describe different things. Plugin versus core describes responsibility. Library versus application-specific code describes reuse. A core service can use a library, and a plugin can use the same library. A package is not necessarily a plugin. Internal reuse does not require publishing a package. A Svelte-specific library is still a reusable library.

### Plugin terminology

The following terms describe the contracts used below:

- **Lifecycle:** registration, activation, deactivation, and cleanup. Registration makes a plugin known to the host. Activation starts its feature and creates a new activation context. Deactivation ends that activation and releases its resources.
- **Contribution:** something a plugin adds through a host extension point, such as a toolbar item, view presentation, or command. One plugin can add several contributions.
- **Capability:** a manifest declaration required to use a contribution API. Current values are `contributions.toolbar`, `contributions.view`, and `contributions.command`. They do not grant manuscript or native access, or restrict JavaScript outside the API.
- **Provider and consumer:** a provider plugin publishes a named, versioned API. A consumer plugin declares that it needs that API. A connection supplies an API object for one consumer activation and provider activation.
- **Revocation:** ending the right to use an activation or connection. Retained top-level API methods then throw. Owned cleanup runs and cancellation signals abort. Revocation cannot undo completed work or automatically invalidate everything a method returned.
- **Application plugin versus ProseMirror `Plugin`:** an application plugin has a feature identity and host lifecycle. A ProseMirror `Plugin` is an editor extension object. It can hold editor state and callbacks. An application plugin may use several ProseMirror plugins or none. Neither kind of plugin is a security boundary.
- **Hook:** a callback that ProseMirror invokes at a defined point, such as filtering a transaction, appending another transaction, or handling a key event. Hooks that need an immediate answer must remain synchronous.
- **Behavioral registration:** a consumer's request to install ProseMirror plugins in matching live editor views. The word-processing provider owns their installation and removal for that connection's lifetime.

**Approved contribution identity; not implemented:** contribution IDs are local to the component. The host combines activation, contribution kind and local ID for runtime identity. Saved placement uses stable package/component/kind/local IDs and project association, not activation IDs. Repeating a local ID for the same kind in one activation is an error. Dependencies call deliberately exposed provider APIs; a toolbar contribution ID is not a feature API. Cross-component contribution references, where supported, need qualified ownership and project resolution. Exact reference APIs remain open. This does not change the word-processing provider's separate registration-ID rules.

A plugin package is the installation and update unit. Its components have independent activation lifetimes and component-specific requirements. Prebuilt ZIP distribution and TOML manifests are approved. The complete manifest and author-facing loading contracts are still under review.

## Responsibility boundaries

The accepted direction is a small core with word processing, formatting bars, and other feature views implemented as plugins. Official and third-party plugins must use the same supported public APIs. Official features must not receive privileged shortcuts into raw editor or application internals. Exact extraction boundaries remain open.

The core hosts contributions and enforces their contracts. It owns workspace layout infrastructure, internationalization, import/export infrastructure, and safe access to platform and project services. Plugins supply feature behavior and presentation through those contracts.

For example, a formatting toolbar supplies horizontal and vertical presentations. It observes formatting summaries and invokes commands. The workbench decides docking, capacity, placement, and focus routing. Moving the toolbar can remount its UI. State that must survive the move cannot live only in that presentation instance.

### Libraries underneath these boundaries

Host-provided locale/direction and activation-owned change subscriptions are approved direction, not implemented. Plugins own their messages and fallback choices. They can still reuse supported translation libraries or declared provider services. An optional shared translation provider service is a future candidate, not a Part 4 requirement. Its operations, catalog ownership, lifecycle and fallback behavior need later design. No particular shared translation helper or catalog service is selected. Official and third-party features use the same public locale API; private app-generated message functions are not that API. Exact locale signatures remain under review. Author guides should make available libraries and provider contracts easy to find before asking authors to implement common functionality.

Private `@writers-ide/layout` supplies registry, capacity, transfer, floater, and drag primitives. It has no manuscript, ProseMirror, or application-singleton dependency. Explicit dependencies allow independent workbenches. The application supplies state adapters, feature rendering, and `Editor.svelte` drag-and-drop composition.

Reusable libraries should not import application singletons or assume project access. Extract cohesive functionality, not a package for every utility or thin dependency wrapper. Do not add framework-independent abstractions without a real use case. See [DnD context](../dnd/context.md) for layout contracts.

## Accepted direction: editor extensions and package wrappers

The goal is broad editor extensibility, not only alternate toolbars or a fixed set of formatting commands. The generic host manages plugins and their relationships. Subsystem providers define domain APIs, such as editing a document. Formatting concepts do not belong in the generic plugin package. Shared editing tools must remain usable without the default toolbar.

Today the word-processing provider supports observations, synchronous editing, commands, and behavioral registrations. Custom content, schema changes, custom views, and conversion registrations remain future work. Acceptance of that direction does not approve their implementation or API signatures.

### Wrapping existing ProseMirror packages

An application plugin can wrap an existing ProseMirror package instead of reimplementing it. The application plugin supplies identity, configuration, and lifecycle ownership. The upstream package remains a library dependency. Official and third-party wrappers use the same supported extension points.

A wrapper adapts configuration and registers behavior through the provider. Where relevant, it must also address serialization, migration, and missing-content fallback. It must not modify another plugin's private state or install callbacks outside the supported APIs.

Compatibility depends on the current schema and the upstream package's assumptions. Some packages need adapters or upstream changes. Some may remain unsupported. Current extension domains are:

- **Commands and workflows:** observations, synchronous edits, and editor command registration are implemented. Automatic keybindings and grouped-edit policies are not.
- **Editor behavior:** input rules, plugin state, supported transaction hooks, decorations, and event handlers are implemented through behavioral registrations.
- **Document content:** node, mark, attribute, parsing, serialization, and schema-evolution contracts still need design.
- **Presentation and conversion:** custom content views, layout contracts, and import/export providers still need design.

Live schema changes need compatibility and preservation rules. They are not ordinary UI toggles.

### Cross-plugin contracts and dependencies

A library dependency shares implementation code. A runtime plugin dependency requires a compatible, active provider. Consumers use declared APIs and owned subscriptions or registrations, not private imports or mutable application singletons. There is no universal context containing every feature's services.

For example, a columns extension might need the word processor. A separate columns-to-LaTeX adapter might also need a conversion provider. This would not make LaTeX a dependency of columns themselves. This example does not select a content model or compiler, approve pagination changes, or permit arbitrary native-process execution.

#### Contract identity and activation

`definePluginApi<T>({ id, major })` defines a frozen contract identity. The ID must be nonempty and the major must be a positive safe integer. Providers declare `provides: [{ id, major }]`. Consumers declare `dependencies: [{ provider, api, major, optional? }]`.

The current in-process dependency API pins an exact provider plugin ID, API ID, and integer major. It does not check package-version ranges. Self-dependencies and duplicate dependencies are rejected. The separate host compatibility field must be exactly `apiVersion: 1`; plugin package `version` does not negotiate either contract.

During synchronous activation, `context.apis.provide(contract, factory)` must publish every declared API exactly once. Undeclared or late publication fails. `get(providerId, contract)` and `subscribe(providerId, contract, listener)` require a matching declared dependency.

Before activation, the host follows every required dependency, including dependencies of dependencies. This set of relationships is the required dependency graph. Only registered plugins participate; the host does not discover or install others.

The host checks the entire graph before calling any activation function. Missing or incompatible contracts fail this check. A cycle, where required dependencies lead back to the same plugin, also fails. The error includes the path through that cycle. Providers activate before their consumers. If a consumer then fails to activate, the host releases that failed activation's resources. Successfully enabled providers stay enabled.

Optional dependencies do not activate providers or affect activation order. Optional cycles between distinct plugins are allowed. An unavailable optional API resolves to `null`.

Subscriptions deliver immediately, then on provider arrival, removal, or reactivation. Releasing a subscription stops its notifications. It does not revoke the shared connection used by other lookups or subscriptions.

The host processes dependency and lifecycle changes one at a time. Code called during a host notification must schedule lifecycle changes for after that notification returns.

#### API objects and connection cleanup

A factory is the provider function that creates a consumer's API object. The host calls it only when the consumer requests a connection. It must finish synchronously. The host reuses the resulting frozen API object for the same consumer activation, provider activation, and contract.

The factory's result has strict shape rules:

- It must be a plain object with `Object.prototype`, or an object with a null prototype.
- Each member must be a method stored directly on that object with a string name.
- Data fields, getters/setters, symbol members, and inherited or class methods are not allowed.
- The result cannot be a promise and cannot have a `then` method.

Individual API methods may return promises. That does not make asynchronous factories valid.

Top-level methods throw after either endpoint stops. Reactivation creates a new connection; old methods never become live again. Returned objects, nested functions, and method-returned promises are not recursively revoked. Providers must manage their lifetimes explicitly.

Each factory receives `consumerId`, `signal`, `own`, `guard`, and `reportError(error)`. Register resource cleanup with `own`, for example to remove an event listener or subscription.

Stopping either the provider or consumer revokes the connection and aborts its signal. Cleanup functions then run in reverse registration order. The handle returned by `own` lets the provider release a resource early. Calling that handle again has no additional effect. If code registers cleanup after revocation, it runs immediately. A cleanup error is attributed to the provider and does not stop the remaining cleanup.

Providers must own registrations and subscriptions. They must guard callbacks or honor cancellation. `guard(callback)` preserves arguments and receiver while live. After revocation it suppresses invocation and returns `undefined`, so its return type is `Result | undefined`. It does not catch live callback errors, retract returned values, or cancel arbitrary work.

`reportError(error)` attributes a provider-mediated failure to the connection's exact consumer activation while both endpoints remain live. Revoked or old connections cannot report against a later activation or another plugin. Reports use phase `provider` and do not disable the consumer.

#### Availability, errors, and removal

Management snapshots report each dependency's availability:

- `missing`: the provider is not registered.
- `incompatible`: the provider does not declare the exact API ID and major.
- `inactive`: the provider is compatible but not live and active.
- `available`: the provider has published the contract and is live.

Availability does not prove that the factory for a particular consumer will succeed.

Factory and connection-cleanup errors are recorded against the provider. Subscription listener and resolution errors are recorded against the consumer. All of these use error phase `provider`.

Failures while checking required dependencies, or activating them for a consumer, use phase `dependency`. Provider and task errors do not disable an otherwise active plugin. They also do not make an otherwise successful deactivation fail. Activation and host-cleanup failures still affect lifecycle status.

Stopping a provider can require stopping its consumers. A consumer's own required consumers must stop too. `planDeactivation(id)` includes all of these active plugins in a frozen plan. Consumers appear before the providers they require, with the target last.

`deactivate(id)` refuses this cascade without explicit `{ cascade: true }` consent. Optional consumers stay active and are notified that the API is no longer available.

The manager shows the ordered impact and initially focuses Cancel. It rechecks the plan on confirmation and asks for renewed review if it changed. `requiredPluginIds` protects every matching ID in the transitive plan, not just the clicked row. Cancellation or completion restores launcher focus. Required-ID protection is host UI policy, not a permission or sandbox.

See the [provider author guide](../../packages-js/plugins/README.md#share-a-versioned-api-with-another-plugin) for examples and exact connection rules. Dependency declarations do not install code, execute project requirements, grant data/native permissions, or authorize deletion of saved content.

### Word-processing provider (Part 3A implemented / unmerged)

The provider gives consumers access to existing editors. Private `@writers-ide/word-processing` owns the contracts and service mechanics without application imports. The app's `createWordProcessingPlugin(sources = defaultWordProcessingSources)` connects registered views, active-tab resolution, and update notifications. It owns API resources, not editor creation or destruction.

The route registers the provider and formatting plugin. Activating formatting resolves its required provider first. Route teardown cascades provider deactivation. Source-owned views, history, the fixed schema, and model-mutating pagination remain in place. Views that share a document ID do not automatically synchronize edits.

#### Reading, editing, and exact targets

`snapshot` and `subscribe` supply data-only view summaries. `inspect` permits live reads in a short synchronous callback. `edit`, `runCommand`, and `applyResult` let the provider dispatch edits through the actual application pipeline. `registerCommand`, `executeCommand`, and `commands` supply a connection-owned editor command registry. This registry does not install ProseMirror plugins or automatic keybindings.

Every edit target is exactly `{ viewId, documentId, revision }`. Revision tokens increase across service instances within the module, including provider restarts. A different state, even a selection-only change, invalidates a target. Changes to view identity, document identity, name, or editability also invalidate it. These tokens are separate from pagination's layout revisions. Reads consult live sources before a reactive flush.

Result application checks target freshness, caller and connection signals, lifetime, editability, and any active-view requirement. It checks around callbacks and before dispatch. Stale results are discarded, not mapped or retargeted. Recomputation must be explicit.

Live state, views, transactions, and dispatch callbacks are available only for synchronous use. Do not retain them for later application. Do not mutate the raw view or dispatch through it directly. Construct transactions from the state supplied to the callback.

These callbacks must return their result immediately, not a promise. An object with a callable `then` method is also promise-like; it is called a thenable. Returning either kind of async result throws. This check cannot stop an async function body that has already started. It also cannot undo a direct call to the raw view's dispatch method.

There is also a transaction-origin limitation. `tr.before === current.state.doc` proves that the starting document matches, not that the transaction came from the current state. An old transaction from a different selection can pass with a fresh target if the document is identical. Supplying it violates the contract. This API does not enforce transaction provenance or isolate live objects.

A command must return a boolean synchronously. Its dispatch callback captures at most one transaction. That callback stops accepting transactions when the command returns. The provider then checks that the target is still valid and dispatches only if the command returned `true`.

The provider dispatches nothing if the command returns `false`, throws, returns a promise or other thenable, or tries to dispatch more than once. Returning `true` without a transaction means the command handled the request successfully without an edit.

A callback can inspect the editor again while another inspection or edit is running. It cannot start another edit: nested edits return `busy`. Editing during notifications also returns `busy`.

The service subscribes to editor sources and starts reactive tracking only when needed. Consumers share those resources, and the service releases them when unused. If a listener throws during its initial notification, its setup is undone. Later listener failures do not stop other listeners.

A listener can trigger another source change during notification. The service rereads those changes before it finishes, rather than losing them. Connections own subscriptions and commands and guard late callbacks. Disposal releases those resources without destroying source-owned views.

#### Formatting consumers

`createFormattingPlugin()` resolves its required provider and builds an activation-owned `FormattingService(provider)`. Formatting policies stay in `menu/basic/`, including caret mark no-ops, mark exclusivity, and continuation-aware paragraph commands. Presentations receive copied summaries and validated requests, not raw editor objects.

For Part 4, the approved initial boundary is an imported reusable library surface for the minimal continuation-aware selection/grouping helpers. Helpers read supplied ProseMirror state without DOM measurements, dispatch or app singletons. Formatting decisions remain in the feature package; other plugins may reuse the helpers. Preserve the current pagination model. This extraction is not implemented; exact exports/result shapes remain under review. Provider-supplied document structure queries are a future candidate that could hide model-specific grouping from consumers, not a Part 4 requirement.

The independent `menu/quick-format/` example consumes the same public API and upstream `toggleMark`. It supports production `bold` and conventional `strong`. Unlike Basic Menu, it supports caret stored marks. Both orientations share a connection-owned command. It is opt-in, registered only in the browser fixture, and imports no Basic Menu implementation.

See the [word-processing guide](../../packages-js/word-processing/README.md) for exact results, errors, callback rules, and ownership. Async work captures only needed data and an exact target. It later calls `applyResult` with a new synchronous callback and cancellation checks. The API does not map stale output, group undo, or recover partially completed edits.

### Lifecycle-owned behaviors (Part 3B implemented / unmerged)

Behavioral registrations let consumers install input rules, decorations, plugin state, and supported editor hooks. `registerBehavior({ id, name, priority?, views?, create })` returns a connection-owned disposer. IDs are service-global; duplicates throw. `views` is an optional view-ID allowlist, not a document filter. Omission means all live views.

`create({ viewId, documentId, name, state, view, signal })` synchronously returns an actual ProseMirror `Plugin` or readonly array of plugins for each matching live view/document identity. Each instance's signal aborts on view closure, detach or replacement, registration removal or failure, connection revocation, or service disposal. Ordinary behaviors forbid `nodeViews` and `markViews`; use the dedicated renderer APIs below.

#### Ordering and state preservation

The editor also has plugins installed outside behavioral registrations. These form its current **baseline**. Managed plugins run before that list. The service preserves the baseline plugins and their order, including plugins added outside the service later.

Managed ordering follows these rules:

- Higher priority runs first. The default priority is zero.
- Equal priorities keep registration order.
- Plugins returned in one factory array keep that array's order.

Each ProseMirror plugin has a key that identifies its state and transaction metadata. A package can supply a `PluginKey` explicitly. ProseMirror generates a key when it does not. Upstream packages use the original plugin or key to retrieve state and attach metadata.

A new registration fails if it returns duplicate keys. This includes keys repeated within its own result, in the baseline, or in an earlier registration. Existing registrations are not replaced. These checks follow registration order, not priority order.

The service wraps the actual upstream Plugin through inheritance instead of constructing a replacement Plugin. It preserves generated keys, `instanceof Plugin`, original `getState(state)`, and metadata addressed to the original Plugin. Callbacks also retain their expected `this` value. That value can be the upstream Plugin, its state-field object, or its plugin-view resource, depending on the callback.

Installation and removal use owner-approved `EditorState.reconfigure` on the existing editor. The same schema instance stays in use. Reconfiguration preserves:

- The document and selection.
- Stored marks, which control formatting for subsequently typed text.
- History.
- State belonging to plugins whose keys remain in the new list. This is the surviving **keyed plugin state**.

Reconfiguration itself creates no transaction or undo entry. It does not recreate the view or document. It does change the editor-state revision, so captured async results become stale.

When another registration changes, a surviving behavior keeps its factory, wrapped Plugin identity, signal, and keyed state. There is a separate lifetime for resources returned by a Plugin's `view()` callback. ProseMirror may destroy and recreate those resources when the plugin list changes. Their identity is not guaranteed to survive.

#### Deferred changes and cleanup

A microtask runs after the current synchronous call stack returns. Source-driven changes use this delay so editor reconfiguration does not run inside a ProseMirror hook. Dedicated source observation and Svelte tracking detect view arrivals, closures, and replacements even without ordinary snapshot subscribers. Service reads do not force pending reconfiguration to run.

Registration and subscription lifecycle changes inside editor callbacks or diagnostic notifications must be explicitly deferred. Explicit registration and removal outside callbacks are synchronous. Removal or revocation disables callback guards immediately. Signal-driven physical removal always waits for a microtask. Explicit removal also waits while managed hooks or service operations are executing.

Before changing any matching view, the service prepares candidate editor states and checks their factories, keys, and state initialization. This preparation is called staging. If a source, lifetime, or input state changes, the service discards the affected preparation and rebuilds it. Transactions dispatched during plugin-view setup or update are retained. An older prepared state must not overwrite them. No document traversal or copy is required.

Keeping installed behaviors consistent with current sources is called reconciliation. A reconciliation pass can itself trigger more source changes. The service repeats this work at most 16 times in one run.

If changes still do not settle, the service disables callbacks for all still-active registrations. It aborts their instances and leaves removable `failed` metadata. This failure response is called quarantine. It applies to all active registrations because arbitrary trusted mutations cannot reliably be traced to one callback.

**The 16-pass bound covers reconciliation only.** ProseMirror can separately call append hooks repeatedly as they produce more transactions. The bound does not limit that append-transaction loop. The service cannot interrupt CPU loops or guarantee that an unbounded append loop terminates.

#### Failures and diagnostics

A hook that throws, returns an invalid value, or returns a promise or other thenable causes immediate quarantine. The whole registration is disabled across all views, not just the failing instance. Instances abort and removable `failed` metadata remains. Removing plugins from editor state waits until execution is outside the hook.

Disabled hooks need fallback results until that removal finishes:

- A transaction filter rejects the transaction on its first error. Later calls to its disabled guard allow transactions until removal.
- An append hook returns `null`, adding no transaction.
- `state.apply` temporarily keeps its previous plugin-state value.
- Decorations and selection helpers return `null`.
- Event handlers return `false`.
- String and slice transforms return their unchanged input.
- Editable falls back to `true`, and attributes to `{}`.
- Clipboard text serialization returns plain text.

Plugin-view update and destroy failures do not prevent the service from attempting the remaining cleanup.

`behaviors()` and `subscribeBehaviors(listener)` expose frozen registration metadata: identity, owner, priority, optional views, active/failed status, and optional error. Subscriptions deliver immediately and on registry or failure changes, not every edit. Diagnostic observer errors are isolated.

Failures independently reach optional `sources.reportBehaviorError` and the owning connection's `reportError`. Reports identify the owner/registration, phase, optional view, and error; connection reports include a meaningful thrown-value description. A reporter throwing does not suppress the other. The host ignores reports from revoked connections, but source observers can still receive cleanup errors. Standalone services without either reporter log failures.

These contracts govern trusted synchronous code. They are not a sandbox or a way to undo arbitrary effects. Preparing candidate states cannot reverse side effects from factories, state initialization, or plugin-view callbacks. It cannot undo direct raw-view dispatch or an async body that has already started. See the [behavior author guide](../../packages-js/word-processing/README.md#part-3b-lifecycle-owned-editor-behaviors) for detailed callback and cleanup rules.

#### Accepted transactions and application invariants

The transaction submitted to the editor is the root transaction. ProseMirror can reject it through a filter or accept it and append further transactions. The app uses `state.applyTransaction(root)` to obtain the accepted sequence.

- If the root is rejected, the app emits no `PreUpdate` and performs no DOM update.
- If accepted, each root and appended transaction gets its own `PreUpdate` notification. All those notifications run before one `view.updateState` updates the editor DOM.
- PageObserver uses each transaction's own `before` and `doc` documents to interpret its positions.

Sources can supply optional synchronous `sources.prepareTransaction(transaction)`. It prepares transactions returned by managed append hooks before ProseMirror applies them. After preparation, the service checks that the transaction still starts from the current document.

The app combines this hook with unchanged `normalizePageIndexes`, extracted to `view/page-indexes.ts`. This preserves page attributes and stored marks. It maintains the app's required document rules; it changes neither schema nor pagination design. Standalone sources do not have to use the app's page rules. See [pagination flow](../pagination/context.md#current-transaction-and-layout-flow).

#### Independent examples

Three opt-in consumers in `src/lib/editor/prosemirror/behaviors/` exercise the shared API:

- Smart punctuation wraps upstream `inputRules({ rules: [ellipsis, emDash] })` and `undoInputRule`. It tests original unkeyed Plugin state and metadata identity. Root `prosemirror-inputrules` is declared as `^1.6.0` and locked to `1.6.0`.
- Selection highlight stores keyed `DecorationSet` metadata and maps ranges through transaction mappings. It does not add authored marks, scan text, or mutate content.
- Word analysis captures at most 32,768 selection model positions and 1,024 text-node chunks, then uses a bundled module worker. Tokens do not match across nodes or chunks, including mark boundaries. Complete repeated tokens across chunks count together. Per-view signals and activation ownership cancel work. Exact-target `applyResult` builds fresh metadata synchronously. There is no full-manuscript scan or stale-output mapping.

The [example guide](../../src/lib/editor/prosemirror/behaviors/README.md) lists public command IDs. Only the fixture's **Mount behavior proofs** control mounts `BehaviorFixture.svelte`. The default route and other fixture scenarios do not enable them. Part 3B added twelve behavior cases to the original twelve Chromium/WebKit cases. The current dedicated suite also includes renderer and production-pagination test files. Browser Smoke CI runs the dedicated configuration. Main app e2e excludes them. Structural layout edits in this fixture do not validate real pagination geometry. Recorded results and remaining diagnostic and selection-timing limits are in the [branch changelog](change-log.md).

### Existing-content renderers (Part 3C first slice implemented / unmerged)

The dedicated `registerNodeView({ id, name, nodeType, views?, create })` and `registerMarkView({ id, name, markType, views?, create })` APIs render types already present in each matching view's schema. They do not register new content types. Normal schema serialization remains responsible for saved content and copy/paste.

The service calls each factory once per matching live view/document identity. It returns a standard ProseMirror constructor synchronously. ProseMirror calls that constructor for individual rendered instances. `EditorRendererContext` includes the behavior context's view/document IDs, name, state, view, and per-instance abort signal. Its additional `reportError(error)` method attributes later renderer failures to the registration. Obsolete or revoked reporters cannot quarantine a later activation.

Connections own registrations and returned disposers. IDs share the behavior namespace. `views` is an optional view-ID allowlist, not a document filter. Active registrations for the same type name reject overlapping scopes, including node/mark name collisions in ProseMirror's shared renderer map. Disjoint explicit allowlists are allowed. Existing baseline renderers also block registration. Checks include direct view props, direct-prop plugins, and unmanaged state plugins in either map. No priority-based replacement is supported. Later source conflicts or unknown types quarantine the registration.

The shared reconciliation engine installs and removes renderer plugins on existing editor states. It preserves the schema, content, selection, stored marks, history, and surviving keyed state. Reconfiguration changes provider revisions and makes captured targets stale. Signals abort on closure, replacement, removal, failure, connection revocation, or service disposal. Registration/removal timing follows the behavior engine's callback guards and deferred source updates. Renderer entries are not exposed by `behaviors()` or `subscribeBehaviors()`.

#### Svelte rendering and content ownership

The optional `@writers-ide/word-processing/svelte` entry exports `defineSvelteNodeView` and `defineSvelteMarkView`. Both return ordinary ProseMirror constructors. Direct DOM constructors use the same registration API without Svelte. Options supply explicit feature `props`, an optional outer `tag`, and `onError: ctx.reportError`. Node adapters default to no editable content; enable `contentDOM` for editable children. Marks always have editable content.

The supplied `contentDOM` action belongs on one empty, stable, unconditional host. ProseMirror owns the inserted editable subtree. Svelte owns surrounding UI and must not render its children. Adapter-owned props take precedence over explicit props. Node props include the current node, decorations, inner decorations, selection flag, and `getPos`. Mark props include the current mark and inline flag. The installed ProseMirror supports `MarkView.update`; both adapters update same-type content reactively. Marks do not have node-specific selection callbacks. The Svelte node adapter cannot render text nodes.

The adapter leaves editable mutations and selection changes visible to ProseMirror. Native controls outside node content stop editor handling; editable-content events and wrapper clicks do not. Cleanup unmounts components once. The [author guide](../../packages-js/word-processing/README.md#part-3c-renderers-for-existing-content) gives complete component/registration examples and exact DOM rules.

#### Renderer failures and layout changes

Factory, constructor, and guarded callback failures quarantine the whole registration across views. Invalid results, thenables, and changed DOM identities are failures. Guards stop immediately, signals abort, and physical removal waits until outside the callback. Schema rendering resumes without deleting content. Cleanup continues after errors. Owner-attributed reports use the connection and optional `sources.reportBehaviorError`; a renderer error does not automatically disable the feature plugin.

The Svelte boundary handles render/effect failures and rescues editable content before a failed branch is torn down. `onError: ctx.reportError` connects later boundary failures to registration-wide quarantine. Arbitrary event handlers, timers, promises, and external effects are not universally caught. Authors must catch and report failures they own. These guards cannot undo side effects or preempt CPU work.

Optional `sources.invalidateLayout(viewId)` delegates geometry changes to the app, which calls `PageObserver.invalidate`. A lazy `ResizeObserver` per editor view is shared across renderer roots and editable elements. Inline renderers also observe their nearest containing layout box. A shared child-list observer refreshes target attachment after mounting or page reparenting. It visits registered renderer resources, not the document model. The first size delivery establishes a baseline without invalidation. Subsequent dimension changes and actual installed renderer-set changes request coalesced animation-frame invalidation. Ordinary source notifications, selection changes, and renderer reconstruction with the same installed set do not each invalidate layout. No resize observer or frame is allocated for this work without the host callback. Provider disposal preserves a final schema-fallback invalidation for still-live matching sources.

The [fixture guide](../../e2e/fixtures/word-processing/README.md) explains opt-in Svelte node/mark examples and coverage. The separate paginated fixture uses the production schema, `createView`, and `Paginator`; its tests measure actual page bounds during renderer installation, component-only resizing, removal, editing, and undo. These are test entry points, not newly verified outcomes. Synthetic composition tests do not establish real IME behavior. Complex layouts and new content types remain separately gated.

### Execution boundary and design validation

A wrapper adapts a package; it does not isolate it. ProseMirror callbacks execute with the frontend environment's authority. Input rules, decorations, and bounded worker analysis have working examples. Broader compatibility remains package- and schema-dependent.

Ordinary Svelte node/mark rendering for existing schema types is implemented. New content registration, schema lifecycle, missing-content preservation, and external/native enforcement still need separate approval. Rendering does not complete those capabilities.

## Accepted direction: frontend trust and native restrictions

Frontend plugins are trusted code in the same JavaScript environment as the app. The owner approved ordinary Svelte, plugin-owned DOM rendering, and supported deep editor APIs. Preventing access to other DOM is deferred. Public APIs are the supported path, but the rule against changing another plugin's UI or private state is behavioral, not an enforced DOM boundary.

External network calls are allowed in principle under explicit user trust. A plugin that can read manuscript content and make requests can disclose that content. Copied snapshots, declarations, wrappers, and DOM boundaries do not prevent this. Installation disclosures must distinguish information from enforced restrictions. Review and network-disclosure UX remain open; no external loader exists today.

Native access means authority outside ordinary browser code, such as Tauri IPC, filesystem access, shell/process execution, or native libraries. Frontend trust must not grant unrestricted native access. Narrow native APIs need actual enforcement and verification before external loading. TypeScript interfaces and frontend checks are not that enforcement. Arbitrary native-plugin execution is not approved.

Project-supplied requirements must not automatically install or execute code or grant permissions. Ordinary Svelte rendering for existing nodes and marks is implemented. Frontend isolation is deferred and must not be described as a current guarantee.

### Native request identity and token enforcement

**Approved direction; not implemented.** Frontend components remain trusted code in the application's JavaScript environment. Native requests must use host-issued credentials and Rust-side permission checks. This identifies whose native authority is used without claiming frontend isolation.

The intended package model allows frontend components, backend components, or both, potentially with multiple components of each kind. Part 4 implements frontend loading; executable backend components and their restricted runtime will be designed later. Installation identity and component execution lifetimes are separate.

Permissions are declared statically in `manifest.toml` at package level, component level or both. A declaration requests authority; it does not grant it. Effective requirements are additive: common package requirements plus the component's own requirements. Components cannot subtract package requirements or inherit siblings' component-specific authority. Authors should prefer component declarations unless a requirement is genuinely common. All effective requirements are mandatory for activation. Project-scoped components use per-project acknowledgement unless users explicitly choose application-wide approval. Application-level components need explicit application-wide approval for their own native requirements; activation scope does not grant authority. No native requirements means no native permission prompt, not an exemption from frontend trust review. App-wide approval is limited to declared operations/resources and is not unrestricted native access. Updates requesting additional authority need renewed approval. Separate `operation` and `resource` permission fields are approved. Initially accept only `project.files.list`/`project`, `project.files.read`/`project` and `external.open`/`http-https`. Listing and reading are separate requirements; neither implies the other. Reject unknown values and unsupported pairs before activation. Remaining manifest details, grant persistence and operation-specific revocation behavior still need design approval. No arbitrary native library or process execution is authorized by this direction.

Only project-scoped components may require native `project.files.*` permissions in Part 4. Global UI uses explicit connections to project components that perform file work under their own grants. These components may share one package. Application components may require `external.open`, but may not declare or inherit project-file requirements. Mixed-scope packages must place project-file requirements on the project components rather than at package level. Application-wide consent does not change the project ownership of file services. Direct project-file handles for application components are a future candidate. This is approved direction, not implemented.

Native project approvals belong to a host-managed local registration and approved location, not shared project files. Normal reopening reuses unchanged grants. Copies at new locations need their own acknowledgement unless application-wide grants cover them. Moves can use an explicit reviewed relink of an existing registration to a validated new location. Project-supplied IDs/names must never silently recover grants. SQLite is approved for the host-management registry, including installations/integrity associations, component choices, project registrations, approvals and staged-update/recovery records. Immutable package files stay in separate directories; activation credentials are not persisted. This is not implemented. Exact schema/migrations, bindings, durability, secure location matching and API/UI remain open. SQLite transactions do not make filesystem changes atomic. This does not choose the full project content format or future plugin-owned storage. See [local project registration](implementation-plan.md#local-project-registration).

**Approved unsafe-registry recovery; not implemented:** corruption, unsupported schema versions or unsafe registry reads enter plugin-free recovery before importing packages. Preserve the database and package files. Do not trust uncertain grants, silently create a replacement registry or reconstruct acceptance from package files. Reset/restoration needs explicit user action. Recovered native approvals must be explicitly acknowledged again before activating components that require them. Validated installation metadata and component choices can be restored without silently making old grants effective. This prevents a backup from undoing later revocations. Preserve project/application-wide scope; a generic restore confirmation is not permission consent. Recheck package bytes against recovered integrity records. Tickets and activation credentials are not restored. This policy is approved, not implemented; exact backup validation and restoration protocols remain open. Normal first launch and temporary locks are separate cases. This known registry-failure response is not the deferred automatic interrupted-startup suggestion feature.

The native request flow is:

1. The host establishes the plugin's identity and approved grants. It issues a fresh, opaque token for an activation rather than one reusable credential for the whole application session. The host-controlled registry associates the token with the plugin, activation, relevant component identity and grants. It initially records a pending activation; native execution remains gated until successful setup is confirmed.
2. The frontend receives service objects with the token held privately. Plugin code calls a named method such as `service.readFile(...)`. That method supplies the token and operation arguments to Tauri's `invoke`. The method name is illustrative. Initial services cover read-only registered project files and opening HTTP/HTTPS links. The initial operation/resource pairs are approved; exact service signatures remain open.
3. Rust looks up the token and verifies that it is active. It derives the identity and grants from that registry, not a caller-supplied plugin ID. It authorizes the operation, validates its target and arguments, and performs or rejects it.
4. Ending an activation revokes its token. Re-enabling the plugin receives a new token. Retained services cannot use an old token to start further native operations. Revoke new requests immediately, cancel queued work and signal safe cooperative cancellation of running work. Recheck authority before final effects where supported. An already committed or safely uninterruptible step may finish; completed effects cannot be undone.

Native operations need explicit cancellation checkpoints and commit semantics. Suppress late results to revoked activations while delivery remains under host control; already delivered data cannot be retracted. Rust owns native resource cleanup and must not depend on a component using a revoked credential to release resources. Apply this on disablement, project closure and permission revocation. It does not guarantee immediate interruption of every operating-system call.

**Approved management boundary; not implemented:** use a separate app-owned management/recovery WebView with no plugin imports. Rust validates the real calling WebView and its capability route before accepting permission or package-management commands. Plugin-hosting WebViews cannot approve grants, issue arbitrary credentials or create, navigate or impersonate this management WebView. Recovery must remain available without loading plugins. Exact commands, credential delivery, durable state and lifecycle coordination need further design. This does not isolate plugins from one another in the editor or authenticate hostile JavaScript callers there.

Frontend wrapping is not the enforcement point. Calling Tauri's original `invoke` directly must not bypass Rust validation. Every protected native endpoint must reject missing, invalid or revoked credentials. Audit Tauri plugin commands and other native routes as well as application commands. Token issuance must not let plugin code select another plugin's identity or expand its grants. The owner approved Rust-authorized pending activations with one-use, target-WebView-bound attachment tickets. Rust resolves accepted package snapshot, component/scope, dependencies and grants before issuing a ticket. New authority or dependency enablement requires management review; unchanged approved startup does not require another prompt. Redemption checks the actual invoking WebView, ticket validity and current authorization, consumes the ticket once and supplies credentials to private service adapters. Reject replay, foreign-WebView redemption and stale package/grant/project-opening associations. Successful setup confirmation releases the native gate; failure/closure/revocation invalidates pending authority. Tickets are temporary like activation credentials. This flow is not implemented. Exact IPC/confirmation details, expiry, response-loss behavior and cleanup still need specification and tests.

A valid token establishes: **this request used the credential issued to this plugin/component activation**. It does not prove which JavaScript code originally caused the call. Private fields help avoid accidental access; they do not isolate hostile code sharing the same environment. Deliberate delegation can also make the initiator different from the component exercising authority. Backend identity and permission enforcement must be grounded in the selected restricted runtime when backend components are introduced.

**Approved provider authority policy; not implemented:** a provider may use its own native grants for the feature operations it exposes through declared APIs. Consumers do not need duplicate native grants for that underlying work. For example, a research index can read approved project files to answer a consumer's search request. Rust attributes the native reads to the provider's credential, not the consumer. Providers must validate inputs and preserve project/resource boundaries. Supported APIs must not expose general native-command proxies or credentials. This is a trusted-frontend contract, not hostile-caller isolation. Permission review must explain that providers can share feature results with declared consumers. Ending a consumer connection prevents further supported calls through it; it does not retract delivered data or automatically revoke the provider's authority.

Initial native services will provide bounded directory listing and byte reads within registered project locations. Paths must be project-relative. Rust enforces containment, limits, authorization and cancellation. Approved initial grants may cover the whole registered project directory within host-enforced limits. Directory-specific grants are deferred. These reads return saved bytes; live or unsaved editor content stays in the word-processing API. A separate permission-controlled service will open external HTTP/HTTPS links. Rust validates URLs and rejects filesystem paths and unsupported schemes. These services are approved direction, not implemented.

Unavailable native service groups are `null`. Project-file services are present only with at least one file grant; external-link services require their own grant. Each method still checks its specific operation, so list-only permission does not authorize reading. Components with no native requirements receive neither service. Calls never implicitly prompt for missing grants. Rust remains the enforcement point, and retained service objects revoke with their activation. This is approved direction, not implemented.

Initial directory listing is nonrecursive and returns bounded pages with opaque continuation cursors. Callers request further pages and subdirectories separately, with cancellation between requests. Files may change between pages; this is not a consistent filesystem snapshot. Recursive listing in bounded batches is planned future work. Its traversal limits, partial failures and change semantics still need design. Single-use continuation cursors are approved. Rust consumes the cursor when accepting the request; success returns a fresh cursor or completion. Failure/cancellation releases enumeration resources and requires restarting. Concurrent reuse is rejected. Restarts can repeat delivered entries. Retryable enumeration is a future candidate. Exact listing fields, cursor expiry and numerical limits remain open. This is approved direction, not implemented.

Native project-file services must not follow symbolic links or Windows junctions/reparse points, including links to targets inside the project. Reject reads and directory traversal through them. Enforcement must hold during filesystem access, not merely at an earlier validation step. Listings include identified links/reparse points and special files as `kind = 'unsupported'`, without targets or contents. Those entries do not themselves fail the listing. Attempts to read or traverse them fail. An actual inspection failure remains an error, not an unsupported classification or silently missing entry. Safe internal-link support is a future candidate. This is approved direction, not implemented, and does not select broader application import or project-storage rules.

Asynchronous native services will reject promises with structured SDK errors and stable codes. An SDK identification helper lets authors handle them in `catch` blocks without parsing messages. Normalize native IPC failures into this contract without treating all unexpected exceptions as native-service errors. Uncaught rejections in managed task callbacks follow existing task-failure reporting; managed cancellation keeps its own semantics. The synchronous word-processing API retains its result values. This is approved direction, not implemented. Exact error/helper names and the complete code vocabulary remain open.

Native writes are deferred. Future writes must stay in host-assigned plugin directories, separated by project/application scope. Storage ownership comes from authenticated host identity, not caller-supplied plugin IDs or paths. This is plugin-owned persistent storage, not permission to overwrite arbitrary project files or export to arbitrary destinations. Directory layout, component sharing, migrations and write APIs need later decisions. Preserve saved data on uninstall unless explicitly deleted. See the [deferred-work list](implementation-plan.md#deferred-work-and-future-candidates).

Logging design is deferred. This decision concerns native-request attribution and authorization, not interception or logging of every frontend operation. See the [Part 4 implementation and validation requirements](implementation-plan.md#native-request-attribution-and-authorization).

### Package loading, updates and defaults

**Approved direction; not implemented.** Part 4 provides author build tooling and an explicit shared-host dependency set, including controlled sharing of Svelte and identity-sensitive ProseMirror packages. Ordinary private dependencies can be bundled. Prebuilt frontend components target a host-defined runtime profile covering shared SDK modules, Svelte compiler/runtime expectations and core ProseMirror dependencies. Start with one supported profile, emitted by build tooling and checked before import. Keep it separate from app/package versions and provider API majors. Retain profiles across compatible app releases; incompatible changes may require rebuilds.

Provide recommended templates, build tooling and an actual-profile test harness, but document the output contract for alternative build systems. Authors retain ordinary TypeScript/Svelte development. Frontend build output uses native ES modules and a host-managed import map installed before plugin import. Shared specifiers resolve to the host's actual supported module instances, while private code can be bundled or package-local. Package-local modules must use verified-resource delivery. No custom module-registration API is required. Profile IDs, manifest fields, exact shared versions/exports and concrete module/worker URLs remain open. Packaged Tauri WebView validation is required; workers do not inherit the window map. A profile is not a sandbox or publisher authentication. See [frontend runtime compatibility](implementation-plan.md#frontend-runtime-compatibility).

The approved manifest identity fields are optional `namespace`, stable machine-readable `name`, human-readable `display_name` and separate `version` under `[package]`. Derive canonical IDs as `@namespace/name` or unscoped `name`; do not persist a contradictory second ID field. Components have stable IDs local to their package. Shared namespaces group independently installed packages, not shared grants or verified publishers. Display names can change freely, while namespace/name changes are identity changes that must not silently inherit grants or saved associations. See [package and component identity](implementation-plan.md#package-and-component-identity).

Packages install and update as a unit. Components activate independently with their own lifetimes. An activation failure leaves unrelated healthy siblings running; required dependencies determine affected consumers. Package-level controls are a convenience over those component lifecycles. Every activated component still needs all applicable mandatory grants. Task or renderer-registration failure does not automatically disable its component. Authors declare initial selections with `default_enabled`, defaulting to `false`. Defaults apply only on first configuration; preserve and restore user selections afterward. Updates do not silently override them or enable new components. New components need explicit enablement or approved dependency activation. Defaults do not bypass required grants.

Every component explicitly declares `activation_scope` as `project` or `application`. Application frontend scope is per window/host, independent of open projects. Project scope creates a separate activation per open project in that host, with bound services/credentials and cleanup on closure. Switching the active project does not retarget an existing activation. Application-wide grant acknowledgement does not merge project instances or grant an application component authority over every project. Required project dependencies resolve within the same project, and project components may require application services in the same host. Application components can require other application services, but do not have unconditional required dependencies on an unspecified project instance. Global UI stays running and uses explicit selected-project connections: release/reconnect on selection changes, end connections on project closure, and never silently retarget old handles. The explicit connection API approach is approved: authors subscribe to selection and manage connection replacement. Independent connection lifetimes are approved: each connection owns its API handles, subscriptions and cancellation signal. Disposing it revokes those handles and aborts its signal without affecting other connections. Provider execution and shared state remain shared, not duplicated per connection. Work tied to the signal can stop; this is not preemption of arbitrary work. Consumer teardown cleans up all its connections; unavailable providers are not automatically enabled. Project references belong to one live opening and become permanently invalid on closure. Reopening creates fresh references; saved settings and permission associations retain their separate persistent registration. This lifetime policy is approved, not implemented. Exact reference representation and validation mechanics remain under review. A convenience helper for automatic switching is a future candidate, not the foundational API. Cross-project required bindings remain a future candidate. Discovery signatures and concrete local project registration/storage APIs remain open. See [component activation scope](implementation-plan.md#component-activation-scope).

Authors can declare required component dependencies. A dependent cannot activate or stay active while its required component is disabled. Do not silently undo explicit user disablement. Enablement offers a full dependency activation plan for explicit review, including re-enabling disabled requirements. Complete mandatory grant acknowledgement before starting and recheck the plan before execution; changed impact requires renewed review. Disablement shows affected required dependents, requires cascade consent and stops dependents first. Neither direction silently overrides user choices. Required cycles fail before activation. Part 4 will also allow an optional package-version range on dependencies. Package versions use semantic versioning. A required dependency outside its range blocks activation; an optional integration outside its range is unavailable without blocking activation. API dependencies still require their exact API major. Both constraints must pass. The host checks installed versions without downloading dependencies or selecting among multiple installed versions. This is approved direction, not implemented. Consumer-local dependency aliases are approved for both same-package and cross-package references. The manifest identifies the provider package/component; runtime lookups use the local alias and imported API contract. Authors do not construct activation IDs. The initial range grammar is approved: exact semantic versions or space-separated `>`, `>=`, `<` and `<=` comparisons that must all pass. Comparison ranges exclude prereleases; exact prerelease versions can be requested explicitly. Richer syntax is a future candidate. Exact reference fields, duplicate-target rules and management APIs remain open; see [component defaults and required dependencies](implementation-plan.md#component-defaults-and-required-dependencies).

Frontend component entry modules export named `activate(context)` functions. The host imports verified modules after compatibility, permission and dependency checks, then calls activation once per execution lifetime. Metadata remains in `manifest.toml`. Activation stays synchronous for setup and provider publication; continuing async work uses managed tasks. Successful activation means setup is complete, not that background data is ready. Features can retain/pass initial-load task handles to state/UI and consume settled outcomes later, or load lazily. Task keys identify replaceable work, not stored result lookup. The owner reaffirmed synchronous activation after reviewing this pattern. The native activation gate is approved direction, not implemented. Calls during setup return pending promises without native execution. After successful synchronous setup, host confirmation lets Rust permit native operations. Failure/revocation rejects waiting calls; failed confirmation does not release the gate. Bound pending work. The one-use attachment flow is approved; exact wire handshake, limits, deadlines and disconnection handling remain open. This does not delay task callback execution, contain browser effects or roll back later native effects. Ownership, signals and an optional returned synchronous disposer handle cleanup. Authors must not start unmanaged feature work during import or assume module state resets on re-enable. This is a trusted-code contract, not isolation. See the [frontend entry-point contract](implementation-plan.md#frontend-entry-point-contract).

Begin with explicit local installation and manual updates. Validate and stage replacements for the next application start while the running session keeps its old version. Recheck compatibility, dependencies and grants before activating the replacement. Show restart-required status, but never force a restart or discard writing state. Keep component enable/disable available for the loaded version. Retain the previous version until replacement acceptance. If an update fails, keep the failed component disabled and show the error in the plugin manager. Keep unrelated healthy components running, subject to required dependencies. Never automatically execute the previous version. Offer explicit package-wide restoration of the retained accepted version for the next restart. Show affected components/dependencies before confirmation and recheck integrity, compatibility, dependencies and permissions before activation. Restoring code does not undo saved-data changes or guarantee that older code can read them. Exact startup promotion and recovery UI contracts remain open. See [installation and recovery](implementation-plan.md#installation-updates-versions-and-defaults). Preserve saved plugin data unless deletion is explicitly requested. Check compatibility before executing code and report missing dependencies rather than fetching or executing them automatically. Initially allow one active version per package identity, but keep identity and version separate so future multiple-version installation is not unnecessarily blocked.

Part 4 must provide an explicit recovery launch mode that skips imports and activation of all packaged plugins, including official packages. Choose this mode before plugin modules execute. Application-owned recovery UI must work without plugins and support disabling components, inspecting recorded failures and staging restoration of a retained package. Preserve saved enablement choices unless explicitly changed. Editing may be limited. This lets users recover after restarting; it cannot interrupt a frozen frontend or restore unsaved work. The concrete launch mechanism remains open. Automatic suggestions after interrupted startup are deferred. This is approved direction, not implemented.

Fresh installs include default feature packages, with Basic Menu, undo functionality and word-count/data features as intended examples. The exact roster and permission onboarding remain open. This direction does not itself implement unfinished features or select an undo-tree history design. Installation UI must explain package identity, version, components, requested native authority and frontend trust risks.

Installation acceptance ordering is approved, not implemented: bounded extraction/staging, candidate validation and required installation consent precede durable publication into a new immutable directory. Do not overwrite an accepted/running artifact. Only afterward commit the artifact location, integrity association and installation state together in SQLite. That commit is the acceptance point; pre-commit staging/orphan directories cannot run and need reference checks before cleanup. After commit, missing/changed artifacts still block loading. Updates stay staged until restart, and installation consent does not replace native grant review. Exact platform durability/recovery operations and crash tests remain open.

Strict manifest validation is approved for the entire document, not only permissions. Unknown fields fail validation with clear errors. An explicit format version identifies the schema; reject unsupported versions before importing plugin code. Apply these checks to installation and update candidates. This is approved direction, not implemented. Remaining schema details and the exact format-version field/value remain under review.

Normal packages are self-contained and prebuilt. They contain frontend JavaScript, CSS and assets compiled by their authors. Distribution uses ZIP with `manifest.toml` at the archive root and no enclosing package-name directory. Extraction must reject unsafe, duplicate or ambiguous entries and enforce expanded-size/work limits in staging before installation acceptance. Packages contain ordinary files/directories, not symlinks, special entries or installation scripts. Digests describe extracted file contents. Remaining manifest fields, entry-path syntax, module loading and detailed extraction APIs still need decisions. Optional developer directory loading is still a proposal. See the [Part 4 package decisions](implementation-plan.md#approved-scope-and-package-direction) for approved policies and open details.

The [deferred work and future candidates](implementation-plan.md#deferred-work-and-future-candidates) list tracks later capabilities and their initial-scope limits. It distinguishes deliberate deferrals from optional investigations. Native enforcement and safe verified loading remain prerequisites, not deferred enhancements.

### Frontend worker bundles

**Approved for Part 4:** each Web Worker is emitted as one self-contained ES-module bundle, including its dependencies and worker-side SDK helpers. Authors can split source files, but package-local worker import graphs/code splitting are deferred. Workers do not inherit the window import map or share its runtime instances. Existing managed-task ownership, cancellation and result-application rules remain. Exchange copied/transferred data and validate editor results on the frontend. This does not introduce backend components or native authority. Managed package workers will always use Blob URLs created from verified bytes, rather than choosing direct loading by platform. Authors supply the package-relative worker URL to the managed task API. The host obtains the verified bytes and creates the worker. Task cleanup terminates the worker and revokes its Blob URL, including startup failure and cancellation. Inside the worker, `import.meta.url` identifies the Blob, not the package. Package-relative worker imports and assets are unsupported; supply needed data through messages or transfers. This is approved direction, not production implementation or cross-platform validation. Exact SDK signatures and integration still need design and tests. Trusted frontend code is not prevented from constructing unmanaged workers. See [worker build output](implementation-plan.md#worker-build-output).

### Verified package resource URLs

**Internal snapshot pool implemented; production resource delivery not integrated.** The planned host-controlled virtual URLs will serve modules, styles, workers and assets from immutable verified package bytes. A native handler resolves only files in the verified snapshot, with no unchecked filesystem fallback. Package-relative references should work through normal module/asset loading, including `import.meta.url`. Different accepted snapshots need distinct resource identities. Load snapshots only when needed and bound retained bytes.

**Approved URL identity and lifetime; production runtime delivery not implemented:** disabling and re-enabling unchanged verified contents reuses the snapshot's resource URLs within the same plugin-hosting WebView. Resource identity is separate from activation identity. Verify the complete file set, lengths and SHA-256 checksums against the host's accepted record before retaining bytes from disk. Serve those exact retained bytes without reopening source files. Reuse does not require rehashing immutable retained bytes. Any reload from disk requires verification again; mismatches block loading without regenerating expected checksums. Accepted changed contents receive a distinct resource identity.

Rust will share immutable verified snapshot bytes in one application-wide pool. Count the same retained snapshot once, even when several WebViews use it. Track each WebView's association separately. Keep the bytes until the last associated plugin-hosting WebView closes. Browser-cached modules may still reference those resources after re-enable. Sharing bytes does not share activation state, native credentials or frontend module instances. Disablement still releases activation-owned UI, stylesheet ownership and tasks and revokes native credentials. It does not unload modules or reset module-level state. Snapshot count and total retained bytes need explicit limits. If a new snapshot would exceed either limit, refuse that load and block the affected activation. Keep existing plugins running. Report the limit clearly in the plugin manager; do not evict used snapshots, disable unrelated plugins or restart automatically. Reusing an already retained snapshot does not allocate another snapshot. These limits cover retained package bytes, not all JavaScript, DOM or worker memory. Limits are host-owned configuration, not fixed plugin API guarantees. Implement accounting and enforcement before selecting production defaults. Choose numerical defaults later using representative package and multi-window measurements. Tests can supply small limits to verify rejection and cleanup. Prototype limits are not production defaults. This does not approve a user-facing settings API or unlimited loading.

**Approved WebView resource access; production Tauri integration not implemented:** serve a snapshot only to plugin-hosting WebViews associated with it by the host. Rust checks the actual requesting WebView, not a caller-supplied identity. Knowing a snapshot URL does not grant access. Associations remain until the WebView closes, including across plugin disablement. The plugin-free management/recovery WebView has no package-resource associations. This is a WebView-level boundary, not isolation between plugins sharing a WebView or a substitute for native permission checks.

The current [internal snapshot pool](../../src-tauri/src/plugin_resources/mod.rs) accepts only `VerifiedPackage` values from the integrity verifier. It derives snapshot identity from a domain-separated SHA-256 hash of the complete, canonically serialized verified record. Equivalent JSON formatting and field order produce the same identity. The record and identity are not publisher authentication or installation acceptance.

Trusted Rust host code can open an opaque WebView-lifetime handle, admit verified bytes and look up files through that handle. Equal snapshots share the original retained buffers. Count and byte limits are supplied by the host; failed admission changes neither usage nor associations. Closing the last associated handle releases the snapshot. Closed handles and handles from another pool cannot read or admit files. The [pool tests](../../src-tauri/src/plugin_resources/tests.rs) exercise these internal contracts.

The production application has no runtime pool owner, actual-requester adapter or close-event wiring yet. Its future owner must serialize access, associate only authorized plugin-hosting WebViews and close handles on actual WebView closure. Labels supplied by frontend code are not authority. No production resource route, manager error UI, Blob-worker integration or frontend API is added by this foundation. Limits count retained file payloads, not transient verification buffers or total application memory.

The standalone fixture uses the production pool without changing production source. It supplies a mutex-protected owner, a host label-to-handle registry and real window-destruction cleanup. Requester identity comes only from native `UriSchemeContext.webview_label()`. Main and peer share one verified snapshot. An unassociated window receives empty 403 responses, even with a spoofed identity header. Rust closes the associated windows in sequence. A real fetch confirms continued access after the first closure; native accounting confirms release after the last. Recovery creates only the plugin-free shell and admits no snapshots.

These fixed labels, URL aliases and close stages are harness contracts, not production API decisions. The sole `finish` command accepts bounded reports from the three fixed windows. It grants no native service APIs or caller-selected setup/close actions. See the [fixture workflow](../../prototypes/plugin-resources/README.md#what-happens) for the sequence and checks.

Frontend components will declare emitted stylesheets in the manifest. The host loads verified CSS before activation and tracks shared ownership across project/component activations. Teardown or activation failure releases that activation's ownership without removing CSS still in use. Build tooling can generate declarations; ordinary Svelte classes and dynamic inline styles remain available. This is approved direction, not implemented. Exact fields and ordering remain open. Host-managed styles are not CSS isolation and may affect other UI.

The URLs identify resources, not native permission credentials or authenticated publishers. They do not provide isolation, module unloading or safe live updates. Production scheme/origin, MIME types, URL/path validation, cache lifecycle and worker compatibility still need design and broader packaged tests. The standalone [fixture prototype](../../prototypes/plugin-resources/) serves retained verified bytes without changing production loading. Its integrated unsigned debug macOS run passed 21 normal and five recovery checks, including native stages. Pool usage was one snapshot with 555,913 file-payload bytes before and after the first close, then zero after the last associated close. This is the current fixture size, not a production default. Native handler tests cover label reopening, poisoned-state fail-closed behavior, cap failure and denial-header spoofing. These checks establish no network restrictions or hostile-JavaScript guarantees. The run also exercised real shared Svelte/ProseMirror identities, a transaction, Svelte lifecycle after CSS readiness, stylesheet ownership/failure cleanup and image/font rendering. Distinct fixture URL aliases produced distinct module instances from the same retained bytes after temporary source extraction removal. Direct worker loading failed; a self-contained verified-byte Blob worker passed copy/transfer and cleanup checks. Blob loading changes `import.meta.url`; relative worker assets are unsupported. Workers do not inherit window import maps. CSP negative probes and plugin-free fixture recovery passed, but the raw opener command was unavailable, not proven ACL-denied. Other platforms, macOS 13.3, full activation failure and task cancellation remain untested. See the [observations and limits](resource-loading-investigation.md#packaged-observations). See [verified resource delivery](implementation-plan.md#verified-resource-delivery).

### Package integrity and publisher identity

**Internal Rust foundation implemented; no installer or loader integration yet.** [plugin_integrity](../../src-tauri/src/plugin_integrity/mod.rs) provides `create_record`, `IntegrityRecord::from_json` and `verify_package`. It is internal host code, not a frontend API or Tauri command. It enables no external execution.

`create_record` returns candidate metadata for explicit installation acceptance. The version-1 JSON record maps each portable relative path to its byte length and lowercase SHA-256 digest. Parsing rejects duplicate entries/fields, unknown fields, invalid paths/digests and unsupported versions. Verification compares the complete file set and returns an immutable `VerifiedPackage`. Its file slices are the same owned bytes that were checked; later filesystem replacement or deletion cannot change them.

The future installer must keep explicitly accepted records in host-managed storage outside package directories. A digest beside plugin files is not a trusted reference. The module neither persists records nor silently regenerates them on mismatch. It covers all regular files without selecting the manifest or archive format. A future loader must consume verified bytes for modules, workers, styles and other assets rather than reopening the original paths. Production browser delivery and persistent installation records remain unimplemented; the standalone fixture integrates the production pool with fixture-only retained-byte delivery and real close events.

The [directory reader](../../src-tauri/src/plugin_integrity/filesystem.rs) uses capability-based no-follow opens and checks opened handles. Root/descendant symlinks, Windows reparse points, special files, invalid UTF-8 names and nonportable paths are rejected. The host supplies trusted root ancestors. File count, per-file/total bytes, depth, path length and directory work are bounded. Defaults cap file bytes at 16 MiB per file and 64 MiB total. Collection is not an atomic filesystem snapshot, but every returned buffer must match the trusted record. Empty directories are validated but not hashed. The synchronous work must be scheduled appropriately by future callers.

The [Rust tests](../../src-tauri/src/plugin_integrity/tests.rs) cover tampering, malformed records, limits, and bytes surviving source overwrite/deletion. Filesystem tests also cover no-follow races and special files. macOS validation does not establish Windows/Linux behavior or packaged Tauri enforcement.

This detects changes relative to accepted bytes while the host's records remain trustworthy. It does not authenticate a publisher or prove that code is safe. Replacing both contents and the trusted record defeats the check. Official package digests can be supplied with the application. Unsigned external packages establish their accepted contents at installation.

Publisher signatures and their trusted-key, key-replacement and revocation policies remain separate decisions. Logging is still deferred. See the [integrity implementation and validation requirements](implementation-plan.md#package-integrity-verification).

## Accepted direction: actions and cooperative execution

Plugins can use activation-owned `context.tasks`. Private `@writers-ide/tasks` contains the extracted [pagination work queue](../pagination/context.md#generic-work-queue) and task helpers. The application host shares pagination's singleton queue. A standalone host accepts an optional `workQueue` or creates an independent queue.

Choose execution to suit the work:

| Mode                    | Use it for                                      | Main constraint                             |
| ----------------------- | ----------------------------------------------- | ------------------------------------------- |
| Immediate synchronous   | Short commands and hooks needing an answer now  | Cannot be interrupted.                      |
| Async                   | Network requests and asynchronous APIs          | Promises do not offload CPU work.           |
| Cooperative main-thread | Incremental DOM-dependent or other bounded work | Yield between short units.                  |
| Worker                  | CPU-heavy work on copied or transferable data   | No live DOM, editor state, or transactions. |

### Make the cooperative path attractive

`tasks.forEach` lazily consumes an iterable and yields between short synchronous units. `tasks.cooperative` accepts synchronous generators with explicit checkpoints. Short UI actions run immediately. Buttons and shortcuts can invoke the same managed operation without implementing scheduling themselves.

The host owns task lifetime, labels, errors, replacement keys, and cancellation. Cooperative work needs a request to keep the queue running. That request is a queue start lease. Helpers acquire it when needed and release it when finished; plugin authors do not manage it themselves. Cancelling one task does not cancel peer work or pagination. Document- or view-specific work should also stop when that document or view closes.

All application plugins share pagination's frame allowance. The queue takes turns between jobs and preserves its existing balance between interactive and background work. Each frame has a 1,000-step cap and an 8 ms soft time budget. Soft means the queue checks the budget between steps. It cannot interrupt a step that is already running. Keep each unit short.

Quotas, slow-step diagnostics, and measured responsiveness guarantees are not implemented.

These helpers encourage responsive code; they do not intercept all JavaScript. Trusted code can still block in event handlers or Svelte effects. Truly synchronous ProseMirror hooks stay synchronous. Do not defer decisions that need an immediate answer or browser operations that require user activation.

### Computation, cancellation and result application

Separate data capture, computation, and result application. Capture only needed data and the target. After computation, validate that the result still applies and construct a fresh transaction synchronously. Do not retain transactions or assume a selection survives `await` or a cooperative yield. The current editor API rejects stale results rather than mapping them. Incremental edits need explicit partial-completion and undo-grouping rules.

`tasks.worker` starts a fresh dedicated worker for each task. The worker code is a module included in the build. Inputs and outputs are explicit. Optional transfer lists move supported values to the other thread rather than copying them.

The separate `@writers-ide/tasks/worker` entry exports `defineTaskWorker`. It imports no Svelte, application, or DOM runtime code. Its message protocol represents errors as data that can be copied between threads.

The service handles worker creation and messaging failures, failed result application, cancellation, and late responses. It also removes listeners and terminates the worker.

Worker pooling, progress, and timeouts are not implemented. A worker result can update local UI without editing a document.

Async operations must honor cancellation signals. Dedicated workers can be terminated; synchronous main-thread work cannot be interrupted. Check cancellation before work and before applying results. Same-key submissions replace prior work across all four modes within one service. Activation identities isolate keys across plugins and reactivations.

Each task returns a handle for observing and controlling it. Status, progress, and errors update reactively. The handle also exposes a cancellation signal and `result: Promise<TaskOutcome<T>>`. This promise never rejects. It resolves to a completed, cancelled, or failed outcome. Cooperative handles also support pause and resume. Worker `apply` runs synchronously at most once while active. Do not also apply the awaited result unless intentionally performing a separate operation. See the [task guide](../../packages-js/tasks/README.md) and [contracts](../../packages-js/tasks/src/contracts.ts) for exact semantics.

The library owns execution mechanics. The host owns plugin task lifetimes. The word-processing provider owns editor validation and transaction application. Formatting commands belong to neither generic layer. This work does not authorize a pagination redesign.

## Accepted implementation stages

Two numbering schemes describe this work. **Stages** are the original architectural rollout. **Parts** are the later implementation sequence in [implementation-plan.md](implementation-plan.md). Part 3 does not mean Stage 3.

Stages 1 and 2 support bundled trusted plugins. Stage 2 includes Parts 1 and 2 and the implemented editor portions, Parts 3A, 3B, and Part 3C's existing-type rendering slice. Part 3C's new-content/schema work remains proposed. Part 4 covers external loading and corresponds to the remaining Stage 3 work. These are scopes, not release dates.

### Stage 1 — Contracts, host, and formatting plugin

**Merged in #80 on 2026-11-14.** This established plugin identity, exact host API compatibility, synchronous lifecycle, contributions, explicit registration, duplicate-ID checks, activation rollback, and cleanup.

The host supports formatting toolbar contributions with horizontal and vertical presentations, capacity costs, and docking. Data contracts and the Svelte presentation adapter have separate entry points.

### Stage 2 — Reusable libraries and plugin management UI

**Implemented on `bh/phase-2-plugin-transition`; unmerged, no PR known.** The branch adds private layout and component libraries and a host-owned manager. It keeps application rendering and composition outside the reusable libraries.

The feature-neutral context contains `signal`, `own`, `contributions`, `tasks`, and `apis`. Domain services are supplied through declared provider contracts.

The later implemented parts add shared task helpers, exact-major providers and dependencies, the word-processing API, and lifecycle-owned behaviors. Formatting consumes the provider. Editor assembly is not extracted. Shortcut routing and broader helper extraction remain deferred.

The manager lists trusted bundled plugins, metadata, status, capabilities, contributions, provider availability, and actionable errors. It supports enable, disable, retry, and confirmed dependent cascades. The host owns the management shell so disabling a feature cannot remove it. There is no file/URL installation workflow or persistent activation preference.

### Stage 3 — Third-party loading, trust and native enforcement

**Planned; separate approval required.** External loading needs package validation, compatibility rules, installation review, and clear frontend trust/network disclosures. It also needs restrictive native APIs with verified request validation, revocation, and failure handling.

Ordinary Svelte and the same official/third-party APIs are the accepted direction. Frontend DOM isolation is deferred. Tests must establish real native denial and lifecycle behavior without claiming frontend isolation.

**Approved completion requirement:** by the end of Part 4, Basic Menu must be a separately packaged plugin using the same supported loading mechanism and public APIs as third-party plugins. It is currently bundled in the app source. The owner also approved packaged examples covering toolbar UI, editor behavior, workers and custom rendering. Reuse existing examples where practical; they need not be enabled by default. Frontend build tooling, controlled shared dependencies, local/manual installation and default feature packages are approved direction. Exact package format, dependency versions, distribution details and permission onboarding still need approval. See the [Basic Menu deliverable](implementation-plan.md#required-outcome-separately-packaged-basic-menu) and [example-package requirements](implementation-plan.md#required-outcome-packaged-extension-examples).

External loading should build on the current provider/dependency lifecycle. Custom content still has its own approval gate. The stages do not select storage or history models. An undo-tree feature remains a possible future consumer of host-managed history.

## Examples and candidate boundaries

These examples illustrate responsibilities, not authorization for further extraction:

- **Formatting toolbar:** an implemented plugin using optional shared controls and provider commands.
- **Word-processing view:** intended to be a feature plugin in a central container. Editor assembly remains coupled to the app.
- **Workbench docking:** core workspace infrastructure using private `@writers-ide/layout` and app-owned rendering.
- **UI foundations:** private `@writers-ide/components` supplies tooltip and icon-button primitives. Broader UI remains application code.
- **Scheduling:** shared infrastructure in `@writers-ide/tasks`, not a feature plugin. Workers offload computation; they do not establish a malicious-code sandbox.
- **Shortcuts:** possible shared routing infrastructure. Focus scopes and conflict policy still need design.
- **Pagination:** currently a coupled word-processing subsystem, not an independently replaceable external plugin. Preserve its model-mutating behavior.

### Undo tree as a boundary example

A future host history service would record changes, preserve stable identities, reconstruct authorized historical content, and validate navigation. An undo-tree plugin would display that history and request previews or navigation. Disabling its UI must not delete history or disable recovery.

Reading metadata, reading historical content, navigating history, and pruning history are distinct authorities. Current-content access should not automatically reveal deleted historical content. A history library, host service, and plugin presentation could be separate. No storage or branching design is selected. ProseMirror typing undo is not durable project history.

## Safety and data contracts

Packaging does not isolate code. Imported frontend code runs with its environment's authority. See the [trust model](#accepted-direction-frontend-trust-and-native-restrictions) for network risks and native restrictions.

Favor versioned data, scoped handles, and validated requests over mutable application singletons. Deep editor access must use the shared word-processing API. Native enforcement belongs below frontend code.

Disabling or removing a plugin must preserve its saved data. Basic preservation must not require executing an unavailable plugin. Schema-owning features need versioning and missing-plugin preservation contracts before extraction. Removing a toolbar is not equivalent to removing support for saved content.

## Current contracts and limitations

### Host lifecycle and management

`@writers-ide/plugins` is private and source-exported. Root contracts have no framework/editor runtime imports. They use a type-only `TaskService` import and contain no formatting types. The [general guide](../../packages-js/plugins/README.md) documents exact manifests, contribution APIs, and ownership.

The synchronous host checks declarations and contribution IDs. It rolls back failed activation, revokes and aborts before reverse-order cleanup, and continues after disposer failures. Contributions and `own()` resources belong to one activation. Old handles cannot act after deactivation or regain authority on reactivation. Features must scope their own subscriptions through this lifecycle.

`PluginManagementService` exposes `list`, `subscribe`, `activate`, `planDeactivation`, and `deactivate` with frozen reactive snapshots. `PluginManager.svelte` takes `management` and optional `requiredPluginIds`. The route owns the dialog, passes `onplugins` through `Editor` to `HorizontalBaseBar`, and restores launcher focus on close. This adds no plugin i18n contract, discovery, user-grant UI, or persisted preference.

Each activation receives a task service without another capability. Cooperative tasks acquire and release the requests that keep the queue running. Async and worker tasks need no such lease. Disposal cancels owned work and rejects further submissions. Task errors include label/key and phase `task`, without disabling the plugin. Callers may keep handles after tasks finish; the host does not keep task history. A later cleanup error can update the error on a cancelled handle. It does not change the already-resolved cancelled outcome. See the [task guide](../../packages-js/tasks/README.md#exact-task-api).

### Presentations and workspace adapters

Trusted Svelte presentations have local render/effect error boundaries and fallbacks. Shared tooltip snippets have their own boundary because they render outside the plugin view. Replacing content or dismissing the tooltip permits recovery. These boundaries do not contain arbitrary JavaScript, event-handler failures, malicious code, or native access.

`defineSveltePresentation(component, props)` checks explicit feature props before type erasure. The component receives the supplied props; include a context explicitly if the component needs one. Toolbar/view contributions adapt to existing registries; host command contributions use host-owned handles. The owner confirmed application commands as useful named actions independent of a particular UI, distinct from editor commands and typed provider services. Current `CommandContribution` callbacks take no arguments and return a synchronous boolean, without implicit editor targeting or native grants. Host registration/execution/revocation exists, but no current application UI routes user actions to these commands and plugins have no command-invocation service. Cross-plugin command invocation is approved direction, not implemented. It requires a declared package/component/local-command dependency and consumer-local alias, resolved to the appropriate project/window activation. Local command IDs may repeat across components; component-dependency aliases are local to the consumer and command aliases are local to each dependency. Required command dependencies participate in activation/removal planning; optional ones can be unavailable without automatically enabling providers. Unqualified registration-order lookup is not the supported path. Typed command arguments with validation before execution are approved direction, not implemented. Argument-free actions remain supported. Callers supply inputs; the host does not automatically generate argument UI. The [concrete command contract shape](command-contract.md) is approved, not implemented: `definePluginCommand` uses Standard Schema-compatible validators with inferred types; manifests declare component commands and nested dependency-command aliases; consumers call typed `context.commands.execute` with both aliases and the shared contract. Exact contract majors match independently of package-version ranges. Breaking argument/result changes require a new major. Publication checks and optional availability reporting still need specification. Awaitable command completion is approved direction, not implemented: implementations may finish synchronously or return a promise, and invocation always returns a promise that settles when the defined action completes. Starting a background task alone is not completion. Synchronous throws and asynchronous failures reject the invocation. Typed results are approved direction, not implemented. Each shared command contract declares its result type, validated before delivery. Invocation resolves with that value; commands with no result use `void`. Failures reject instead of relying on a universal handled/success boolean. Copied data-only payloads/results are approved, with no mandatory validator library. Raw functions and live editor/DOM/service handles are not payloads. The exact extended structured-clone value list, schema-transform semantics and resource budgets remain to be specified.

Per-invocation cooperative cancellation is approved direction, not implemented. Supply a signal tied to explicit caller cancellation, caller/provider activation end, command removal and its project-connection lifetime. The host rejects a pending invocation with a recognizable cancellation/revocation error when it processes the event, suppresses late success and observes late failures. Authors must propagate the signal to tasks/cancellable operations and check before further effects. Arbitrary synchronous code cannot be interrupted, and completed edits/native effects do not roll back. Rejection does not prove all work stopped. Cancelling one invocation must not cancel unrelated provider work/consumers or revoke its activation credential. Signal placement in the callback context and execution options follows the approved command shape. Exact error codes and remaining lifecycle edge cases still need specification. Use existing task helpers for substantial work; promises do not offload CPU work. Activation, ProseMirror hooks and editor callbacks remain synchronous; apply computed results through fresh validated editor operations. A command picker or shortcut system is not approved by this purpose decision. Central-view instance metadata and contributed shortcut routing are not implemented. The application registers the built-in word processor directly.

`@writers-ide/components` exports `TooltipState`, `TooltipProvider`, `IconButton`, `Tooltip`, and `Pointer` with explicit dependencies and no app singleton. App wrappers retain the shared tooltip manager. The route supplies it to `Editor` with `renderPointer={false}` because the app still renders its pointer. Drag suppression uses that same manager.

### Formatting and relocation

Formatting exposes immediate copied snapshots with view ID, monotonic revision, mark/block ratios, and command availability. Requests identify view, revision, and command. Validation uses live active view, state, and editability, including before reactive flush. Tab document IDs resolve to distinct registered view IDs. Unavailable and no-op controls are disabled.

Formatting subscriptions are lazy. Availability queries inspect content without speculative transactions. Peer grouping must handle page boundaries, final leaf blocks, and document-end selections. Listener failures do not interrupt peers or editor dispatch. Feature-local scoping copies snapshots and requests, owns subscriptions, and rejects stale activations. See the [formatting guide](../../src/lib/editor/prosemirror/menu/basic/README.md) for these policies and regressions.

Disabling a toolbar removes its presentation but retains placement IDs and orientation capacity costs. Missing-item placeholders remain, and reactivation restores presentations. Registry `clear()` releases retained metadata. This is in-memory preservation, not durable storage. Relocation remounts UI against the same scoped service and current snapshot. There is no general component-local-state transfer, schema lifecycle, or durable history API.

## Source and test entry points

These are private implementation entry points, not a published stable SDK. Recorded test results belong to the [changelog](change-log.md); the references below identify coverage, not newly run checks.

### Host and contributions

- `packages-js/plugins/index.ts`, `svelte.ts`, and [guide](../../packages-js/plugins/README.md): lifecycle/data contracts and typed presentation descriptors.
- `src/lib/plugins/plugin-host.ts`, `plugin-host.test.ts`, `plugin-dependencies.test.ts`, and `plugin-tasks.svelte.test.ts`: lifecycle, rollback, dependency preflight, exact majors, optional providers, connection cleanup, errors, and task ownership.
- `src/lib/plugins/PluginManager.svelte` and `PluginManager.svelte.test.ts`: management actions, metadata, failures, and cascade consent.
- `src/lib/plugins/PluginPresentation.svelte`, `plugin-presentation.svelte.test.ts`, and `generic-presentation.svelte.test.ts`: explicit props and local failure containment.
- `src/lib/plugins/application-plugin-host.ts` and `application-plugin-host.svelte.test.ts`: registry adapters, collisions, ownership, reactivation, and retained capacity.
- `src/lib/editor/state/bar-item-registry.svelte.ts`, `bar-items.svelte.ts`, and `tab-state-registry.svelte.ts`: registry integration. `shared.types.ts` defines the application workspace prop types.
- `e2e/plugin-dependencies.test.ts`, `e2e/fixtures/plugins/`, and `playwright.plugins.config.ts`: production-built provider/consumer and manager fixture. Run `pnpm test:plugins` separately from app e2e.

### Editor and feature integrations

- `packages-js/word-processing/src/contracts.ts`, `service.svelte.ts`, and [guide](../../packages-js/word-processing/README.md): standalone API, exact targets, result handling, and ownership. `src/lib/testing/word-processing.svelte.test.ts` covers service regressions.
- `packages-js/word-processing/src/behaviors.svelte.ts` and `src/lib/testing/word-processing-behaviors.svelte.test.ts`: wrappers, ordering, key/state preservation, staging, quarantine, and cleanup.
- `packages-js/word-processing/src/rendering-manager.svelte.ts`, `renderers.ts`, and `src/lib/testing/word-processing-renderers.svelte.test.ts`: dedicated renderer factories, conflict checks, guarded callbacks, ownership, schema fallback, and layout integration.
- `packages-js/word-processing/svelte.ts`, `src/svelte-views.svelte.ts`, `src/svelte-view-host.svelte`, and `src/lib/testing/word-processing-svelte-views.svelte.test.ts`: component props, stable editable DOM, mark updates, selection, boundary recovery, and teardown. Test components are `src/lib/testing/SvelteWordProcessingNodeAdapterFixture.svelte` and `SvelteWordProcessingMarkAdapterFixture.svelte`.
- `packages-js/word-processing/src/renderer-layout.ts` and `src/lib/editor/prosemirror/renderer-layout.svelte.test.ts`: shared observation, initial baselines, dimension-change coalescing, and cleanup.
- `src/lib/editor/prosemirror/word-processing.svelte.ts` and `word-processing.svelte.test.ts`: app sources/provider. `src/routes/+page.svelte` composes provider and formatting and still directly registers the editor view.
- `src/lib/editor/prosemirror/view/editor.ts`, `page-indexes.ts`, and `editor-behaviors.svelte.test.ts`: accepted-transaction integration and normalization. `plugins.svelte.ts` in the parent directory supplies baseline editor factories, separately from the application-plugin host.
- `src/lib/editor/prosemirror/menu/basic/` ([guide](../../src/lib/editor/prosemirror/menu/basic/README.md)): plugin definition, contracts, formatting bridge, scoped service, and presentations. `formatting-service.svelte.test.ts`, `scope-formatting-service.test.ts`, and `menu.test.ts` cover formatting queries, stale targets, ownership, and both orientations.
- `src/lib/editor/prosemirror/menu/quick-format/menu.ts` and `QuickFormat.svelte`: independent public-API command consumer.
- `src/lib/editor/prosemirror/behaviors/` ([guide](../../src/lib/editor/prosemirror/behaviors/README.md)): input rules, mapped decorations, bounded worker analysis, and public command IDs.
- `e2e/word-processing.test.ts`, `e2e/word-processing-behaviors.test.ts`, `e2e/fixtures/word-processing/BehaviorFixture.svelte`, and `playwright.word-processing.config.ts`: real views/history, app adapter, independent consumers, and workers. Run `pnpm test:word-processing` separately from app e2e. The fixture imports no Basic Menu implementation.

- `e2e/word-processing-renderers.test.ts`, `e2e/word-processing-renderer-pagination.test.ts`, and the [fixture guide](../../e2e/fixtures/word-processing/README.md): opt-in Svelte rendering, multi-view failure recovery, and production-pagination geometry. Both run through `playwright.word-processing.config.ts`, separately from main app e2e.

### Libraries, scheduling, and browser coverage

- `packages-js/layout/index.ts` and `src/`: injected layout engine and drag primitives. `src/lib/editor/state/workbench.svelte.ts` composes the compatibility instance. `src/lib/editor/bars/` and `src/lib/dnd/` retain app rendering/composition. See [DnD context](../dnd/context.md).
- `packages-js/components/index.ts` and `src/`: explicit tooltip services and controls. `src/lib/testing/layout-library.svelte.test.ts` and `components-library.svelte.test.ts` cover instance independence.
- `packages-js/tasks/src/contracts.ts`, `task-service.svelte.ts`, `work-queue.svelte.ts`, and [guide](../../packages-js/tasks/README.md): queue and helper mechanics. Package `worker.ts` and `examples/count.worker.ts` provide worker-only helpers and an example. `src/lib/editor/state/work-queue.svelte.ts` retains compatibility exports and the app singleton.
- `src/lib/testing/tasks-library.svelte.test.ts`, `tasks-library-worker.test.ts`, and `src/lib/editor/state/work-queue.svelte.test.ts`: task mechanics, mock worker protocol, and queue regressions. `e2e/tasks.test.ts`, `e2e/fixtures/tasks/`, and `playwright.tasks.config.ts` cover real workers, transfers, cancellation, recovery, and queue sharing. Run `pnpm test:tasks`.
- `e2e/docking.test.ts`: real docking and formatting-button regressions. Smoke also includes `e2e/smoke.test.ts`, `pagination-selection.test.ts`, and `plugin-manager.test.ts`. Running only smoke and docking misses broader app regressions.
- `.github/workflows/browser_smoke.yml`: selected-engine task, provider, and word-processing fixture steps alongside app smoke. Main app e2e excludes those dedicated fixtures. Browser checks do not establish Tauri/native enforcement. Use real pagination browser tests for geometry; behavior fixtures and jsdom cannot establish it.

The root and five private packages are workspace members. Shortcuts, broader UI/services, and other editing helpers remain application code. This is not a bulk-extraction or publication plan.

## Open implementation decisions

The implemented task/provider, editor behavior, and existing-type renderer contracts are approved, not pending decisions. Remaining questions include:

- Package boundaries beyond current scope, dependency rules, publication, and API stabilization.
- Lifecycle beyond synchronous API version 1, richer view-instance contracts, user grants, and persisted activation preferences.
- Domain APIs beyond the current provider system and broader editor assembly extraction.
- New content types, Part 3C: approve node/mark registration, schema lifecycle, and missing-content preservation separately. Existing-type rendering, conflicts, fallback, failures, and Svelte adapters are implemented and approved. The [remaining Part 3C plan](implementation-plan.md#3c--custom-content-and-svelte-node-views) separates those contracts from the open design gates.
- Task quotas, slow-step diagnostics, responsiveness measurements, and any demonstrated need for worker pooling, progress, or timeouts.
- External loading, review/network disclosures, restrictive native enforcement, and possible later frontend isolation. External loading is Part 4 and needs owner approval.
- Broader document/view ownership, schema evolution, persistence, history, collaboration, and retention.

Candidate examples do not authorize further migrations. Use the [implementation plan](implementation-plan.md) for the remaining approval gates.
