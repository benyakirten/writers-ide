# Registry implementation review

**Status: owner-approved internal foundation, lifecycle and gated publisher implementation / unmerged.** The internal code includes location ownership, lifecycle control, generation-bound sealing, the 64-byte selector and consuming publication/result handling. Production preflight refuses every platform because qualification is incomplete. Maintenance adapters still have test-only constructors. No application integration or native production publication is enabled.

The registry is an internal Rust service in [`plugin_registry`](../../src-tauri/src/plugin_registry/mod.rs). It stores plugin installation records, project registrations and saved user decisions in SQLite. It does not store manuscripts or execute plugins. Frontend authors do not call its methods. No Tauri command, application startup caller or management UI uses it yet.

## How to read this review

1. Read this page for implemented responsibilities, internal operations and integration limits.
2. Read the [schema baseline](registry-schema-review.md) and authoritative [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql) for the 20-table schema.
3. Use the [foundation guide](registry-foundation.md) for approved policy and the [artifact guide](registry-artifacts.md) for installation transitions.

These are internal contracts, not plugin SDK or management IPC contracts. New behavior or responsibility changes still require owner approval.

## What exists today

The registry implements typed async operations, a bounded dedicated worker, schema initialization and validation, transactional installation and decision operations, SQLite-aware backup and restore staging. Schema version `2` retains 20 tables. Resource-settings Stage A is implemented internally / unmerged. It adds eight typed limits, a separate revision, purpose-specific operations and a real internal `1 → 2` migration. Version 1 is an unshipped internal baseline retained exactly in `schema_v1.sql`. Unknown versions reject. The [approved settings design](resource-settings-plan.md) separates this implementation from planned distribution. Only Stage A implementation is authorized; Stage B design approval does not authorize its implementation.

The [integrity module](../../src-tauri/src/plugin_integrity/mod.rs) implements database-independent entry construction and iteration. Records and verified snapshots share the `writers-ide.file-set/1` binary fingerprint. Integrity-record JSON encoding is unchanged. The manifest parser, snapshot pool and resource route remain separate internal foundations.

## Approved implementation boundary

| Implemented                                                                | Not implemented by this slice                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Integrity entries, binary fingerprints and fixed-vector tests              | Public SDK changes or management IPC                            |
| Typed registry data, validation and semantic transitions                   | ZIP installation or immutable package publication               |
| 20-table SQLite schema and private migration execution helper              | Live tokens, attachment tickets or native authorization         |
| Bounded FIFO worker, readiness and explicit shutdown                       | Application startup, first-run selection or launch forwarding   |
| Transactional permission, enablement and scope-review records              | Actual native directory preparation or project opening          |
| SQLite-aware backup and restore staging                                    | Qualified production publication or recovery UI                 |
| Production-format selector, consuming publisher and Linux/macOS candidates | Platform qualification, production enablement or startup        |
| Location lease, shared lifecycle control and generation-bound sealing      | Production maintenance requests or Windows durability guarantee |
| Authorized `cfg(test)` publication adapter and lifecycle regressions       | Application lifecycle wiring or production publication          |

## Responsibility boundaries

### Preparation outside the database worker

Trusted Rust host code can call `PreparedArtifact::from_verified(snapshot, artifact_store, limits)` before submitting a write. It parses the manifest and derives integrity metadata from the same retained verified bytes. It allocates a random artifact ID and derives the destination beneath the supplied host-owned store. The returned bundle has private fields and owns metadata, not all package payload buffers.

Preparation is synchronous work. The eventual host must schedule it outside the database queue and off latency-sensitive threads. An async caller alone does not offload parsing or hashing.

Acceptance also requires a `PublicationReceipt` matched to the artifact ID, fingerprint and destination. Its constructor is test-only. The real durable publisher does not exist. `InstallationPrerequisites`, `PreparedProject`, `RelinkPrerequisite` and `ArtifactUnused` also have only test constructors. They represent future verified-artifact/import, native-location, closed-project and runtime-use checks. Tests exercise their bindings; they do not establish production enforcement. These values are neither JavaScript inputs nor permission credentials.

### SQLite worker

One OS thread owns the connection. It enables and verifies foreign keys, WAL and `synchronous=FULL`. It processes ordinary reads and writes in successful admission order. SQL and connections stay private.

The host supplies finite `RegistryLimits` and a positive queue capacity. A full queue rejects immediately with `LimitExceeded` before admission. There is no waiting queue for capacity. Production defaults remain open.

Reads return bounded owned snapshots from one transaction. Transactions and cursors end before delivery. Abandoned queued reads are skipped. Running reads finish normally. Admitted writes continue even if their caller drops the future. Success means completion and commit of any changes, not admission.

### Application lifecycle owner

Trusted Rust host code acquires `LocationLease` beside the dedicated root, then calls `Registry::open_owned(lease, path, limits, capacity)` with an already selected existing database. The blocking lease acquisition belongs off latency-sensitive threads. Owned opening validates that the path resolves beneath the existing owned root. It neither selects a generation nor initializes missing storage. The worker retains the lease before the startup await until actual cleanup. No application caller is wired. Unleased `Registry::create` and `Registry::open` are now test-only helpers.

For a recognized version-1 database, trusted Rust code must instead call `Registry::open_owned_with_upgrade(lease, path, backup, limits, capacity)`. The host supplies an explicit non-overwriting backup destination. Ordinary opening validates version 2 and refuses version 1 without that upgrade path. Upgrade opening of an already-current database validates without creating a backup or resetting settings. Neither method is an application startup adapter.

