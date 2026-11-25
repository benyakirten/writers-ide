# Registry implementation review

**Status: owner-approved internal foundation, implemented / unmerged.** The approved final sign-off covers the database and integrity slice described here. It does not approve or implement production package publication, generation switching or application integration.

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

| Implemented                                                   | Not implemented by this slice                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Integrity entries, binary fingerprints and fixed-vector tests | Public SDK changes or management IPC                          |
| Typed registry data, validation and semantic transitions      | ZIP installation or immutable package publication             |
| 20-table SQLite schema and private migration execution helper | Live tokens, attachment tickets or native authorization       |
| Bounded FIFO worker, readiness and explicit shutdown          | Application startup, first-run selection or launch forwarding |
| Transactional permission, enablement and scope-review records | Actual native directory preparation or project opening        |
| SQLite-aware backup and restore staging                       | Generation selector, durable publication or recovery UI       |

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

`Registry::create` and `Registry::open` return a `RegistrySession` only after readiness checks finish. The session separates `RegistryOwner` from cloneable `RegistryHandle` operation access. Application lifecycle code will own the former; ordinary native callers will use the latter. That application wiring is absent.

Creation uses non-overwriting file creation and refuses existing destinations, including zero-byte files. Opening never initializes missing storage. Readiness checks schema objects/version, full SQLite integrity, foreign keys, required rows/catalogs, resource bounds and domain relationships. These checks do not verify installation files or select an active generation.

The store canonicalizes its destination and holds a standard-library `File::try_lock` lock on a persistent `.registry-lock` sidecar. The lock is separate from the database because file locking can overlap SQLite byte-range locks on some platforms. The sidecar is not deleted on release. Ownership lasts through worker cleanup. This prevents competing service owners for the canonical destination; it is not application single-instance detection or second-launch forwarding. Those still need integration and cross-platform tests.

`RegistryOwner::shutdown(self).await` closes admission, rejects queued standalone reads, finishes current work and drains admitted writes in order. It awaits cleanup and joins without blocking the async executor thread. Dropping the owner only signals draining without blocking. Retained handles cannot submit after closure. Explicit awaited shutdown is required to know cleanup finished before process exit.

## Internal Rust contract shape

The signatures below describe calls by trusted Rust host code. Paths, limits and capacity come from that host, not plugins. The methods are async. Tests currently supply their callers.

```text
Registry::create(path: PathBuf, limits: RegistryLimits, queue_capacity: usize)
    -> Result<RegistrySession>
Registry::open(path: PathBuf, limits: RegistryLimits, queue_capacity: usize)
    -> Result<RegistrySession>
RegistryOwner::shutdown(self) -> Result<()>
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

## Proposed publication safety requirements

Generation publication is still planned. Stop the normal service and retain exclusive coordinator ownership. Prepare and validate a separate generation. Complete the supported platform's file, SQLite-sidecar and directory durability steps before replacing active-generation metadata. Reopen only the selected generation through readiness validation.

Missing/invalid metadata requires plugin-free recovery. Do not guess a generation by name, timestamp or validity. An uncertain selector replacement must preserve both generations and report `OutcomeUnknown`, not automatically retry or switch back. Old generations remain until deliberate maintenance.

Exact selector encoding, replacement/synchronization operations and fault handling need investigation and packaged tests on macOS, Linux and Windows. Backup and staging tests do not establish this protocol.

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
- [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs) and [`worker_tests.rs`](../../src-tauri/src/plugin_registry/worker_tests.rs): readiness, ownership, FIFO, overload, abandoned waiters, shutdown and failure.
- [`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs), [`recovery_tests.rs`](../../src-tauri/src/plugin_registry/recovery_tests.rs) and [`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs): real-file/WAL backup, restore staging and synthetic migration tests.
- [`plugin_integrity/tests.rs`](../../src-tauri/src/plugin_integrity/tests.rs): binary vectors, entry validation, source errors and existing integrity regressions.

Run from `src-tauri`:

```sh
cargo test --lib plugin_registry
cargo test --lib plugin_integrity
cargo test --lib
cargo fmt -- --check
cargo clippy --lib --tests -- -D warnings
```

The [cumulative changelog](change-log.md#native-registry-design) records verified macOS validation. Library tests do not prove cross-platform publication or packaged Tauri authorization.
