# Registry generation publication investigation

**Status: owner-approved selector/publisher contracts implemented behind qualification preflight / unmerged.** This guide covers the internal production-format implementation, platform research and the separate test-only [`publication_probe/`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs) experiment. Runtime publication refuses every platform because none is qualified. Only test adapters can exercise native selection. Earlier disposable probes remain historical evidence. No application startup or Windows durability guarantee is enabled.

## Purpose

The plugin registry stores installation records and permission decisions in SQLite. Restoration prepares a replacement database in a separate directory. A small metadata file, called the **selector** here, identifies the active directory. Publishing a restore means changing that selector. It does not mean replacing a live SQLite database file.

The [foundation guide](registry-foundation.md#approved-registry-generation-layout) approves separate generation directories, a single selector and preservation of old generations. Missing or invalid selection metadata requires plugin-free recovery. An uncertain publication returns `OutcomeUnknown`, with no usable service and no automatic retry or switch-back.

The internal registry already implements database transactions, backup and restore-data preparation. The lifecycle core, production-format selector and consuming publisher are implemented internally. Native production publication remains disabled; application lifecycle wiring and first-run integration remain absent. The test harness exercises selector publication and controlled opening in isolated temporary directories. See the [implementation guide](registry-implementation-review.md).

## Main findings

1. **Atomic visibility and durability are separate properties.** A replacement can appear indivisible to running readers without proving that it survives power loss.
2. **SQLite does not publish the selector.** Its WAL/FULL settings cannot make directory creation or a separate file replacement durable.
3. **Ownership must cover the whole registry location.** The existing per-database lock cannot protect a switch between databases.
4. **Linux has a documented file-and-directory synchronization sequence.** macOS provides stronger drive flushing, and local APFS probes accepted it for files and directories. Neither is evidence for every filesystem or device.
5. **Windows remains the largest evidence gap.** Microsoft documents write-through move behavior, but the sources reviewed do not specify the complete power-loss-atomic selector protocol we would need to promise.
6. **A process-exit test is not a power-loss test.** The operating system and its caches remain running after the publisher exits.

## What each guarantee means

| Property                      | Meaning                                                                                                            | What it does not establish                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Consistent database copy      | SQLite copies one logical source snapshot, including committed WAL contents                                        | The generation directory or selector has reached stable storage                      |
| Atomic replacement visibility | A running reader sees one complete selector rather than a partially overwritten file                               | The latest selection survives a system crash                                         |
| Durable publication           | Required database contents and directory entries persist in the required order under supported storage assumptions | Protection from broken hardware, dishonest flush implementations or later corruption |
| Readiness                     | The selected registry passes schema, integrity, bounds and domain checks                                           | Successful plugin activation or native authorization                                 |

Do not use a successful read-back as proof of durability. It may read cached data. Do not claim that a filesystem's journal makes the last application publication durable merely because the filesystem remains structurally consistent.

## Current source boundaries

| Source                                                                                                                                 | Implemented behavior                                                                                 | Missing publication responsibility                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`store.rs`](../../src-tauri/src/plugin_registry/store.rs)                                                                             | Per-database ownership, WAL/FULL configuration and readiness validation                              | Registry-location ownership spanning generation changes |
| [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs), [`lifecycle.rs`](../../src-tauri/src/plugin_registry/lifecycle.rs)       | Owned opening, lifecycle admission/revisions, draining, recovery retention and shutdown              | Production maintenance adapters and application startup |
| [`location.rs`](../../src-tauri/src/plugin_registry/location.rs), [`generation.rs`](../../src-tauri/src/plugin_registry/generation.rs) | Stable location lease and generation-bound checked sealing                                           | Directory barriers and selector publication             |
| [`selector.rs`](../../src-tauri/src/plugin_registry/selector.rs), [`publisher.rs`](../../src-tauri/src/plugin_registry/publisher.rs)   | Strict 64-byte codec, bound generation validation, consuming publication/failure/readiness handling  | Qualification and enabled production callers            |
| [`publication_platform.rs`](../../src-tauri/src/plugin_registry/publication_platform.rs)                                               | Always-refusing preflight; runtime-compiled Linux/macOS candidates                                   | Qualified storage, platform baseline and crash evidence |
| [`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs)                                                                       | SQLite-aware copy, validated restore transformations, explicit target close and file synchronization | Generation-directory and selector publication           |
| [`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs)                                                                   | Private static-chain infrastructure, backup before transactional schema changes                      | Application startup upgrade orchestration               |

Normal worker shutdown drops the store. It is not a checked maintenance seal. The internal [`generation.rs`](../../src-tauri/src/plugin_registry/generation.rs) binds checked sealing to owned generation construction. The test-only [`sealing.rs`](../../src-tauri/src/plugin_registry/publication_probe/sealing.rs) shares the checked mechanics but keeps its fixture connection/path API. [`platform.rs`](../../src-tauri/src/plugin_registry/publication_probe/platform.rs) contains native move and directory-barrier candidates. The harness does not replace normal shutdown or connect publication to application startup.

`cargo test --lib` drives the harness. Tests supply finite limits, private fixture identifiers and isolated temporary directories. No application entry point calls it. [`tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/tests.rs) exercises faults and readiness. [`process_tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/process_tests.rs) launches the test executable as a child for process-exit and cross-process ownership cases.

The restore helper preserves logical source/current database data. SQLite read-only opens can still require or create shared-memory/WAL sidecars when permissions allow it. Do not interpret logical preservation as a promise of no filesystem activity. Do not set SQLite's `immutable` URI flag on a crash-left WAL database to avoid that activity; that flag assumes facts that have not been established.

## Ownership and first-time setup

**Implemented as a shared internal primitive:** `location::LocationLease::acquire(root)` locks a persistent sibling file in the existing stable parent. It neither inspects nor creates the dedicated root. `Registry::open_owned` consumes a lease before the startup await and retains it through actual worker cleanup. It checks a host-supplied existing database beneath the root; it does not select a generation or initialize missing storage. Unleased service opening/creation is test-only. The publication probe retains its separate fixture lease. Per-database locks remain additional protection.

Acquire this lease **before checking whether the registry location exists**. Place its lock file beside that location in the stable application-data parent, not inside a generation or the selector. Creating the registry directory merely to place a lock inside it would conflict with the approved first-run rule: an existing empty location is not automatically a fresh installation.

Under the lease:

- If the dedicated registry location is absent, claim it through exclusive, non-overwriting creation.
- If it exists, read and validate the selector. Missing or invalid metadata requires recovery, not initialization.
- Retain ownership across ordinary operation, shutdown draining, maintenance, publication and fresh opening.
- Make fallback worker draining retain the lease too. Dropping the application owner must not release it while admitted writes continue.
- Never replace or unlink the lock file while it can be held. Replacing its inode can create independent owners.

All production openers must follow this path. Merely adding a lock to the publisher does not stop another opener from reading the selector during maintenance. The lease is not a security boundary against arbitrary native programs modifying application data.

The runtime owned-opening path passes its lease into the actual worker before awaiting startup. The `cfg(test)` `ProbeStartup` hook can pause opening to test abandonment. [`lifecycle_tests.rs`](../../src-tauri/src/plugin_registry/lifecycle_tests.rs) checks real location-lease retention through startup cancellation, recovery-only mode and shutdown. Earlier fixture regressions remain in [`worker_tests.rs`](../../src-tauri/src/plugin_registry/worker_tests.rs). Attaching a lease only after readiness would leave abandoned startup unprotected.

`ProbeSession` also prototypes a cleanup thread that awaits shutdown while retaining the lease. This is test scaffolding, not the selected production coordinator architecture. The shared lifecycle core now runs on the existing registry thread instead. Application startup and single-instance forwarding remain unwired.

## SQLite preparation and sealing