Opening returns a `RegistrySession` after readiness, including required backup and migration validation. The session separates `RegistryOwner` from cloneable `RegistryHandle` operation access. `RegistryOwner::control()` supplies lifecycle snapshots, revision-checked handle acquisition and maintenance admission. Retaining a handle or control does not retain the location lease after thread cleanup.

Creation uses non-overwriting file creation and refuses existing destinations, including zero-byte files. Opening never initializes missing storage. Readiness checks schema objects/version, full SQLite integrity, foreign keys, required rows/catalogs, resource bounds and domain relationships. These checks do not verify installation files or select an active generation.

The store canonicalizes its destination and holds a standard-library `File::try_lock` lock on a persistent `.registry-lock` sidecar. The lock is separate from the database because file locking can overlap SQLite byte-range locks on some platforms. The sidecar is not deleted on release. Ownership lasts through worker cleanup. This prevents competing service owners for the canonical destination; it is not application single-instance detection or second-launch forwarding. Those still need integration and cross-platform tests.

`RegistryOwner::shutdown(self).await` closes admission, rejects queued standalone reads, finishes current work and drains admitted writes in order. It awaits cleanup and joins without blocking the async executor thread. Dropping the owner only signals draining without blocking. Retained handles cannot submit after closure. Explicit awaited shutdown is required to know cleanup finished before process exit.

### Approved production ownership boundary

**Approved and implemented as an internal core:** one lifecycle coordinator retains the location lock across owned opening, normal operation, maintenance transitions and fresh opening. Maintenance requests can currently be constructed only by test fixtures; production restore/publication request adapters are not implemented. It acquires the lock beside the dedicated registry root before checking whether that root exists. The worker receives shared retention before startup waits. Startup cancellation or dropping the coordinator must not release the lock while worker cleanup or admitted writes continue.

SQLite work stays on the database thread. Maintenance closes admission and drains admitted writes before preparing and sealing a replacement. Checked sealing preserves the connection if preparation, checkpointing or explicit close fails. A maintenance failure stops that attempt. It does not automatically resume service, retry publication or select another generation.

**Approved execution owner:** extend the dedicated registry thread to run lifecycle transitions as well as ordinary database operations. The thread owns SQLite and performs preparation, sealing and cleanup. A small shared control object handles admission and exposes owned lifecycle snapshots. Caller futures wait for results; they do not own the admitted work. A failed connection stays on this thread in recovery-only mode. No separate asynchronous supervisor or second coordinator thread is selected. A fresh service after maintenance means a new validated store and operation-admission channel; it does not require a replacement OS thread.

**Approved sealed-generation handoff:** successful checked sealing returns an opaque private Rust value bound to the prepared physical generation and its retained ownership. The gated publisher consumes this value instead of accepting an arbitrary database path. Normal preparation APIs cannot reopen or modify the sealed generation through this value. Sealing success requires validation, a checked WAL checkpoint, explicit checked SQLite close and synchronization of the closed database file. Directory barriers and selector publication still require separate checks. The value enforces internal ordering; it is not authentication or protection against external file modification. Failure still preserves any returned connection under the recovery-only coordinator. This handoff does not enable Windows publication or select a production selector format.

**Approved maintenance admission:** admit only one maintenance attempt at a time. While an attempt is running, reject a competing maintenance request immediately with `Conflict`, without changing storage for that request. There is no maintenance waiting queue. A caller can inspect current state and explicitly submit a new request later. This does not change the bounded queue for ordinary registry operations or define which recovery actions are valid after a failure.

**Approved stale-request check:** when trusted application code reads coordinator state, it receives an opaque lifecycle revision. A maintenance request must include the revision the caller reviewed. The coordinator checks it at admission. A stale revision returns `Conflict` without admitting the attempt or changing storage. The revision changes when an attempt is admitted and when its outcome is established, even if the selected generation stays the same. This detects intervening failed attempts as well as successful replacement. The revision tracks lifecycle changes, not every ordinary database write. Bind it to the coordinator lifetime as well as its transition sequence, so a revision from another coordinator or a previous lifetime cannot match a new instance accidentally. It grants no authority. Concrete Rust naming and encoding remain implementation details; the management wire API is not defined here.

**Approved maintenance caller lifetime:** an explicitly requested maintenance attempt continues once admitted, even if the caller drops its waiting future or closes the management window. Before admission, there is no accepted attempt to complete. After admission, the coordinator retains ownership until the single attempt finishes. Success leaves a fresh ready registry; failure leaves recovery-only mode. A later caller must be able to inspect authoritative lifecycle state rather than infer the outcome from a lost response. This does not add automatic retries or an explicit cancellation API. It does not authorize publication on an unsupported platform.

**Approved operation-handle lifetime:** handles for the stopped worker remain permanently closed. Calls through them return `Unavailable`; they never reconnect to a replacement worker. After successful maintenance, the coordinator supplies new handles only after the fresh worker passes readiness checks. Application services must explicitly obtain replacement handles. Calls are not queued across maintenance, and failed operations are not replayed. This does not change the draining of writes admitted before the old worker closed admission.

**Approved maintenance-failure state:** keep the coordinator alive in recovery-only mode. It retains the location lock and ownership of any returned SQLite connection while the application offers plugin-free recovery. Ordinary registry handles remain unavailable. Recovery or shutdown requires an explicit action; the failure does not release ownership to another process while the user decides. SQLite work remains on its owning database thread. This defines the recovery state, not a recovery UI or command API.

Explicit awaited shutdown confirms cleanup. Dropping an owner initiates cleanup but does not certify completion. The coordinator and any outstanding cleanup must retain location ownership until their work actually finishes. Ordinary operation handles do not control this lifetime.

