# Registry implementation review

**Status: owner-approved internal foundation and shared lifecycle/sealing core, implemented / unmerged.** The bounded core includes location ownership, lifecycle control and generation-bound checked sealing. Maintenance adapters have test-only constructors. Production package publication, generation switching and application integration remain absent.

The registry is an internal Rust service in [`plugin_registry`](../../src-tauri/src/plugin_registry/mod.rs). It stores plugin installation records, project registrations and saved user decisions in SQLite. It does not store manuscripts or execute plugins. Frontend authors do not call its methods. No Tauri command, application startup caller or management UI uses it yet.

## How to read this review

1. Read this page for implemented responsibilities, internal operations and integration limits.
2. Read the [schema baseline](registry-schema-review.md) and authoritative [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql) for the 20-table schema.
3. Use the [foundation guide](registry-foundation.md) for approved policy and the [artifact guide](registry-artifacts.md) for installation transitions.

These are internal contracts, not plugin SDK or management IPC contracts. New behavior or responsibility changes still require owner approval.

## What exists today

The registry implements typed async operations, a bounded dedicated worker, schema initialization and validation, transactional installation and decision operations, SQLite-aware backup and restore staging. Private migration infrastructure is tested with synthetic upgrades. Schema version `1` is the only actual supported schema. There is no shipped predecessor migration.

The [integrity module](../../src-tauri/src/plugin_integrity/mod.rs) implements database-independent entry construction and iteration. Records and verified snapshots share the `writers-ide.file-set/1` binary fingerprint. Integrity-record JSON encoding is unchanged. The manifest parser, snapshot pool and resource route remain separate internal foundations.

## Approved implementation boundary

| Implemented                                                           | Not implemented by this slice                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Integrity entries, binary fingerprints and fixed-vector tests         | Public SDK changes or management IPC                               |
| Typed registry data, validation and semantic transitions              | ZIP installation or immutable package publication                  |
| 20-table SQLite schema and private migration execution helper         | Live tokens, attachment tickets or native authorization            |
| Bounded FIFO worker, readiness and explicit shutdown                  | Application startup, first-run selection or launch forwarding      |
| Transactional permission, enablement and scope-review records         | Actual native directory preparation or project opening             |
| SQLite-aware backup and restore staging                               | Production generation selector, durable publication or recovery UI |
| Location lease, shared lifecycle control and generation-bound sealing | Production maintenance requests or Windows durability guarantee    |
| Authorized `cfg(test)` publication adapter and lifecycle regressions  | Application lifecycle wiring or production publication             |

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

Opening returns a `RegistrySession` after readiness. The session separates `RegistryOwner` from cloneable `RegistryHandle` operation access. `RegistryOwner::control()` supplies lifecycle snapshots, revision-checked handle acquisition and maintenance admission. Retaining a handle or control does not retain the location lease after thread cleanup.

Creation uses non-overwriting file creation and refuses existing destinations, including zero-byte files. Opening never initializes missing storage. Readiness checks schema objects/version, full SQLite integrity, foreign keys, required rows/catalogs, resource bounds and domain relationships. These checks do not verify installation files or select an active generation.

The store canonicalizes its destination and holds a standard-library `File::try_lock` lock on a persistent `.registry-lock` sidecar. The lock is separate from the database because file locking can overlap SQLite byte-range locks on some platforms. The sidecar is not deleted on release. Ownership lasts through worker cleanup. This prevents competing service owners for the canonical destination; it is not application single-instance detection or second-launch forwarding. Those still need integration and cross-platform tests.

`RegistryOwner::shutdown(self).await` closes admission, rejects queued standalone reads, finishes current work and drains admitted writes in order. It awaits cleanup and joins without blocking the async executor thread. Dropping the owner only signals draining without blocking. Retained handles cannot submit after closure. Explicit awaited shutdown is required to know cleanup finished before process exit.

### Approved production ownership boundary

