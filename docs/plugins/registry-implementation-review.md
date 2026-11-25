# Registry implementation review

**Status: consolidated proposal. Not implementation approval.** The owner requested this review before registry code is written. Existing approvals remain requirements. Recommendations in this document are not new approvals.

The registry is an internal Rust service. It stores plugin installation records, project registrations and saved user decisions in SQLite. It does not store manuscripts or execute plugins. Frontend authors will not call its methods directly.

## How to read this review

1. Read this document for scope, Rust responsibilities and the remaining decisions.
2. Read the [schema review](registry-schema-review.md) for the complete proposed SQL. It includes 20 tables, indexes, checks and ownership triggers.
3. Use the [foundation guide](registry-foundation.md) to check approved policy. The [artifact review](registry-artifacts.md) preserves the distinction between approved transitions and earlier recommendations.

The SQL is a review artifact, not a migration. Rust names below are proposed internal names, not a plugin SDK or Tauri IPC contract. Routine private naming, message layout and migration bookkeeping do not need individual A/B approval. Changes to behavior, authority or responsibility still do.

## What exists today

The native integrity module verifies package bytes against a supplied record. The manifest module parses the verified manifest and resolves static dependencies. The snapshot pool and resource route provide separate internal resource foundations.

There is no registry service or schema. The current verified-package fingerprint still hashes deterministic JSON. Implementing the approved `writers-ide.file-set/1` binary fingerprint will change that internal calculation. This proposal does not claim the source already uses it.

## Proposed implementation boundary

The following work is proposed for the foundation. It is not authorized merely by appearing here.

| Include                                                                       | Exclude                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Database-independent integrity entry construction and iteration               | Plugin SDK changes and management IPC                                 |
| Shared binary fingerprint and reference-vector tests                          | External package loading and Basic Menu distribution                  |
| Typed registry data, validation and semantic transitions                      | Real ZIP installation and immutable package publication               |
| SQLite schema, initialization and supported transactional migration framework | Live tokens, attachment tickets and native authorization caches       |
| Bounded dedicated worker, admission, completion and shutdown                  | Project file reads, indexing and filesystem watchers                  |
| Transactional decisions, enablement and pure eligibility evaluation           | Actual directory identity validation and project opening              |
| SQLite-aware backup and restore transformation tests                          | Application restart, recovery UI and production restore orchestration |

The generation selector and filesystem publication adapter need a separately verified protocol before they can be part of a working restore path. Pure restore transformations can be tested without claiming that production restoration is implemented. Final sign-off must explicitly confirm whether filesystem publication belongs in this implementation slice or the following one.

## Responsibility boundaries

### Preparation outside the database worker

A trusted native helper takes one verified package snapshot. It derives the normalized manifest declarations, accepted file entries and shared fingerprint from those same bytes. It returns an owned `PreparedArtifact` with private fields.

The helper must not perform substantial hashing or manifest work inside the SQLite queue. Running a function through `async` alone does not move its CPU work off the calling thread. Use the host's bounded native execution facilities for preparation.

The eventual installer publishes the immutable package directory and produces a private `PublicationReceipt`. The receipt identifies the artifact, destination layout and matching prepared content. Registry acceptance checks the binding. The first library defines this contract and uses a test-only publisher substitute. It must not expose a production constructor that fabricates successful publication.

Neither object grants native authority. Neither is accepted from JavaScript. Trusted native code remains responsible for their construction; these types are not a sandbox against compromised host code.

### SQLite worker

One dedicated OS thread owns the `rusqlite` connection. It enables foreign keys, WAL and `synchronous=FULL`. It validates the resulting configuration. Ordinary operations enter a bounded FIFO queue.

The worker owns SQL transactions and semantic state changes. It returns owned data, not a connection, transaction or live cursor. No transaction spans package verification, user confirmation or filesystem publication.

A full queue rejects before admission with `LimitExceeded`. Admitted writes finish even if their waiter disappears. Abandoned reads are skipped before execution; running reads finish and release their resources. Production numerical defaults remain deferred. Tests supply explicit finite limits.

### Application lifecycle owner

Application startup owns creation, opening and shutdown. Windows receive cloneable operation handles. Dropping a window or the last handle does not shut down the service.