The owner approved implementing this bounded responsibility and Rust contract. The core uses the existing dedicated thread, not the test-only cleanup thread. Production maintenance request fields and application startup wiring remain separately gated. The approved selector format and publisher contracts are implemented behind the qualification gate. Windows publication remains blocked pending required research.

### Consolidated Rust contract

**Owner-approved bounded core, implemented / unmerged.** These are internal Rust contracts, not plugin APIs or Tauri commands. Trusted application Rust code supplies inputs and receives owned results. No application entry point calls this lifecycle yet. `MaintenanceRequest` has only a test fixture constructor. The compiled control state machine is exercised through those fixtures, not through a production restore or publication API.

| Internal contract        | Responsibility                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RegistryOwner`          | One lifecycle owner. Starts shutdown on drop and provides explicit awaited shutdown. The dedicated thread retains resources until its work and cleanup actually finish.                                                                                                                                                                                                     |
| Shared lifecycle control | Holds only admission/control state and bounded owned snapshots. It does not expose a connection or perform SQL under its mutex. Maintenance admission and closing the old operation channel use the same synchronized decision.                                                                                                                                             |
| `LifecycleSnapshot`      | An owned state report with an opaque revision. Reports opening, ready, maintenance, recovery-only or shutdown state. Recovery reports distinguish preparation failure, uncertain publication and failed readiness after confirmed publication. It contains no live connection or transaction.                                                                               |
| `LifecycleRevision`      | An opaque expected-state value. Its check and maintenance admission happen together. An accepted attempt changes the revision immediately; its established outcome changes it again.                                                                                                                                                                                        |
| Ready-handle acquisition | Returns a handle only for the ready service matching the caller's expected lifecycle revision. Otherwise returns `Conflict` for a stale revision or `Unavailable` when no ready service exists. This avoids returning a replacement handle based on an obsolete snapshot.                                                                                                   |
| Maintenance call         | Takes an expected revision and a typed host-owned request. Its async result reports completion, not admission. Once admitted, the thread owns the request independently of the waiting future. A competing attempt or stale revision returns `Conflict` without storage changes. Exact request fields remain tied to the separately reviewed restore/publication contracts. |
| Prepared generation      | Owns the physical generation association and preparation connection on the registry thread. It is not an arbitrary caller-supplied path paired with an unrelated connection.                                                                                                                                                                                                |
| Sealed generation        | A private, non-cloneable value produced only by successful checked sealing. It retains generation ownership and has no mutation/reopening API. The gated publisher consumes it.                                                                                                                                                                                             |
| Seal failure             | Retains the generation association, diagnostic error and any connection returned before or during checked close. A post-close failure has no connection to return. These resources stay on the registry thread in recovery-only mode; callers receive owned diagnostics.                                                                                                    |

The thread remains alive while recovery-only mode awaits an explicit action. Its control path must still accept state inspection and shutdown when ordinary operation admission is closed. Ordinary registry work retains its existing bounded FIFO queue. There is no maintenance waiting queue and no unbounded queue of lifecycle requests.

Implemented regression coverage includes simultaneous maintenance admission, stale revisions after failed attempts, foreign/prior-coordinator revision rejection, caller abandonment after admission, old-handle rejection, fresh-handle acquisition racing maintenance, and location-lock retention through startup cancellation, recovery-only mode and cleanup. Sealing tests verify generation binding, connection retention before/at close and absence of a connection after checked close. Lifecycle fixture outcomes distinguish unknown publication from failed readiness after confirmed publication; the existing publication probe retains its native fault coverage.

#### Review outcome and approved shutdown rule

The dedicated worker now arbitrates maintenance completion against lifecycle shutdown. `PreparedGeneration::create` creates a new generation directory and database together under the location lease. Consuming `seal()` binds the resulting value or failure to that same generation. The probe's separate connection/path signature remains test-only and shares checked sealing mechanics with this core. Restore staging remains a separate helper, not a production maintenance request.

**Approved shutdown interaction; implemented in the core:** shutdown or owner drop sets a persistent control flag, including when maintenance is already admitted. Setting it immediately prevents further maintenance admission and ready-handle acquisition. An already admitted attempt still finishes its one planned attempt and records its outcome. It then proceeds directly to cleanup without exposing a ready service or waiting for an interactive recovery action. This does not cancel publication, retry it or change its success criteria. The thread retains the location lock through cleanup. Dropping the shutdown waiter does not reverse the flag or interrupt cleanup. Tests cover shutdown and owner drop before and during maintenance completion, plus abandonment of the shutdown waiter.

This resolves the shutdown policy identified by the source and race review. The normal maintenance-success and recovery-only outcomes apply when shutdown has not been requested. Once shutdown is requested, recording the maintenance outcome does not reopen ordinary admission or wait for interactive recovery. Coordinator-lifetime revision binding and the distinction between a stopped service and a live lifecycle thread are implementation clarifications of the approved policies, not new permission or publication rules.

This bounded implementation now includes the internal production-format selector and consuming publisher behind an always-refusing qualification gate. It adds no enabled native production publication, recovery-command API, application startup wiring or external loading. Windows publication research remains required. The existing test-only publisher can supply lifecycle fault evidence without becoming the production publisher. A pre-opened gated worker is not part of this core.

## Internal Rust contract shape

The signatures below describe calls by trusted Rust host code. Paths, limits and capacity come from that host, not plugins. The methods are async. Tests currently supply their callers.

```text
LocationLease::acquire(root: &Path) -> Result<LocationLease> // blocking; no root creation
Registry::open_owned(lease: LocationLease, path: PathBuf, limits: RegistryLimits, capacity: usize)
    -> Result<RegistrySession> // async; existing selected database only