SQLite WAL commits may reside in `registry.sqlite-wal`, not the main file. Copying or synchronizing only the main file while committed WAL pages remain is unsafe. The current backup API correctly copies the logical database. Its step loop requires completion and rejects contention rather than waiting indefinitely. See [SQLite backup](https://sqlite.org/c3ref/backup_finish.html) and [WAL](https://sqlite.org/wal.html).

For publication, prepare the new generation directly at its final directory and database basename. There is no need to rename either the database or its directory. Keep all sidecars with the database to which they belong. Never manually delete a crash-left WAL or journal to make the directory look clean. See [SQLite corruption hazards](https://sqlite.org/howtocorrupt.html).

**Approved internal handoff; implemented:** checked sealing returns an opaque private Rust value bound to the prepared physical generation and its retained ownership. Publication consumes that value, not an arbitrary database path. Normal preparation APIs cannot reopen or modify the sealed generation through it. The value requires successful validation, WAL checkpointing, checked SQLite close and synchronization of the closed database file. It does not certify directory barriers or selector publication; those checks remain separate. It enforces internal ordering, not authentication or protection against external file modification. Any returned connection on failure remains owned by the recovery-only coordinator. This does not enable Windows publication or choose a selector format. See the [ownership contract](registry-implementation-review.md#approved-production-ownership-boundary).

**Sealing responsibilities exercised by the test adapter:**

1. Finish restore transformations and full validation in the new generation.
2. End source/current read snapshots and close those connections before publication. Separate snapshots are stable through maintenance ownership; they are not one cross-database transaction.
3. Establish the intended WAL configuration on the prepared database. Finish transactions and finalize statements and backup objects.
4. Run a TRUNCATE checkpoint outside transactions. Inspect its returned busy flag and page counts. SQL execution success alone does not prove checkpoint completion.
5. Explicitly close SQLite and check the result. On failure, preserve the returned connection/error state and do not publish.
6. With SQLite closed, synchronize the prepared database using the platform file barrier. Do not open and close unrelated raw descriptors on the database while SQLite uses it; that can disrupt POSIX locking.
7. Synchronize the generation directory and every newly created ancestor entry needed to reach it.

A busy checkpoint stops preparation. The adapter must not silently downgrade to a weaker checkpoint or discard sidecars. The harness accepts only a successful TRUNCATE result `(0, 0, 0)` or the verified-WAL no-log sentinel `(0, -1, -1)`. It tests busy, incomplete and inconsistent counters. It verifies WAL, FULL, foreign keys and full bounded readiness before checkpointing. It returns the connection on preparation or checked-close failure. File synchronization happens only after checked close. Tests cover an actual close failure caused by an outstanding statement, reader contention, wrong configuration, active transactions, bounds and unexplained sidecar preservation. See [checkpoint API](https://sqlite.org/c3ref/wal_checkpoint_v2.html), [checkpoint result rows](https://sqlite.org/pragma.html#pragma_wal_checkpoint) and [checked close](https://sqlite.org/c3ref/close.html).

`FULL` synchronizes WAL commits. It does not imply macOS `fullfsync=ON`. SQLite documents that `fullfsync` defaults off. `checkpoint_fullfsync` covers checkpoints separately; enabling `fullfsync` covers sync operations generally. The inspected bundled SQLite source can fall back to ordinary `fsync` if the stronger call fails. Reading back a PRAGMA does not prove that a device honored a flush. The harness does not change production SQLite flush policy. These remain platform-policy and evidence concerns. See [synchronous](https://sqlite.org/pragma.html#pragma_synchronous), [fullfsync](https://sqlite.org/pragma.html#pragma_fullfsync) and [checkpoint_fullfsync](https://sqlite.org/pragma.html#pragma_checkpoint_fullfsync).

## Platform findings

### Linux

Linux documents that replacing an existing destination with `rename` is atomic for observers. The source and destination must be on the same mounted filesystem. It also explicitly states that `fsync` on a file does not necessarily persist its containing directory entry. Synchronize the directory separately. See [rename](https://man7.org/linux/man-pages/man2/rename.2.html) and [fsync](https://man7.org/linux/man-pages/man2/fsync.2.html).

The candidate sequence is: synchronize generation contents and newly created directories, write and synchronize a unique temporary selector beside the active selector, rename it over the active selector, then synchronize the selector's containing directory. No cross-device copy fallback or delete-before-rename step is allowed.

First selector creation must not overwrite an unexpected destination. The compiled test adapter uses `renameat2(RENAME_NOREPLACE)` on Linux. Existing-selector replacement uses `rename`. A prior absence check alone is not exclusive creation. Neither operation has a fallback. The Native Registry CI job passed on Ubuntu 24.04. This is runtime and barrier-call evidence for the runner's filesystem, not power-loss certification. The [cumulative record](change-log.md#native-registry-design) identifies the verified run and commit. Network filesystems are outside the approved local registry-storage direction.

### macOS

Apple's archived manual documents same-filesystem replacement and states that an instance of the destination exists even if the system crashes during rename. That is not a promise that the **new** acknowledged selection persists. The archived material predates APFS; use it alongside current platform evidence, not as a complete APFS durability specification. See [Apple rename](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/rename.2.html).

Apple distinguishes ordinary `fsync` from `F_FULLFSYNC`, which also asks the drive to flush buffered data. Device support still matters. See [Apple fsync](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) and [fcntl](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html). Apple's [published XNU `fcntl` manual](https://github.com/apple-oss-distributions/xnu/blob/e3723e1f17661b24996789d8afc084c0c3303b26/bsd/man/man2/fcntl.2#L207-L245) explicitly lists APFS support for `F_FULLFSYNC`. It states that the call performs `fsync`, drains the device queue and persists previously fsynced data on the same device before returning. This strengthens the primitive-level argument beyond the archived manual. It does not identify the exact APFS/OS build being qualified or establish every directory dependency in this publisher. The same source describes `F_BARRIERFSYNC` as ordering without guaranteed persistence on return; it is not a replacement for the approved acknowledgment barrier.

**Rust-specific correction:** the inspected Rust **1.90** Apple implementation of `File::sync_all` already uses `F_FULLFSYNC`. The current foundation's file synchronization should not be described as merely calling ordinary macOS `fsync`. What it does not supply is the whole directory-and-selector protocol. This source inspection covers the project's minimum Rust baseline, not an assertion about every future standard-library implementation. See [Rust 1.90 Unix filesystem source](https://github.com/rust-lang/rust/blob/1.90.0/library/std/src/sys/fs/unix.rs).

Earlier disposable APFS probes accepted both ordinary directory `fsync` and directory `F_FULLFSYNC`. The compiled adapter now uses `File::sync_all` for file and directory barriers. First creation uses `renamex_np(RENAME_EXCL)`; replacement uses `rename`. It does not downgrade or retry a failed native operation. The current macOS library run exercises this adapter. It does not prove power-loss ordering or support on the minimum macOS 13.3 release. No unsupported-call fallback may silently weaken a required durability barrier.

### Windows

Microsoft documents `MOVEFILE_WRITE_THROUGH` as not returning until a move is actually performed on disk. It separately gives an explicit flushing description for copy-and-delete moves. The page does not define a complete power-loss-atomic same-volume replacement protocol. Keep the temporary selector and active selector on the same volume and do not set `MOVEFILE_COPY_ALLOWED`. See [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

`ReplaceFileW` is not a shortcut to a stronger guarantee. Its `REPLACEFILE_WRITE_THROUGH` flag is unsupported. The documented error cases include partial renaming effects. An error cannot universally be interpreted as leaving the old selector unchanged. See [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).

`FlushFileBuffers` requires a writable handle. Opening a directory with `FILE_FLAG_BACKUP_SEMANTICS` does not itself establish a POSIX-equivalent directory flush contract. The documented volume-flush path requires administrative privileges and is not an acceptable assumption for an ordinary desktop application. See [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) and [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

The test-only native candidate makes one explicit same-volume `MoveFileExW` call with `MOVEFILE_WRITE_THROUGH`, adding `MOVEFILE_REPLACE_EXISTING` only for replacement. It never sets `MOVEFILE_COPY_ALLOWED`, deletes the active selector first, retries or uses a fallback API. Separate raw-move tests cover exclusive creation, replacement, invalid sibling paths, missing staging and incompatible sharing handles. The corrected Windows library suite and Clippy passed in Native Registry CI. This verifies the tested raw move and refusal paths, not a Windows directory-durability guarantee. See the [CI record](change-log.md#native-registry-design).

`sync_directory` explicitly returns `Unsupported` on Windows. Integrated publication therefore stops at the generation-directory barrier, before creating or changing a selector, and returns no session. Raw move success would not bypass that refusal or establish directory durability.

Do not rely on Rust's generic `rename` to select these durability flags. The inspected Rust 1.90 Windows implementation uses `MOVEFILE_REPLACE_EXISTING` without `MOVEFILE_WRITE_THROUGH` and can take a different rename path after access denial. Its standard contract does not supply the complete required protocol. See [Rust 1.90 Windows filesystem source](https://github.com/rust-lang/rust/blob/1.90.0/library/std/src/sys/fs/windows.rs) and [standard rename documentation](https://doc.rust-lang.org/std/fs/fn.rename.html).

**Unresolved:** the reviewed Microsoft documentation does not establish ordinary-user directory-entry ordering and power-loss guarantees for the complete selector-plus-generation publication. This is an evidence gap, not proof that Windows cannot implement safe publication. Do not mark Windows production publication ready or silently weaken the success criterion. Filesystem journaling alone does not fill this gap. See [Windows file caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching) and [NTFS reliability](https://learn.microsoft.com/en-us/windows-server/storage/file-server/ntfs-overview#increased-reliability).

## Approved next direction and required Windows research

The owner approved advancing shared production ownership and checked SQLite sealing while keeping Windows generation publication blocked. This is a temporary implementation boundary, not permanent exclusion of Windows. It does not approve a weaker durability guarantee or make the current Windows refusal path a completed publisher.

**Windows publication remains required follow-up research and a completion gate.** Investigate the supported local storage assumptions, directory-entry persistence, publication success criteria and recovery behavior. Gather platform evidence beyond process-exit tests. If the existing primitives cannot justify the required guarantee, present any alternative protocol or narrower guarantee for owner approval. Do not silently substitute best-effort publication.

Windows registry initialization and restoration that require generation publication remain gated. Cross-platform plugin management and Part 4 cannot be declared complete on the strength of the shared primitives alone. The current bundled application is unchanged.

The owner approved a [single lifecycle coordinator](registry-implementation-review.md#approved-production-ownership-boundary) to retain location ownership across opening, normal operation, maintenance and fresh opening. The worker shares retention before startup waits and through actual cleanup. Maintenance failures stop without automatic service resumption, publication retry or generation selection. Checked sealing retains the connection on preparation/checkpoint/close failure. After maintenance failure, the coordinator remains alive in recovery-only mode. It retains the location lock and ownership of any returned connection pending an explicit recovery or shutdown action. Normal registry handles remain unavailable. This prevents another process from taking ownership while the user decides. Awaited shutdown confirms cleanup; dropping an owner does not.

Only one maintenance attempt can be admitted at a time. While it runs, a competing request returns `Conflict` immediately, without changing storage for that request. There is no maintenance waiting queue. A caller can inspect current state and explicitly submit a new request later. The ordinary registry worker's bounded queue is unchanged.

Maintenance requests must also include the opaque lifecycle revision supplied with the coordinator state the caller reviewed. Admission checks that revision. A stale request returns `Conflict` without starting maintenance or changing storage. The revision changes at admission and when the outcome is established, even if the selected generation is unchanged. It detects intervening failed attempts, does not track every ordinary database write and grants no authority.

An explicitly requested maintenance attempt continues once admitted, independently of the caller's waiting future or management-window lifetime. The coordinator retains ownership through the single attempt. Success leaves a fresh ready registry; failure leaves recovery-only mode. A later caller can inspect authoritative lifecycle state. Caller abandonment does not trigger cancellation, a retry or a weaker publication path. This does not enable blocked Windows publication or add an explicit cancellation API.

Operation handles for the stopped worker remain permanently closed and return `Unavailable`. They never reconnect automatically. After successful maintenance, the coordinator supplies new handles only after fresh-worker readiness checks pass. Application services must explicitly obtain those handles. Calls are not queued across maintenance or replayed. Previously admitted writes still drain under the existing shutdown contract.

The owner approved extending the dedicated registry thread to own lifecycle transitions, preparation, sealing and cleanup. A small shared control object handles admission and exposes lifecycle snapshots. Caller futures only wait for results, and failed connections remain on their owning thread in recovery-only mode. Fresh opening creates a new validated service and operation channel on that thread; it need not create another OS thread.

The [consolidated Rust contract](registry-implementation-review.md#consolidated-rust-contract) describes the owner-approved shared core, now implemented internally. `MaintenanceRequest` has only test fixture constructors; no production restore/publication request can be submitted yet. The owner resolved the shutdown race identified by source review: shutdown or owner drop sets a persistent flag that immediately blocks new admission and ready-handle acquisition. Admitted maintenance completes its single attempt and records its outcome, then proceeds directly to cleanup without exposing a fresh service or waiting for interactive recovery. The location lock remains held through cleanup. Abandoning the shutdown waiter does not reverse shutdown or interrupt cleanup. Lifecycle revisions must also reject values from other coordinator lifetimes; this preserves the approved stale-request check. The bounded ownership, admission, cleanup and sealing contracts are implemented. Production maintenance adapters and application wiring remain separately gated. The selector encoding and publisher contract below are implemented internally behind the qualification gate; native publication enablement still requires passing the approved platform/storage qualification gates. This approval does not promote the test-only cleanup thread or fixture format into production.

## Approved production selector structure

**Approved structure; implemented internally:** use a fixed-size, versioned binary record containing a format identifier/version, a random 128-bit generation ID and a SHA-256 checksum covering the preceding fields. Parsing requires the exact length and rejects unknown versions, malformed records and checksum mismatches. Resolve the generation ID within the host-owned layout, never as an arbitrary path. A checksum detects damaged metadata; it does not authenticate the record or prove publication durability. Missing or invalid metadata retains the approved recovery behavior, with no guessing or fallback.

The fixture bytes below are not adopted as the production encoding. The owner approved the exact production bytes, compatibility rules and publisher contract below. The platform/storage policy below is also approved. Its required evidence must be gathered before publication is enabled. Windows publication remains blocked pending required research.

## Approved production publisher contract

**Owner-approved contract; implemented internally behind qualification preflight.** This completes the first of two publication approval checkpoints. It specifies the selector representation and publisher responsibilities. The approved second checkpoint defines platform/storage assumptions, success criteria and required evidence. Its qualification gates must pass before production publication can be enabled. Existing ownership, shutdown and recovery policies remain in force.

### Record and owned layout

Use exactly 64 bytes:

| Byte range | Contents                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `0..16`    | Exact ASCII format/version header `WIDE-REGISTRY-1\n`, including the final LF byte.              |
| `16..32`   | Raw 16-byte random physical generation ID. Treat these as bytes, not an integer with byte order. |
| `32..64`   | Raw 32-byte SHA-256 digest of bytes `0..32`.                                                     |

There are no optional fields, text encodings, padding or trailing bytes. The digest covers the header and ID, not the writable database. The logical registry namespace and in-memory lifecycle revision are not selector fields.

For a dedicated root called `registry`, use this layout. The name is illustrative; choosing its application-data parent belongs to startup integration.

```text
stable-parent/
  registry.location-lock
  registry/
    active
    <32-lowercase-hex-generation-id>/
      registry.sqlite
      SQLite sidecars and the persistent per-database lock
```

`active` is the only selection authority. Derive the generation directory directly from the 16 ID bytes as exactly 32 lowercase hexadecimal ASCII characters. Do not accept a directory name or path from selector data. Allocate IDs with the host random source. Claim each new directory exclusively; never reuse an existing directory or treat a collision as permission to replace its contents. Bind the ID, lease and database together during preparation. The runtime generation constructor now enforces this ID-derived layout. Arbitrary named construction is test-only, and the publisher rejects an identity/path mismatch.

Read the selector through one opened regular file, using a bounded read that detects bytes beyond the exact length. Reject symlinks and nonregular entries rather than following them. Validate the header, length and checksum before resolving the ID. Verify that the selected directory/database belongs beneath the owned root. A bounded read or checksum is not protection against arbitrary native processes modifying application data.

### Version compatibility

Version 1 readers accept only this exact version-1 record. Unknown versions, extra/truncated bytes and checksum failures return `RecoveryRequired` and preserve the selector. Do not attempt a text parser, reinterpret another format, rewrite metadata during reads or choose a different generation. A future version must bring an explicit compatibility decision; this contract does not promise that older applications can open newer formats. No conversion from unreleased test fixtures is added.

### Consuming handoff and sequence

Trusted Rust lifecycle code calls the publisher on the existing registry thread. There is no plugin/frontend caller or Tauri command. The publisher consumes `SealedGeneration`; it does not accept an arbitrary database path. It derives the record from that value's bound generation identity and retains its ownership throughout publication.

Before disruptive maintenance or first-run root creation, reject a platform already known not to support the required publication protocol. This preflight does not establish durability. Windows remains blocked until its required research and approval are complete.

The runtime publisher currently refuses before this sequence. Test-only candidate and fault adapters exercise the same compiled orchestration in this approved order:

1. Hold the location lease. For restoration, close old operation admission, drain admitted writes and close the old store. Prepare and seal the replacement directly in its final generation directory.
2. Complete the platform-approved directory barriers for that generation and any newly created ancestor entries, through the root and its stable parent as required. The database file barrier is already part of checked sealing. Never split a database from its sidecars or delete crash-left sidecars.
3. Create a unique temporary selector beside `active` using non-overwriting creation. Write the exact record, handle short writes, synchronize the file and close its handle before the native selection operation.
4. Perform exactly one supported native selection operation. First publication uses exclusive destination creation; replacement uses atomic replacement without deleting `active` first. No copy fallback, alternate API or automatic selection retry is permitted.
5. Complete the required post-selection directory barrier. Only after all required barriers succeed can the publisher return a private, generation-bound `PublishedGeneration` result. A read-back is not a substitute for these barriers.
6. Consume that result to open and validate the selected database on the same registry thread. Release or transfer the per-database seal lock as part of controlled opening while retaining the location lease. Ordinary operation handles become available only after readiness passes and only if shutdown has not been requested.

The published result retains generation identity and ownership. Publication failures also return a private, generation-bound failure value retaining the consumed generation, its per-database seal lock and its diagnostic error. The coordinator holds that value and the location lease in recovery-only mode until explicit recovery or shutdown. A failed publication does not return a reusable publication token or authorize an automatic retry.

The published-to-ready handoff must account for retained ownership on failure too. Keep the location lease continuously. Preserve generation identity, diagnostics and any still-owned lock or returned live connection on the registry thread. Do not claim that a successfully closed connection remains available, or release and reacquire the location lease between phases.

The published result is not a registry handle, a package-artifact `PublicationReceipt` or native authority. It confirms selector publication under the separately approved platform contract, not readiness. If the caller stops waiting, the admitted attempt still finishes. Persistent shutdown still sends completion directly to cleanup without exposing a fresh ready service.

### First publication and replacement

Only absence of the dedicated root under the location lease permits automatic first-run initialization. Claim the root exclusively before preparing the first generation. A crash after root creation but before valid selector publication leaves a recovery case, not an automatically resumable installation. The first native selector operation must refuse an unexpected destination, including a symlink.

Replacement requires a valid current selector matching the coordinator's expected selected generation, with maintenance admission already checked against the reviewed lifecycle revision. Revalidate that selection before the native selection operation. If metadata is missing, invalid or unexpectedly changed, stop with `RecoveryRequired`; do not reinterpret the request as first publication. This check is defensive validation under cooperative ownership, not a filesystem compare-and-swap against hostile native writers.

### Results and retained evidence

| Boundary                                                                                         | Result and retained state                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known unsupported protocol before admission/root claim                                           | `Unavailable`; no admitted maintenance or first-run root creation.                                                                                                                                 |
| Failure before the native selection call                                                         | Report the specific validation/storage error. No new selection was made. Preserve the old selector and failed preparation/temporary evidence. An admitted maintenance failure stays recovery-only. |
| Native selection attempted, but the required durable outcome cannot be confirmed                 | Conservatively report `OutcomeUnknown`; preserve generations and any remaining temporary selector. No ready handle, automatic retry or switch-back.                                                |
| All required selection barriers complete                                                         | Return the private published-generation value. This is publication success, not service readiness.                                                                                                 |
| Confirmed publication followed by read-back/selection inconsistency or failed database readiness | `RecoveryRequired`; preserve selected metadata and generations without switching back. Do not relabel confirmed publication as unknown merely because later readiness failed.                      |
| Fresh readiness passes without pending shutdown                                                  | Record maintenance success; new revision-checked operation handles can be obtained. Old handles remain permanently closed.                                                                         |

Old generations and surviving temporary evidence are not deleted automatically by this contract. Removal requires deliberate maintenance under separately reviewed eligibility rules. Preserving evidence can consume disk space. It does not authorize selecting an old or temporary record as a fallback.

### Implementation and validation boundary

The format codec, generation binding, consuming ownership/result handling and Linux/macOS candidate adapters are implemented and tested internally. `InitialRoot::claim` and `publish` always fail qualification preflight with `Unavailable`; they cannot be enabled by a caller argument or setting. Only `cfg(test)` helpers bypass preflight to exercise native candidates. The lifecycle retains seal/publication/reopening failures on its existing thread. Native candidate success in those tests is not platform qualification. Production enablement still depends on passing its qualification gates; Windows has no approved publication sequence. Startup, production restore request fields, recovery IPC/UI, external loading and Basic Menu packaging remain separate scopes.

Tests must cover fixed record vectors, every malformed-field/length class, unknown versions, symlink/nonregular selector rejection, bounded reads, ID/path binding, exclusive initial publication, expected-selector mismatch, short writes, each pre/post-selection failure boundary and retained ownership. Keep lifecycle shutdown/cancellation regressions and native process-exit probes. Test results must distinguish ordinary process termination from actual power-loss evidence.

## Approved platform and storage contract

**Checkpoint 2 of 2; owner-approved policy, qualification incomplete.** This defines a conditional durability target, initial qualification targets and required evidence. Approval permits implementation and qualification work. It does not certify an untested filesystem or enable publication before its evidence gates pass. The exact selector and publisher ownership/failure contract above is already approved.

### Storage assumptions and success target

Keep the registry in host-managed local application data. The root, generations and selector must stay on the same local filesystem/volume. The stable parent must support the required directory barriers too. Do not offer a custom registry-location setting in this initial slice. Network shares, cloud-synchronized or provider-managed storage, volatile filesystems, and unqualified removable/overlay/userspace filesystems are outside the initial publication contract. This restriction concerns registry storage, not where authors may keep manuscripts.

Qualification must identify the actual filesystem and relevant mount/storage configuration, not infer them from an operating-system label or path name. Runtime preflight rejects known unsupported or unrecognized configurations before disruptive admission or root creation. Do not claim that filesystem identification detects every cloud agent or proves that a device honors flushes. No native attacker boundary is added; cooperative local ownership remains the model.

Publication success means that the sealed database and required directory/selector entries have completed the platform's required persistence barriers in dependency order. Under the qualified filesystem and storage stack's documented guarantees, a subsequent system crash or power loss must not roll selection back below that acknowledged publication or leave its generation unreachable. This excludes later writes, deliberate maintenance, external modification, media failure and storage stacks that falsely report flush completion. It is a durability target under stated assumptions, not unconditional protection from hardware failure.

This contract concerns generation publication. It does not change SQLite's existing WAL/FULL policy for later ordinary transactions or imply that SQLite `fullfsync` is enabled. File checksums and successful read-back do not establish physical persistence.

### Initial qualification targets and native candidates

| Target                | Candidate primitive sequence                                                                                                                                                                             | Current evidence and enablement status                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux on local ext4   | `fsync` for required files/directories; `renameat2(RENAME_NOREPLACE)` for first selection; same-filesystem `rename` for replacement; selector-parent `fsync` afterward.                                  | Linux documents separate file/directory synchronization and ext4 support for exclusive rename. Ubuntu CI exercises the native candidates, but its actual storage configuration and crash durability are not yet qualified. Not approved for enablement by CI alone.  |
| macOS on local APFS   | Required file/directory barriers using the verified Apple `F_FULLFSYNC` path; `renamex_np(RENAME_EXCL)` for first selection and same-filesystem `rename` for replacement; final selector-parent barrier. | Local APFS probes and macOS CI exercised these calls. Archived Apple documentation and successful calls do not establish the complete current APFS ordering contract. Minimum macOS 13.3 and crash/storage evidence remain missing. Not approved for enablement yet. |
| Windows on local NTFS | Research target only. Evaluate same-volume native selection and persistence of the generation, parent entries and selector as one protocol under ordinary-user privileges.                               | Raw `MoveFileExW` and refusal-path tests pass. The complete directory/selector persistence contract remains unresolved. Publication stays blocked; no Windows primitive sequence is approved.                                                                        |

These are initial qualification targets, not permanent exclusions of other local filesystems. Adding a filesystem requires evidence against the same contract, not a silent best-effort fallback. The Linux row does not assume that every Ubuntu runner uses ext4. The Windows row does not assert that NTFS cannot support a suitable protocol.

The reviewed [Linux `fsync` documentation](https://man7.org/linux/man-pages/man2/fsync.2.html) requires a separate directory synchronization for directory-entry persistence. [`rename`](https://man7.org/linux/man-pages/man2/rename.2.html) describes atomic replacement visibility and filesystem-dependent `RENAME_NOREPLACE` support. These are complementary guarantees, not interchangeable calls.

The reviewed [Apple `fsync` documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) distinguishes drive flushing from ordinary host-to-drive writes. The inspected [Rust 1.90 Apple implementation](https://github.com/rust-lang/rust/blob/1.90.0/library/std/src/sys/fs/unix.rs) uses `F_FULLFSYNC` for `File::sync_all`. Qualification must check the implementation used by the build and the required directory behavior, not assume that the same Rust method supplies identical guarantees everywhere. Do not weaken a failed required barrier with an ordinary-flush fallback.

The reviewed Microsoft [`MoveFileExW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw) and [`FlushFileBuffers`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) pages do not establish the complete ordinary-user protocol. Volume flushing requires administrator privileges. [`ReplaceFileW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew) explicitly does not support its write-through flag and documents partial failure effects. Do not infer a complete protocol from a function name, filesystem journaling or one successful raw move.

### Required evidence before each platform is enabled

1. **A reviewed platform argument.** Document why each required data and directory dependency persists before selection is acknowledged. Resolve any filesystem-specific evidence gaps. Identify exact OS/filesystem versions, mount options and relevant storage/virtualization assumptions. A passing call is not a replacement for this argument.
2. **Actual production-code coverage.** Test the approved 64-byte codec, generation binding, native adapters and consuming failure ownership. Include exclusive initial creation, replacement, contention, short writes, disk/flush errors, every boundary, shutdown and caller abandonment. Continue three-OS CI, while distinguishing unsupported/refusal paths from publication success.
3. **Supported-version coverage.** Run native publication/barrier checks on supported platform baselines. macOS 13.3 is an explicit missing gate; macOS 15 CI is not a substitute. Packaged application startup and permissions remain a separate integration gate.
4. **Crash/storage evidence beyond process exit.** Use a dedicated test environment with a documented cache-aware storage-fault model, or controlled power interruption, capable of losing unsynchronized writes. Exercise first creation and replacement before/after each barrier and after success is recorded. A guest restart that preserves host caches is not automatically a power-loss test. After acknowledged success, the selected new generation must remain reachable and valid within the model. Earlier interruptions must respect the approved phase-specific selection/recovery rules. Do not run destructive tests on user data or a development machine without explicit authorization and a dedicated setup.
5. **A recorded qualification result.** Keep the tested environment, source rationale, results and limitations together. Review failures rather than weakening the protocol until tests pass. Enable only configurations whose required gates pass. Expanding the guarantee, changing the protocol or reducing the guarantee requires owner approval.

No finite test campaign proves that every device reports persistence honestly. The storage assumptions and tested fault model must remain explicit. Physical hardware interruption can add evidence, but is not a universal hardware certification requirement. Ordinary process-exit tests remain valuable lifecycle tests; they do not fulfill the crash/storage gate by themselves.

### Implementation and enablement boundary

Both publication design checkpoints are approved. The codec, ownership/result handling and Linux/macOS candidate adapters may be implemented and tested behind the publication gate. Runtime qualification/preflight must not claim support solely because compilation or CI succeeds. Production enablement remains conditional on the evidence above; no platform becomes enabled by recording this decision.

Windows research remains required for cross-platform plugin management and Part 4 completion. If that research needs a different protocol or weaker target, present the concrete issue and evidence for approval. Do not treat the existing Windows block as a permanent product exclusion or optional post-release backlog. This checkpoint does not authorize startup wiring, production restore request fields, recovery UI/IPC or external loading.

## Cache-aware model and environment observations

**Test-only qualification work implemented; no platform qualified.** [`publication_crash_tests.rs`](../../src-tauri/src/plugin_registry/publication_crash_tests.rs) drives the actual consuming `publish_with` orchestration through a private storage-model adapter. It is not a separate hand-written publisher and does not alter production preflight.

The model separates stable object identities, file bytes and directory entries. File synchronization commits bytes only. Directory synchronization commits that directory's immediate entries, not child data. Rename preserves the selector object's identity. Sealed database bytes are assumed durable at entry, while their new directory entries are not. Replacement begins with a persisted valid old selection captured before new preparation. First creation begins with an unpersisted root entry beneath an existing stable parent.

Each campaign observes 27 boundaries around creation, partial/full writing, file/directory barriers, selection and acknowledged success. At each boundary it reconstructs 18 bounded persistence scenarios. These combine durable-only or selected early namespace persistence with lost, partial, torn or complete unsynchronized selector bytes. First creation and replacement therefore cover 972 primary crash-state checks. Reconstructed images use the real selector parser, bound-entry validation and SQLite readiness checks. They never scan generations to choose a fallback.

Negative controls omit the generation-directory barrier, selector file synchronization, first-root parent barrier or final selector-parent barrier. Each control detects an acknowledged result that would be missing, unreadable or still selected to the old generation within the model. These controls show that the campaign is not merely checking successful host writes.

The model assumes completed barriers cannot roll back and treats each directory namespace snapshot atomically. It tests representative persistence choices, not every dirty-entry subset, sector tear, metadata-corruption pattern, device or filesystem. It starts after checked sealing and does not simulate later ordinary SQLite transactions. Fixture visibility operations are not tests of native atomic replacement. All model files and reconstructed images are isolated temporary directories. The campaign does not kill processes, reset machines or force cache loss on the host. Normal sealing of isolated fixture databases still uses its existing file-synchronization calls.

This is evidence about the implementation's sequence under explicit storage assumptions. It does not resolve the platform argument, map those assumptions to actual APFS/ext4/NTFS behavior, validate macOS 13.3 or qualify a real storage stack. Production publication remains unavailable on every platform.

### Environment evidence and CI artifacts

[`qualification_evidence.rs`](../../src-tauri/src/plugin_registry/qualification_evidence.rs) is compiled only for tests. Its capture test observes one real default-tempdir fixture and the repository manifest, not an application registry location. It records target OS/architecture, a sanitized numeric Unix kernel release, filesystem observations and whether those two samples identify the same filesystem. It explicitly sets qualification, runtime publication enablement and physical power-loss testing to false. Probe failures remain explicit unavailable observations.

macOS uses `statfs` for filesystem name and flags. Linux records `statfs`/`statvfs` data and a bounded `/proc/self/mountinfo` observation. The mount parser chooses the most specific component-prefix entry, decodes kernel path escapes and refuses ambiguous observations. It does not infer ext4 from the shared ext2/ext3/ext4 magic number. Only allowlisted filesystem names and durability-related mount options are serialized; unknown options are counted, not copied. Windows uses volume information and drive-kind observations. Drive type and filesystem names do not prove physical locality or flush guarantees.

Reports omit absolute sample paths, mount sources, volume identifiers/labels/serials, custom kernel suffixes and raw native errors. The collector invokes no subprocess and requires no administrator rights. The underlying device/storage stack, compiler implementation and complete OS product/build remain separate evidence obligations; the numeric kernel release is not a product version. The local observation and toolchain are recorded in the [cumulative changelog](change-log.md#native-registry-design).

Run these focused commands from `src-tauri`:

```sh
cargo test --locked --lib plugin_registry::generation::publisher::crash_tests
cargo test --locked --lib plugin_registry::qualification_evidence
```

The environment test writes a local report to `target/registry-qualification/storage-evidence-local.json`. In GitHub Actions it uses a numeric run-ID/attempt-specific filename instead. The [Native Registry workflow](../../.github/workflows/native_registry.yml) is configured to upload only that exact current report as `registry-storage-evidence-<matrix-os>-<attempt>`, even when later checks fail. The collection/upload path passed native CI on all three platforms. The owner supplied the three current-run JSON reports for inspection; their findings are summarized below and attributed in the [changelog](change-log.md#native-registry-design). Missing reports are warnings, not fabricated success. Unique report filenames prevent a cached target directory from attributing an old observation to a new run. The JSON report describes environment observations, not test outcomes or platform qualification. Use the workflow's test result and the source model assumptions alongside it.

### Inspected CI storage observations

The inspected reports use schema `writers-ide.registry-storage-evidence/1`. All three identify the same run and attempt. They explicitly report `qualified = false`, `runtime_publication_enabled = false` and `power_loss_tested = false`. These observations describe the temporary fixture and repository manifest, not host-managed application data.

| Platform        | Observed storage                                                                                                                                                 | Remaining uncertainty                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS, aarch64  | Both samples report writable, local APFS and the same filesystem. The numeric kernel release is `24.6.0`.                                                        | The report does not identify the product version/build, prove minimum-macOS support or establish APFS persistence ordering and device flushing.                                                                                          |
| Linux, x86_64   | Mountinfo identifies both samples as ext4 with `rw`, `data=writeback` and `nobarrier`. Both identify the same filesystem. The numeric kernel release is `7.0.0`. | Physical locality is unknown. Five options per sample are omitted by the allowlist. The storage stack and cache protection are unobserved. The shared `0xef53` magic alone does not identify ext4.                                       |
| Windows, x86_64 | Both samples report writable NTFS on fixed drives.                                                                                                               | Fixed drive type is not proof of physical locality. The samples have different reported volume roots; aliases are unresolved, so same-filesystem status is unavailable, not a confirmed mismatch. OS version probing is not implemented. |

The Linux mount options matter for qualification. The [Linux ext4 documentation](https://www.kernel.org/doc/html/latest/admin-guide/ext4.html#options) states that `data=writeback` does not preserve data-before-metadata ordering and `nobarrier` disables journal write barriers. The documentation allows that disabling barriers can be safe with appropriately protected storage. These reports do not establish such protection. Do not treat successful calls or green CI on this runner as evidence that the approved persistence assumptions hold. This is not proof that an acknowledged publication was lost; no native power-loss experiment occurred.

Continue to use hosted CI for compilation, regressions and environment observations. Native durability qualification needs a controlled environment with recorded mount options, storage/cache behavior and supported OS versions. For Linux, investigate a barrier-enabled local ext4 setup with a known storage stack rather than relying on this runner's unknown cache protection. This is a research recommendation, not a new production support policy. macOS 13.3 coverage, APFS persistence arguments and the complete Windows NTFS publication protocol remain open evidence requirements. Reset or storage-fault experiments require a dedicated disposable setup and explicit permission.

## Native persistence argument and controlled experiment plan

**Research findings and controlled-experiment scope, not qualification or production adapter approval.** This section maps reviewed sources to the implemented publisher. It does not authorize resets, block-device configuration or production enablement.

### Dependency order in the actual publisher

[`publish_with`](../../src-tauri/src/plugin_registry/publisher.rs) starts with a checked sealed database. It synchronizes the generation directory, registry root and stable parent in that order. Those barriers cover the database entry, generation entry and root entry. It then creates and writes a unique temporary selector, synchronizes its bytes, performs one exclusive-creation or replacement rename and synchronizes the root again before returning publication success. The final root barrier must persist the renamed active entry. Fresh-open readiness is a separate step.

This maps the abstract model's dependencies to native work. It is not evidence that an arbitrary native filesystem implements those dependencies. In particular, the stable parent is assumed to exist durably before this sequence. Qualification must not silently treat newly created ancestors above that parent as already durable. The old generation and selector must form a durable replacement baseline before new preparation begins.

### Linux ext4 source argument

The [Linux `fsync` contract](https://man7.org/linux/man-pages/man2/fsync.2.html) covers file data and inode metadata, waits for device-reported completion and separately requires directory synchronization for directory entries. The inspected [Linux v6.8 ext4 implementation](https://github.com/torvalds/linux/blob/v6.8/fs/ext4/fsync.c) supplies more implementation context:

- `ext4_sync_file` waits for file data writeback before the journal synchronization path. `data=writeback` therefore does not by itself prove that an explicit successful file `fsync` is ineffective.
- `ext4_fsync_journal` forces a full journal commit for directories. For regular files it coordinates the journal commit and required device barrier.
- Explicit extra device flushing depends on barrier state. The journal path checks `JBD2_BARRIER`; the non-journal path checks the filesystem's `BARRIER` option. Do not assume that adding more `fsync` calls compensates for disabled device barriers.

This is a review of a pinned reference implementation, not a source match for the observed CI kernel `7.0.0` or an approved Linux minimum. Qualification still needs the exact test kernel/configuration, relevant filesystem features, effective mount options and device/virtualization cache behavior. Review the corresponding implementation for that environment. A filesystem label or `fsync` return value cannot establish that a lower storage layer reports persistence honestly.

### macOS APFS argument still to complete

The published XNU manual linked in [macOS findings](#macos) documents APFS `F_FULLFSYNC` and distinguishes it from ordering-only `F_BARRIERFSYNC`. Rust 1.90 maps `File::sync_all` to `F_FULLFSYNC` on Apple targets, and the native directory adapter uses that method. Neither source review identifies the compiler used by an arbitrary stable-Rust CI run. Record the actual compiler and inspect its relevant implementation before attributing a native result to that path.

The remaining argument must connect directory synchronization, same-filesystem rename and the final root synchronization on the tested APFS/OS release. Cover first creation and replacement, including the stable-parent dependency. Record product version/build separately from the numeric kernel release. Run native checks on macOS 13.3 as well as newer supported releases. Successful directory calls on a newer host and generic copy-on-write claims are not substitutes for that coverage or crash/storage evidence.

### Windows ordinary-user argument still to complete

The reviewed [handle-based rename structure](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) describes replacement and directory-relative naming. It does not document a barrier that persists the generation's parent entries and the selected name together. Changing from `MoveFileExW` to a handle-based rename would therefore not, by itself, fill the current gap.

Microsoft's [`NtFlushBuffersFileEx` driver documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntflushbuffersfileex) states that normal flags flush file data and metadata and synchronize the underlying storage cache. It distinguishes this from flags that omit metadata or storage synchronization. Its documented target is a kernel driver API. This source does not establish a supported ordinary-user directory flush contract for this application. It is not approval to add native syscalls, a driver or elevated volume flushing. The reviewed `FlushFileBuffers` and `MoveFileExW` contracts still do not cover the complete generation-directory/selector dependency sequence.

Before implementing a Windows candidate, establish supported ordinary-user handle access, directory-entry persistence scope, same-volume replacement behavior and the failure/acknowledgment rule for the whole sequence. Verify this against supported Windows builds and a documented NTFS storage setup. A successful undocumented directory flush or raw rename probe alone cannot fill the argument. Keep the existing `Unsupported` candidates until evidence supports a concrete protocol. Any changed protocol or weaker guarantee needs owner approval.

### Controlled Linux experiment

**Harness implemented / unmerged; native campaign not executed.** The first native storage campaign uses a disposable Linux VM and dedicated scratch devices. It must not attach user disks or run against the host's application data. An administrator may be needed to configure the test devices inside that VM; this does not introduce a production privilege requirement.

The harness uses the kernel's [`dm-log-writes`](https://www.kernel.org/doc/html/v6.8/admin-guide/device-mapper/log-writes.html) target. It logs writes around completed preflush operations and records force-unit-access writes when they complete. This provides a cache-aware replay mechanism below ext4 rather than merely killing the publisher process. The controller implements a bounded standard-library Python reader/replayer against the pinned Linux v6.8 format. It does not install or run the documentation's external replay tool. Unknown records and discard are refused. The [lab guide](../../tooling/registry-lab/README.md) documents the format reference, responsibilities and execution boundary. This mechanism samples a defined block-level model; it does not cover every early write, sector tear or dishonest device.

1. Record the disposable environment before testing. Include kernel and compiler versions, filesystem creation features, effective mount options, virtual device cache settings, host backing storage and the logging/replay tool revisions. Start with barrier-enabled local ext4 on a known storage stack. This is an experiment configuration, not a new support policy.
2. Define separate disk, log-size, case-count and time limits before running. Verify that failures in the fault mechanism remain confined to scratch devices. Preserve a durable initial baseline for first creation and a separately durable old-generation baseline for replacement.
3. Drive the actual private publisher through test-only native instrumentation. Correlate before/after barrier and rename boundaries with block-log marks and return values. Marks record observation points; they must not be treated as persistence barriers. Do not replace the production sequence with a hand-written shell rename test or reuse the older fixture selector.
4. Preserve the log, then reconstruct each chosen crash cut on a fresh baseline clone. Later orderly cleanup may finish the source run, but must not contribute writes beyond the chosen cut. Mount only the reconstructed clone for normal filesystem journal recovery. Avoid automatic repair that could hide a failure. Validate the real selector, its bound generation and SQLite readiness.
5. Capture the publication-success acknowledgment outside the tested filesystem and correlate it with the chosen cut. Do not lose the only acknowledgment evidence in the same simulated crash. Keep this point separate from later service-readiness success.
6. Require every acknowledged-success image to retain the new active selector and its valid, reachable generation. For earlier cuts, assess the existing phase-specific selection/recovery contract without generation scanning, switch-back or fallback. Run missing-barrier controls to establish sensitivity, but report when a native filesystem's stronger incidental persistence masks an omission. Include an independent cache-loss calibration; an insensitive campaign is not qualification evidence.
7. Save the exact source revision, environment record, phase trace, replay cuts, validator results and coverage limits together. Do not mark a target qualified from one successful replay or from filesystem consistency alone. Native write-error injection remains separate: [`dm-flakey`](https://www.kernel.org/doc/html/v6.8/admin-guide/device-mapper/dm-flakey.html) can drop acknowledged writes and may violate the honest-flush assumptions rather than simulate only unsynchronized cache loss.

A non-privileged capability check of the available Docker Desktop VM found ARM64 Linux `6.12.76-linuxkit`. Its readable kernel configuration has loop devices, device-mapper and ext4 built in, but explicitly disables `CONFIG_DM_LOG_WRITES`, `CONFIG_DM_FLAKEY`, `CONFIG_DM_SNAPSHOT` and `CONFIG_DM_THIN_PROVISIONING`. No logging-target module was visible. Installing container tools or granting container privileges does not add a target omitted from this kernel. The inspected Docker setup therefore cannot run the proposed `dm-log-writes` campaign as configured. This result applies to that kernel, not every Docker installation.

The owner has now provisioned a separate UTM ARM64 Linux VM on the same Mac. Owner-supplied console output shows kernel `6.8.0-151-generic`, `CONFIG_DM_LOG_WRITES=m`, an installed module and successful loading followed by `dmsetup targets` listing `log-writes v1.1.0`. The VM has a 32 GiB system disk with EFI, boot and LVM-root partitions. Three additional 4 GiB disks show no partitions, recognized filesystems or mount points. The observed names are `/dev/vda` for the system disk and `/dev/vdb`, `/dev/vdc`, `/dev/vdd` for the proposed data/log/replay roles. These names are observations, not stable identity checks or permission to erase them. No logging mapping, scratch filesystem or replay campaign has been created by this work.

This confirms the required kernel capability, not a qualified storage setup. The ordinary-user VM build and compiler identity are now verified in the [changelog](change-log.md#native-registry-design). Full kernel/package configuration, effective test-filesystem options, UTM cache settings and host backing behavior still need recording for the campaign. The VM's current ext4 root is an LVM volume and must not become a scratch target. Its root LV was expanded separately under explicit administrative setup approval. The experiment controller must never resize or format the system disk or root volume. Do not modify Docker Desktop's kernel or substitute a different fault model without reviewing the concrete setup and isolation. Minimum-macOS and controlled Windows storage environments remain unavailable.

### Harness implementation boundary

**Owner-approved and implemented / unmerged; native execution unverified.** [`tooling/registry-lab/`](../../tooling/registry-lab/README.md) contains a Linux-only controller for narrowly scoped privileged disk operations. A separate build helper compiles the opt-in Rust workload without root and records compiler, source revision and executable hash. [`publication_storage_lab.rs`](../../src-tauri/src/plugin_registry/publication_storage_lab.rs) belongs beneath the publisher's private test module. Its adapter delegates native calls to the existing candidate operations and records actual boundaries, including marks immediately after required barriers. Ordinary Rust fixtures use temporary directories; the native entry remains ignored and requires the controller's opt-in environment and acknowledgment handshake. No runtime qualification bypass or application behavior changed.

The controller defaults to inspection only. It requires initially zero-filled whole scratch disks and scans their complete contents before accepting the selection. It fingerprints device/boot identities, obtains cooperative per-device locks and checks live identities again before transitions. Before any destructive run, require explicit data/log/replay device selection and a separate erase confirmation. Recheck distinct device identities and sizes, mount/swap use and device dependencies. Reject the VM system disk and its partitions/LVM backing devices, in-use devices and unrecognized existing contents. Matching the three displayed names or sizes alone is insufficient. Privileged work is confined to confirmed scratch-device formatting, mappings, mounts and replay. It must not install or build tools as root, attach Mac directories, change boot configuration or reset the Mac or VM.

Record acknowledgments and bounded evidence on the VM system filesystem outside the three scratch devices. The controller bounds the data/replay prefixes to 128 MiB each, the log prefix to 256 MiB, retained evidence to 512 MiB, the campaign to six cases and 160 replay cuts, and its deadline to one hour. Deadlines do not guarantee immediate termination of a kernel task stalled in uninterruptible device I/O. It calibrates cached-write loss separately and includes four first-creation missing-barrier controls. Masked omissions are reported, not treated as proof that the omitted barrier is unnecessary. On failure, stop the campaign and preserve diagnostics and owned evidence. Never retry publication, select another generation or guess that a failed mapping or mount was cleaned up. Provide explicit cleanup limited to resources demonstrably created by the run. Inspection and safety-refusal tests must run without real device writes. Native capture/replay remains opt-in and outside ordinary CI.

Implementation approval covers code and non-destructive tests only. Before native execution, verify the complete scratch setup and obtain explicit authorization to erase the exact three devices. The owner's setup and module-loading steps do not authorize formatting. The [inspection/build instructions](../../tooling/registry-lab/README.md#inspection-before-execution) stop before destructive execution. Three-platform CI passed for the harness revision, including the Python 3.12 safety step on Ubuntu. Rust fixtures use temporary directories and the native lab entry remains ignored. See the [verified CI record](change-log.md#native-registry-design). Separately, the ordinary-user VM build helper, executable identity and focused temporary-directory fixtures were verified, and the controller's unprivileged bare-inventory mode succeeded. Privileged full-disk inspection and native block-device operations remain unverified and unexecuted. Full environment and host-cache evidence remain incomplete; no target is qualified.

## Test-only lifecycle adapter

This sequence is implemented only in the private test harness. It is not a production Rust API or application lifecycle integration.

```text
Location lease held
  -> close admission and drain the old service
  -> prepare and validate a new generation
  -> checkpoint, close and synchronize it
  -> write and synchronize temporary selection metadata
  -> replace and synchronize the selector
  -> open the selected generation and await readiness
  -> return a fresh session
```

The private selector fixture is exactly **61 bytes**: the 13-byte magic `WIDE-PROBE-1\n`, a 16-byte generation ID and a 32-byte SHA-256 checksum of the preceding bytes. Parsing checks exact length, magic and checksum. It resolves the opaque ID within the fixture layout, not as an arbitrary path or logical namespace. The checksum detects malformed fixture metadata; it does not authenticate anything. This encoding is test-only, not a public or production format. The separate 64-byte production encoding is implemented above; it does not change this private fixture format. The mutable database is not checksummed as an immutable artifact; ordinary registry writes change it.

Perform all persistent restore transformations and establish the database's intended journal mode before switching. Fresh opening is for readiness and normal SQLite recovery, not for finishing restore preparation. It may recreate sidecars; do not promise zero filesystem changes during opening.

Use the existing fresh-open-after-publication approach initially. If a confirmed durable publication is followed by readiness failure, keep the selected generation and enter recovery. That is a readiness failure, not automatically `OutcomeUnknown`. Do not revert the selector.

The harness opens a fresh worker after publication. It does not introduce a pre-opened worker with admission held closed. Such a lifecycle extension still requires separate approval.

### Failure classification

| Boundary                                                        | Required result                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Failure known to occur before selector publication              | No new selection; preserve failed staging evidence and any existing old selection                 |
| Replacement attempted but durable outcome cannot be established | `OutcomeUnknown`, no usable session, preserve both generations, no automatic retry or switch-back |
| Selector confirmed durable, but fresh opening fails             | Recovery required; leave selector unchanged and preserve generations                              |
| Process exits before replacement                                | For replacement, follow the existing valid selector, never the newest-looking directory           |
| Selector missing, malformed or pointing to unusable storage     | Plugin-free recovery; do not guess a generation or silently initialize                            |
| Process exits after publication but before session delivery     | Next controlled startup validates the selected generation; old handles never revive               |

First-time creation has no old selector. If it stops after creating the registry location but before publishing valid metadata, the next launch enters plugin-free recovery. Do not resume initialization automatically or select the prepared generation by validity.

No result here changes the existing permission sanitization, process-wide import or native-authority requirements. Stopping the database worker does not unload JavaScript.

## Earlier disposable experiments

Research ran on **macOS 27.0.1, APFS**, with **Rust 1.99.1** installed. The source-level Rust comparison used the **1.90** baseline. Disposable Python probe files were created under the ignored `src-tauri/target` directory and removed afterward. That earlier research added no probe source. The separately authorized compiled Rust harness now lives in `publication_probe/`; it is not production implementation.

| Check                                                             | Observed result                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Regular-file `fsync` and `F_FULLFSYNC`                            | Both calls succeeded                                           |
| Directory `fsync` and `F_FULLFSYNC`                               | Both calls succeeded                                           |
| 100 same-directory selector replacements with a concurrent reader | 32,269 complete reads; no missing or partial selector observed |
| Abrupt publisher exit before replacement                          | Old selector remained                                          |
| Abrupt publisher exit after replacement                           | New selector was visible                                       |
| Abrupt publisher exit after containing-directory synchronization  | New selector was visible                                       |

The probes used direct Python filesystem/syscall access. They did not execute a Rust publisher. They tested runtime visibility and abrupt process exit while the OS remained alive. No power interruption, kernel crash, reboot, fault-injected disk or packaged Tauri test was performed. Successful synchronization calls do not measure a device's physical persistence.

Those experiments did not execute Windows, Linux or macOS 13.3. Their visibility/read-count results must not be attributed to the compiled Rust harness.

## Compiled harness coverage and current validation

The newer production-format implementation has separate tests in [`selector_tests.rs`](../../src-tauri/src/plugin_registry/selector_tests.rs), [`publisher_tests.rs`](../../src-tauri/src/plugin_registry/publisher_tests.rs), [`publication_platform_tests.rs`](../../src-tauri/src/plugin_registry/publication_platform_tests.rs) and [`publication_lifecycle_tests.rs`](../../src-tauri/src/plugin_registry/publication_lifecycle_tests.rs). They cover strict metadata and entry checks, consuming ownership, every selection boundary, original diagnostics, same-thread lifecycle replacement and production refusal. The publisher's Rust module path is `plugin_registry::generation::publisher`; publication/lifecycle tests are under `plugin_registry::worker::lifecycle::publication_tests`.

Only test adapters exercise native selection. Production preflight remains unavailable on all platforms. The [cumulative validation record](change-log.md#native-registry-design) records local checks and the verified three-platform CI pass for the gated implementation after its Windows import-guard correction. No qualification, minimum-macOS or power-loss result is implied by the following older fixture coverage.

The current macOS publication-module suite has **34 tests**, including the missing/unusable selected-database regression. The two worker lease regressions are outside that module. Coverage includes:

- First creation and replacement through actual ready registry workers; old handles stay closed.
- Missing, invalid, oversized and checksummed selector parsing. An unusable selected database requires recovery without choosing a valid sibling.
- Fault injection at every named preparation/publication phase. Prepublication failures preserve staging and the old selection. Uncertain replacement/barrier outcomes return no session, preserve generations and do not retry or switch back.
- Partial selector writes followed by `WriteZero`, with partial staging preserved.
- Actual readiness failure after publication, by deleting a required settings row before fresh opening. The new selector remains selected; no fallback occurs.
- Child publisher exits before/after replacement, after the directory barrier and before reopening. Interrupted first creation requires recovery, not automatic resumption.
- Cross-process lease competition and lock release after a child is killed. Children have timeouts and kill/reap guards.

**Earlier probe-only validation on macOS:** before the gated publisher implementation, `cargo test --lib` passed **213 library tests**; `cargo check --lib`, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` all passed. The 34-test module result includes the added missing-selected-database case; the earlier 33-test subset is not the final suite. The two worker lease tests cover startup cancellation and owner-drop draining, not production lease integration. See the [cumulative record](change-log.md#native-registry-design).

The new [Native Registry workflow](../../.github/workflows/native_registry.yml) is configured for `macos-15`, `windows-latest` and `ubuntu-24.04` with stable Rust. It runs formatting, the full locked library suite and locked all-target Clippy. After the LF/CRLF documentation-test correction, remote formatting, complete library suites and all-target Clippy passed on macOS 15, Windows latest and Ubuntu 24.04. Minimum-macOS results remain unavailable. See the [verified run and local correction](change-log.md#native-registry-design). Platform-conditional tests differ; the macOS count is not a promised count on every OS.

These are runtime, failure-handling and barrier-call observations. They are not power-loss, kernel-crash, reboot, physical-device persistence, packaged-app or production authorization evidence.

## Recommended next work

1. Retain the verified three-platform CI pass for the gated codec/publisher and qualification helpers. The current-run environment reports have been inspected. Use the storage observations above to guide controlled platform research; the Linux runner's `nobarrier` configuration has no documented cache protection in the collected evidence. Neither modeled success nor reported filesystem names qualify a platform. Both design checkpoints are approved and the implementation is in place, but native production enablement still requires passing the platform/storage qualification gates. Production maintenance request adapters remain absent; review their concrete requests and integration before adding them.
2. Retain Windows publication as required follow-up research, not optional backlog or permanent exclusion. Define supported storage assumptions and success criteria, and resolve the evidence gap before enabling it. The owner approved keeping it blocked in the meantime, not reducing its guarantees.
3. Keep the fixture publisher, fixture selector encoding, cleanup-thread prototype and startup barriers test-only. Implementing the approved production codec and ownership/result contracts does not enable native publication or application startup.
4. Maintain the implemented fault, sealing, lease and reopening regressions. Extend evidence where platform runs expose unsupported assumptions; do not silently weaken barriers to make a test pass.
5. Use OS CI for Windows/Linux and a minimum-macOS validation environment. Run process-termination tests separately from power-loss/storage testing. CI termination alone does not establish power-loss behavior.
6. Only after the protocol and evidence are accepted, implement the application lifecycle owner and production publication. Do not enable external plugins as a side effect.

The approved missing-selector recovery policy already handles unusable metadata. It does not prove durability of an operation reported as successful. If validation cannot justify the required Windows success condition, present the exact proposed guarantee and remaining risk to the owner before implementing a weaker policy. Do not reopen deferred redundant-record or automatic-generation-selection designs without a separate reason and approval.