Opening returns a usable service only after schema checks, required migration, full SQLite integrity checking, foreign-key checking and domain validation succeed. Fresh creation is separate and refuses existing destinations. Automatic creation is allowed only when the dedicated registry location is absent.

Explicit shutdown closes admission, rejects queued standalone reads, finishes current work and admitted writes, then awaits worker cleanup. Owner drop signals the same drain without blocking the destructor. It does not guarantee completion after process termination.

## Proposed Rust contract shape

The following is signature notation for review, not compilable source. The eventual implementation supplies the named records and concrete error payloads. `&self` methods are called by trusted Rust host code. Each async method returns after its operation completes, not merely after queue admission.

```text
Registry::create(CreateRegistry) -> Result<RegistrySession, RegistryError>
Registry::open(OpenRegistry)     -> Result<RegistrySession, RegistryError>

RegistrySession {
    owner: RegistryOwner,
    handle: RegistryHandle,
}

RegistryOwner::shutdown(self) -> Result<(), RegistryError>
```

Creation and opening are async readiness operations. `CreateRegistry` identifies a nonexisting destination and required initial configuration. `OpenRegistry` identifies existing storage and supplies validated host limits. Neither takes a plugin-provided path or a flag that converts an open failure into initialization.

`RegistryHandle` exposes typed, operation-specific methods in these families:

| Proposed method          | Inputs and result                                                                                               | Atomic boundary                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `package_details`        | Stable package identity; owned details with installation state, accepted declarations and relevant review state | One bounded consistent read transaction                                                        |
| `project_details`        | Local project registration key; owned saved location and decisions                                              | One bounded consistent read transaction                                                        |
| `read_settings`          | No plugin input; typed host settings                                                                            | One bounded read transaction                                                                   |
| `accept_artifact`        | Private prepared artifact and matching publication receipt; accepted artifact identity                          | History comparison plus all artifact/declaration inserts                                       |
| `change_installation`    | Semantic action, reviewed expected state and any trusted prerequisites; committed transition result             | Pointer changes, relevant decision cleanup, enablement initialization and scope state together |
| `register_project`       | Complete trusted prepared location and cached name; new local registration key                                  | All registration fields together                                                               |
| `relink_project`         | Key, expected location revision and trusted validated replacement; new revision                                 | Location replacement and revision increment together                                           |
| `refresh_project_name`   | Key, expected location revision and name from validated current opening                                         | Update only if the reviewed location is still current                                          |
| `save_permission_review` | Named components, permission coverage, expected reviewed requirements and deliberate decisions                  | Validate and save the entire review, including any separately confirmed denial clearing        |
| `set_enablement`         | Component, application choice or project override, applicable declaration and expected state                    | Choice change; Inherit deletes the project override                                            |
| `acknowledge_scope`      | Exact target release, reviewed baseline/revision and scope                                                      | Save pending acknowledgement or establish matching selected baseline                           |
| `set_host_settings`      | Typed setting changes and expected settings                                                                     | Coherent save; mode changes apply approved automatic-approval rules                            |
| `remove_unused_artifact` | Artifact and expected eligibility                                                                               | Explicit owned-child deletion followed by artifact deletion                                    |

These method families describe responsibilities, not a mandatory one-method-per-row design. The permission and settings methods must support the already approved rules without exposing arbitrary table mutation. A review that changes multiple facts must not be split into partial successful saves.

An installation action may include a newly prepared target. In that case acceptance and the installation change commit together. Reuse the acceptance validation internally; do not call two public methods and claim they form one transaction. Separate acceptance remains useful for recording a durably published copy without selecting it.

### Semantic installation actions

Use a typed action enum internally for install, stage update, repair, restore previous, cancel stage, cancel all pending changes, uninstall and promote stage. Callers request intent, not arbitrary replacement pointer sets.

The pure transition calculator takes the current installation snapshot and validated target facts. It returns the new pointers and required cleanup. The committing operation rechecks the reviewed installation revision and expected state before applying that result, then advances the revision atomically with the change. Future previews can call the same calculator.

Verification success, process-wide no-prior-import eligibility and closed-project checks are trusted host prerequisites, not claims a plugin can submit. The registry library can define private prepared-input contracts and exercise them in tests. Actual enforcement requires the later host integrations. Until then, passing a test prerequisite must not imply that production runtime checks exist.