**Approved and implemented as an internal core:** one lifecycle coordinator retains the location lock across owned opening, normal operation, maintenance transitions and fresh opening. Maintenance requests can currently be constructed only by test fixtures; production restore/publication adapters are not implemented. It acquires the lock beside the dedicated registry root before checking whether that root exists. The worker receives shared retention before startup waits. Startup cancellation or dropping the coordinator must not release the lock while worker cleanup or admitted writes continue.

SQLite work stays on the database thread. Maintenance closes admission and drains admitted writes before preparing and sealing a replacement. Checked sealing preserves the connection if preparation, checkpointing or explicit close fails. A maintenance failure stops that attempt. It does not automatically resume service, retry publication or select another generation.

**Approved execution owner:** extend the dedicated registry thread to run lifecycle transitions as well as ordinary database operations. The thread owns SQLite and performs preparation, sealing and cleanup. A small shared control object handles admission and exposes owned lifecycle snapshots. Caller futures wait for results; they do not own the admitted work. A failed connection stays on this thread in recovery-only mode. No separate asynchronous supervisor or second coordinator thread is selected. A fresh service after maintenance means a new validated store and operation-admission channel; it does not require a replacement OS thread.

**Approved sealed-generation handoff:** successful checked sealing returns an opaque private Rust value bound to the prepared physical generation and its retained ownership. The later publisher consumes this value instead of accepting an arbitrary database path. Normal preparation APIs cannot reopen or modify the sealed generation through this value. Sealing success requires validation, a checked WAL checkpoint, explicit checked SQLite close and synchronization of the closed database file. Directory barriers and selector publication still require separate checks. The value enforces internal ordering; it is not authentication or protection against external file modification. Failure still preserves any returned connection under the recovery-only coordinator. This handoff does not enable Windows publication or select a production selector format.

**Approved maintenance admission:** admit only one maintenance attempt at a time. While an attempt is running, reject a competing maintenance request immediately with `Conflict`, without changing storage for that request. There is no maintenance waiting queue. A caller can inspect current state and explicitly submit a new request later. This does not change the bounded queue for ordinary registry operations or define which recovery actions are valid after a failure.

**Approved stale-request check:** when trusted application code reads coordinator state, it receives an opaque lifecycle revision. A maintenance request must include the revision the caller reviewed. The coordinator checks it at admission. A stale revision returns `Conflict` without admitting the attempt or changing storage. The revision changes when an attempt is admitted and when its outcome is established, even if the selected generation stays the same. This detects intervening failed attempts as well as successful replacement. The revision tracks lifecycle changes, not every ordinary database write. Bind it to the coordinator lifetime as well as its transition sequence, so a revision from another coordinator or a previous lifetime cannot match a new instance accidentally. It grants no authority. Concrete Rust naming and encoding remain implementation details; the management wire API is not defined here.

**Approved maintenance caller lifetime:** an explicitly requested maintenance attempt continues once admitted, even if the caller drops its waiting future or closes the management window. Before admission, there is no accepted attempt to complete. After admission, the coordinator retains ownership until the single attempt finishes. Success leaves a fresh ready registry; failure leaves recovery-only mode. A later caller must be able to inspect authoritative lifecycle state rather than infer the outcome from a lost response. This does not add automatic retries or an explicit cancellation API. It does not authorize publication on an unsupported platform.

**Approved operation-handle lifetime:** handles for the stopped worker remain permanently closed. Calls through them return `Unavailable`; they never reconnect to a replacement worker. After successful maintenance, the coordinator supplies new handles only after the fresh worker passes readiness checks. Application services must explicitly obtain replacement handles. Calls are not queued across maintenance, and failed operations are not replayed. This does not change the draining of writes admitted before the old worker closed admission.

**Approved maintenance-failure state:** keep the coordinator alive in recovery-only mode. It retains the location lock and ownership of any returned SQLite connection while the application offers plugin-free recovery. Ordinary registry handles remain unavailable. Recovery or shutdown requires an explicit action; the failure does not release ownership to another process while the user decides. SQLite work remains on its owning database thread. This defines the recovery state, not a recovery UI or command API.

