# Plugins, reusable libraries, and core responsibilities

Writer's IDE separates feature plugins, reusable libraries, and the application core. A plugin adds a feature, such as a formatting toolbar. A library supplies code that other code imports. The core hosts features and coordinates the workspace. A plugin and the core can both use libraries.

This document explains those responsibilities and the current extension contracts. Use the [plugin author guide](../../packages-js/plugins/README.md) to build a bundled plugin. Use the [word-processing guide](../../packages-js/word-processing/README.md) for editor integrations and the [task guide](../../packages-js/tasks/README.md) for managed background work.

## Status and scope

The current implementation supports explicitly registered, trusted bundled plugins. They can contribute toolbars, view presentations, and commands. They can also share versioned APIs, run managed tasks, and extend existing editors. There is no external plugin loader or sandbox. The workspace packages are private and evolving, not a published stable SDK.

The implementation described here includes unmerged work on `bh/phase-2-plugin-transition`. No PR is known. The original host merged in [#80](https://github.com/benyakirten/writers-ide/pull/80) on 2026-11-14.

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

A plugin package is intended to be the unit of feature identity, compatibility, activation, and permissions. External package and loading formats have not been selected.

## Responsibility boundaries

The accepted direction is a small core with word processing, formatting bars, and other feature views implemented as plugins. Official and third-party plugins must use the same supported public APIs. Official features must not receive privileged shortcuts into raw editor or application internals. Exact extraction boundaries remain open.

The core hosts contributions and enforces their contracts. It owns workspace layout infrastructure, internationalization, import/export infrastructure, and safe access to platform and project services. Plugins supply feature behavior and presentation through those contracts.

For example, a formatting toolbar supplies horizontal and vertical presentations. It observes formatting summaries and invokes commands. The workbench decides docking, capacity, placement, and focus routing. Moving the toolbar can remount its UI. State that must survive the move cannot live only in that presentation instance.

### Libraries underneath these boundaries

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

A dependency pins an exact provider plugin ID, API ID, and integer major. It is not a package-version range. Self-dependencies and duplicate dependencies are rejected. The separate host compatibility field must be exactly `apiVersion: 1`; plugin package `version` does not negotiate either contract.

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

The independent `menu/quick-format/` example consumes the same public API and upstream `toggleMark`. It supports production `bold` and conventional `strong`. Unlike Basic Menu, it supports caret stored marks. Both orientations share a connection-owned command. It is opt-in, registered only in the browser fixture, and imports no Basic Menu implementation.

See the [word-processing guide](../../packages-js/word-processing/README.md) for exact results, errors, callback rules, and ownership. Async work captures only needed data and an exact target. It later calls `applyResult` with a new synchronous callback and cancellation checks. The API does not map stale output, group undo, or recover partially completed edits.

### Lifecycle-owned behaviors (Part 3B implemented / unmerged)

Behavioral registrations let consumers install input rules, decorations, plugin state, and supported editor hooks. `registerBehavior({ id, name, priority?, views?, create })` returns a connection-owned disposer. IDs are service-global; duplicates throw. `views` is an optional view-ID allowlist, not a document filter. Omission means all live views.

`create({ viewId, documentId, name, state, view, signal })` synchronously returns an actual ProseMirror `Plugin` or readonly array of plugins for each matching live view/document identity. Each instance's signal aborts on view closure, detach or replacement, registration removal or failure, connection revocation, or service disposal. `nodeViews` and `markViews` are rejected until custom-content work is approved.

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

The [example guide](../../src/lib/editor/prosemirror/behaviors/README.md) lists public command IDs. Only the fixture's **Mount behavior proofs** control mounts `BehaviorFixture.svelte`. The default route and other fixture scenarios do not enable them. The dedicated suite has 24 Chromium/WebKit cases: twelve original cases and twelve behavior cases. Browser Smoke CI includes both test files. Main app e2e excludes them. Structural layout edits in this fixture do not validate real pagination geometry. Recorded results and remaining diagnostic and selection-timing limits are in the [branch changelog](change-log.md).

### Execution boundary and design validation

A wrapper adapts a package; it does not isolate it. ProseMirror callbacks execute with the frontend environment's authority. Input rules, decorations, and bounded worker analysis have working examples. Broader compatibility remains package- and schema-dependent.

A small ordinary Svelte custom-node integration is proposed next. Schema lifecycle, missing-content preservation, and external/native enforcement need separate approval. None is completed by the current behavior API.

## Accepted direction: frontend trust and native restrictions

Frontend plugins are trusted code in the same JavaScript environment as the app. The owner approved ordinary Svelte, plugin-owned DOM rendering, and supported deep editor APIs. Preventing access to other DOM is deferred. Public APIs are the supported path, but the rule against changing another plugin's UI or private state is behavioral, not an enforced DOM boundary.

External network calls are allowed in principle under explicit user trust. A plugin that can read manuscript content and make requests can disclose that content. Copied snapshots, declarations, wrappers, and DOM boundaries do not prevent this. Installation disclosures must distinguish information from enforced restrictions. Review and network-disclosure UX remain open; no external loader exists today.

Native access means authority outside ordinary browser code, such as Tauri IPC, filesystem access, shell/process execution, or native libraries. Frontend trust must not grant unrestricted native access. Narrow native APIs need actual enforcement and verification before external loading. TypeScript interfaces and frontend checks are not that enforcement. Arbitrary native-plugin execution is not approved.

Project-supplied requirements must not automatically install or execute code or grant permissions. Ordinary Svelte node views remain a goal. Frontend isolation is deferred and must not be described as a current guarantee.

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

Stages 1 and 2 support bundled trusted plugins. Stage 2 includes Parts 1 and 2 and the implemented editor portions, Parts 3A and 3B. Part 3C covers proposed custom content. Part 4 covers external loading and corresponds to the remaining Stage 3 work. These are scopes, not release dates.

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

`defineSveltePresentation(component, props)` checks explicit feature props before type erasure. The component receives the supplied props; include a context explicitly if the component needs one. Toolbar/view contributions adapt to existing registries; host command contributions use host-owned handles. Central-view instance metadata and contributed shortcut routing are not implemented. The application registers the built-in word processor directly.

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
- `src/lib/editor/prosemirror/word-processing.svelte.ts` and `word-processing.svelte.test.ts`: app sources/provider. `src/routes/+page.svelte` composes provider and formatting and still directly registers the editor view.
- `src/lib/editor/prosemirror/view/editor.ts`, `page-indexes.ts`, and `editor-behaviors.svelte.test.ts`: accepted-transaction integration and normalization. `plugins.svelte.ts` in the parent directory supplies baseline editor factories, separately from the application-plugin host.
- `src/lib/editor/prosemirror/menu/basic/` ([guide](../../src/lib/editor/prosemirror/menu/basic/README.md)): plugin definition, contracts, formatting bridge, scoped service, and presentations. `formatting-service.svelte.test.ts`, `scope-formatting-service.test.ts`, and `menu.test.ts` cover formatting queries, stale targets, ownership, and both orientations.
- `src/lib/editor/prosemirror/menu/quick-format/menu.ts` and `QuickFormat.svelte`: independent public-API command consumer.
- `src/lib/editor/prosemirror/behaviors/` ([guide](../../src/lib/editor/prosemirror/behaviors/README.md)): input rules, mapped decorations, bounded worker analysis, and public command IDs.
- `e2e/word-processing.test.ts`, `e2e/word-processing-behaviors.test.ts`, `e2e/fixtures/word-processing/BehaviorFixture.svelte`, and `playwright.word-processing.config.ts`: real views/history, app adapter, independent consumers, and workers. Run `pnpm test:word-processing` separately from app e2e. The fixture imports no Basic Menu implementation.

### Libraries, scheduling, and browser coverage

- `packages-js/layout/index.ts` and `src/`: injected layout engine and drag primitives. `src/lib/editor/state/workbench.svelte.ts` composes the compatibility instance. `src/lib/editor/bars/` and `src/lib/dnd/` retain app rendering/composition. See [DnD context](../dnd/context.md).
- `packages-js/components/index.ts` and `src/`: explicit tooltip services and controls. `src/lib/testing/layout-library.svelte.test.ts` and `components-library.svelte.test.ts` cover instance independence.
- `packages-js/tasks/src/contracts.ts`, `task-service.svelte.ts`, `work-queue.svelte.ts`, and [guide](../../packages-js/tasks/README.md): queue and helper mechanics. Package `worker.ts` and `examples/count.worker.ts` provide worker-only helpers and an example. `src/lib/editor/state/work-queue.svelte.ts` retains compatibility exports and the app singleton.
- `src/lib/testing/tasks-library.svelte.test.ts`, `tasks-library-worker.test.ts`, and `src/lib/editor/state/work-queue.svelte.test.ts`: task mechanics, mock worker protocol, and queue regressions. `e2e/tasks.test.ts`, `e2e/fixtures/tasks/`, and `playwright.tasks.config.ts` cover real workers, transfers, cancellation, recovery, and queue sharing. Run `pnpm test:tasks`.
- `e2e/docking.test.ts`: real docking and formatting-button regressions. Smoke also includes `e2e/smoke.test.ts`, `pagination-selection.test.ts`, and `plugin-manager.test.ts`. Running only smoke and docking misses broader app regressions.
- `.github/workflows/browser_smoke.yml`: selected-engine task, provider, and word-processing fixture steps alongside app smoke. Main app e2e excludes those dedicated fixtures. Browser checks do not establish Tauri/native enforcement. Use real pagination browser tests for geometry; behavior fixtures and jsdom cannot establish it.

The root and five private packages are workspace members. Shortcuts, broader UI/services, and other editing helpers remain application code. This is not a bulk-extraction or publication plan.

## Open implementation decisions

The implemented task/provider and editor behavior contracts are approved, not pending decisions. Remaining questions include:

- Package boundaries beyond current scope, dependency rules, publication, and API stabilization.
- Lifecycle beyond synchronous API version 1, richer view-instance contracts, user grants, and persisted activation preferences.
- Domain APIs beyond the current provider system and broader editor assembly extraction.
- Custom content: schema lifecycle, preservation, and Svelte node/mark views. This is Part 3C and needs owner approval.
- Task quotas, slow-step diagnostics, responsiveness measurements, and any demonstrated need for worker pooling, progress, or timeouts.
- External loading, review/network disclosures, restrictive native enforcement, and possible later frontend isolation. External loading is Part 4 and needs owner approval.
- Broader document/view ownership, schema evolution, persistence, history, collaboration, and retention.

Candidate examples do not authorize further migrations. Use the [implementation plan](implementation-plan.md) for the remaining approval gates.
