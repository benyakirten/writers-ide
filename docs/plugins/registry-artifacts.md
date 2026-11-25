# Registry review 1: artifacts and installation transitions

**Status: partially approved design proposal. Not implemented.** This document covers the first of six review groups in the [registry foundation guide](registry-foundation.md#remaining-review-groups). The owner is reviewing decisions through individual A/B questions. The derived installation-location approach, retained package display name/description and per-artifact integrity-record version are approved. Other recommendations remain unapproved unless explicitly marked. Implementation still requires the remaining reviews and final sign-off.

The registry is the application's SQLite database for plugin installations and user decisions. An **artifact** is one accepted, immutable copy of a package. A repair creates a new artifact even when its contents match an existing copy. Package files live outside SQLite.

## What is already approved

These requirements are not new questions:

- Stable package and component identities are separate from accepted artifacts and user decisions.
- Artifact IDs are random 128-bit values, stored as 16-byte BLOBs. They are not content hashes or credentials.
- One package and complete SemVer value has one accepted file-set fingerprint. History survives uninstall. Repairs must match that accepted content.
- Publish immutable files durably before recording acceptance. Record the artifact, file set and accepted declarations in one database transaction.
- A separate installation-state row holds selected, staged, previous and optional pending-repair references. Every reference belongs to the same package.
- Updates, repairs and previous-version restoration are restart-staged. A new installation can select immediately only if no package code has been imported anywhere in the current process.
- Repair and keep the update is the default repair preference. A pending repaired copy becomes previous when the staged update is selected.
- Selection is not activation or native permission. Dependencies, component choices, scope review and permission checks still apply.

The [foundation guide](registry-foundation.md) contains the approved identity, fingerprint, file and component columns. Everything below is a recommendation for this review unless explicitly identified as already approved.

## Proposed accepted-artifact columns

Use this complete initial `accepted_artifacts` column set:

| Column                     | Storage and meaning                                                                                                            | Decision status                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `id`                       | `BLOB NOT NULL PRIMARY KEY`. Exactly 16 bytes. Identifies this immutable copy.                                                 | ID representation approved.                                     |
| `package_id`               | `INTEGER NOT NULL`. References `packages(id)`.                                                                                 | Approved as part of the composite history reference.            |
| `version`                  | `TEXT NOT NULL`. Complete canonical SemVer, including prerelease and build metadata.                                           | Approved as part of the composite history reference.            |
| `integrity_record_version` | `INTEGER NOT NULL`. Positive format version for reconstructing this artifact's integrity record. Initially `1`.                | Per-artifact placement approved; physical constraints proposed. |
| `storage_layout`           | `TEXT NOT NULL`. Initially `writers-ide.artifact-store/1`. Determines how to locate the artifact beneath the host-owned store. | Derived location approved; exact initial tag proposed.          |
| `display_name`             | `TEXT NOT NULL`. Accepted package display name from the verified manifest.                                                     | Approved.                                                       |
| `description`              | `TEXT NOT NULL`. Accepted package description from the verified manifest.                                                      | Approved.                                                       |

**Approved:** reference version history through a composite foreign key from `(package_id, version)` to `package_version_history(package_id, version)`. Keep package and complete version directly on the artifact; do not introduce a separate history-row ID for this reference. Exact SQL remains subject to final schema review.

The proposed unique `(package_id, id)` key lets installation references enforce package ownership. The ID remains globally unique within the registry.

Keep the fingerprint and its scheme in version history, not repeated in each artifact. Same-version artifacts must pass the history comparison during acceptance. The full file set remains in `artifact_files`. **Approved:** retain the package display name and description from the exact verified manifest with each artifact. These labels can change between releases. The manager can show them even when files are missing or damaged. They are informational metadata, not publisher authentication or permission to load unverified files.

Do not add acceptance timestamps, ZIP-source paths, archive hashes or mutable health flags in this first column set. They are not needed to identify accepted content or locate it. Health must be checked against actual files. Audit logging remains separate future work.

**Approved:** store the integrity-record format version on each artifact, not in package/version history. Different copies of the same accepted release may use different supported record formats. A format change does not permit changed package contents or bypass the history fingerprint check. Repairs still create new artifacts rather than mutate existing acceptance records.

The integrity-record version, fingerprint scheme and storage-layout identifier serve different purposes. They describe record reconstruction, content hashing and physical location respectively. Never substitute one for another. Unknown values must not silently fall back to version 1. The exact unsupported-state error contract belongs to review 4; startup/recovery handling belongs to review 5.

## Approved installation-location approach

**Approved:** derive each directory from the artifact ID and a versioned layout beneath a host-owned root. Do not store an arbitrary absolute path per artifact. The proposed `storage_layout` column carries the layout version; its exact initial identifier remains a proposal.

The application supplies one host-owned artifact-store root for the registry. Derive each location as:

```text
<artifact-store>/v1/<32 lowercase hexadecimal digits of artifact ID>/
```

For example, artifact ID bytes represented by `0123456789abcdef0123456789abcdef` locate a package at:

```text
<artifact-store>/v1/0123456789abcdef0123456789abcdef/
```

Do not persist an arbitrary absolute path for each artifact. The stored layout identifier and artifact ID determine its relative location. The root is application configuration, not a plugin-supplied path. Moving the complete store requires coordinated host handling; changing a root setting is not a repair or proof of file integrity.

This layout gives each repair its own directory. A collision must fail without overwriting an existing directory or record. Published content is immutable. The installer must finish durable publication before requesting acceptance. A crash between publication and acceptance can leave an unaccepted directory; it must not cause automatic acceptance or loading.

This is an on-disk layout, not the public module URL scheme. Deriving a path neither opens it safely nor verifies its contents. Filesystem publication, safe opening, cleanup and external loading remain later integration work.

## Proposed keys and reference constraints

**Approved for installation pointers:** both Rust and SQLite enforce that selected, staged, previous and pending-repair artifacts belong to the installation state's package. Rust provides an understandable validation error. Database constraints also reject mismatched references. Exact SQL remains subject to final schema review. The artifact-component ownership trigger is separately approved below.

Use exact, case-sensitive comparisons for canonical identifiers, component IDs, version strings and accepted paths. Do not trim or normalize values during persistence. Rust validates manifest identifiers, SemVer and package-relative paths before acceptance. SQLite enforces storage types, required values, uniqueness and relationships.

| Table or relationship     | Proposed physical constraint                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages`                | Keep approved integer key and unique generated canonical identity. Reject empty names and empty non-null namespaces. Rust enforces the complete manifest grammar.                                                                   |
| `components`              | Unique `(package_id, local_id)`, foreign key to package, nonempty local ID.                                                                                                                                                         |
| `package_version_history` | Primary key `(package_id, version)`, foreign key to package, nonempty version and fingerprint scheme, exactly 32 BLOB bytes for the fingerprint.                                                                                    |
| `accepted_artifacts`      | ID must have BLOB type and length 16. Composite history reference and unique `(package_id, id)` as described above. Positive integer record version and nonempty layout identifier. Rust recognizes supported versions and layouts. |
| `artifact_files`          | Primary key `(artifact_id, path)`, foreign key to artifact, nonempty path, integer byte length at least zero, exactly 32 BLOB bytes for the digest.                                                                                 |
| `artifact_components`     | Primary key `(artifact_id, component_id)`, foreign keys to artifact and component. A database trigger rejects mismatched package ownership. Keep approved kind, scope and boolean constraints.                                      |
| Installation pointers     | Composite foreign keys `(package_id, pointer)` to `accepted_artifacts(package_id, id)` for each non-null pointer.                                                                                                                   |

**Approved for artifact-component ownership:** keep the existing column set and use a SQLite trigger, rather than adding `package_id` to `artifact_components`. On insertion or an association update, compare the referenced artifact's `package_id` with the referenced component's `package_id` and reject a mismatch. Rust also validates the association for clear errors. Foreign keys still require both parents to exist. Parent package associations must remain immutable; the child trigger alone does not prevent parent reassignment. The service offers no reassignment operation. Final schema review must include enforcement of those parent invariants and the exact trigger SQL.

Use integer type checks for integer data and BLOB type/length checks for IDs and digests. Use SQLite's binary text comparison for exact identity. Do not rely on SQLite coercion as validation. Final SQL syntax and all remaining permission-table references will be reviewed together in review 6.

**Approved:** use restrictive parent deletion rather than automatic cascading deletion for artifact cleanup. Rust explicitly deletes the artifact-owned file, component-metadata and permission-requirement rows, then the artifact, in one transaction. A remaining selected, staged, previous or pending-repair reference blocks deletion. Any overlooked child reference also blocks deletion rather than causing partial cleanup. This operation does not delete physical files or remove stable identities, version history or user decisions as a side effect. Exact permission-declaration cleanup details remain part of review 3.

Accepted artifact metadata and child sets are immutable through the Rust service. Acceptance inserts complete sets; cleanup removes complete sets. No API independently edits a file hash, package association, version or accepted declaration. These rules do not claim protection against an external program that can rewrite the database.

## Proposed installation-state columns and valid shapes

**Approved:** represent an installation awaiting its first selection in `package_installation_state`, not a separate pending-installation table. In this state, selected is null, staged is required, and previous/pending repair are null. An uninstalled package has no installation-state row. Reject all-null rows. This representation does not approve the remaining transition rules below.

Use `package_installation_state` with these columns:

| Column                       | Proposed storage                                         |
| ---------------------------- | -------------------------------------------------------- |
| `package_id`                 | `INTEGER PRIMARY KEY`, referencing `packages(id)`.       |
| `selected_artifact_id`       | Nullable 16-byte artifact BLOB. Abbreviated **S** below. |
| `staged_artifact_id`         | Nullable 16-byte artifact BLOB. Abbreviated **T** below. |
| `previous_artifact_id`       | Nullable 16-byte artifact BLOB. Abbreviated **P** below. |
| `pending_repair_artifact_id` | Nullable 16-byte artifact BLOB. Abbreviated **R** below. |

The letters are only notation for this guide. They are not proposed public API names.

- **Selected:** the accepted copy chosen for the package. It might be damaged or have no active components.
- **Staged:** the copy intended to replace selected at the next eligible startup. It is not loaded merely because it is staged.
- **Previous:** one retained copy offered for explicit restoration. Its files still need verification before use.
- **Pending repair:** a repaired copy of selected that must be kept alongside a different staged version. It is not another selected version.

Permit only these shapes:

| Shape                                            | S        | T        | P        | R                               |
| ------------------------------------------------ | -------- | -------- | -------- | ------------------------------- |
| Uninstalled                                      | No row   | No row   | No row   | No row                          |
| First installation or reinstall awaiting restart | Null     | Required | Null     | Null                            |
| Selected installation                            | Required | Optional | Optional | Optional, under the rules below |

Reject an all-null row. If S is null, T must exist and P/R must be null. T cannot equal S. P cannot equal S. T may equal P only for explicit different-version restoration. A same-version repair uses a fresh artifact, so its T cannot equal P. Do not impose a blanket rule that every pointer must differ.

R requires S and T. R must differ from S, T and P. It must have the same full version and accepted fingerprint as S. T must have a different full version from S when R exists. Repeated repair replaces R only after a reviewed replacement has been accepted; it does not accumulate repair copies in this state row.

Use row checks for nullability and pointer equality. Use same-package composite foreign keys for ownership. Rust transaction logic checks relationships that require reading artifact versions, including R's version and T's different version. Treat invalid persisted relationships as unsafe registry state, not a request to guess a replacement. Concrete recovery handling remains review 5.

## Proposed transition rules

**Approved:** each change checks the operation's expected installation state in the committing transaction. If another operation changed that state, reject the outdated operation without overwriting the newer decision or committing partial changes. The UI refreshes its plan automatically. If the revised action changes what the user would approve, require renewed confirmation rather than silently resubmitting it. The concrete Rust request/error types and comparison mechanism remain review 4. File verification and publication happen outside the short write transaction.

In this table, **X** means a newly accepted target or an already accepted, freshly verified restoration target. A target with unchanged healthy selected contents follows the existing no-op policy; it must not silently clear a staged update.

| Requested action                                        | Result after a successful commit                                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install while uninstalled, with no prior process import | S = X; T/P/R = null. Selection is allowed only after the host establishes the approved no-prior-import condition.                                                                                |
| Install while uninstalled, after prior process import   | S = null; T = X; P/R = null. Wait for restart.                                                                                                                                                   |
| Replace a staged-only installation after review         | T = X; S/P/R remain null. No promotion in the current process.                                                                                                                                   |
| Stage an update with S present                          | T = X; preserve S and P. Preserve R only if X has a different full version from S. Replacing an existing stage requires the reviewed replacement action.                                         |
| Stage repair of S with no staged update                 | T = repaired X; preserve S/P; R = null. X matches S's accepted version and fingerprint.                                                                                                          |
| Repair S and keep a different staged version            | R = repaired X; preserve S/T/P. A later repair can explicitly replace R.                                                                                                                         |
| Repair S and replace the staged update                  | T = repaired X; preserve S/P; R = null. Apply the approved repair preference and any required user review.                                                                                       |
| Stage explicit restoration of P                         | T = P; preserve S/P. Preserve R if present. Restoration is a different-version transition in this initial model.                                                                                 |
| Cancel T with no R                                      | Clear T. Preserve S/P. If S is null, remove the installation row instead.                                                                                                                        |
| Cancel the staged update while keeping pending repair R | Move R to T; clear R; preserve S/P. The repair remains restart-staged.                                                                                                                           |
| Cancel all pending changes                              | Clear T/R; preserve S/P. With no S, remove the installation row. This is distinct from keeping a pending repair.                                                                                 |
| Uninstall                                               | Remove the installation row. Remove native approvals under the approved uninstall policy. Preserve version history, explicit denials and saved enablement choices. Physical cleanup is separate. |

Targets in an update or restoration row have a different full version from S. Same-version replacement is repair and must match accepted contents. If P has the same full version as S, do not offer it as a distinct version restoration. Matching contents can instead be used to prepare an explicit repair in a new artifact directory with a fresh ID. Do not stage the same-version P itself as that repair. Do not use SemVer text order to infer upgrade or downgrade intent.

**Approved:** Cancel update preserves an existing pending repair. Move R to T and clear R; leave S and P unchanged. The repaired copy remains scheduled for the next eligible restart. The UI must explain that the update was canceled but the repair remains scheduled. A separate Cancel all pending changes action clears both T and R without changing S or P. These actions do not authorize immediate loading or physical deletion.

Any operation that would discard R must make that part of the reviewed action. Do not silently drop a pending repair when replacing or canceling another stage. Acceptance of a target and any associated state change happen atomically when performed as one operation. A failed state comparison must not leave a newly accepted target or newly reserved version from that operation.

**Approved:** cancellation of a staged-only installation follows uninstall policy. Remove the installation-state row and native permission approvals. Preserve version history, explicit denials and saved enablement choices. Physical cleanup happens separately when safe. A later installation must satisfy the permission approval rules again. Exact permission-row updates and transaction coordination remain review 3. This proposal does not authorize physical deletion of running or retained package files.

## Proposed startup promotion

Promotion replaces S with T. It does not execute plugin code or issue authority.

**Approved for a normal different-version update without pending repair:** after successful startup checks, select the staged artifact, clear staged and make the old selected artifact previous. This replaces any older previous reference. Removing that reference does not authorize immediate cleanup; retained references and runtime uses still apply. Explicit previous-version restoration follows the approved swap rule below.

**Approved for explicit different-version restoration without pending repair:** stage the previous artifact for restart. After successful startup verification, make it selected, move the old selected artifact to previous and clear staged. This swaps selected and previous; it does not authorize automatic rollback. The retained copy still requires verification and normal activation checks before any later use. Restoration with a pending repair follows the approved preservation rule below.

**Approved for same-version repair:** after successful promotion, select the repaired artifact, clear the staged target and preserve the previous artifact reference. Do not replace previous with the damaged copy being repaired. The damaged artifact is eligible for cleanup only when no retained reference or runtime use still requires it. The other promotion and failure rules below remain proposed unless separately approved.

The host must not promote a stage in a process that has already imported code from that package. For packages previously imported, the restart boundary must create a fresh application process. Merely reopening a window or creating a new frontend host in the same process is insufficient. This makes the approved process-wide import restriction explicit. Cross-platform relaunch and queued-launch handoff remain later integration work.

**Approved when an update has a pending repair:** verify both the staged update and pending repaired copy before changing installation references. If either fails, preserve the references, keep the package stopped and explain the blocker. Do not proceed with the update while silently retaining a failed repair. Successful promotion selects the update, makes the verified repaired copy previous, and clears staged/pending repair. That previous copy still requires verification before any later restoration. **Approved for a change to restoration before restart:** when the user replaces the staged update with explicit different-version restoration, preserve the pending repair. The review must show the restoration target as the future selected copy and the repaired copy as future previous. Verify both before committing promotion. If either fails, keep the package stopped and preserve the references. On success, select the restoration target, make the verified repair previous, and clear staged/pending repair. The repaired copy does not run first. It still requires verification before any later restoration.

At eligible startup:

1. Read the expected installation row.
2. Verify T's actual files against its accepted integrity record. Parse and validate the exact verified manifest and its binding to accepted declarations. Check the host/runtime compatibility needed to select it. Do not run package code during this check.
3. Check the new previous copy according to the table below. For an update or restoration with pending repair, verify R before promoting it as the repaired previous copy. Ordinary previous metadata is not a promise that its files are healthy.
4. In a short transaction, recheck the expected state and the registry relationships. Commit all pointer changes together.
5. Only then evaluate component activation. Missing dependencies, disabled components and missing approvals can block individual components without rewriting the selected artifact. **Approved for outstanding scope review:** selection can proceed after normal package checks, but the changed component and its required dependents remain stopped until review. Unaffected components can activate if their own checks pass. Persist the blocker across restarts and explain it in management UI; selection is not scope acknowledgement.

The initial library does not perform filesystem preflight or track imports. Its eventual internal caller contract must represent those prerequisites without treating arbitrary plugin input as proof. Review 4 will propose that contract.

| State before promotion       | State after promotion                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Staged-only: S = null, T = X | S = X; T/P/R = null.                                                                                              |
| Different-version T, no R    | S = old T; P = old S; T/R = null. This also covers T = old P, so restoration swaps selected and previous.         |
| Different-version T, with R  | S = old T; P = old R; T/R = null. The repaired selected version becomes previous.                                 |
| Same-version repair in T     | S = old T; preserve P; T/R = null. Do not replace a useful previous version with the damaged copy being repaired. |

**Approved for a failed staged startup check:** leave the installation pointers unchanged and report the blocker. Do not load T, automatically cancel the update, run S as a fallback, select P or substitute R for S. Keep the affected package stopped until an explicit recovery action resolves it. Recovery can offer cancellation or repair; any subsequently selected code still requires verification and normal activation checks. Required dependents may also be blocked. This avoids silently executing a version other than the one the user expected. Other packages still undergo their own dependency and activation checks.

**Approved for a failed state comparison:** the outdated operation leaves the current pointers unchanged and reports the conflict. Refresh the plan as described above; do not apply the stale action or select a fallback. This does not undo the newer operation. The exact concurrency/error contract remains review 4.

**Approved:** a crash after the pointer commit but before activation leaves the new S selected for the next startup. Verify it again and apply the normal activation checks. Do not infer successful activation from selection or automatically restore the older version because activation confirmation is missing. The initial model does not add an activation-confirmation marker for automatic rollback. A crash before the commit leaves the prior row intact. Activation-health-based rollback remains a possible future feature requiring separate design approval.

## Worked repair example

Letters here identify distinct artifacts, not versions:

```text
Before repair:
  S = A (1.0.0, damaged)
  T = B (1.1.0, staged update)
  P = C (0.9.0, previous)
  R = null

After accepting repair with “Repair and keep the update”:
  S = A
  T = B
  P = C
  R = D (new copy of accepted 1.0.0 contents)

After successful startup promotion:
  S = B (1.1.0)
  T = null
  P = D (healthy repaired 1.0.0)
  R = null
```

If the user instead cancels the update but keeps the repair, T becomes D and R becomes null. At the next eligible startup, the same-version repair rule selects D and preserves C as previous.

If B fails verification, none of these pointers change and this package does not start. The manager can offer repair or cancellation. It must not automatically execute A, C or D.

## Cleanup boundary and tradeoffs

This proposal keeps acceptance, selection and activation separate. That costs several explicit transition cases. It preserves the selected copy, pending update and repair without overwriting files or losing the user's chosen update.

A removed pointer does not authorize physical deletion. Runtime users, ongoing preparations and other retained references can still need an artifact. Later installer/loader integration must track those uses and coordinate cleanup. An unreferenced artifact record alone is not proof that its directory is safe to delete.

The first registry library provides transactional record operations and invariant checks. It does not delete installation directories, import modules, establish native authority or claim filesystem safety. Production cleanup orchestration remains outside this slice.

## Review checklist

Review the remaining decisions through individual A/B questions. This list groups the topics; it is not a request for approval of the whole document:

1. The accepted-artifact columns, including package labels, record-format metadata and derived versioned storage location.
2. The concrete keys, restrictive deletion and same-package ownership checks.
3. The allowed installation-state shapes and update, repair, cancellation, restoration and uninstall transitions.
4. The startup promotion rules, fresh-process requirement and stop-without-fallback behavior on failed preflight.

Project-registration details are review 2. Permission and scope-review persistence are review 3. Rust contracts, worker mechanics and assembled-schema sign-off follow in reviews 4–6. None of those unresolved details is approved by accepting this proposal.