Explicit awaited shutdown confirms cleanup. Dropping an owner initiates cleanup but does not certify completion. The coordinator and any outstanding cleanup must retain location ownership until their work actually finishes. Ordinary operation handles do not control this lifetime.

The owner approved implementing this bounded responsibility and Rust contract. The core uses the existing dedicated thread, not the test-only cleanup thread. Production maintenance request fields, selector format and application startup wiring remain separately gated. Windows publication remains blocked pending required research.

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
| Sealed generation        | A private, non-cloneable value produced only by successful checked sealing. It retains generation ownership and has no mutation/reopening API. The future publisher consumes it.                                                                                                                                                                                            |
| Seal failure             | Retains the generation association, diagnostic error and any connection returned before or during checked close. A post-close failure has no connection to return. These resources stay on the registry thread in recovery-only mode; callers receive owned diagnostics.                                                                                                    |

The thread remains alive while recovery-only mode awaits an explicit action. Its control path must still accept state inspection and shutdown when ordinary operation admission is closed. Ordinary registry work retains its existing bounded FIFO queue. There is no maintenance waiting queue and no unbounded queue of lifecycle requests.

Implemented regression coverage includes simultaneous maintenance admission, stale revisions after failed attempts, foreign/prior-coordinator revision rejection, caller abandonment after admission, old-handle rejection, fresh-handle acquisition racing maintenance, and location-lock retention through startup cancellation, recovery-only mode and cleanup. Sealing tests verify generation binding, connection retention before/at close and absence of a connection after checked close. Lifecycle fixture outcomes distinguish unknown publication from failed readiness after confirmed publication; the existing publication probe retains its native fault coverage.

#### Review outcome and approved shutdown rule

The dedicated worker now arbitrates maintenance completion against lifecycle shutdown. `PreparedGeneration::create` creates a new generation directory and database together under the location lease. Consuming `seal()` binds the resulting value or failure to that same generation. The probe's separate connection/path signature remains test-only and shares checked sealing mechanics with this core. Restore staging remains a separate helper, not a production maintenance request.

**Approved shutdown interaction; implemented in the core:** shutdown or owner drop sets a persistent control flag, including when maintenance is already admitted. Setting it immediately prevents further maintenance admission and ready-handle acquisition. An already admitted attempt still finishes its one planned attempt and records its outcome. It then proceeds directly to cleanup without exposing a ready service or waiting for an interactive recovery action. This does not cancel publication, retry it or change its success criteria. The thread retains the location lock through cleanup. Dropping the shutdown waiter does not reverse the flag or interrupt cleanup. Tests cover shutdown and owner drop before and during maintenance completion, plus abandonment of the shutdown waiter.

This resolves the shutdown policy identified by the source and race review. The normal maintenance-success and recovery-only outcomes apply when shutdown has not been requested. Once shutdown is requested, recording the maintenance outcome does not reopen ordinary admission or wait for interactive recovery. Coordinator-lifetime revision binding and the distinction between a stopped service and a live lifecycle thread are implementation clarifications of the approved policies, not new permission or publication rules.

This bounded implementation adds no production selector, publisher, recovery-command API, application startup wiring or external loading. Windows publication research remains required. The existing test-only publisher can supply lifecycle fault evidence without becoming the production publisher. A pre-opened gated worker is not part of this core.

## Internal Rust contract shape

The signatures below describe calls by trusted Rust host code. Paths, limits and capacity come from that host, not plugins. The methods are async. Tests currently supply their callers.

```text
LocationLease::acquire(root: &Path) -> Result<LocationLease> // blocking; no root creation
Registry::open_owned(lease: LocationLease, path: PathBuf, limits: RegistryLimits, capacity: usize)
    -> Result<RegistrySession> // async; existing selected database only
RegistryOwner::control(&self) -> RegistryControl
RegistryControl::snapshot(&self) -> LifecycleSnapshot
RegistryControl::ready_handle(&self, expected: &LifecycleRevision) -> Result<RegistryHandle>
RegistryControl::maintain(&self, expected: LifecycleRevision, request: MaintenanceRequest)
    -> Result<()> // async; request constructors are test-only
RegistryOwner::shutdown(self) -> Result<()> // async; waits for actual cleanup
```