### Integrity entries

The integrity module remains independent of SQLite and `RegistryError`. It accepts a bounded fallible iterator of entries and exposes read-only iteration after validation.

```text
IntegrityEntry { path: String, byte_length: u64, sha256: [u8; 32] }

from_entries<E>(version, entries, limits)
    -> Result<IntegrityRecord, IntegrityBuildError<E>>

IntegrityBuildError<E> = Source(E) | InvalidRecord(IntegrityError)
```

The signature preserves concrete source errors. The registry maps errors after reconstruction. SQL lengths must fit SQLite's signed integer storage; reject unrepresentable values instead of wrapping. The integrity module owns conversion to its existing hexadecimal JSON representation. The JSON format need not change.

### Completion and errors

Use the [nine approved categories](registry-foundation.md#approved-registry-error-categories). Retain underlying causes for host diagnostics without exposing database details to plugins.

- `Ok` means successful completion and committed changes, if any.
- Queue rejection is not admission and causes no execution.
- `Storage` for a mutation means the operation is known not to have committed.
- `OutcomeUnknown` means the caller cannot establish the commit/publication outcome. Do not blindly retry.
- Missing caller-requested data is `NotFound`. Broken required relationships require recovery handling.
- Unexpected worker termination makes existing handles unavailable. Do not replace the worker automatically or replay writes.

## Proposed publication safety requirements

The generation layout is approved. The following sequence assembles its requirements; it is not a verified cross-platform filesystem implementation.

1. Retain exclusive maintenance ownership after stopping the normal service.
2. Prepare a separate generation through SQLite-aware copying.
3. Apply restore transformations. Merge eligible history and counter evidence, sanitize approvals, force Secure mode and apply any required namespace change.
4. Validate the prepared database. Complete a SQLite-aware close/checkpoint and durability sequence that preserves committed WAL contents.
5. Durably prepare the generation's required files and directory entries before selecting it.
6. Prepare replacement selector metadata in the same owned location. It contains only a validated generation identifier and format information, not an arbitrary path.
7. Replace the selector through the supported platform's atomic replacement mechanism. Confirm the required file and directory durability.
8. Reopen the selected registry through normal readiness validation. Return a fresh service only after success.

A failure before attempting selection leaves the current selection unchanged. A failure after attempting selection must be classified from actual evidence. If durability cannot be established, report `OutcomeUnknown`, preserve both generations and enter controlled recovery. Do not automatically retry or switch back.

Missing or invalid selector metadata requires recovery. Never choose by directory name, timestamp or database validity. Old generations are not automatically deleted. The selector is separate from the logical identity namespace, and active SQLite remains writable.

### What still needs technical investigation

Document and test the exact supported replacement and durability operations for macOS, Linux and Windows. Investigate directory synchronization, Windows replacement/sharing behavior, SQLite backup/checkpoint failure handling and failure classification. A generic rename call alone is not proof of durability.

This is engineering investigation, not another preference question. If a platform cannot support the approved guarantee, explain the limitation and ask before weakening behavior. Do not claim production restore readiness from in-memory SQL probes or a test on one OS.

## Remaining owner decisions

All four focused behavioral questions are resolved. Final schema/contract and implementation-scope sign-off remains required. A newly discovered behavior gap must still be explained before making a design choice. The owner has approved detecting installation changes away and back through a retained monotonic revision. Explicit review also consumes the matching recovered approval candidate atomically with the new decision.

The owner approved limiting the foundation's settings to permission mode and repair-conflict policy. Add command resource settings and the blocked-activation preference through later typed migrations during Part 4. Do not substitute generic JSON or key/value storage.

These are completion requirements, not indefinite backlog items:

- External command/runtime and settings integration requires typed persistence, loading saved resource settings into the dispatcher, change distribution and the settings menu.
- Plugin lifecycle/management integration requires persistence of the blocked-activation preference, activation-behavior wiring and its management toggle.
- The internal registry foundation can finish without these additional settings. Their feature slices and Part 4 cannot finish without them.

No precise calendar date or order between those integration slices is established. Numerical defaults and existing preference semantics are unchanged by this scope decision.

The owner approved deriving scope-review blockers from saved facts, without a separate mutable blocked flag. For an installed component, no baseline requires initial review; a selected scope different from the baseline requires change review. Matching scopes have no scope-review blocker. Apply an applicable acknowledgement and update the baseline atomically. Pending acknowledgements remain completed reviews awaiting target selection. Returning to the reviewed scope clears only the scope blocker, not other activation checks.

Explicit candidate review matches the component, operation/resource pair, coverage scope and project registration when project-specific. Save the current decision and delete only that candidate in one transaction. A failed save preserves it. Reviewing one project does not consume another project's or application-wide candidate. Automatic Trust-mode processing alone preserves recovered candidates. This does not implicitly clear any denial.

The approved installation revision is separate from `location_revision` and `scope_revision`. It survives uninstall. The draft SQL stores it on `packages`, which remains after installation-state removal. Each committed installation-state change advances it atomically. Reviewed writes compare it and reject stale revisions with `Conflict`, including changes away and back. Start-at-1 storage and checked increments are proposed mechanics; counters must never wrap.

Final sign-off must also confirm the remaining installation pointer-shape checks and the complete schema. Those checks are collected in the schema review instead of generating a separate question for each SQL expression.

## Mechanical choices and deferred work

The draft proposes `STRICT` tables, restrictive foreign keys, explicit singleton rows, binary text comparison, 16-byte logical namespace storage and checked positive counters starting at one. Review these together with the SQL. Names, enum encodings, indexes and concrete Rust wrappers are routine choices when they preserve approved behavior. Counter exhaustion must reject without wrapping or partial mutation.

Native path encoding and directory identity need documented supported formats before real project registration. The foundation can store validated versioned binary fields without claiming it validates the actual directory. Unknown formats cannot recover grants. Public project-ID encoding remains opaque and is not a new author-facing format contract.

Do not add project-forgetting APIs, generic configuration reset, automatic generation cleanup, cross-registry import, audit logging, interactive restore conflict resolution or activation-health rollback to complete this slice. These features remain deferred. Numerical production defaults remain deferred too; finite injected test limits are not release defaults.

## Proposed implementation and test order

After the focused decisions and final sign-off:

1. **Integrity construction and fingerprint.** Add database-independent entry construction and read-only iteration. Implement the approved binary fingerprint once. Reproduce the existing reference vectors and test ordering, duplicates, malformed digests, source errors, unsupported formats and bounds.
2. **Domain model and transitions.** Add typed identities, reviewed-state checks, coverage evaluation and the pure installation calculator. Test all repair/update/restoration paths, stale operations, uninstall retention, scope baselines and denial precedence.
3. **Schema and transactions.** Add bundled `rusqlite`, the reviewed schema and typed operations. Test constraints directly and through the service. Inject transaction failures and verify no partial acceptance, decision review or selection cleanup.
4. **Worker lifecycle.** Add bounded FIFO admission, ready-only handles and explicit shutdown. Test overload without admission, dropped waiters, queued-read rejection, admitted-write draining and unexpected worker loss.
5. **Backup and recovery transformations.** Test SQLite-aware backups and restore preparation using real temporary files and WAL. Cover history conflicts, counter retention, namespace recovery, inactive recovered approvals and Secure mode. Keep publication claims separate until platform evidence exists.
6. **Integration handoff.** Document the tested internal contracts and remaining production adapters. Do not enable application plugin loading, management IPC or native authority as a side effect.

The eventual test matrix must include reopen persistence, wrong schema, missing required singleton/catalog data, foreign-key and domain corruption, revision exhaustion and supported migration failure. Restoration tests must distinguish database transformation from durable publication. Platform publication tests need explicit fault points before and after selector replacement.

## Final approval checklist

Before implementation, present one bounded sign-off covering:

- The resolved behavioral questions and updated SQL.
- The typed method families, prepared-input ownership and atomic boundaries.
- Which backup/restore pieces are implemented in this slice and which remain gated.
- The test matrix and any platform evidence still unavailable.
- The fact that no public SDK, IPC, native authority or external-loading integration is included.

Do not interpret approval to consolidate documentation as this final implementation sign-off.