Registry::open_owned_with_upgrade(lease: LocationLease, path: PathBuf, backup: PathBuf,
    limits: RegistryLimits, capacity: usize) -> Result<RegistrySession> // async; explicit backup
RegistryOwner::control(&self) -> RegistryControl
RegistryControl::snapshot(&self) -> LifecycleSnapshot
RegistryControl::ready_handle(&self, expected: &LifecycleRevision) -> Result<RegistryHandle>
RegistryControl::maintain(&self, expected: LifecycleRevision, request: MaintenanceRequest)
    -> Result<()> // async; request constructors are test-only
RegistryOwner::shutdown(self) -> Result<()> // async; waits for actual cleanup
```

See [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs) for exact operation signatures and [`model.rs`](../../src-tauri/src/plugin_registry/model.rs) for records.

| `RegistryHandle` method          | Input and atomic result                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_command_resource_settings` | Returns `CommandResourceSettingsSnapshot` with all eight limits and their revision in one read transaction.                                        |
| `set_command_resource_settings`  | Takes `CommandResourceRevision` and `CommandResourceSettings`; commits all eight limits and revision together after expected-revision validation.  |
| `read_settings`                  | Returns the two typed permission/repair host settings in one read transaction.                                                                     |
| `package_details`                | Takes `PackageId`; returns installation, artifacts, declarations and decisions in one bounded snapshot.                                            |
| `project_details`                | Takes `ProjectId`; returns saved name, location, revision, logical public identity, decisions and overrides.                                       |
| `accept_artifact`                | Takes `PreparedArtifact` and matching receipt; inserts history and complete immutable metadata together.                                           |
| `change_installation`            | Takes expected state, semantic action, optional target and prerequisites; commits acceptance if supplied, pointers, revision and cleanup together. |
| `register_project`               | Takes a complete `PreparedProject`; commits all location/name fields and initial revision together.                                                |
| `relink_project`                 | Takes key, expected revision, prepared location and closed-project prerequisite; replaces location and increments revision together.               |
| `refresh_project_name`           | Takes key, expected location revision and prepared current location; refreshes the label only for the matching location.                           |
| `save_permission_review`         | Takes a bounded review with expected installation, settings and decisions; saves all effects and deliberate candidate consumption together.        |
| `acknowledge_scope`              | Takes exact target release and baseline/revision; saves pending review or applies the selected baseline atomically.                                |
| `set_enablement`                 | Takes declaration, expected installation/choice and new choice; `None` removes a project override for Inherit.                                     |
| `set_host_settings`              | Takes expected/current and replacement typed settings; commits coherent mode/policy changes.                                                       |
| `remove_unused_artifact`         | Requires matching runtime-use prerequisite and no installation reference; explicitly deletes owned children and artifact, not files/history.       |
| `backup`                         | Takes a new destination path; completes SQLite-aware copying and file synchronization after admission.                                             |

`ArtifactTarget::Prepared` combines preparation and receipt for acceptance within an installation transaction. Two separate public method calls do not form one atomic operation.

### Command resource settings

[`model.rs`](../../src-tauri/src/plugin_registry/model.rs) defines `CommandResourceSettings`, `CommandResourceRevision` and `CommandResourceSettingsSnapshot`. The limits are positive JavaScript-safe integers. The revision starts at zero and serializes/deserializes as a canonical nonnegative decimal string, not a JavaScript number. It remains separate from installation and lifecycle revisions and the two-field permission `HostSettings`.

[`store_command_settings.rs`](../../src-tauri/src/plugin_registry/store_command_settings.rs) reads scalar integers through borrowed `ValueRef` values without allocating malformed persisted strings or blobs. Missing or invalid persisted values return `RecoveryRequired`. A stale revision returns `Conflict`, even if the proposed limits match. A current identical write returns the snapshot without advancing the revision. This no-op remains valid at the signed-integer maximum; a changed write there returns `LimitExceeded`. Resource-only updates do not change permission mode, clean up automatic approvals or invalidate permission reviews.

The operations use the existing bounded FIFO worker and service-bound `RegistryHandle`. Admitted writes survive caller abandonment. Mutation uncertainty returns `OutcomeUnknown` and poisons the store; controlled reopening/recovery is required before further ordinary use. Stage A implements no settings coordinator, delivery epoch, window distribution or UI.

### Semantic installation actions

[`transitions.rs`](../../src-tauri/src/plugin_registry/transitions.rs) calculates install, update, repair, previous-version restoration, cancellation, uninstall and promotion. Callers request actions, not arbitrary pointer replacements. The store checks the reviewed monotonic installation revision and state, then commits pointers, revision advancement and required decision/scope cleanup together. The revision survives uninstall and detects changes away and back.

Scope blockers are derived from the selected declaration and retained reviewed baseline. No baseline means initial review; a different scope means change review. A matching scope removes only this blocker. Staged acknowledgements bind to release and baseline revision. Selection applies matching review atomically. Native permission coverage remains separate. Uninstall retains history, denials, saved choices and scope baselines, but removes approvals and pending scope acknowledgements.

Unsupported component profiles block those components and required dependents, not selection of an otherwise valid package or compatible siblings. Package-fatal verification failures retain the no-fallback rule. Actual filesystem preflight and process-wide import tracking remain future prerequisites, not registry services.

### Integrity entries

`IntegrityRecord::from_entries<E>(version, entries, limits)` consumes `IntoIterator<Item = Result<IntegrityEntry, E>>`. Each entry owns a path, `u64` byte length and `[u8; 32]` digest. Validation stops on the first source or record error. `IntegrityBuildError<E>` preserves `Source(E)` separately from `InvalidRecord(IntegrityError)`.