See [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs) for exact operation signatures and [`model.rs`](../../src-tauri/src/plugin_registry/model.rs) for records.

| `RegistryHandle` method  | Input and atomic result                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_settings`          | Returns the two typed host settings in one read transaction.                                                                                       |
| `package_details`        | Takes `PackageId`; returns installation, artifacts, declarations and decisions in one bounded snapshot.                                            |
| `project_details`        | Takes `ProjectId`; returns saved name, location, revision, logical public identity, decisions and overrides.                                       |
| `accept_artifact`        | Takes `PreparedArtifact` and matching receipt; inserts history and complete immutable metadata together.                                           |
| `change_installation`    | Takes expected state, semantic action, optional target and prerequisites; commits acceptance if supplied, pointers, revision and cleanup together. |
| `register_project`       | Takes a complete `PreparedProject`; commits all location/name fields and initial revision together.                                                |
| `relink_project`         | Takes key, expected revision, prepared location and closed-project prerequisite; replaces location and increments revision together.               |
| `refresh_project_name`   | Takes key, expected location revision and prepared current location; refreshes the label only for the matching location.                           |
| `save_permission_review` | Takes a bounded review with expected installation, settings and decisions; saves all effects and deliberate candidate consumption together.        |
| `acknowledge_scope`      | Takes exact target release and baseline/revision; saves pending review or applies the selected baseline atomically.                                |
| `set_enablement`         | Takes declaration, expected installation/choice and new choice; `None` removes a project override for Inherit.                                     |
| `set_host_settings`      | Takes expected/current and replacement typed settings; commits coherent mode/policy changes.                                                       |
| `remove_unused_artifact` | Requires matching runtime-use prerequisite and no installation reference; explicitly deletes owned children and artifact, not files/history.       |
| `backup`                 | Takes a new destination path; completes SQLite-aware copying and file synchronization after admission.                                             |

`ArtifactTarget::Prepared` combines preparation and receipt for acceptance within an installation transaction. Two separate public method calls do not form one atomic operation.

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

[`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs) is private infrastructure for reviewed static SQL chains, not caller-supplied SQL. It validates the source and bounded consecutive steps, completes a backup before mutation, applies steps/version changes in one transaction and validates the target before commit. Tests use synthetic `1 -> 2` schemas and failure chains. Actual opening supports schema `1` only and rejects unknown versions. No prior shipped schema migration is registered.

The synchronous private `prepare_restore` helper is exercised directly by native tests. A future closed-registry coordinator must schedule it off latency-sensitive threads and retain exclusive maintenance ownership. It prepares a new database, not a live replacement. It holds consistent source/current read snapshots, performs bounded full validation of the backup and prepared result, and validates current history/allocation evidence separately. It merges history by canonical package/version, rejects known fingerprint conflicts, and preserves validated allocation high-water marks. It never merges current approvals or installation selection into the backup.

Ordinary restoration requires matching namespaces. Explicitly acknowledged missing/unreadable history or unrecoverable allocation evidence requires a fresh namespace as specified by the recovery policy. The helper preserves safely decoded history pins even when other history or metadata is damaged. Missing or malformed evidence needs explicit loss acknowledgement; it never manufactures a missing fingerprint. A loss acknowledgement cannot bypass a known validated conflict, readable unsupported schema, known incompatible namespace or host resource limit. Deleted history with no surviving evidence cannot be detected or reconstructed. Restore forces Secure mode and moves approvals into inactive recovered candidates, merging source flags without granting coverage. Source/current databases stay unchanged.

## Publication harness and production safety requirements

Production generation publication is still planned. The owner-authorized [`publication_probe`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs) module is compiled only for tests. `cargo test --lib` calls it with isolated temporary directories and explicit limits. There is no application entry point, public API or authority credential. It prepares fixture databases, checks sealing, exercises selector publication and opens actual registry workers. It does not install package artifacts or construct production artifact-publication receipts.

