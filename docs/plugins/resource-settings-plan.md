# Command resource settings: approved persistence and distribution design

**Status: owner-approved design. Stage A internal native persistence and Stage B's internal distribution fixture are authorized and implemented / unmerged. Authorization extends through Stage B only, not production integration.**

Application commands let a component invoke a declared action supplied by another component. The host's dispatcher validates those calls and accounts for pending calls and retained payloads. Resource settings control those budgets. They do not grant native permissions or bound arbitrary plugin memory use.

This design connects the [approved settings behavior](command-contract.md#user-settings-and-changes) to the existing internal SQLite registry and per-window dispatcher. It does not enable production registry startup, publication, external loading or native authority. Windows persistence qualification remains deferred and all production publication gates stay unchanged.

## Current implementation and approved requirements

The [reservation ledger](../../packages-js/plugins/command-reservations.ts) implements validated defaults, per-window counters and `updateLimits`. Each admitted call captures its limits. Updating the ledger does not replace its counters, cancel running work or alter an admitted call's limits. Stage B adds an internal fake-source, transport-independent coordinator/client fixture. The [application component assembly](../../src/lib/plugins/application-component-host.svelte.ts) accepts either a ledger or an opt-in `resourceSettingsClient`. There is no production registry source, Rust settings coordinator, saved-settings loader or window transport. See [internal setup and lifetime](#internal-fixture-setup-and-lifetime).

The [schema-2 registry settings row](../../src-tauri/src/plugin_registry/schema.sql) stores permission mode, repair-conflict policy, eight resource limits and a separate resource revision. [The model](../../src-tauri/src/plugin_registry/model.rs) keeps the two-field `HostSettings` independent from `CommandResourceSettings`, `CommandResourceRevision` and `CommandResourceSettingsSnapshot`. Permission reviews still compare only `HostSettings`. Resource-specific reads and writes are implemented in [`store_command_settings.rs`](../../src-tauri/src/plugin_registry/store_command_settings.rs) and exposed through `RegistryHandle` in [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs). They are internal Rust operations, not IPC or a settings loader.

Already approved behavior includes one application-wide configuration, independent window counters, changes for new invocations, individual reset controls and warnings above defaults. Values must be positive JavaScript-safe integers. No unlimited mode, project overrides or additional fixed upper bounds are approved. The owner has approved registry persistence and asynchronous per-window application as described below. Exact production wire messages and transport budgets remain open.

## Approved design choices

The owner approved all five choices. Implementation authorization now covers Stage A and the internal Stage B fixture only:

1. Keep the existing registry as the sole durable authority. Add explicit typed columns through a real internal schema-1-to-schema-2 upgrade. Do not add browser storage, a second configuration file or a new dependency.
2. Give resource settings a separate optimistic-concurrency revision and typed operations. Keep permission-setting comparisons independent.
3. Define a successful save as a confirmed database commit. Track per-window application separately. Do not promise an instantaneous application-wide switch.
4. Restore resource settings from the backup, while retaining the existing Secure-mode permission-recovery rule. Use a fresh service identity after reopening or restoration.
5. Implement and test internal persistence first, then a transport-independent distribution fixture. Production IPC, settings UI and startup remain separately gated.

A separate revision detects intervening edits, including changes away from and back to the same values. Commit completion and window application are separate states. A blocked window does not prevent a save, but it may temporarily use older limits. Distribution must therefore report pending application and handle stale associations. Stage B models these approved semantics internally. Production runtime integration remains absent.

## Implemented stored data

Schema version 2 retains 20 tables. Its required singleton `host_settings` row adds nine explicit typed columns: eight resource limits and one revision. The frontend names below describe the existing ledger shape, not a new plugin API. The SQL names and defaults are implemented.

| Existing runtime field | SQL column                     | Initial value |
| ---------------------- | ------------------------------ | ------------: |
| `maxCallerPending`     | `command_max_caller_pending`   |            32 |
| `maxProviderPending`   | `command_max_provider_pending` |            64 |
| `maxWindowPending`     | `command_max_window_pending`   |           256 |
| `payload.maxBytes`     | `command_max_payload_bytes`    |     8,388,608 |
| `payload.maxDepth`     | `command_max_payload_depth`    |            64 |
| `payload.maxEntries`   | `command_max_payload_entries`  |       100,000 |
| `maxComponentBytes`    | `command_max_component_bytes`  |    33,554,432 |
| `maxWindowBytes`       | `command_max_window_bytes`     |   134,217,728 |

Require each resource value to be an integer in `1..=9,007,199,254,740,991` in native validation and SQL constraints. That range fits SQLite's signed integer and JavaScript's exact integer representation. Native integer types alone do not enforce it. Validate before SQL conversion and before delivering a stored value to JavaScript. Keep byte counts in bytes; settings controls must check any unit conversion for overflow.

Do not impose relationships such as payload allowance being less than component allowance. Different independent budgets may make some calls inadmissible, but the approved policy does not prohibit that configuration.

Add a separate nonnegative `command_resource_revision` integer, initially zero. A changed configuration advances it once using checked arithmetic. At SQLite's signed-integer maximum, a changed configuration returns `LimitExceeded` without wrapping or resetting. A current-revision no-op still succeeds at that maximum. Serialize revisions as canonical decimal strings, not JavaScript numbers. Revisions are ordering markers, not credentials.

Keep `HostSettings` and its permission/repair comparison semantics unchanged. The distinct resource-settings types and purpose-specific read/update operations use the same SQL row. A resource-only update must not delete automatic permission approvals, change permission mode or invalidate a permission review solely because resource values changed.

## Implemented migration and recovery

Version 1 is an internal unshipped baseline. Its upgrade preserves developer and fixture registries; it does not establish a released compatibility obligation. [`schema_v1.sql`](../../src-tauri/src/plugin_registry/schema_v1.sql) retains that baseline byte-for-byte.

The private compiled static SQL in [`migration_v1_to_v2.sql`](../../src-tauri/src/plugin_registry/migration_v1_to_v2.sql) rebuilds `host_settings` to the exact accepted version-2 definition through the [approved backup-before-migration mechanism](registry-foundation.md#approved-normal-schema-migration). Preserve permission mode, repair policy, registry identity and unrelated rows. Supply the eight approved defaults and revision zero during that upgrade. Fresh version-2 creation uses the same defaults.

Version-aware validators check source, backup, restore source and target against the recognized schema definitions. They preserve registry identity, allocation high-water marks, permissions and unrelated rows. Unknown or newer versions reject; version 3 is unsupported and appears only in negative or synthetic migration fixtures.

Trusted internal Rust code can call `Registry::open_owned_with_upgrade(lease, path, backup, limits, capacity)` or the underlying `Store::open_with_upgrade(path, backup, limits)`. The host supplies the selected database and an explicit non-overwriting backup destination. Ordinary opening validates version 2 and refuses version 1 without this explicit upgrade path. It never guesses a backup path. Opening an already-current database through the upgrade opener validates it without creating a backup or resetting saved values. No application startup adapter calls these methods. This slice introduces no automatic backup-retention or cleanup rules.

Keep migration transactional and separate from generation publication. Backup failure prevents mutation. Failed target validation rolls back. The migration executor can report uncertain completion; it does not itself transition a lifecycle coordinator. On uncertain commit or rollback, return no ready service. The owning opening/recovery path must preserve ownership and apply the existing recovery policy. Do not enable an application startup path to exercise this upgrade.

After successful initialization or migration, missing settings or invalid resource values are invalid registry state. Do not silently replace them with defaults. For restoration, retain valid backed-up resource settings. The existing rule that recovered permission state becomes Secure remains independent. Recognize and validate a version-1 backup without modifying it, then copy it into the owned restore working destination. Upgrade and validate that working database before publication or readiness. Preserve the original backup and current database. Resource settings are unavailable until that working copy passes the recognized upgrade and target validation.

## Implemented update and conflict contract

`Store` and `RegistryHandle` expose `read_command_resource_settings()` and `set_command_resource_settings(expected_revision, settings)`. A read returns the complete eight-value configuration and resource revision in one transaction. A write updates all eight values and their revision in one transaction. This prevents mixed configurations. Reads inspect scalar integers through borrowed SQLite `ValueRef` values instead of allocating persisted text or blobs. Missing or invalid persisted settings return `RecoveryRequired`, not defaults.

An update supplies the expected resource revision. Compare it before applying the change. A stale revision returns a conflict without writing. Do not merge fields or automatically retry an old settings form over a newer save. The UI should retain the user's draft and show the current saved configuration for review.

With a current revision, an identical configuration is a no-op: return the current snapshot without advancing the revision or emitting a change. A stale revision still conflicts even if the proposed values happen to match current values. This detects intervening changes without coupling resource edits to permission reviews.

Return save success only after SQLite commit succeeds. Preserve `OutcomeUnknown` when the registry cannot confirm a write outcome. Mutation uncertainty poisons the store so ordinary operations cannot continue against uncertain state. Resource operations use the existing bounded FIFO worker and `RegistryHandle` service association; Stage A adds no distribution epoch. Abandoning a caller does not cancel an admitted write. After controlled reopening or recovery, an authoritative read can show current state; it cannot always prove whether the earlier save happened before a later edit. Do not label it a confirmed rollback or replay the write automatically.

## Runtime authority and snapshots: internal fixture and production boundary

The eventual production runtime owner is a Rust-side internal settings coordinator. It will own the committed snapshot and distribution state. The registry worker remains the only database owner; it must not call frontend observers or wait for WebView acknowledgments while a transaction is open. Stage B models this ownership in TypeScript with a fake source. It does not implement or wire the production Rust coordinator or a registry-backed source.

Once a write is admitted, completion reconciliation must remain owned independently of the caller's waiting future. Abandoning the request must not leave committed settings permanently absent from the coordinator's snapshot or change delivery. Publishing only after a caller-owned `await` is insufficient. Late read/write completions must not regress a newer accepted snapshot. Uncertain completion triggers authoritative resynchronization or the existing recovery path, not guessed publication. The owning reconciliation work must remain bounded by host admission and lifecycle limits; do not create an unbounded background task for every subscriber.

Associate runtime snapshots with a fresh service epoch and the persisted resource revision. Allocate a new epoch when a settings service starts, reopens after recovery or adopts a restored registry. The epoch is not persisted and grants no authority. It prevents a revision from an older database lifetime being mistaken for a newer state after restore.

Reads are bound to the current service association. Updates additionally carry the expected resource revision. An old association is rejected rather than retargeted. Keep this distinct from package installation revisions and registry maintenance revisions. No public SDK type or Tauri command is selected here.

Before adopting a replacement database lifetime, the runtime owner closes its old settings associations and stops publishing through them. This follows the existing rule that old registry operation handles never retarget. A fresh epoch alone does not invalidate clients. Each attached window enters stale/paused state when it detects association closure and must explicitly reattach before using the new service. Once a client detects closure, it ignores queued old-association messages and acknowledgments. This design does not promise that every WebView detects backend replacement simultaneously; until detection, a window may still use its previous configuration. Authoritative old-association reads/writes remain rejected. That delivery gap is part of the approved asynchronous boundary, as is ordinary change propagation.

## Window delivery and application: internal fixture and production boundary

Use full immutable snapshots, not eight independent field events. Each host-owned workspace subscription retains at most one in-progress delivery and one latest replacement snapshot. Intermediate configurations may be coalesced. Keep pending state proportional to live host-owned windows, not the number of edits. Plugins cannot register these subscriptions or publish settings messages.

Initial registration and snapshot selection must be ordered with committed updates. A new window must not miss a change between its first read and subscription. Subscribe before enabling that window's settings-integrated command host, deliver the current snapshot, and acknowledge only after applying it. A settings-integrated host with no initial valid snapshot does not admit commands under guessed defaults. This does not change today's standalone test helpers or default bundled host.

Apply each accepted snapshot through `updateLimits` on the existing ledger. Do not recreate the dispatcher, ledger, activations or counters. A window rejects stale revisions within its live epoch and accepts a new epoch only through explicit host-controlled reattachment. Compare canonical decimal revisions numerically without converting them to JavaScript numbers or using lexicographic string order. An identical configuration with the same epoch/revision is an idempotent duplicate and can be acknowledged again. The same epoch/revision with different values is a protocol inconsistency: mark the client stale instead of choosing one configuration. Apply all eight values together before admitting another invocation in that window. Existing calls retain their captured limits and remain counted until their work settles.

A save reply means **saved**, not **applied everywhere**. The settings UI should distinguish those states and identify windows with pending application. A window may admit calls under the previous configuration until it receives the update. A blocked JavaScript thread cannot be forced to apply a snapshot immediately. This per-window transition is the approved interpretation of “changes apply to new invocations.” It does not promise simultaneous application-wide cutover.

A detected service disconnect or invalid snapshot marks the settings-integrated host stale and pauses new command admission. Existing work continues with its original accounting. Reattach, obtain a current snapshot and apply it before resuming. Do not reset counters or guess saved values. An undetected transport gap cannot be presented as current state. The later production transport must provide acknowledgment, gap detection and resynchronization; unacknowledged fire-and-forget events alone are insufficient. Exact IPC messages, delivery deadlines and retry budgets remain a later approval gate, not an implied production implementation in the first slice.

Notification failure after commit is a distribution failure, not a rolled-back save. Never replay a settings write to repair delivery. Resend or reread committed state instead. No polling loop, unbounded queue or automatic service restart is approved by this design.

## Approved write authority and UI boundary — not implemented

Only trusted application settings management may request writes. The planned [management/recovery boundary](context.md#native-request-identity-and-token-enforcement) still requires Rust to validate the actual calling WebView and allowed route. Plugin-hosting WebViews may eventually receive the resource snapshots needed for dispatch, but they must not gain a setter. A frontend wrapper or activation token alone does not enforce that distinction.

The first implementation stages expose no Tauri commands or native capabilities. Use internal operations and controlled test fixtures. Production read/write exposure, management-window lifetime and packaged authorization tests need their own reviewed integration. The planned UI section is Plugins → Resource limits, with complete-configuration Save, per-field reset, warnings above defaults, conflict handling, and separate saved/application status. No plugin can raise its own budget.

Persistent diagnostics are not included. Nor are permission settings changes, blocked-activation preferences, project overrides, default bundled-host migration, manifest assembly, external loading or package installation. Those remain separate requirements in the [Part 4 checklist](implementation-plan.md#foundation-slice-and-remaining-execution-checklist).

## Implementation stages and acceptance

**Stage A: internal native persistence — implemented / unmerged.** The working branch contains typed values, recognized migration, defaults, validation, resource-specific concurrency, explicit owned upgrade opening and restore behavior. Test sources cover numeric boundaries, missing rows, stale/no-op writes, revision exhaustion, permission-review independence, restore-source preservation, backup failures, rollback, uncertainty and abandoned admitted callers. Readiness is withheld until backup, migration and required validation finish. Failed or uncertain migration exposes no usable operation handle. No production startup or publication adapter is added.

**Stage B: isolated distribution and ledger integration — authorized and implemented internally / unmerged.** The fake-source, transport-independent coordinator/client fixture connects to the opt-in application assembly. Tests cover initial-subscription races, coalescing, stale/out-of-order completions and messages, duplicates, equal-revision inconsistencies and abandoned admitted writes. They also cover association closure, queued old messages, explicit epoch changes, resynchronization, callback isolation, disposal, cleanup reentry and bounded subscription churn. Assembly tests verify preserved counters and admitted-call limits through lowered settings, disconnects and cancellation with unfinished work. This fixture is not production multi-window IPC.

**Later production integration.** Approve and implement the management read/write routes, bounded transport recovery, saved/application UI, registry startup and remaining authorization prerequisites. Verify real packaged windows and the supported platform matrix. The internal stages do not complete settings integration or Part 4. Windows contract work stays deferred unless explicitly resumed.

## Internal fixture setup and lifetime

These are internal repository imports for trusted application composition and tests. They are not public SDK exports or plugin authority. [`command-resource-settings.ts`](../../packages-js/plugins/command-resource-settings.ts) supplies the coordinator and client. The [assembly tests](../../src/lib/plugins/application-command-resource-settings.svelte.test.ts) demonstrate their setup with an in-memory source.

1. Host test code supplies a `CommandResourceSettingsSource` to `createCommandResourceSettingsCoordinator(source, options)`. Its asynchronous `read()` returns `{ revision, settings }`. Its `write(expectedRevision, settings)` returns `saved` or `conflict` with that complete state, or `outcome-unknown`. The source is responsible for persistence semantics; this fixture uses no SQLite or IPC. Revisions are canonical decimal strings in SQLite's nonnegative signed-integer range. All eight settings must be positive safe integers.
2. Create one `createCommandResourceSettingsClient(ledger?)` per workspace lifetime. It wraps the supplied existing ledger, or creates one. Retain no separate settings writer for that underlying ledger. Pass the client as `createApplicationComponentHost({ resourceSettingsClient: client })`. Supplying both `ledger` and `resourceSettingsClient` is rejected by TypeScript and at runtime. Omitting the client preserves standalone defaults and explicit ledger injection.
3. Host code calls `client.attach(service)` explicitly. The service supplies `epoch`, `read()` and `subscribe(observer)` only; it has no setter. The coordinator can serve this read/subscription role directly in controlled tests. The client subscribes rather than performing a separate initial read. The coordinator starts an authoritative read for initial subscriptions when it has no snapshot. Delivery is scheduled through microtasks. Admission stays paused until a valid complete snapshot has been applied to the existing ledger and acknowledged.
4. Trusted fixture management code calls `coordinator.write(expectedRevision, completeSettings)`, not the client. The coordinator captures immutable inputs and snapshots. It reconciles admitted completions even if the caller abandons its promise. Older completions cannot regress published state. An identical revision/configuration emits no change; inconsistent equal revisions close the coordinator. A confirmed saved result remains saved even if a newer completion has already been published. Conflicts publish authoritative state without replaying the write. Unknown or rejected write outcomes trigger an authoritative read in the same admission slot, never a write retry. Failed resynchronization closes the association.
5. The client exposes a guarded `ledger`, `status`, `attach`, `disconnect` and `dispose`. There is no settings setter. Its ledger wrapper rejects `updateLimits` as `settings-owned`. Only `ready` admits new calls; disconnected, connecting, stale and disposed clients reject admission as `not-ready`. The dispatcher maps this internal failure to `execution-failed`, not capacity overload. Applying all eight values pauses admission, then acknowledges after successful application. Invalid messages or failed application leave the client stale without acknowledgment. Applied limits are not rolled back if acknowledgment fails.
6. Host code explicitly reattaches after closure or disconnect. Each coordinator has a fresh nonpersistent epoch. Attachment generations ignore old callbacks and queued messages. Lower revisions can be accepted after explicit reattachment, including a restored database lifetime. `disconnect()` closes only the subscription and pauses new admissions. It does not cancel existing work or reset accounting. `dispose()` ends the client permanently. Disposing either the assembly or its `host` disposes the opted-in client after host teardown and adapter/locale cleanup. Rejected reentrant host disposal must not detach it. The fixture owner separately closes the coordinator; assembly disposal does not own that service.

The coordinator bounds admitted source operations and live subscribers. Defaults are **16 operations and 64 subscribers**, adjustable through fixture options. These are fixture bounds, not approved production transport budgets or additional limits on resource-setting values. Each subscriber retains one unacknowledged snapshot and one latest replacement. A single scheduled delivery callback uses a removable set of live subscribers. Unsubscribe removes queued delivery state. Reentrant subscription churn cannot retain a closure per canceled subscription or create an unbounded delivery loop in one scheduler turn. Observer failures are isolated. Client cleanup invalidates its attachment before calling subscription cleanup; reentrant disposal or replacement attachment cannot revive or overwrite an obsolete association.

## Source and validation entry points

- Native data and operations: [`model.rs`](../../src-tauri/src/plugin_registry/model.rs), [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql), [`store.rs`](../../src-tauri/src/plugin_registry/store.rs), [`store_decisions.rs`](../../src-tauri/src/plugin_registry/store_decisions.rs), [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs).
- Migration and recovery: [`schema.rs`](../../src-tauri/src/plugin_registry/schema.rs), [`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs), [`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs).
- Runtime settings and existing tests: [`command-reservations.ts`](../../packages-js/plugins/command-reservations.ts), [`command-reservations.test.ts`](../../packages-js/plugins/command-reservations.test.ts), [`command-dispatcher.test.ts`](../../packages-js/plugins/command-dispatcher.test.ts).
- Stage B coordinator/client and regressions: [`command-resource-settings.ts`](../../packages-js/plugins/command-resource-settings.ts), [`command-resource-settings.test.ts`](../../packages-js/plugins/command-resource-settings.test.ts), [`application-command-resource-settings.svelte.test.ts`](../../src/lib/plugins/application-command-resource-settings.svelte.test.ts).
- Host injection and lifetime: [`command-component-host.ts`](../../packages-js/plugins/command-component-host.ts), [`application-component-host.svelte.ts`](../../src/lib/plugins/application-component-host.svelte.ts), [`application-component-host.svelte.test.ts`](../../src/lib/plugins/application-component-host.svelte.test.ts).

- Stage A regression sources: [`store_command_settings_tests.rs`](../../src-tauri/src/plugin_registry/store_command_settings_tests.rs), [`migrations_stage_a_tests.rs`](../../src-tauri/src/plugin_registry/migrations_stage_a_tests.rs), [`opening_upgrade_tests.rs`](../../src-tauri/src/plugin_registry/opening_upgrade_tests.rs), [`recovery_command_settings_tests.rs`](../../src-tauri/src/plugin_registry/recovery_command_settings_tests.rs), [`schema_tests.rs`](../../src-tauri/src/plugin_registry/schema_tests.rs) and [`worker_tests.rs`](../../src-tauri/src/plugin_registry/worker_tests.rs).

Run focused native checks from `src-tauri`:

```sh
cargo test --locked --lib command_resource
cargo test --locked --lib opening_upgrade_tests
cargo test --locked --lib migrations
cargo test --locked --lib recovery
```

Stage A passed the focused checks above, the full library suite, native check, formatting and all-target Clippy locally on macOS. See the [cumulative changelog](change-log.md#resource-settings-persistence-and-distribution) for verified results. Stage A Windows/Linux execution remains unverified. See [CONTRIBUTING.md](../../CONTRIBUTING.md#native-registry-checks) for broader checks. Stage B has focused coordinator/client, ledger, dispatcher and assembly tests. Run `pnpm --filter @writers-ide/plugins test` and `pnpm --filter @writers-ide/plugins check` for package validation. Run the application settings and existing assembly tests through the root Vitest configuration. The cumulative changelog records verified Stage B results and the unrelated existing application type-check failure. Production multi-window behavior requires real packaged-window tests, not just fake delivery or browser unit tests.