`entries()` returns an exact-size iterator of owned metadata copies. Changing an entry cannot mutate the record. `format_version()` and `fingerprint()` provide validated metadata. `VerifiedPackage::integrity_record(limits)` derives a record from retained verified buffers rather than reopening source files. SQL reconstruction uses these APIs without a JSON round trip. The integrity module remains independent of SQLite and `RegistryError`.

### Completion and errors

The service uses the [nine domain categories](registry-foundation.md#approved-registry-error-categories). Missing requested records are `NotFound`; broken required relationships require recovery handling. A mutation reports `Storage` only when it is known not to have committed. Uncertain commit/rollback or a lost admitted-write completion is `OutcomeUnknown`; refresh authoritative state rather than blindly retrying.

Unexpected worker termination closes admission and makes existing handles unavailable. It does not automatically replace the worker or replay writes. Controlled reopen/recovery remains the host's responsibility.

## Backup, migrations and restore preparation

[`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs) uses SQLite backup steps of 128 pages. `Busy` and `Locked` fail immediately rather than retrying indefinitely. Destinations are claimed without overwriting; failed staging files remain as evidence. Backup reads a consistent source transaction, validates the copied schema, closes the target and synchronizes the file. It does not prove generation-directory durability.

[`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs) is private infrastructure for reviewed static SQL chains, not caller-supplied SQL. It validates the source and bounded consecutive steps, completes a backup before mutation, applies steps/version changes in one transaction and validates the target before commit. The registered private chain uses compiled [`migration_v1_to_v2.sql`](../../src-tauri/src/plugin_registry/migration_v1_to_v2.sql) to rebuild the settings table to the exact version-2 definition. Version-aware validation preserves namespace, allocation high-water marks, permissions and unrelated rows. Real-upgrade regressions accompany synthetic failure-chain tests. `Store::open_with_upgrade(path, backup, limits)` is the store entry point used by owned upgrade opening. Local validation is recorded in the cumulative changelog; Stage A Windows/Linux validation remains outstanding. No automatic backup destination, retention or cleanup policy is introduced.

The synchronous private `prepare_restore` helper is exercised directly by native tests. A future closed-registry coordinator must schedule it off latency-sensitive threads and retain exclusive maintenance ownership. It prepares a new database, not a live replacement. It holds consistent source/current read snapshots, performs bounded full validation of the backup and prepared result, and validates current history/allocation evidence separately. It merges history by canonical package/version, rejects known fingerprint conflicts, and preserves validated allocation high-water marks. It never merges current approvals or installation selection into the backup. The source is read-only and may use recognized schema 1 or 2. The owned destination is upgraded and target-validated before history merge and permission quarantine. Version-2 limits and resource revision survive restoration; version 1 receives the approved defaults and revision zero. Source/current databases remain untouched. Secure-mode permission sanitization is independent of the resource configuration.

Ordinary restoration requires matching namespaces. Explicitly acknowledged missing/unreadable history or unrecoverable allocation evidence requires a fresh namespace as specified by the recovery policy. The helper preserves safely decoded history pins even when other history or metadata is damaged. Missing or malformed evidence needs explicit loss acknowledgement; it never manufactures a missing fingerprint. A loss acknowledgement cannot bypass a known validated conflict, readable unsupported schema, known incompatible namespace or host resource limit. Deleted history with no surviving evidence cannot be detected or reconstructed. Restore forces Secure mode and moves approvals into inactive recovered candidates, merging source flags without granting coverage. Source/current databases stay unchanged.

## Gated publisher entry points

These synchronous internal Rust calls belong on the registry thread. They are not plugin APIs or Tauri commands. Tests currently supply the only callers that can reach native selection. No production restore request constructor or application startup path uses them.

- `InitialRoot::claim(&lease)` performs qualification preflight before exclusive root creation. It currently returns `Unavailable` without root access. A separate test-only claim helper exercises exclusive creation and issues a one-use first-publication proof.
- `PreparedGeneration::create(&lease, limits)` requires an existing owned root, allocates a random ID and creates its lowercase-hex directory and database together. Arbitrary named construction remains test-only. Sealing retains the ID/path association.
- `publisher::publish(sealed, mode)` consumes the seal. The mode is either the first-root proof or an expected current generation for replacement. Production preflight currently refuses. The private orchestration is exercised through test-only native and fault adapters. A successful candidate returns `PublishedGeneration`, not an operation handle.
- `PublishedGeneration::open(limits)` consumes confirmed publication and checks selection, no-follow generation/database entries and store readiness. It retains the location lease while releasing the per-database seal lock for the store opener. It returns an owned `ReadyGeneration` or a retained `ReopenFailure` without switching back.
- `ReadyGeneration::into_store(&owner_lease)` requires the same retained location owner before handing a ready store to the lifecycle thread. A mismatched owner returns the still-owned value. The thread retains its own lease until the store is destroyed.

`PublicationFailure` retains the consumed seal, diagnostic error and preselection/attempted stage. Attempted-selection failures report `OutcomeUnknown` while retaining the original cause separately. Unchanged sources observed in specific refused Windows fixture cases do not establish a general every-error guarantee. `ReopenFailure` retains generation ownership, diagnostics and any remaining seal lock; it does not pretend to retain a connection after successful close. Lifecycle recovery holds seal, publication or reopening failure values locally on the SQLite thread, not in shared state or caller futures.

## Publication harness and production safety requirements

Native production publication remains disabled. The runtime-compiled codec, consuming publisher and Linux/macOS native candidates are implemented behind qualification preflight. The owner-authorized [`publication_probe`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs) module is compiled only for tests. `cargo test --lib` calls it with isolated temporary directories and explicit limits. There is no application entry point, public API or authority credential. It prepares fixture databases, checks sealing, exercises selector publication and opens actual registry workers. It does not install package artifacts or construct production artifact-publication receipts.

For production, stop the normal service and retain exclusive coordinator ownership. Prepare and validate a separate generation. Complete the supported platform's file, SQLite-sidecar and directory durability steps before replacing active-generation metadata. The publisher synchronizes the generation directory, registry root and stable parent before selection. It flushes and closes the prepared selector's source handle before path-based selection, then synchronizes the root again afterward. Reopen only the selected generation through readiness validation.

Missing/invalid metadata requires plugin-free recovery. Do not guess a generation by name, timestamp or validity. An uncertain selector replacement must preserve both generations and report `OutcomeUnknown`, not automatically retry or switch back. Old generations remain until deliberate maintenance.

The [publication investigation](registry-publication-investigation.md) distinguishes earlier disposable Python/APFS observations from the compiled harness. The harness checks WAL/FULL, foreign keys, bounded readiness, TRUNCATE counters and explicit close before flushing the closed file. Preparation/close failures return the connection. Its private 61-byte checksummed selector fixture is not a production format or authentication mechanism. The separate 64-byte production encoding is implemented in `selector.rs`. Platform success criteria and evidence requirements are approved; qualification remains incomplete.

Native first creation uses Linux `renameat2(RENAME_NOREPLACE)` or macOS `renamex_np(RENAME_EXCL)`. Windows raw-move tests use `MoveFileExW` with write-through, without copy or fallback. Windows directory synchronization explicitly returns `Unsupported`, so integrated publication stops before selector creation and returns no session. Native Registry CI passed formatting, the complete library suites and all-target Clippy on macOS, Windows and Ubuntu after the documentation-test line-ending correction. See the [validation record](change-log.md#native-registry-design). Runtime/barrier and process-exit tests do not prove power-loss durability.

The test adapter acquires a stable location lease before first-run detection, seals the replacement, exercises the platform adapter and then opens the selected registry. `cfg(test)` worker hooks retain its `Arc<File>` before the startup await through actual worker cleanup, including abandoned startup and owner-drop draining. The leased-session cleanup thread is a prototype only. The internal `open_owned` helper now retains a separate production-compiled location lease; application startup is not wired to it. A failed fresh open after confirmed publication requires recovery without switching back. A pre-opened gated worker is optional, not an approved lifecycle change. Source/current logical data remains unchanged during preparation, but SQLite opens can still create or rebuild sidecars.

The owner approved advancing shared production ownership and checked sealing while keeping Windows generation publication blocked temporarily. [Windows publication research](registry-publication-investigation.md#approved-next-direction-and-required-windows-research) remains a required completion gate, not permanent exclusion or optional backlog. No weaker Windows guarantee is approved. The [single-coordinator ownership boundary](#approved-production-ownership-boundary) is approved. The shared core is implemented under its reviewed Rust contract. Production maintenance requests and startup wiring remain gated; the publisher prototype remains test-only. The [approved publisher contract](registry-publication-investigation.md#approved-production-publisher-contract) specifies exact record/layout, consuming ownership, exclusive first publication, replacement preconditions and failure boundaries. It permits format/ownership implementation and tests, not production native publication enablement. The [platform/storage policy](registry-publication-investigation.md#approved-platform-and-storage-contract) completes the second design checkpoint. It authorizes codec, ownership/result and Linux/macOS candidate-adapter implementation and tests behind the publication gate. Its qualification gates still require a platform argument, production-code coverage, supported-version checks and cache-aware crash/storage testing. No platform is declared qualified; Windows publication remains blocked. `production_preflight` unconditionally returns `Unavailable` without inspecting or creating the root. `InitialRoot::claim` and `publish` cannot bypass it in runtime code. Only `cfg(test)` helpers exercise the candidates.

## Remaining integration decisions

Native path encoding, directory-identity schemes and alias matching need supported platform formats. `PublicProjectId` internally pairs namespace and registration key; its author-facing string encoding and native host mapping remain open. No real native location proof can be constructed yet.

Typed command resource persistence and the recognized schema migration are implemented internally in Stage A. Permission mode and repair policy retain their separate two-field contract. Command/runtime integration still requires saved-settings loading into the dispatcher, change distribution and its settings menu. Lifecycle/management integration must add the blocked-activation preference, activation wiring and management toggle. These are completion gates for their slices and Part 4, not optional backlog items.

No project-forgetting workflow, configuration reset, automatic generation cleanup, cross-registry import, audit log, interactive history-conflict recovery or activation-health rollback is added. Production numerical defaults remain deferred.

## Final sign-off proposal

**Approved by the owner and implemented for the internal slice only.** The scope includes the integrity API and binary fingerprint, assembled 20-table schema, typed transactions, bounded worker/lifecycle, backup, private migration infrastructure and restore-data preparation. It excludes real publication, generation switching, application startup/recovery integration, management IPC/UI, live authority, project-file services, indexing, external loading and Basic Menu packaging.

## Source, tests and validation

- [`schema.rs`](../../src-tauri/src/plugin_registry/schema.rs), [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql) and [`schema_tests.rs`](../../src-tauri/src/plugin_registry/schema_tests.rs): creation, required objects, constraints and unsafe-state rejection.
- [`store.rs`](../../src-tauri/src/plugin_registry/store.rs), [`store_decisions.rs`](../../src-tauri/src/plugin_registry/store_decisions.rs), [`store_validation.rs`](../../src-tauri/src/plugin_registry/store_validation.rs) and [`store_tests.rs`](../../src-tauri/src/plugin_registry/store_tests.rs): transactions, bounds, revisions, decisions, retention and rollback.
- [`preparation.rs`](../../src-tauri/src/plugin_registry/preparation.rs), [`model.rs`](../../src-tauri/src/plugin_registry/model.rs), [`transitions.rs`](../../src-tauri/src/plugin_registry/transitions.rs) and [`error.rs`](../../src-tauri/src/plugin_registry/error.rs): private preparation contracts, typed records, policy calculations and errors.
- [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs), [`lifecycle.rs`](../../src-tauri/src/plugin_registry/lifecycle.rs), [`lifecycle_tests.rs`](../../src-tauri/src/plugin_registry/lifecycle_tests.rs) and [`worker_tests.rs`](../../src-tauri/src/plugin_registry/worker_tests.rs): readiness, bounded admission, lifecycle snapshots/revisions, handle replacement, recovery retention, abandonment and sticky shutdown.
- [`location.rs`](../../src-tauri/src/plugin_registry/location.rs), [`generation.rs`](../../src-tauri/src/plugin_registry/generation.rs) and [`generation_tests.rs`](../../src-tauri/src/plugin_registry/generation_tests.rs): stable location ownership, generation-bound creation/sealing, checked close, failure ownership and closed-file synchronization.
- [`selector.rs`](../../src-tauri/src/plugin_registry/selector.rs) and [`selector_tests.rs`](../../src-tauri/src/plugin_registry/selector_tests.rs): exact format vectors, bounded capability-relative no-follow reads, generation validation and malformed metadata rejection.
- [`publisher.rs`](../../src-tauri/src/plugin_registry/publisher.rs), [`publisher_tests.rs`](../../src-tauri/src/plugin_registry/publisher_tests.rs) and [`publication_lifecycle_tests.rs`](../../src-tauri/src/plugin_registry/publication_lifecycle_tests.rs): consuming publication/failure ownership, readiness handoff, all-phase faults, original error causes and same-thread lifecycle integration. The Rust module path is `plugin_registry::generation::publisher`.
- [`publication_platform.rs`](../../src-tauri/src/plugin_registry/publication_platform.rs) and [`publication_platform_tests.rs`](../../src-tauri/src/plugin_registry/publication_platform_tests.rs): always-refusing production preflight and unqualified Linux/macOS candidates. Windows/other native candidate helpers return `Unsupported`; the old Windows raw move experiment stays separate.
- [`publication_crash_tests.rs`](../../src-tauri/src/plugin_registry/publication_crash_tests.rs): test-only cache-aware storage model driven by the actual publisher sequence, reconstructed selector/database readiness and missing-barrier negative controls. It does not qualify a native filesystem.
- [`qualification_evidence.rs`](../../src-tauri/src/plugin_registry/qualification_evidence.rs): test-only, sanitized environment observations. CI uploads current-run JSON, not a qualification token. See [model assumptions and artifact limits](registry-publication-investigation.md#cache-aware-model-and-environment-observations).
- [`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs), [`recovery_tests.rs`](../../src-tauri/src/plugin_registry/recovery_tests.rs), [`recovery_command_settings_tests.rs`](../../src-tauri/src/plugin_registry/recovery_command_settings_tests.rs), [`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs), [`migrations_stage_a_tests.rs`](../../src-tauri/src/plugin_registry/migrations_stage_a_tests.rs) and [`migration_v1_to_v2.sql`](../../src-tauri/src/plugin_registry/migration_v1_to_v2.sql): real-file/WAL backup, version-aware restore, real internal upgrade and synthetic failure-chain tests.
- [`store_command_settings.rs`](../../src-tauri/src/plugin_registry/store_command_settings.rs), [`store_command_settings_tests.rs`](../../src-tauri/src/plugin_registry/store_command_settings_tests.rs) and [`opening_upgrade_tests.rs`](../../src-tauri/src/plugin_registry/opening_upgrade_tests.rs): typed atomic resource operations, numeric/revision boundaries, permission independence and explicit upgrade readiness.
- [`plugin_integrity/tests.rs`](../../src-tauri/src/plugin_integrity/tests.rs): binary vectors, entry validation, source errors and existing integrity regressions.
- [`publication_probe/mod.rs`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs), [`sealing.rs`](../../src-tauri/src/plugin_registry/publication_probe/sealing.rs), [`platform.rs`](../../src-tauri/src/plugin_registry/publication_probe/platform.rs), [`tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/tests.rs) and [`process_tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/process_tests.rs): test-only lifecycle, native candidates, sealing, all-phase faults, partial writes, post-publication readiness rejection, process exits and cross-process locks. Child tests use timeouts and kill/reap guards. The two additional lease lifetime regressions are in `worker_tests.rs`.

Run from `src-tauri`:

```sh
cargo test --locked --lib command_resource
cargo test --locked --lib opening_upgrade_tests
cargo test --locked --lib migrations
cargo test --locked --lib recovery
cargo test --locked --lib plugin_registry::selector
cargo test --locked --lib plugin_registry::publication_platform
cargo test --locked --lib plugin_registry::generation::publisher
cargo test --locked --lib plugin_registry::generation::publisher::crash_tests
cargo test --locked --lib plugin_registry::qualification_evidence
cargo test --locked --lib plugin_registry::worker::lifecycle::publication_tests
cargo test --lib plugin_registry::publication_probe
cargo test --lib plugin_registry::worker::tests::probe_
cargo test --lib plugin_registry::worker::lifecycle
cargo test --lib plugin_registry::generation
cargo test --lib plugin_registry
cargo test --lib plugin_integrity
cargo test --lib
cargo check --lib
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

The [native storage lab guide](../../tooling/registry-lab/README.md) covers the opt-in Linux controller, unprivileged build/workload, calibration and replay. `cargo test --locked --lib storage_lab` exercises temporary-directory Rust fixtures, not the ignored native entry. From the repository root, `python3 -B -m unittest discover -s tooling/registry-lab -v` runs non-destructive safety/protocol tests with Python 3.11+. The Python 3.12 safety step passed on Ubuntu CI, alongside passing Rust formatting, library tests and Clippy on all three platforms for the harness revision. Actual scratch-device execution is not a CI step. One separately approved UTM attempt returned normally, with successful receipt-checked cleanup. The exported evidence has been reviewed: 120 marked publication/baseline images and two calibration reconstructions were cross-checked against logs and trace. Both normal acknowledgment cases retained the new generation. Selector-file and final-root omissions were detected; generation-directory and stable-parent omissions were masked. See the [native replay findings](registry-publication-investigation.md#reviewed-native-replay-evidence). These results do not establish host-cache behavior or complete durability qualification. Neither suite qualifies a storage stack.

The approved [Windows conformance fixture](windows-registry-conformance-proposal.md) adds an ignored, test-only 20-case Win32 matrix and portable control/schema/cleanup tests. It requires ordinary-user token/NTFS preflight and a matching executable-bound record from its build-only PowerShell helper. It does not call the runtime publisher. Run `cargo test --locked --lib windows_conformance` from `src-tauri` for focused checks; this does not run ignored native entries. A reviewed owner-pasted report records completed Windows ARM64/fixed-NTFS preflight, all 20 cases and confirmed cleanup. Its build record matches the supplied fresh-helper hash and dirty-source/compiler observations, but attribution remains cooperative; neither the JSON nor binary was independently authenticated. See the [observed API results and limits](registry-publication-investigation.md#decision-gate-and-bounded-follow-up). Directory-flush success is an observed case, not storage qualification.

Microsoft's [MS-FSA §2.1.5.7](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/0de7dc40-9627-437e-a4df-c4696cdc3d02) describes flushing persistent attributes to stable storage, `DirectoryStream` metadata, directory-structure persistence and a final physical-storage flush. [Product note 80](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4e3695bd-7574-4f24-a223-b4679c065b63) says only NTFS implements that statement; other filesystems return success without action for that statement. This is not a claim that every non-NTFS flush is a no-op. MS-FSA section 2 specifies an abstract store supporting CIFS/SMB. It is not by itself a local Win32 guarantee. IFS `IRP_MJ_FLUSH_BUFFERS` links `FlushFileBuffers` to associated metadata flushing and driver completion to cache flushing. The abstract-store specification and IFS metadata-flush contracts do not yet establish the full local Win32 dependency argument. See the [post-conformance assessment](registry-publication-investigation.md#post-conformance-contract-assessment), [dependency assessment](registry-publication-investigation.md#windows-dependency-assessment) and [retained future-review questions](registry-publication-investigation.md#windows-contract-clarification-request). Immediate child bindings, supporting metadata, new-parent persistence and rename recovery remain unresolved. The owner deferred that investigation while independent plugin work continues. External clarification is optional, not an immediate prerequisite; production qualification and completion gates remain unchanged.

The fixture's handle-held rename comparison is not a drop-in implementation for this source-closed publisher. Rust 1.100's reviewed compiler source maps `File::sync_all` through `File::fsync` to `FlushFileBuffers`. Its `std::fs::rename` includes `MoveFileEx` and `FileRenameInfoEx`/POSIX fallback paths; it is not a safe substitute for the approved no-retry single native selection call. Legacy rename contracts restrict open targets, and `FILE_SHARE_DELETE` supplies sharing rather than POSIX replacement. Extended POSIX flags were not tested or adopted. API availability minima such as XP/Vista do not establish qualification or an approved Windows baseline. The observed ARM64 build does not establish x64 or minimum-version support. No Windows protocol is approved. The separately reported 38 focused tests and one token-only success do not confirm latest Windows full-suite, check or Clippy results. Preserve both the original refusal and subsequent completed report. No retry or explicit cleanup is needed. Production preflight remains `Unavailable`; Windows production candidates remain `Unsupported`.

The [cumulative changelog](change-log.md#native-registry-design) separates earlier foundation/probe evidence from current shared-core validation. Focused subsets do not replace the full library suite, library check, formatting and all-target Clippy.

The [Native Registry workflow](../../.github/workflows/native_registry.yml) is configured for stable Rust on macOS 15, Windows latest and Ubuntu 24.04. It runs formatting, the full locked library suite and locked all-target Clippy. Earlier CI passed all three checks on macOS 15, Windows latest and Ubuntu 24.04 after the LF/CRLF documentation-test correction. The shared lifecycle/sealing implementation subsequently passed all three checks on all three platforms. The gated selector/publisher implementation subsequently passed all three checks on all three platforms after the Windows import-guard correction. The cache-aware campaign, environment collector and artifact upload subsequently passed all three platforms after the Windows empty-lock-file fixture correction. The [inspected storage reports](registry-publication-investigation.md#inspected-ci-storage-observations) record APFS, ext4 and NTFS observations. Linux reports `data=writeback,nobarrier` with unknown cache protection; Windows same-filesystem comparison is unavailable. These are evidence gaps, not qualification results. Minimum-macOS evidence remains missing. See the [CI record](change-log.md#native-registry-design). Library tests do not prove power-loss durability, production publication or packaged Tauri authorization.