For production, stop the normal service and retain exclusive coordinator ownership. Prepare and validate a separate generation. Complete the supported platform's file, SQLite-sidecar and directory durability steps before replacing active-generation metadata. Reopen only the selected generation through readiness validation.

Missing/invalid metadata requires plugin-free recovery. Do not guess a generation by name, timestamp or validity. An uncertain selector replacement must preserve both generations and report `OutcomeUnknown`, not automatically retry or switch back. Old generations remain until deliberate maintenance.

The [publication investigation](registry-publication-investigation.md) distinguishes earlier disposable Python/APFS observations from the compiled harness. The harness checks WAL/FULL, foreign keys, bounded readiness, TRUNCATE counters and explicit close before flushing the closed file. Preparation/close failures return the connection. Its private 61-byte checksummed selector fixture is not a production format or authentication mechanism. The separate 64-byte production encoding is approved but not implemented. Platform success criteria and evidence requirements are approved; qualification remains incomplete.

Native first creation uses Linux `renameat2(RENAME_NOREPLACE)` or macOS `renamex_np(RENAME_EXCL)`. Windows raw-move tests use `MoveFileExW` with write-through, without copy or fallback. Windows directory synchronization explicitly returns `Unsupported`, so integrated publication stops before selector creation and returns no session. Native Registry CI passed formatting, the complete library suites and all-target Clippy on macOS, Windows and Ubuntu after the documentation-test line-ending correction. See the [validation record](change-log.md#native-registry-design). Runtime/barrier and process-exit tests do not prove power-loss durability.

The test adapter acquires a stable location lease before first-run detection, seals the replacement, exercises the platform adapter and then opens the selected registry. `cfg(test)` worker hooks retain its `Arc<File>` before the startup await through actual worker cleanup, including abandoned startup and owner-drop draining. The leased-session cleanup thread is a prototype only. The internal `open_owned` helper now retains a separate production-compiled location lease; application startup is not wired to it. A failed fresh open after confirmed publication requires recovery without switching back. A pre-opened gated worker is optional, not an approved lifecycle change. Source/current logical data remains unchanged during preparation, but SQLite opens can still create or rebuild sidecars.

The owner approved advancing shared production ownership and checked sealing while keeping Windows generation publication blocked temporarily. [Windows publication research](registry-publication-investigation.md#approved-next-direction-and-required-windows-research) remains a required completion gate, not permanent exclusion or optional backlog. No weaker Windows guarantee is approved. The [single-coordinator ownership boundary](#approved-production-ownership-boundary) is approved. The shared core is implemented under its reviewed Rust contract. Production maintenance requests and startup wiring remain gated; the publisher prototype remains test-only. The [approved publisher contract](registry-publication-investigation.md#approved-production-publisher-contract) specifies exact record/layout, consuming ownership, exclusive first publication, replacement preconditions and failure boundaries. It permits format/ownership implementation and tests, not production native publication enablement. The [platform/storage policy](registry-publication-investigation.md#approved-platform-and-storage-contract) completes the second design checkpoint. It authorizes codec, ownership/result and Linux/macOS candidate-adapter implementation and tests behind the publication gate. Its qualification gates still require a platform argument, production-code coverage, supported-version checks and cache-aware crash/storage testing. No platform is declared qualified; Windows publication remains blocked.

## Remaining integration decisions

Native path encoding, directory-identity schemes and alias matching need supported platform formats. `PublicProjectId` internally pairs namespace and registration key; its author-facing string encoding and native host mapping remain open. No real native location proof can be constructed yet.

Only permission mode and repair-conflict policy are foundation settings. Command/runtime integration must add typed settings persistence, dispatcher loading, change distribution and its settings menu. Lifecycle/management integration must add the blocked-activation preference, activation wiring and management toggle. These are completion gates for their slices and Part 4, not optional backlog items.

No project-forgetting workflow, configuration reset, automatic generation cleanup, cross-registry import, audit log, interactive history-conflict recovery or activation-health rollback is added. Production numerical defaults remain deferred.

## Final sign-off proposal

**Approved by the owner and implemented for the internal slice only.** The scope includes the integrity API and binary fingerprint, assembled 20-table schema, typed transactions, bounded worker/lifecycle, backup, private migration infrastructure and restore-data preparation. It excludes real publication, generation switching, application startup/recovery integration, management IPC/UI, live authority, project-file services, indexing, external loading and Basic Menu packaging.

## Source, tests and validation

- [`schema.rs`](../../src-tauri/src/plugin_registry/schema.rs), [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql) and [`schema_tests.rs`](../../src-tauri/src/plugin_registry/schema_tests.rs): creation, required objects, constraints and unsafe-state rejection.
- [`store.rs`](../../src-tauri/src/plugin_registry/store.rs), [`store_decisions.rs`](../../src-tauri/src/plugin_registry/store_decisions.rs), [`store_validation.rs`](../../src-tauri/src/plugin_registry/store_validation.rs) and [`store_tests.rs`](../../src-tauri/src/plugin_registry/store_tests.rs): transactions, bounds, revisions, decisions, retention and rollback.
- [`preparation.rs`](../../src-tauri/src/plugin_registry/preparation.rs), [`model.rs`](../../src-tauri/src/plugin_registry/model.rs), [`transitions.rs`](../../src-tauri/src/plugin_registry/transitions.rs) and [`error.rs`](../../src-tauri/src/plugin_registry/error.rs): private preparation contracts, typed records, policy calculations and errors.
- [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs), [`lifecycle.rs`](../../src-tauri/src/plugin_registry/lifecycle.rs), [`lifecycle_tests.rs`](../../src-tauri/src/plugin_registry/lifecycle_tests.rs) and [`worker_tests.rs`](../../src-tauri/src/plugin_registry/worker_tests.rs): readiness, bounded admission, lifecycle snapshots/revisions, handle replacement, recovery retention, abandonment and sticky shutdown.
- [`location.rs`](../../src-tauri/src/plugin_registry/location.rs), [`generation.rs`](../../src-tauri/src/plugin_registry/generation.rs) and [`generation_tests.rs`](../../src-tauri/src/plugin_registry/generation_tests.rs): stable location ownership, generation-bound creation/sealing, checked close, failure ownership and closed-file synchronization.
- [`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs), [`recovery_tests.rs`](../../src-tauri/src/plugin_registry/recovery_tests.rs) and [`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs): real-file/WAL backup, restore staging and synthetic migration tests.
- [`plugin_integrity/tests.rs`](../../src-tauri/src/plugin_integrity/tests.rs): binary vectors, entry validation, source errors and existing integrity regressions.
- [`publication_probe/mod.rs`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs), [`sealing.rs`](../../src-tauri/src/plugin_registry/publication_probe/sealing.rs), [`platform.rs`](../../src-tauri/src/plugin_registry/publication_probe/platform.rs), [`tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/tests.rs) and [`process_tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/process_tests.rs): test-only lifecycle, native candidates, sealing, all-phase faults, partial writes, post-publication readiness rejection, process exits and cross-process locks. Child tests use timeouts and kill/reap guards. The two additional lease lifetime regressions are in `worker_tests.rs`.

Run from `src-tauri`:

```sh
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

The [cumulative changelog](change-log.md#native-registry-design) separates earlier foundation/probe evidence from current shared-core validation. Focused subsets do not replace the full library suite, library check, formatting and all-target Clippy.

The [Native Registry workflow](../../.github/workflows/native_registry.yml) is configured for stable Rust on macOS 15, Windows latest and Ubuntu 24.04. It runs formatting, the full locked library suite and locked all-target Clippy. Earlier CI passed all three checks on macOS 15, Windows latest and Ubuntu 24.04 after the LF/CRLF documentation-test correction. The shared lifecycle/sealing implementation subsequently passed all three checks on all three platforms. Minimum-macOS evidence remains missing. See the [CI record](change-log.md#native-registry-design). Library tests do not prove power-loss durability, production publication or packaged Tauri authorization.
