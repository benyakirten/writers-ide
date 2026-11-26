# Plugin registry foundation

**Status: owner-approved internal foundation, implemented / unmerged.** This guide records the registry responsibilities and invariants implemented in native Rust. Application installation, loading, native authority and recovery orchestration are not integrated.

The registry stores host-owned plugin installation records, component choices, project registrations and permission decisions. It does not store project documents. Immutable package files stay in separate installation directories.

The [implementation plan](implementation-plan.md#internal-registry-foundation) separates the completed internal slice from remaining Part 4 work. The [implementation review](registry-implementation-review.md) describes the actual Rust operations and their limits. The [schema baseline](registry-schema-review.md) links the authoritative SQL. Owner sign-off covers this internal database/integrity slice, not real publication or application integration.

## Approved package and artifact separation

Separate package identity, version history, accepted installations and their file records:

| Table                        | Responsibility                                                                                                                                                | Retention                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages`                   | Stable local package record with a unique canonical package identity.                                                                                         | Keep while retained history or decisions reference it.                                                  |
| `components`                 | Stable package association and package-local component identity, without version-specific metadata.                                                           | Keep while retained artifacts or user records reference it.                                             |
| `package_version_history`    | Associate one package/version with its accepted file-set fingerprint.                                                                                         | Keep after uninstall and artifact cleanup, until explicit registry reset.                               |
| `accepted_artifacts`         | Identify one accepted installation through an opaque artifact ID, package/version association, integrity-record metadata and immutable installation location. | Keep while that accepted installation is retained.                                                      |
| `artifact_files`             | Store the accepted paths, byte lengths and SHA-256 digests belonging to one artifact.                                                                         | Keep with the owning artifact, not lightweight version history.                                         |
| `package_installation_state` | Hold one package's selected, staged, retained-previous and pending-repair artifact references.                                                                | Remove independently when installation state is removed; retain package identity and its other records. |

A canonical package identity is `name` or `@namespace/name`. The existing manifest parser derives it from validated fields. It identifies a package, not a verified publisher.

Version history enforces the approved rule that a known package/version cannot acquire different accepted contents. Identical file-set fingerprints are not a version conflict. ZIP compression is not part of file-set identity. The shared binary `writers-ide.file-set/1` fingerprint specification is approved below. Full-version identity and database keys are implemented as described below.

An artifact identifies an accepted installation, not merely a version label. Acceptance must not rewrite another artifact's accepted metadata. Multiple artifact records can reference the same version history when their accepted contents match. This supports repair; it does not implement multiple-version loading.

These responsibilities are implemented in the [schema baseline](registry-schema-review.md) and authoritative `schema.sql`.

## Approved local package and component keys

Use `INTEGER PRIMARY KEY AUTOINCREMENT` for database-local package and component IDs. Normal SQLite allocation must not reuse previously committed IDs within that registry. Do not publish a rolled-back allocation as a committed identity.

Wrap package and component keys in distinct internal Rust types. These keys are not manifest names, SDK string identifiers or native credentials. They provide lookup identity, not authority. Preserve canonical-package and package-local-component uniqueness separately.

The keys are local to one registry, not globally unique across independently created databases. Artifact IDs follow the separately approved random-key policy below. Project-opening identities, attachment tickets and credentials retain their separate requirements.

## Approved local project-registration key

Use `INTEGER PRIMARY KEY AUTOINCREMENT` for the persistent local project-registration key. Normal allocation must not reuse previously committed IDs. The key identifies one host-managed registration within this registry, not a globally portable project identity. Keep it separate from temporary live-opening identities and native credentials.

The plugin-facing `ProjectReference.id` is an opaque, registry-namespace-qualified string representation of the registration key. It does not require a separately generated random public ID per project. Authors may compare IDs but must not parse them or depend on a particular encoding. Reopening the same registration preserves its ID; IDs are local to the registry. Exact encoding is an implementation detail. Registration columns are implemented; public string encoding and application reference mapping remain open. Possessing or guessing an ID grants no authority. Validating the approved location and checking host-issued live references remain separate requirements. This decision does not make grants portable between registries.

## Approved complete-registration commit

Create a persistent `project_registrations` row only after location validation and preparation succeed. Save its display name, encoded path, directory identity and location revision together as a complete registration. Keep candidates outside this table; do not add incomplete rows or a persistent setup-pending state in the initial model. Failed or canceled preparation leaves no registration row. Interrupted preparation must be performed again.

A complete registration may become unavailable later and remains retained under the policy below. This decision concerns the registry backing project-specific permissions; it does not decide whether the editor can open an unregistered folder. The first registry library still performs no actual filesystem validation. Its trusted caller contract and later native integration must establish that prerequisite; inserting complete-looking values is not proof of validation.

## Approved retained project display name

Retain a project display name directly in `project_registrations`. Management screens can show the last known name when the directory is unavailable. Do not rely only on deriving a folder name from the stored path.

Treat the saved name as a cache of the project's current display name, not a separate local nickname. The host supplies it during registration. When opening a validated project, refresh the saved label if the host obtains its current name. Use the directory name as a fallback when no project title is available. Preserve the last known name while the directory is unavailable. This does not choose a project-file format or require plugins to read metadata.

The name is a human-readable label, not project identity, a permission key or proof that a location is approved. Name changes must not transfer registrations or recover grants. A separate user-defined local alias is a future candidate, not part of this field. Column constraints are implemented; the real project metadata-source integration remains absent.

## Approved project-path representation

Store the native project location losslessly in a binary column with an explicit encoding identifier. Do not restrict registered locations to paths representable as UTF-8. Rust owns encoding and decoding. The format must preserve native path data; physical columns are implemented, but native encoding identifiers and byte formats remain open.

Human-readable path text is for display, not the authoritative stored location. Never use lossy display conversion to reconstruct the path. Unknown encodings must not be guessed. The native location is not exposed through `ProjectReference`.

This representation requires encoding/decoding code and cross-platform tests. It does not establish directory identity, validate access, resolve aliases or make locations portable between operating systems. Safe native location validation remains a separate integration requirement.

## Approved project-directory identity representation

Store directory-identity information as one versioned binary value in `project_registrations`, separate from the encoded path and location revision. Retain an explicit identity-scheme identifier and the identity bytes. Do not add platform-specific identifier columns to the initial schema. This is one native identity value, not a serialized registration document.

Rust validates and interprets supported identity formats. Unknown formats must not count as a successful identity match. Physical constraints are implemented; native scheme identifiers and byte formats remain open. The path encoding and identity scheme are independent and must not be substituted for each other.

The native mechanisms and their limitations still require platform investigation and testing. Storing an identity does not prove that every replacement can be detected or replace safe filesystem access. This approval selects persistence representation, not a particular operating-system identity mechanism.

## Approved single current project location

Store the current location directly in `project_registrations`, alongside the stable registration key. Keep its encoded path, directory-identity information and `location_revision` in that row. Do not introduce a separate one-to-one location table or location ID in the initial model. The versioned binary directory-identity representation is approved above; columns are implemented, but native formats remain open.

Associate each project registration with one current approved location, not a collection of locations. Explicit reviewed relink replaces that association while preserving the registration key and its saved decisions. The old location no longer identifies the registration for reopening. This does not delete the old directory or authorize access to the new one without validation.

Keep the existing relink requirements: the registration must be closed in every window, Rust must recheck this before committing, and the validated destination must not belong to another registration. Do not merge registrations or their decisions. Native alias and directory-identity validation remains separate; path-byte equality alone does not establish location identity. Multiple approved locations per registration are outside the initial model and would require later design approval.

## Approved project-location revision

Store an incrementing `location_revision` on each project registration. Increment it with every committed relink, in the same transaction as the location association change. A prepared relink request records the revision it reviewed. Rust rechecks that revision before applying the request and rejects an outdated request without overwriting newer state.

The revision detects an intervening relink even if the association changes from X to Y and back to X. Reopening an unchanged registration does not increment it. It is not a credential, a filesystem-change counter or a replacement for native location validation. Storage constraints and typed stale-revision checks are implemented. Native relink orchestration remains absent.

## Approved unavailable-project retention

Keep a project registration when its directory cannot be reached. Report the location as unavailable; do not automatically remove its saved settings, approvals or explicit denials. Temporary absence is not proof that the user wants to forget the project.

Before reusing project-specific approvals after the location returns, validate the approved location and directory identity. A replacement directory at the same path must not inherit old approvals automatically. A moved project can use the approved explicit reviewed relink process. Retaining the registration does not authorize access to an unavailable or unvalidated location. Actual filesystem checks and how availability is represented remain later design/integration work.

## Approved artifact identity

Generate artifact IDs in trusted Rust code as random 128-bit values from a secure randomness source. Store them as 16-byte BLOB primary keys, rejecting null, non-BLOB or incorrectly sized values. Enforce uniqueness and handle collisions without overwriting existing records or installations.

Allocate the ID during preparation, before filesystem publication and database acceptance. Use that identity through the installation lifecycle, without inserting a premature acceptance record or keeping a transaction open during preparation. Allocation alone grants no acceptance, loading authority or permissions.

Keep artifact identity separate from the file-set fingerprint. Identical repair contents have the same content fingerprint but a fresh artifact ID. These IDs are lookup identities, not native credentials. `PreparedArtifact::from_verified` allocates IDs with `getrandom` before publication.

## Approved package identity columns

Use the following `packages` column set:

| Column         | Approved role or type                                              |
| -------------- | ------------------------------------------------------------------ |
| `id`           | `INTEGER PRIMARY KEY AUTOINCREMENT`, a database-local package key. |
| `namespace`    | Nullable `TEXT`; null means an unscoped package.                   |
| `name`         | `TEXT NOT NULL`, validated under the manifest identifier rules.    |
| `canonical_id` | Virtual generated `TEXT`, constrained unique.                      |

Generate `canonical_id` with:

```sql
CASE
    WHEN namespace IS NULL THEN name
    ELSE '@' || namespace || '/' || name
END
```

Namespace and name are the source of identity. Validate both with the existing manifest rules; an empty namespace is not a substitute for null. Canonical identity cannot be written independently or case-folded. Unique canonical values prevent duplicate scoped and unscoped identities despite namespace nullability.

Treat namespace/name as stable identity fields, not mutable display labels. This approves no rename operation that transfers existing history or permissions to another identity. Version, artifact selection and permission state stay in their separate tables. A namespace does not authenticate a publisher or organization.

The generated canonical identity and uniqueness constraints are implemented and covered by native schema/store tests.

## Approved version-history identity

Identify a release by the canonical package identity and complete parsed SemVer value, including prerelease and build metadata. Preserve the full canonical version text without case folding or stripping metadata.

For example, `1.0.0+build.1` and `1.0.0+build.2` have separate history records and may have different accepted fingerprints. Reusing the same complete version with different accepted contents remains prohibited. Prerelease identifiers also remain significant.

Release identity is separate from dependency compatibility. The existing dependency matcher uses SemVer precedence and ignores build metadata, including for exact requirements. This decision does not change matching, introduce automatic version selection or enable multiple active versions.

Do not use SQLite text ordering as semantic version precedence. Use the existing Rust SemVer model for compatibility and ordering decisions. The history column set below is approved. Composite history keys and physical uniqueness constraints are implemented.

## Approved version-history columns

Use the following `package_version_history` column set:

| Column               | Approved role or type                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `package_id`         | `INTEGER NOT NULL`, referencing the stable package key; restrictive foreign key implemented. |
| `version`            | `TEXT NOT NULL`, containing the complete canonical SemVer value.                             |
| `fingerprint_scheme` | `TEXT NOT NULL`, initially `writers-ide.file-set/1`.                                         |
| `fingerprint`        | `BLOB NOT NULL`, constrained to exactly 32 bytes.                                            |

Allow one row per `(package_id, version)`, using exact case-sensitive identity after strict SemVer parsing. Create history only during successful artifact acceptance, in the same transaction as the artifact's other records. Inspecting an unaccepted candidate must not reserve a version.

Existing history requires matching accepted contents. Interpret its digest using the stored scheme; never compare different schemes as interchangeable or overwrite a stored scheme/digest to accept changed contents. Missing or unsupported scheme identifiers must not be treated as version 1.

Keep history after uninstall and artifact cleanup until explicit registry reset. It stores no installation location, per-file records, user preferences or native authority. Accepted artifacts retain `package_id` and complete `version` and reference history through the composite pair `(package_id, version)`. Do not add a separate history-row ID for this relationship. Each artifact keeps its own immutable installation and integrity records. The composite reference and restrictive deletion are implemented.

## Approved restore version-history retention

When restoring an older backup, preserve validated version-history records from both the backup and the current registry, if the current registry can be safely validated. Combine records by canonical package identity and complete version, not database-local integer IDs. Retain newer accepted-content history even when its installation has been removed.

This combines content-history records only. It does not merge current permission approvals or installation selections into the restored configuration. Interpret fingerprint schemes explicitly and detect disagreements rather than silently replace either accepted fingerprint. The initial conflict policy is rejection of the whole restore, as described below.

If current storage is missing or cannot be safely validated, allow explicit recovery from a validated backup. Explain that post-backup version-history records may be unrecoverable and require acknowledgement of that history loss. Do not present it as a normal history-preserving restore or claim that unknown records survived. Preserve any unreadable original for recovery. Apply the existing Secure-mode and inactive-recovered-approval rules.

Trusted Rust code determines whether current storage can be safely validated; this is not a caller-supplied shortcut around conflict checks. Known accepted-content conflicts from a safely validated current registry still reject the initial restore. The private staging helper validates and merges available history without modifying source/current data. It validates pins independently and preserves every safely decoded pin even when another history row, namespace record or allocation counter is missing or malformed. Incomplete evidence requires loss acknowledgement and a fresh namespace. Readable unsupported schema versions, known namespace mismatches and known accepted-content conflicts still reject recovery. Resource-limit failures cannot be bypassed by acknowledging loss. History deleted without surviving evidence cannot be detected or reconstructed; do not claim it was preserved. Loss acknowledgement UI and application recovery remain absent. The internal publisher is implemented behind a qualification gate that refuses all production publication.

### Approved restore allocation-counter retention

When current allocation history can be safely validated, preserve the higher allocation high-water mark from current registry and backup for each `AUTOINCREMENT` identity table: packages, components and project registrations. Account for IDs already present in the restored data. Establish these bounds before assigning new IDs during restoration or normal operation.

For example, if current allocation reached 100 and the backup reached 60, new IDs must be above 100. Preserve allocation metadata without treating matching local IDs across source databases as matching entity identities. This does not merge current choices, approvals or installation selections into the restored configuration.

This preserves the existing normal-allocation non-reuse rule when the necessary evidence is available. If current counters are missing or cannot be safely recovered, do not claim that unknown post-backup allocations were preserved. Use the fresh identity boundary below for that recovery case. Counter validation and canonical history remapping are implemented in restore staging; application reference refresh remains absent.

### Approved identity boundary for unrecoverable counters

If current allocation history cannot be preserved during recovery, give the recovered working registry a fresh persistent identity namespace. Qualify public project identifiers with that namespace and the integer registration key. A repeated numeric key must not imply the same public identity as before recovery.

Keep restored integer keys and their foreign-key associations intact. Public IDs for restored projects change at this recovery boundary; external caches and saved ID-based references need refresh or explicit remapping. Ordinary creation establishes an identity namespace, and ordinary reopening preserves it. The namespace is not a permission credential or proof of publisher identity.

This does not restore native credentials or approvals, revive old live references or replace native location validation. The namespace is a random 16-byte value and internal project identity pairs it with the registration key. Public string encoding and application mapping remain open. Ordinary-restore eligibility is defined below.

### Approved ordinary-restore namespace boundary

When the current registry can be safely validated, ordinary restoration requires the backup to carry the same registry identity namespace. Reject a different namespace in the initial implementation rather than silently import or replace another registry's configuration. A same-namespace restore preserves that namespace and still applies the approved history, allocation-counter, validation and permission safeguards.

Namespace equality is an identity gate, not permission, publisher authentication or proof that every record is valid. Required schema and entity-consistency checks still apply. Cross-registry configuration import or replacement needs separately approved contracts and is outside the initial ordinary-restore scope.

This does not remove the explicit recovery path for missing or unreadable current storage. That path uses a fresh identity namespace when allocation history cannot be preserved, with its approved loss acknowledgement and permission restrictions. Trusted Rust validation determines which path is applicable; callers cannot select the loss-recovery path merely to bypass a known conflict.

### Approved closed-registry restoration

Run restoration as closed-registry maintenance, not alongside a live ordinary service. If a normal service is running, close its operation admission, finish admitted writes and close the old store before preparing the replacement. Under the approved production direction, the dedicated lifecycle thread remains alive to run restoration and reopening. Stopping the old service does not mean terminating that thread. The restoration coordinator retains exclusive registry ownership throughout draining, validation, restoration and reopening; do not allow another ordinary opener into that interval.

After successful restoration and startup checks, open a fresh ready service with new operation handles. Old service handles do not revive. Application integration still follows the approved plugin-free recovery, native-authority cleanup and process-wide import/restart rules. Closing the ordinary registry service alone does not make previously imported plugin code safe to reload.

**Approved shutdown interaction; implemented in the internal core:** shutdown or owner drop immediately blocks new admission and ready-handle acquisition. An admitted maintenance attempt still finishes and records its outcome, then proceeds directly to cleanup. Do not expose a fresh service or wait for interactive recovery once shutdown is requested. Keep the location lock through cleanup. Abandoning the shutdown waiter does not cancel cleanup or reverse shutdown. See the [reviewed shutdown rule](registry-implementation-review.md#review-outcome-and-approved-shutdown-rule).

Shared lifecycle ownership, admission, revision checks and shutdown are implemented internally. Maintenance request constructors remain test-only, and the fixture transitions do not add live restoration. Production restore/publication adapters and restart integration remain under review. There is no management IPC. See the [implemented internal contract](registry-implementation-review.md#consolidated-rust-contract).

### Approved staged restore preparation

The private helper is implemented and tested with real files. It performs bounded full backup/result validation, merges validated history/counters and quarantines approvals in a new destination. It does not publish a generation or coordinate application recovery.

Build the restored registry at a separate host-owned staging location using SQLite-aware copying. Apply required migrations, validated history/counter preservation, Secure mode, recovered-approval separation and any required identity-namespace change there. Validate the prepared result before publishing it as the current registry.

Do not modify the current destination during preparation or alter the source backup. Preserve any unreadable original under the recovery policy. A preparation failure must not partially apply settings or installations to the current registry. Staging requires additional temporary disk space; it does not require holding the entire database in memory.

The generation-directory layout below is approved. Generation-bound SQLite checkpointing, checked close and closed-file synchronization are implemented. Production publication and application crash recovery remain separately gated. A database-file rename alone is not an approved WAL-safe publication protocol. Normal startup checks still apply before returning a ready service. Restore staging is implemented. The approved production-format codec, consuming publisher and Linux/macOS candidates are implemented behind qualification preflight. Preflight refuses all runtime publication because no platform is qualified. Test-only adapters exercise selector changes; no application publication is enabled.

### Approved registry generation layout

Keep each physical registry generation in its own directory under a host-owned registry root. A small active-generation metadata file identifies the selected directory; it is not a symlink. Store a generation identifier rather than an arbitrary filesystem path and resolve it within the owned layout.

Prepare restoration in a new generation directory. After validation and required durability steps, publish it by changing the active-generation metadata. Each database keeps its SQLite sidecars in its own directory. Preserve the previous directory under the recovery policy rather than mix its files with the replacement.

A physical generation is not the logical registry identity namespace. A same-registry restore can change physical generation without changing public project IDs. The active generation remains a normally writable SQLite database, not an immutable snapshot.

The owner approved a fixed-size, versioned binary selector record. It contains a format identifier/version, a randomly generated 128-bit physical generation ID and a SHA-256 checksum of the preceding fields. Require exact record length and reject unknown versions, malformed records and checksum mismatches. Resolve the ID within the owned layout; it is not an arbitrary path. The checksum detects damaged metadata, not authenticity or durability. Missing or invalid metadata still requires recovery without generation guessing. The [production publisher contract](registry-publication-investigation.md#approved-production-publisher-contract) is implemented internally behind the qualification gate. It specifies the exact 64-byte version-1 encoding, `active` selector, ID-derived directory layout, compatibility checks, consuming ownership and publication/failure sequence. The [platform/storage policy](registry-publication-investigation.md#approved-platform-and-storage-contract) is also approved. It permits implementation and qualification work, not enablement based on CI alone. Both design checkpoints are complete; each platform must still pass the policy's qualification gates. The [publication investigation](registry-publication-investigation.md) describes the authorized compiled test harness and separates it from earlier disposable Python/APFS evidence. Its private 61-byte checksummed selector is a fixture, not a public format or authentication. The probe's separate fixture lease spans first-run detection, draining and generation changes in tests. A shared runtime location lease now protects `Registry::open_owned` and lifecycle cleanup. It does not select a generation, initialize missing storage or wire application startup. Windows directory synchronization explicitly returns `Unsupported`; integrated tests stop before selector creation and return no session. Separate raw Windows move tests do not establish directory durability. Windows power-loss publication guarantees remain unresolved; no weaker success criterion is approved. Initial generation retention is defined below. No native production publication or plugin-facing filesystem API is enabled.

### Approved temporary Windows publication boundary

Shared production ownership and checked sealing may advance while Windows generation publication stays blocked. The owner explicitly requires later Windows research. This is not permanent platform exclusion or approval of a weaker success criterion. Windows initialization/restoration that needs generation publication remains gated, and cross-platform plugin management is not complete without resolving that work. Track it as a required Part 4 completion gate, not optional deferred work. See the [research scope and boundary](registry-publication-investigation.md#approved-next-direction-and-required-windows-research). The [single-coordinator ownership boundary](registry-implementation-review.md#approved-production-ownership-boundary) is approved. The coordinator retains the location lock across opening, operation, maintenance and reopening. Workers share retention before startup waits through actual cleanup. The reviewed shared core is implemented. Production maintenance request constructors and application startup wiring remain absent. The selector and consuming publisher exist internally, but runtime preflight always refuses; only test adapters can exercise native selection. Its fixture transitions do not complete cross-platform plugin management.

### Approved missing or invalid generation metadata

If the active-generation metadata is missing or invalid, stop normal opening and enter plugin-free recovery. Return no usable registry handle. Preserve the metadata and generation directories for recovery.

Do not choose a generation by timestamp, directory name or database validity. A valid database may have been prepared but never published. Do not automatically initialize a replacement registry. Fresh creation remains a separate operation under the first-time setup policy below. The new first-root claim checks qualification before exclusive creation; it currently refuses without creating the root. Test-only claim proofs do not enable runtime initialization.

### Approved uncertain publication outcome

If the host cannot confirm that an attempted active-generation switch is durable, report `OutcomeUnknown`. Stop restoration and require controlled plugin-free recovery before normal use resumes. Return no usable service handle and preserve both generations.

Do not automatically retry the switch or switch back. Either operation could introduce another uncertain change. Recovery must reopen through the controlled path and validate the selected registry before returning a ready service. The exact publication protocol remains under review.

### Approved initial generation retention

The first version does not automatically delete old registry generations after restoration. Preserve them until deliberate maintenance removes them. An unselected directory alone is not evidence that deletion is safe. Exact maintenance eligibility and deletion procedures require separate review.

This retains old SQLite databases and their associated files, not additional copies of plugin packages. Disk usage can grow after repeated restores. Automatic retention limits are deferred. Retention does not authorize reopening an old generation as active or restoring its approvals outside the approved recovery rules.

### Initial conflict rejection and future recovery UI

For a known accepted-content conflict between the same canonical package and complete version, reject the initial restore operation as a whole. Report the conflicting package/version. Do not replace the current registry, modify the source backup, silently choose a fingerprint or partially apply settings and installation changes.

**Approved long-term direction, deferred:** provide a user-controlled choice between strict rejection and an interactive recovery UI where the user can choose recovery actions or data. Do not implement that setting or selective-recovery workflow in the initial foundation. The setting's scope/default and the exact allowed actions still require design approval.

The future UI must explain the resulting plan and require appropriate confirmation. It does not implicitly authorize overwriting a known fingerprint, restoring native authority or bypassing explicit history-reset safeguards. Any new reset/reconciliation semantics require separate approval. Source preservation, permission review and integrity checks remain required.

## Approved integrity-record storage

**Registry persistence preference:** use relational columns and tables. Use JSON only as a last resort, with a specific justification and design approval.

Store the full accepted file set in `artifact_files`, not a JSON value on `accepted_artifacts`. Each file record belongs to an artifact and contains its accepted path, byte length and SHA-256 digest. Preserve the integrity record's format version on each accepted artifact as `integrity_record_version`, not in package/version history. Different copies of the same release can use different supported record formats without changing accepted content identity. Repairs still require matching accepted contents and a fresh artifact. The per-file column set and digest encoding below are approved. Identity-reference types and physical constraints are implemented.

Insert the artifact and its complete file set atomically. Do not expose partially accepted file sets or offer independent mutation of accepted file records. An existing artifact's acceptance remains immutable; repair creates a new artifact.

When loading an artifact, reconstruct the integrity record through bounded reads and validate it in Rust. Database constraints complement validation; they do not replace path, digest, format-version or resource-limit checks.

## Approved artifact-file columns

Use the following `artifact_files` column set:

| Column        | Approved role or type                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| `artifact_id` | `BLOB NOT NULL`, referencing the artifact's 16-byte key; restrictive foreign key implemented. |
| `path`        | `TEXT NOT NULL`, preserving the exact accepted package-relative path.                         |
| `byte_length` | `INTEGER NOT NULL`, constrained to nonnegative values.                                        |
| `sha256`      | `BLOB NOT NULL`, constrained to exactly 32 bytes of binary SHA-256 digest data.               |

Allow one row per `(artifact_id, path)`. Do not trim or case-fold accepted paths during persistence. Reject byte lengths that cannot be represented rather than truncating or wrapping them. Rust still validates the paths, lengths, digests and resource budgets.

The digest constraint must reject non-BLOB values as well as incorrect lengths. The implemented predicate is `typeof(sha256) = 'blob' AND length(sha256) = 32`. Developers can inspect the digest using SQLite's `hex(sha256)`.

The existing integrity module represents per-file digests as lowercase hexadecimal strings. Convert losslessly at its entry boundary where needed. Binary persistence does not change SHA-256, accepted contents or verification strength. The complete file set remains immutable and is inserted atomically with its artifact.

This decision selects per-file digest encoding. The whole-file-set fingerprint uses the separately approved version-1 specification below.

## Approved shared file-set fingerprint

The scheme identifier is `writers-ide.file-set/1`. Compute SHA-256 over the following concatenated bytes:

```text
UTF-8 bytes of "writers-ide.file-set/1", followed by one zero byte
Unsigned 64-bit file count, big-endian

For each file, ordered by its exact UTF-8 path bytes:
    Unsigned 64-bit UTF-8 path byte count, big-endian
    Exact UTF-8 path bytes
    Unsigned 64-bit file byte length, big-endian
    Raw 32-byte SHA-256 file digest
```

Each integer occupies eight bytes with the most significant byte first. Path lengths count UTF-8 bytes, not characters. Include the complete accepted file set, including `manifest.toml`. Validate entries and reject duplicate paths before hashing. Do not trim, case-fold or Unicode-normalize paths.

Do not include ZIP compression, file timestamps, installation paths, artifact IDs, user settings or integrity-record storage layout. Persist the scheme identifier and resulting 32-byte digest together. Freeze this definition; incompatible encoding changes require a different scheme identifier.

Use one shared helper for verified-package/snapshot content identity and registry version history. Persist the scheme identifier alongside the digest so its interpretation remains explicit. Do not make fingerprints depend on JSON serialization or integrity-record storage layout. A new immutable repair installation with identical accepted contents retains the same content fingerprint, while its artifact identity remains separate.

The shared implementation uses this binary encoding for integrity-record, verified-package and snapshot fingerprints. Individual file SHA-256 hashes and integrity-record JSON encoding are unchanged. Fixed vectors and integrity/resource regression tests cover the calculation. A fingerprint grants no authority and authenticates no publisher.

The binary calculation is implemented in [`plugin_integrity/mod.rs`](../../src-tauri/src/plugin_integrity/mod.rs). `IntegrityRecord::fingerprint()` and verified-package fingerprint construction use the same helper.

### Reference vectors

These are fingerprint-format vectors, not complete installable packages. The digests are shown in hexadecimal for inspection; persistence stores the binary value. The `abc` content is exactly three bytes with no trailing newline.

| File set                 | Encoded input length | Fingerprint                                                        |
| ------------------------ | -------------------- | ------------------------------------------------------------------ |
| Empty file set           | 31 bytes             | `bb1fce0a61739db749f572861750a86908166d0f948676669e1b5eca47a0807d` |
| `a.txt` containing `abc` | 84 bytes             | `616f6edea51ec2663dc8e6377974436346b235cbc28cf46729ce00134065d0b0` |

Rust tests reproduce these independently calculated vectors. Input enumeration order does not change a fingerprint.

## Approved integrity-module boundary

The integrity module implements `IntegrityRecord::from_entries(version, entries, limits)`. It constructs a record from a fallible entry iterator, enforces limits incrementally and rejects duplicate or invalid paths. `entries()` returns an exact-size iterator of owned metadata copies, so changing an item cannot mutate the record. `format_version()` and `fingerprint()` expose validated metadata. Trusted native preparation uses `VerifiedPackage::integrity_record(limits)` to derive the record from retained verified buffers, not reopened source files.

The registry translates SQL rows to and from these entries. The integrity module remains responsible for interpreting and validating records. It must not depend on SQLite or `rusqlite`.

Use fixed-size binary SHA-256 digests (`[u8; 32]`) at the new constructor and read-only iteration boundary. Entries also carry the accepted path and byte length. The integrity module owns any conversion to its existing internal hexadecimal representation. This does not change the existing JSON record format or require an internal storage rewrite. The registry must reject malformed database digest values rather than truncate or pad them into this type. The implemented entry has an owned `String` path, `u64` byte length and `[u8; 32]` digest.

Allow the constructor to consume a fallible iterator whose items are `Result<IntegrityEntry, E>`. Read and validate entries incrementally. Stop on a source-reading error or an integrity-validation failure, preserving the distinction between those cases. The source error type is generic, so the integrity module does not depend on the registry or SQLite. The registry need not build a second complete entry collection before construction. Ordinary collections can be adapted into successful items.

Use a generic error result that preserves the source's concrete type:

```rust
enum IntegrityBuildError<E> {
    Source(E),
    InvalidRecord(IntegrityError),
}
```

The constructor returns `Result<IntegrityRecord, IntegrityBuildError<E>>`. Preserve the original source error in `Source(E)` rather than requiring a boxed trait object. The registry translates these failures into its own domain error; the integrity module does not return or depend on `RegistryError`. The implemented constructor takes `IntoIterator<Item = Result<IntegrityEntry, E>>`; the registry owns domain-error translation.

A structurally valid record is not proof of trusted acceptance and does not verify package bytes. Acceptance and byte verification retain their separate boundaries. These entry operations are internal Rust APIs, not plugin-facing SDK exports.

The lightweight version history retains its fingerprint after artifact cleanup. It does not retain the detailed file rows. This choice selects registry persistence, not a new plugin transport format or a rewrite of existing integrity serialization helpers.

## Approved artifact-linked declarations

Persist the registry-relevant component metadata and native permission requirements as normalized, immutable rows linked to the accepted artifact. The retained fields include component names, activation scopes, initial enablement defaults and package/component permission requirements referencing the shared native permission catalog. This does not approve mirroring every manifest field. The component-metadata column set and permission-declaration tables below are approved. Reference types and physical constraints are implemented.

Derive these rows from the exact verified manifest. Record them atomically with the artifact and its full integrity file set. Acceptance must prevent a declaration set from being associated with different manifest bytes. The owned prepared-bundle input and matching typed publication-receipt requirement described below are approved. Fields and receipt matching are implemented; the receipt constructor is test-only until a durable publisher exists.

User enablement choices and permission decisions stay separate and belong to stable package/component identities. Artifact-linked declarations describe a version's requirements, not the user's consent or the component's current availability. Their retention follows the artifact, not retained permission denials.

The manager can inspect accepted declarations even if installation files later become missing or damaged. Only validated registry state may supply those records. Cached declarations never authorize loading unverified files or bypass runtime permission checks. No plugin code is executed to read them.

## Approved artifact-component columns

Use `artifact_components` for accepted, version-specific component metadata:

| Column             | Approved role or type                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `artifact_id`      | `BLOB NOT NULL`, referencing the artifact's 16-byte key; restrictive foreign key implemented.           |
| `component_id`     | `INTEGER NOT NULL`, referencing the stable component key; restrictive foreign key implemented.          |
| `display_name`     | `TEXT NOT NULL`, retaining the accepted human-readable name.                                            |
| `description`      | `TEXT NOT NULL`, retaining the accepted description.                                                    |
| `kind`             | Constrained `TEXT NOT NULL`; initially only `frontend`.                                                 |
| `activation_scope` | Constrained `TEXT NOT NULL`: `project` or `application`.                                                |
| `default_enabled`  | `INTEGER NOT NULL`, constrained to `0` or `1`; the author's initial suggestion, not current enablement. |

Allow one declaration per `(artifact_id, component_id)`. Require the artifact and stable component to belong to the same package. Enforce this in Rust and with a SQLite trigger on child insertion or association update. Keep the existing columns rather than adding `package_id` to this table. Parent package associations remain immutable; the trigger does not by itself prevent parent reassignment. The schema implements those parent invariants, trigger SQL and foreign keys. Accept these immutable rows atomically with the artifact, file records and permission declarations.

File hashes belong to `artifact_files`, not this table. The artifact association binds component metadata to the exact verified manifest described by those file records. Keep current enablement and permission decisions in their separate tables.

This initial column set does not mirror entry paths, styles, runtime profiles, provider contracts, commands or dependencies. Loader/runtime integration must still validate those declarations from verified package data. These metadata rows alone do not establish runtime compatibility or dependency availability. Backend execution remains deferred.

## Approved stable component identity

Use a `components` table to represent stable package/component identities. Artifact-linked declarations, user enablement choices and permission decisions reference these identities. Keep a component identity while retained artifacts or user records require it, including denials that survive uninstall.

Names, activation scopes, requirements and manifest defaults belong to artifact-linked declarations, not the stable component row. The existence of a component row does not mean installed, available, enabled or authorized. The column set and restrictive foreign keys are implemented.

Natural composite keys remain a valid relational design. Repeating a package/component key in related tables is not itself denormalization. The reason for a stable parent row is its independent lifetime and the common foreign-key target it provides. Use the approved integer surrogate keys for references while retaining natural identity uniqueness.

## Approved component identity columns

Use the following `components` column set:

| Column       | Approved role or type                                                  |
| ------------ | ---------------------------------------------------------------------- |
| `id`         | `INTEGER PRIMARY KEY AUTOINCREMENT`, the database-local component key. |
| `package_id` | `INTEGER NOT NULL`, referencing `packages(id)`.                        |
| `local_id`   | `TEXT NOT NULL`, preserving the manifest's package-local component ID. |

Require uniqueness of `(package_id, local_id)`. Validate the local ID with the existing manifest component-ID rules and compare exact values. Treat package association and local ID as stable identity fields. Do not rename or move a row in place and thereby transfer its retained choices or permissions.

Keep display names, descriptions, activation scopes and defaults in `artifact_components`. A publisher may change a display name in a new artifact without changing `local_id`. Retain identity while accepted declarations or user records reference it. Restrictive foreign keys and physical constraints are implemented.

## Approved host-settings storage

Store application-wide registry settings in one required `host_settings` row with explicit typed columns. The initial logical fields are `permission_mode` and `repair_conflict_policy`. Constrain each to its recognized values. The owner approved limiting this foundation's settings to these two fields. Additional settings use typed migrations in their Part 4 feature-integration slices, not generic JSON or key/value storage.

Command resource settings require persistence, loading into the dispatcher, change distribution and a settings menu before the external command/runtime and settings integration slice is complete. The blocked-activation preference requires persistence, activation-lifecycle wiring and a management toggle before plugin lifecycle/management integration is complete. Both are required before Part 4 is complete. The internal registry foundation can finish without them; the corresponding feature slices cannot. This does not cancel approved preference semantics or choose numerical defaults.

Use the already approved defaults on fresh initialization: Secure mode and Repair and keep the update. Preserve saved choices on ordinary startup. After successful initialization/migration, a missing required settings row is an invalid registry state, not permission to silently regenerate defaults. Restore still follows its separate rule of selecting Secure mode and leaving recovered approvals inactive.

Rust methods remain typed. This table is host configuration, not plugin-owned settings storage or a direct plugin database API. The required singleton and constrained setting encodings are implemented.

## Approved native permission catalog

Use a host-owned `native_permissions` table for recognized operation/resource pairs. Use `(operation, resource)` as its composite key, without a separate integer permission ID. Artifact requirements, approvals and denials store both values and reference the catalog through composite foreign keys. Preserve exact validated text values. Catalog SQL and constraints are implemented; no predecessor schema migration is registered.

The initial vocabulary is `project.files.list` with `project`, `project.files.read` with `project`, and `external.open` with `http-https`. Application initialization and migrations maintain the catalog. A plugin cannot add entries or register an arbitrary native operation through its manifest. Unsupported declarations are rejected rather than inserted automatically.

Catalog membership is neither a grant nor evidence that a service instance is available. Rust must recognize, implement and enforce each operation independently of table contents. Adding a new capability requires approved semantics, native implementation, manifest/SDK support and catalog maintenance; inserting a row alone enables nothing.

This catalog describes the initial host-native service model. It is not the provider API/command registry, and it does not design executable backend components or their future permission model.

## Approved permission-declaration tables

Preserve the package and component declaration levels in separate tables:

| Table                            | Associations                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `artifact_package_permissions`   | Accepted artifact and a permission from `native_permissions`.                                     |
| `artifact_component_permissions` | Accepted artifact, its accepted component declaration and a permission from `native_permissions`. |

A component-level requirement must belong to a component declared by that artifact, not merely any stable component identity. Keep these declarations immutable and accept them atomically with the artifact's other records.

Compute effective requirements as the deduplicated union of package and component declarations. Reject duplicates within a declaration level. The same permission at package and component levels is valid and remains one effective requirement. The existing Rust manifest model already defines this union.

This preserves declaration origin for review without repeating common requirements for every component. It does not create package-wide consent: approvals still cover explicitly reviewed components. Current activation-scope restrictions remain unchanged. Keys, column types and foreign keys are implemented.

## Approved permission tables

Use separate `permission_approvals` and `permission_denials` tables. Both associate a stable component, a permission from `native_permissions`, and project-specific or application-wide coverage. Project-specific decisions reference a host-managed local project registration, not a live opening or project-supplied ID.

Both tables store an explicit `coverage_scope` and nullable `project_registration_id`. Constrain coverage to `application` or `project`. A database check requires a non-null project reference for project coverage and null for application coverage. Non-null references target the persistent local project registration, not an opening. Reject invalid combinations rather than inferring application-wide coverage from missing data. This describes permission coverage, not component activation scope.

Approval rows have a `source` identifying explicit or automatic approval. Denials are always explicit, so their table needs neither a source column nor an effect discriminator. Table membership identifies approval versus denial.

An approval and a matching denial may coexist. Effective-access evaluation applies denial precedence; adding a denial must not implicitly erase an approval. Clearing the denial follows the approved review and durable-save rules. Uninstall removes approvals and preserves denials.

Keep at most one approval per stable component, operation/resource pair and coverage scope. For project coverage, the project registration is part of that identity. When reviewed explicit approval replaces automatic approval for the same identity, update the existing row's source to explicit after durable save. Automatic processing must never downgrade explicit approval. Decisions at other scopes are unchanged, and matching denials retain precedence unless separately cleared through review.

Use two filtered (partial) unique indexes in each permission-decision table. For application coverage, require uniqueness by component and permission. For project coverage, require uniqueness by component, permission and project registration. Do not substitute a reserved project-key value for null. Apply these rules independently to approvals and denials so a matching approval and denial can coexist. Permission references use the approved operation/resource pair, so permission identity in these indexes includes both fields. The SQL is implemented.

Identify a permission decision by its table (approval or denial), stable component, operation/resource pair, coverage scope and project registration when project-specific. Do not add a separate persistent decision ID. SQLite internal row IDs are not part of the service contract. Management operations still require caller validation and reviewed-state checks; knowledge of a decision's identity grants no authority.

The row represents current approval, not its history. When logging is added, record automatic-to-explicit promotion as an audit event. Logging remains deferred; event fields, storage and retention are not selected by this decision.

This separation reflects different fields and lifetimes, not an established performance advantage. The coverage column names and valid combinations above are approved. The filtered uniqueness strategy above is approved. The logical decision key above is approved. Physical constraints, indexes and typed keys are implemented in the schema baseline.

## Approved recovered-approval separation

Restoration selects Secure mode and places recovered approval decisions in a separate review table, `recovered_permission_approvals`. Do not populate effective `permission_approvals` from those recovered decisions. Prepare this separation before the restored registry becomes ready.

Recovered records are information for review and never provide permission coverage themselves. Explicit review creates a current approval through the normal approval path and its validation rules. Deliberately enabling Trust mode can create new automatic approvals through the normal current-approval path. It must not silently revive historical explicit consent as current explicit approval. Matching explicit denials still take precedence.

Enabling Trust mode after restoration does not discard recovered review records. Keep them inactive and available for later explicit review while new automatic approvals follow the ordinary Trust-mode rules. Returning to Secure mode removes automatic coverage under existing policy; it does not make recovered consent effective. Recovered records follow the existing approval-removal boundaries. At version selection, remove records for dropped effective requirements or components removed from the package. At uninstall, remove the package's recovered records. Commit cleanup with the corresponding selection/uninstall changes. Preserve unrelated recovered records, explicit denials and saved enablement choices. Staging, temporary disablement and mode changes alone do not remove recovered records. Reintroduced requirements follow normal approval rules, not recovery of deleted candidates.

Keep one recovered review row per component, operation/resource pair and coverage, including project registration for project coverage. Record two source facts: `had_explicit_approval` and `had_automatic_approval`. Combine matching facts when restoring, so both flags can be true. Require at least one source flag. The flags describe information present in the restored data, not which source was latest or a new approval. They never provide coverage.

The current `permission_approvals` table retains its existing single `source` field. The recovered flags do not change automatic-to-explicit promotion or denial precedence. Physical columns, constraints and restore normalization are implemented.

Keep recovered review data distinct from current approvals in queries and pure permission evaluation. This is a persistence boundary, not a new native permission or plugin API. Schema/index definitions and private restore staging are implemented. Native generation publication remains disabled behind qualification preflight, and native authorization remains absent.

### Approved recovered-candidate consumption

When explicit review of a recovered candidate succeeds, save the current permission decision and remove the matching candidate in one transaction. Match its exact stable component, operation/resource pair, coverage scope and project registration for project coverage. Reviewing one project does not consume another project's candidate or an application-wide candidate. A failed save preserves the candidate.

Automatic Trust-mode processing alone does not consume recovered candidates. Preserve the existing denial-precedence and explicit denial-clearing rules; candidate consumption does not itself clear a denial. Audit logging remains separate future work.

## Approved dropped-requirement cleanup

When a new version becomes selected, remove a continuing component's approvals for permissions it no longer effectively requires. Apply this to project-specific and application-wide approvals, whether explicit or automatic. Do not remove them merely because an update is staged. Commit cleanup with the selection change so the saved state is coherent.

Compare the deduplicated union of package and component requirements. Preserve approvals when a permission remains required through either declaration level. Preserve explicit denials and unrelated components' decisions. If a later update or explicit restoration requires the removed permission again, normal approval rules apply; retaining an older artifact does not preserve those removed approvals.

If the newly selected version removes a component entirely, remove all of that component's native approvals at selection, not staging. Preserve its stable identity, explicit denials, application-level enablement choice and project overrides. A later version or explicit restoration that brings it back reuses saved enablement choices but must satisfy normal native approval rules again. Keep unrelated components' decisions unchanged. Commit removed-component cleanup with the selection change. Typed cleanup transactions are implemented.

## Approved enablement tables

Use two tables for saved choices:

| Table                           | Responsibility                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `component_enablement_defaults` | One application-level enabled/disabled choice per configured stable component. |
| `project_component_overrides`   | An explicit enabled/disabled override for a component in a registered project. |

No project-override row means Inherit. Choosing Inherit removes the override. The application-level choice is saved configuration, not a live reference to the latest manifest default. Existing first-configuration rules determine its initial value.

Project overrides apply only to project-scoped components. The Rust service validates the applicable accepted declaration; a stable identity alone contains no activation scope. Keys, column types and constraints are implemented. Scope changes follow the review and applicability rules below. Outstanding scope blockers are derived from the selected declaration and reviewed baseline.

## Approved activation-scope changes

An update may change a component's activation scope without changing its stable component ID. Require explicit review of the new lifetime and enablement effects before the changed component activates. This can be part of the normal update review rather than a separate prompt. Updates remain restart-staged; do not retarget an existing activation.

An outstanding scope review blocks the changed component's activation, not selection of the entire package. After normal package checks, the update can become selected and unaffected components can activate if their own checks pass. Keep the changed component and its required dependents stopped, and explain the outstanding review in management UI. Derive the blocker from the selected declaration and saved reviewed baseline. For an installed component, a missing baseline requires initial review; a different selected scope requires scope-change review. A matching scope has no scope-review blocker. Do not store a separate mutable blocked flag. This calculation survives restart through the underlying saved facts. Selecting a release is not scope acknowledgement. Physical constraints are implemented.

A newer update may become selected while scope review is still outstanding. Replace the pending review target with the newly selected release and evaluate its scope against the component's last reviewed scope. Do not treat the earlier unreviewed selected scope as the baseline. If the new target still needs scope review, keep the component blocked until that target is reviewed. Unaffected components still undergo their own update and activation checks. Baseline and pending-target storage are implemented.

If the newly selected release returns to the last reviewed scope before the unreviewed scope ever activates, clear the scope-review blocker without another acknowledgement. The manager may explain that the pending scope change no longer applies. Do not automatically enable the component or bypass normal dependency, native-permission and other activation checks. Resolving this blocker does not clear unrelated blockers.

Preserve saved choices, but use only those applicable to the new scope. Keep project overrides stored and inactive while the component is application-scoped. Do not reinterpret project-specific native approvals as application-wide approvals. Current permission requirements and native service-ownership rules still apply.

Bind a scope-change review to the stable component, old scope, new scope and exact accepted target package/version. Version history binds that release to its accepted contents. A fresh repair artifact of the same accepted release can use that review because its contents match. The review does not approve a different release merely because it declares the same scope.

Require review for each new scope change, even if the component, old/new scopes and target release match a previously completed transition. The earlier review is not permanent approval of future repeats. Include the lifetime effects in the current update/restoration confirmation where possible, rather than requiring another dialog. Ordinary restarts and matching repairs that preserve the current scope do not require renewed scope review.

Advance the last-reviewed-scope baseline once both the matching accepted target release is selected and its scope review is durably saved. If review happens after selection, advance the baseline when saving that review. Reviewing a staged target alone does not change the baseline for the currently selected release. Do not wait for successful activation: disablement, missing native approvals or an activation failure do not undo completed scope review. Baseline advancement grants no authority and bypasses no activation check.

Retain the last reviewed scope with the stable component identity across uninstall. Discard pending transition acknowledgements associated with the removed installation. On reinstall, compare the declared scope with the retained baseline and require review of a different scope before activation. Retaining the baseline is not approval of a future transition and restores no native permissions.

Store the baseline in a separate `component_scope_state` table, with at most one row per stable component. Its logical fields are `component_id`, `last_reviewed_scope` and `scope_revision`. Keep `components` focused on stable identity and `artifact_components` on the release's declared scope. Pending transition acknowledgements remain separate from the baseline. The existence of a component identity does not establish a reviewed scope. Establish the first baseline through normal installation or enablement review. Show whether the component runs per project or per window. Save the baseline only after the initial scope is acknowledged and the matching release is selected. The review can share an existing confirmation screen; it need not be a separate popup. A component without that acknowledgement remains blocked from activation. This is distinct from native permission acknowledgement; components with no native requirements gain no native-permission prompt. Column constraints are implemented.

Do not create a placeholder `component_scope_state` row for a never-reviewed component. Every baseline row contains an established reviewed scope and its revision. Absence of a row means initial scope acknowledgement is still required before activation. A saved acknowledgement for a staged first installation remains in the separate pending record until the matching release is selected; it is not yet a baseline.

Store an incrementing `scope_revision` alongside the reviewed baseline. Advance it whenever that baseline changes. Prepared reviews and staged acknowledgements record the baseline revision they reviewed. Rust rejects an acknowledgement based on an older revision, even if the scope changed away and back to the same value. Ordinary restarts and repairs that preserve the baseline do not increment it. The revision identifies baseline state, not authority or plugin execution. Revisions start at 1, reject exhaustion and use typed expected-state checks.

Retain at most one pending scope acknowledgement per component. It records a completed review for a target transition not yet applied, unlike an outstanding review the user has not completed. Bind it to the target release and reviewed baseline revision. Replacing the target with a different release invalidates the old acknowledgement; the new target needs its own review if its scope requires one. A matching repair of the same accepted release may retain the acknowledgement. This is current transition state, not a history of reviewed candidate versions.

Use one `component_scope_acknowledgements` table for both initial and scope-change acknowledgements:

| Column                    | Approved role                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `component_id`            | Integer primary key; permits at most one pending acknowledgement per stable component.            |
| `package_id`              | Integer package association used in the component and target-release foreign keys.                |
| `target_version`          | Complete accepted target version, referenced with `package_id` to version history.                |
| `review_kind`             | Explicit `initial` or `scope-change`.                                                             |
| `previous_scope`          | Null for initial review; otherwise the reviewed `project` or `application` baseline.              |
| `expected_scope_revision` | Null for initial review; otherwise a positive integer identifying the reviewed baseline revision. |
| `target_scope`            | Required `project` or `application` scope acknowledged for the target release.                    |

Database checks require both source fields to be null for initial review. For scope changes, require both to be present, a positive revision and different source/target scopes. Use a composite foreign key from `(package_id, component_id)` to `components(package_id, id)`, with supporting uniqueness on that parent pair. Use another from `(package_id, target_version)` to version history. This enforces same-package ownership and accepted-release existence.

Rust must additionally verify baseline absence for initial review, matching baseline scope/revision for a change, and the component's actual target declaration and scope. It must also validate the target against the reviewed installation action. Apply an acknowledgement and remove its pending row in the same transaction as establishing or advancing the baseline. Final assembled SQL and remaining physical constraints still require review.

This review record is separate from native permission approvals. It grants no native access and cannot convert project-specific approvals into application-wide coverage. Physical constraints and transition-validation contracts are implemented. This policy does not define an automatic settings migration.

## Approved enablement retention

Keep application-level enablement choices and per-project overrides after uninstall. Associate them with stable component identities rather than artifact records. Reinstallation preserves choices for matching identities instead of applying changed manifest defaults over them. A deliberately disabled component stays disabled.

This does not authorize code to run while uninstalled or restore removed native approvals. Reinstallation still requires installation review and the normal activation checks. Retained denials remain effective. Existing first-configuration rules still apply; updates must not silently enable newly added components.

Uninstall removes code, not the user's enablement configuration. A separate explicit configuration-reset action remains a future candidate, not part of this decision. Enablement keys, columns and constraints are implemented.

## Approved artifact-selection ownership

Use a separate `package_installation_state` table rather than selection columns on `packages`. It holds one row per package with installation state. Its conceptual fields are the package association and selected, staged, retained-previous and pending-repair artifact references.

Each referenced artifact must belong to that package. Enforce this ownership invariant in both Rust validation and SQLite constraints, not only in service code. Staged-only nullability is approved below. Keys, ownership foreign keys, nullability and transitions are implemented. First-install eligibility is approved below. Promotion policy and state constraints are implemented; runtime prerequisites remain test-only.

When a normal different-version update succeeds at startup without a pending repair, select the staged artifact, clear staged and move old selected to previous. Replace any older previous reference. That older artifact is eligible for cleanup only when no retained reference or runtime use requires it. Same-version repair preserves previous instead. For explicit different-version restoration without pending repair, stage previous for restart. After successful startup checks, swap selected and previous and clear staged. The retained copy must still pass verification and normal activation checks before later use. This is not automatic rollback. If a pending repair exists, explicit restoration instead uses the verified repaired copy as previous, as described below.

The stable package row may remain after uninstall because retained history or denials reference it. Remove installation state independently. This does not delete retained history or denials, or authorize artifact cleanup while another required reference exists.

If a staged installation fails package-fatal startup validation, such as its integrity or manifest check, leave the installation references unchanged and keep the affected package stopped. An unsupported component runtime profile is not a package-fatal failure: an otherwise valid package may still be selected. Block that component and its required dependents while leaving compatible siblings eligible, under the [approved profile policy](implementation-plan.md#frontend-runtime-compatibility). Do not automatically run the selected or previous copy, substitute a pending repair, or cancel the update. Report the problem and require an explicit recovery action. Required dependents may also be blocked. Other packages still undergo their own dependency and activation checks. Normal verification and activation rules apply to any recovery target.

## Approved pending-repair reference

Add the optional `pending_repair_artifact_id` reference to `package_installation_state`. It preserves a repaired copy when Repair and keep the update must also retain the selected installation, a staged update and any retained previous artifact.

The pending repair must belong to the same package and match the selected version's accepted contents. It does not authorize loading the repair before restart. Before promoting an update with a pending repair at startup, verify both the update and the pending repaired copy. If either fails, preserve installation references, keep the package stopped and explain the blocker. On success, select the update, make the verified repaired copy previous and clear staged/pending repair. Verification is still required before any later restoration of that previous copy.

If the user replaces the staged update with explicit different-version restoration before restart, preserve pending repair. Show the restoration target and future repaired previous copy in the review. Verify both copies before promotion; if either fails, preserve references and keep the package stopped. On success, select the restoration target, make the repaired copy previous and clear staged/pending repair. The repair does not run first, and later restoration of it still requires verification.

If the user cancels the staged update, preserve the repair by moving its reference to staged and clearing pending repair. Leave selected and previous unchanged. Explain that the repair remains scheduled for restart. Offer a separate Cancel all pending changes action to clear both pending targets without changing selected or previous.

Do not repurpose the selected, staged or previous references to hold the pending repair while retaining the staged update. This is package-owned transition state, not a general operation queue or multiple-version loading feature. Nullability, reference constraints and transition rules are implemented.

## Approved first-install eligibility

A new package may become selected without restarting if no code from that package has been imported anywhere in the current application process. Verification, durable publication and registry acceptance must complete first. Its enabled components may activate only after dependency, review and native-permission checks pass. Selection does not itself mean active or authorized.

If code from the package was imported earlier in the process, require restart even if the package was subsequently uninstalled. Updates and repairs remain restart-staged. The eventual host must establish this process-wide import history; the internal registry foundation does not load modules or infer that history from database rows alone.

The no-prior-import check is a runtime eligibility gate, not a persisted credential or permission grant. Represent a first installation or reinstall awaiting restart with a row in `package_installation_state`: selected is null, staged is required, and previous/pending repair are null. Do not use a separate pending-installation table. An uninstalled package has no installation-state row; reject all-null rows. Canceling a staged-only installation follows uninstall policy: remove its installation-state row and native approvals, but preserve version history, explicit denials and saved enablement choices. Physical cleanup remains separate. A later installation must satisfy permission approval rules again. Typed inputs, promotion policy and cancellation transactions are implemented; process-wide import tracking remains absent.

## Repair example

Suppose `@org/research` version `1.0.0` has accepted fingerprint X. Its installed files become damaged. The user supplies a matching ZIP and confirms repair.

The host verifies the repair against the prior acceptance data and publishes a clean copy into a new immutable directory. It then records a new accepted artifact. It does not overwrite the old artifact or its acceptance metadata.

```text
Package: @org/research
  Version history: 1.0.0 -> fingerprint X
    Artifact A -> original installation directory
    Artifact B -> repaired installation directory
```

Both artifacts must match fingerprint X. Selection of the repaired artifact remains restart-staged under the approved repair policy. When the same-version repair is successfully selected, clear its staged reference and preserve the existing previous artifact. Do not replace previous with the damaged copy being repaired. Cleanup of that damaged artifact still requires that no retained reference or runtime use needs it. Their storage belongs to `package_installation_state`; transition constraints are implemented.

## Cleanup and retained history

Use explicit transactional cleanup rather than cascading artifact deletion. Rust deletes artifact-owned file records, component metadata and permission requirements, then the artifact, in one transaction. Restrictive foreign keys block deletion while installation pointers or any remaining child rows reference it. This database operation does not delete physical files or remove stable identities, version history or user decisions as a side effect. Permission-declaration cleanup commits with artifact removal.

After uninstall and safe cleanup, remove artifact records whose installations are no longer retained. Keep the lightweight package/version/fingerprint history. That history retains no installation location, executable files or permission authority.

Uninstall removes permission approvals, not saved enablement choices or per-project overrides. Explicit denials survive uninstall under their approved package/component, permission and scope associations. They remain separate from artifact records and must remain manageable without an installed artifact.

Retained history does not authorize reinstall or activation. Package bytes still require verification. Native permission requirements still follow the approved Secure/Trust and denial-precedence rules in the [plugin context](context.md#native-request-identity-and-token-enforcement).

## Persistence and authority boundaries

Use the approved dedicated Rust worker with `rusqlite`, bundled SQLite, WAL mode and `synchronous=FULL`. The worker serializes registry operations through bounded admission. This does not choose the storage or concurrency model for project documents, history or the file metadata index.

Registry transactions do not publish package files. Durable publication into a new immutable directory precedes the transaction that records acceptance. The foundation must not treat an arbitrary candidate integrity record as trusted acceptance merely because it has been inserted into a table. The internal acceptance contract requires prepared metadata and a matching receipt; only tests can construct the receipt until publication is integrated.

Each installation change rechecks its expected state inside the committing transaction. If that state has changed, reject the outdated operation without partial changes or overwriting the newer decision. Management UI refreshes the plan automatically and requires renewed confirmation if the revised action changes what the user would approve. Do not silently resubmit a changed action. Use the approved installation revision below. Typed requests and domain errors are implemented.

### Approved installation revision

Retain a monotonic installation revision per package across uninstall. Advance it atomically with every committed installation-state change. A reviewed action records the revision it examined. Reject a mismatching revision with `Conflict` before committing changes, even if the installation pointers have changed away and back to the reviewed values.

Uninstall must not erase or reset the revision. It is separate from project `location_revision` and component `scope_revision`. The schema stores it on the retained package row, initially 1. Checked increments must not wrap or partially mutate state.

A committed selection survives a crash before plugin activation. At the next launch, verify the selected artifact and apply normal activation checks again. Selection does not claim successful activation. Do not automatically restore an older artifact because activation confirmation is missing, and do not add such a confirmation marker for rollback in the initial model. Activation-health-based rollback is a possible future feature requiring separate design approval. A crash before the selection commit leaves the prior state intact.

Keep database-library types behind Rust domain operations. Frontend and plugin APIs receive neither SQL access nor a registry connection. Concrete internal request/result types are implemented; see the implementation review.

## Approved internal Rust entry points

Expose typed methods for individual registry operations to application Rust code. Each method accepts its own request type and returns its own typed result through `Result`. The method sends work to the dedicated SQLite worker internally. Callers do not submit a generic request enum and then match a generic response enum.

Write methods are normal async operations that return their completed result, not a separate admitted-write handle. `Ok(result)` means successful completion and that any database changes committed; queue acceptance alone is not success. An unchanged/no-op result does not require manufacturing a new mutation. Worker communication and admission remain internal. Dropping a method future after admission still follows the admitted-write lifetime rule below.

The worker may use private message types, including an internal request enum. Keep queue mechanics and database-library types behind the service methods. This is an internal Rust service boundary, not the plugin SDK or management IPC. It exposes neither SQL nor a registry connection to frontend or plugin code.

Use one shared `RegistryError` enum as the error type across these methods. Its variants distinguish domain failures and may carry operation context and underlying causes for host diagnostics. Do not expose raw SQLite errors as the service's error contract. Not every variant needs to apply to every operation. This internal enum is not automatically the plugin-facing native error vocabulary.

The internal methods and records are implemented in [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs) and [`model.rs`](../../src-tauri/src/plugin_registry/model.rs). See the [operation summary](registry-implementation-review.md#internal-rust-contract-shape). These are private host contracts, not a plugin SDK or management IPC.

### Approved installation-transition ownership

Callers request semantic installation actions, such as staging an update or applying a repair. The registry service calculates the resulting selected, staged, previous and pending-repair references under the approved transition rules. Ordinary mutation methods do not accept an arbitrary replacement pointer set calculated by a caller.

Keep this policy calculation in one place. Future management-plan previews can reuse it rather than independently reproduce transition rules. Apply the result atomically after expected-state validation. Required file-publication, user-review and runtime-eligibility inputs remain separate gates; this decision does not give the registry filesystem or activation responsibilities.

`InstallationAction`, `InstallationExpectation` and the shared calculator are implemented in [`transitions.rs`](../../src-tauri/src/plugin_registry/transitions.rs). Production previews and runtime prerequisite providers remain unimplemented.

### Approved registry readiness

Return a usable registry handle only after opening, schema checks and required initialization or supported migration succeed. Application startup awaits that result. Do not expose an initializing handle that admits ordinary requests before readiness. If initialization fails, return an error rather than a usable service handle.

The host can show its setting-up UI while awaiting readiness. Progress reporting does not require access to partially initialized registry operations. Readiness means initialization completed, not that the service can never fail or shut down later. Existing backup, migration and recovery policies still apply. Registry initialization must finish before external plugin loading. Library readiness is implemented; application progress reporting remains open.

### Approved normal schema migration

The private reviewed-static-chain helper is implemented and tested with synthetic `1 -> 2` fixtures. Actual opening supports only schema `1`; no prior shipped migration is registered. Unknown schemas reject. The policy below constrains future supported migrations.

Before a supported schema upgrade, complete the required SQLite-aware backup. Keep ordinary registry operations unavailable during migration. Apply the supported migration steps to the current database in one SQLite transaction, rather than preparing and publishing a new generation. Roll back on failure before commit. Complete required validation before returning a usable service, and preserve the backup for recovery.

A migration helper may execute and track versioned SQL changes. It does not own host backup, readiness or recovery policy. The approved database driver is `rusqlite`, not an ORM. Routine migration plumbing does not require separate architectural approval when it preserves these contracts. Restoration retains its separate generation-publication process.

### Approved startup database validation

Run SQLite's full `integrity_check` before returning a ready registry handle. Also run foreign-key checks and required application-specific validation. The full check covers database structure, index/table consistency and uniqueness; it does not replace foreign-key or domain checks.

Perform this work on the backend registry worker. It may delay readiness, so the application can show its setting-up UI while waiting. Startup cost has not been measured. This registry stores host-management data, not manuscript contents; these checks do not scan project documents or verify plugin installation files.

Do not return a ready handle if required validation fails or cannot complete. Apply existing corruption, unsupported-schema and recovery policies without silently resetting storage. Passing these checks does not prove every application value is semantically correct or replace package-file integrity verification. Library checks and explicit resource bounds are implemented. Startup cost and application reporting remain unmeasured or unintegrated.

### Approved separate registry creation

Separate creating a fresh registry from opening an existing one. Normal opening fails if the database is missing; it must not create an empty registry or fall back to initialization after an open error. A dedicated creation operation requires the host to deliberately choose initialization.

First-launch startup may choose creation automatically only when the dedicated registry location does not exist. Claim that location through exclusive, non-overwriting creation. An existing location without valid active-generation metadata requires plugin-free recovery, even if the directory is empty. Do not automatically resume interrupted initialization.

Users need not manually create a database on a fresh installation. However, this policy cannot distinguish a fresh installation from complete deletion of the registry directory. Neither creation nor opening may silently replace a corrupt database or treat leftover package files as accepted installations.

Fresh creation must refuse an existing destination without modifying it, including an apparently empty or zero-byte file. Use non-overwriting creation semantics rather than a path-existence check followed by an operation that could overwrite a file created in between. Do not implicitly repurpose an existing file. An unfinished file from an earlier initialization attempt requires separately defined recovery based on evidence of that attempt.

Unleased create/open service helpers are test-only. Runtime `Registry::open_owned` requires a location lease and a host-selected existing database beneath that root. `PreparedGeneration::create` allocates a random ID and initializes its derived generation directory under an existing leased root; it is not first-run orchestration. The test-only harness checks first creation and rejects automatic resumption of interrupted initialization. Production first-run generation selection and interrupted-initialization recovery remain unimplemented. This is an internal Rust startup contract, not new management IPC or implemented first-run UI.

### Approved application-owned lifecycle

The internal owner/handle split is implemented. Canonical destination ownership uses a persistent `.registry-lock` sidecar and `File::try_lock`, separate from SQLite byte-range locks. This is not application single-instance detection or launch forwarding.

Application startup/shutdown code owns the registry lifecycle. Ordinary windows and background operations use operation handles, not lifecycle ownership. Holding or dropping an operation handle does not start or stop the registry. Do not tie shutdown to the last operation handle being dropped.

The application owner explicitly stops admission, finishes admitted writes under their existing validation/transaction rules, and awaits worker cleanup and termination. It need not wait for every operation handle to be dropped. Retained handles cannot admit new work after admission closes; this does not cancel already-admitted writes. These are internal Rust responsibilities, not plugin or frontend shutdown capabilities. The library lifecycle is implemented; application startup/shutdown wiring remains absent. Runtime owned opening passes the location lease into the actual worker before the startup await and retains it through cleanup. Regressions cover abandoned startup, recovery retention and owner-drop draining. Fixture startup barriers remain `cfg(test)`. The separate leased-session cleanup thread is only a prototype; the shared core uses the existing registry thread.

If the application drops the lifecycle owner without awaiting shutdown, close admission and signal the worker to follow the shutdown policy without blocking the dropping thread. The worker retains registry ownership until draining and cleanup finish. Do not synchronously join from the destructor or release ownership early. This is only a fallback: application code must still await explicit shutdown before exiting to know finalization completed. It does not guarantee completion through a crash or force quit.

### Approved normal-shutdown drain

After closing admission, reject queued standalone reads that have not started with `RegistryError::Unavailable`, even if their callers are still waiting. Let the current bounded operation finish and clean up normally. Process remaining admitted writes under their normal validation and commit/failure rules, then await worker cleanup and termination. Preserve the relative admission order of those writes.

This does not skip SQL reads needed inside an admitted write. Those remain part of its validation and transaction. Complete any application shutdown preparation that needs standalone registry reads before closing admission. This changes no plugin cancellation API or protected native-service rule. The owner awaits `shutdown()` completion; application shutdown status UI remains future work.

### Approved unexpected-worker failure

If the registry worker panics or otherwise terminates unexpectedly, stop admission and make the existing service unavailable. Report affected requests without automatically replaying writes. If a write's commit outcome cannot be established, report `OutcomeUnknown` rather than claim it failed without changes.

Require controlled reopening or recovery before further registry operations. Do not automatically replace the worker and revive the service. Never silently reset the database or bypass existing recovery and native-authority rules. This policy concerns unexpected worker termination, not every validation failure or handled storage error. Worker failure closes admission and classifies affected requests. Application recovery integration remains absent.

### Approved consistent read snapshots

Assemble related registry data in one purpose-specific service operation and read transaction. Return owned Rust data describing one consistent database state. For example, package details must not combine a selected version from one moment with component requirements from another.

End the transaction before returning the result. Do not expose a live database cursor or retain a transaction while management UI displays the snapshot. Keep each query bounded; this does not require one unbounded snapshot of the whole registry.

If a read's result waiter disappears before execution starts, skip the queued read and release its resources. If execution has started, let the bounded read finish and clean up normally; discard its result if nobody is waiting. Do not add mid-query interruption semantics. This is internal waiter abandonment, not a new plugin cancellation API. Admitted writes keep their separate processing guarantee.

A snapshot may become outdated after return. Writes still revalidate expected state before committing. Purpose-specific snapshot methods and explicit `RegistryLimits` are implemented; production defaults remain open. This is an internal Rust read contract, not a new frontend or plugin API.

### Approved artifact-acceptance preparation

Prepare registry metadata before submitting the acceptance write, outside the database queue. A shared trusted host-side helper derives integrity entries, the file-set fingerprint, and component/permission declarations from the same verified in-memory package snapshot. Reuse the existing [`parse_verified`](../../src-tauri/src/plugin_manifest/parse.rs) path to read the exact verified manifest and validate declared resource membership.

`PreparedArtifact::from_verified` returns one owned private-field bundle. The worker receives it, rechecks registry state and records acceptance atomically. Callers do not independently assemble declarations and file hashes. Preparation remains synchronous bounded host work outside the database queue; async calling alone does not offload it.

The bundle establishes data consistency, not acceptance or permission. It is not evidence that files were durably published. Durable immutable file publication must still precede acceptance, and neither a constructed integrity record nor a prepared bundle verifies filesystem publication. Acceptance also requires a separate typed publication receipt. Trusted publication code creates it only after successful durable publication. Bind the receipt to the same artifact and destination as the prepared bundle; acceptance must check that they match. Keep receipt construction private to that trusted path. This makes the ordering explicit in the internal Rust contract rather than leaving it only as a documented caller obligation.

The receipt is a native host pipeline value, not a plugin SDK object, a frontend-supplied token, a new Tauri `invoke` command or a native permission credential. It is not a security boundary against compromised trusted host code. It does not make filesystem publication and the database transaction atomic or replace integrity verification before loading.

The library checks receipt binding to artifact ID, fingerprint and destination. Only tests can construct `PublicationReceipt` until the real durable publisher exists. Installation/import, native project-location, closed-project and runtime-use prerequisites likewise have only test constructors. The foundation tests their contracts, not production enforcement.

### Approved registry queue overload

If the registry work queue is full, reject the request immediately with `RegistryError::LimitExceeded`. Do not wait asynchronously for queue capacity or create another queue of waiting callers. This rejection happens before admission; the refused request performs no worker operation or database changes.

Keep admission capacity bounded. Numerical defaults remain deferred. This decision does not select an automatic retry policy or change the lifetime of writes already admitted. It governs the internal registry queue, not HTTP concurrency or protected native-service scheduling. The worker bounds pending queue entries and rejects before admission when capacity is reached.

### Approved ordinary-operation ordering

Process ordinary registry reads and writes in successful admission order (FIFO). This worker accesses the host registry's SQLite database, not project documents. Give neither reads nor writes priority over queued ordinary work. Admission order means the actual queue order, not when callers created their futures.

Skip abandoned queued reads under the separate read-lifetime rule. Do not interrupt an executing operation to run another. Shutdown admission controls and immediate native authorization restrictions do not wait behind ordinary registry work. Queue ordering and admission closure are implemented in the worker.

### Approved admitted-write lifetime

Once a registry write is admitted, continue processing it even if the caller drops its Rust future or the management window closes. The worker performs normal validation and either commits the coherent change or fails it. Losing the waiter is not a cancellation request and does not bypass expected-state checks. This is consistent with finishing admitted registry writes during normal shutdown.

Cancel UI preparation before submission rather than relying on abandonment of an admitted write. A caller that later needs the outcome must check authoritative state; it must not assume that closing the window canceled the save. This is not a guarantee of completion through a crash or force quit. The normal async completion style is approved above. Admission occurs when the worker queue accepts the operation; see the implemented service signatures.

This rule applies to internal registry writes. It does not change cancellation or revocation rules for protected native service requests.

### Approved registry error categories

Use distinct `RegistryError` variants for these cases:

| Variant            | Meaning                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `InvalidInput`     | The request contains invalid values or combinations.                                                          |
| `NotFound`         | A record requested by the caller does not exist.                                                              |
| `Conflict`         | The expected or reviewed state changed. Refresh before proceeding.                                            |
| `VersionConflict`  | The same package and complete version already has different accepted contents.                                |
| `LimitExceeded`    | Queue or operation resource limits prevent the request from proceeding.                                       |
| `Unavailable`      | The service cannot admit the request, or shutdown rejects a queued standalone read before it starts.          |
| `Storage`          | A storage operation failed, with its cause retained. For a mutation, this requires knowing it did not commit. |
| `RecoveryRequired` | Normal operation cannot safely continue, such as with corrupt state or an unsupported registry schema.        |
| `OutcomeUnknown`   | An admitted write lost its completion response, so the caller cannot establish whether it committed.          |

A missing caller-requested record is `NotFound`. Missing data that violates a required registry relationship is an unsafe-state problem, not an ordinary lookup miss. Do not translate an uncertain write outcome into a confirmed failure. Check authoritative state rather than blindly repeating a write after `OutcomeUnknown`.

These categories and source-error translation are implemented in [`error.rs`](../../src-tauri/src/plugin_registry/error.rs), the store and worker. They are not plugin-facing native codes and introduce no automatic retry policy.

## Remaining review groups

The owner approved the assembled schema, internal Rust contracts and bounded implementation scope. The six review groups covered artifacts/transitions, project registrations, permission/enablement schema, internal Rust APIs, persistence/worker mechanics and complete foundation sign-off. That internal slice is implemented. They are not six remaining approval rounds.

Production publication and generation switching, native location encodings and alias matching, management IPC/UI, live authorization, project-file services, indexing and external loading remain separate work. Additional settings retain their Part 4 completion gates. See the [implementation review](registry-implementation-review.md#remaining-integration-decisions) for those limits and [final sign-off](registry-implementation-review.md#final-sign-off-proposal) for the approved scope. New behavior gaps still require owner review.

## Existing source entry points

- [`plugin_manifest/model.rs`](../../src-tauri/src/plugin_manifest/model.rs): normalized package metadata, canonical identity and effective permission requirements. Requirements are not grants.
- [`plugin_integrity/mod.rs`](../../src-tauri/src/plugin_integrity/mod.rs): accepted-record representation, strict deserialization and integrity verification. The record contains a format version and per-path byte lengths and SHA-256 digests.
- [`plugin_resources/mod.rs`](../../src-tauri/src/plugin_resources/mod.rs): existing immutable snapshot identities and verified-buffer ownership. Snapshot identities are not activation credentials or automatically registry artifact IDs.

- [`plugin_registry/mod.rs`](../../src-tauri/src/plugin_registry/mod.rs), [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs) and [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql): internal service, dedicated worker and schema version 1.
- [`publication_probe/mod.rs`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs): authorized `cfg(test)` adapter, driven by Cargo tests in isolated temporary directories, not by application startup. Sibling modules implement checked sealing, native platform candidates, phase faults and child-process tests.
- The [implementation source/test map](registry-implementation-review.md#source-tests-and-validation) links transactions, decisions, validation, preparation, recovery and tests, with relevant Cargo commands. The [cumulative changelog](change-log.md#native-registry-design) records local validation and verified Native Registry CI: formatting, platform-specific library suites and all-target Clippy passed on macOS, Windows and Ubuntu after the LF/CRLF documentation-test correction. These results do not establish production publication or power-loss durability.

The application has no registry startup owner or commands yet. Tests exercise these internal contracts.
