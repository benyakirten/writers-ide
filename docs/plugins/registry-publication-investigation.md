# Registry generation publication investigation

**Status: owner-authorized test-only harness, implemented / unmerged. Production publication remains gated.** This guide covers platform research and the compiled Rust publication experiment in [`publication_probe/`](../../src-tauri/src/plugin_registry/publication_probe/mod.rs). Earlier disposable Python probes are historical evidence, not the current implementation. Authorization covers the test-only adapter and regressions. It does not approve production startup wiring, a public selector format or a Windows durability guarantee.

## Purpose

The plugin registry stores installation records and permission decisions in SQLite. Restoration prepares a replacement database in a separate directory. A small metadata file, called the **selector** here, identifies the active directory. Publishing a restore means changing that selector. It does not mean replacing a live SQLite database file.

The [foundation guide](registry-foundation.md#approved-registry-generation-layout) approves separate generation directories, a single selector and preservation of old generations. Missing or invalid selection metadata requires plugin-free recovery. An uncertain publication returns `OutcomeUnknown`, with no usable service and no automatic retry or switch-back.

The internal registry already implements database transactions, backup and restore-data preparation. Production selector publication, an application lifecycle coordinator and first-run integration remain absent. The test harness exercises selector publication and controlled opening in isolated temporary directories. See the [implementation guide](registry-implementation-review.md).

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

| Source                                                               | Implemented behavior                                                                                 | Missing publication responsibility                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`store.rs`](../../src-tauri/src/plugin_registry/store.rs)           | Per-database ownership, WAL/FULL configuration and readiness validation                              | Registry-location ownership spanning generation changes          |
| [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs)         | Admission closure, draining and cleanup; `cfg(test)` startup/lifetime lease hooks                    | Production location-lease wiring and checked maintenance sealing |
| [`recovery.rs`](../../src-tauri/src/plugin_registry/recovery.rs)     | SQLite-aware copy, validated restore transformations, explicit target close and file synchronization | Generation-directory and selector publication                    |
| [`migrations.rs`](../../src-tauri/src/plugin_registry/migrations.rs) | Private static-chain infrastructure, backup before transactional schema changes                      | Application startup upgrade orchestration                        |

Normal worker shutdown drops the store. It is not a checked maintenance seal. The separate test-only [`sealing.rs`](../../src-tauri/src/plugin_registry/publication_probe/sealing.rs) checks a prepared connection before publication. [`platform.rs`](../../src-tauri/src/plugin_registry/publication_probe/platform.rs) contains native move and directory-barrier candidates. The harness does not replace normal shutdown or connect publication to application startup.

`cargo test --lib` drives the harness. Tests supply finite limits, private fixture identifiers and isolated temporary directories. No application entry point calls it. [`tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/tests.rs) exercises faults and readiness. [`process_tests.rs`](../../src-tauri/src/plugin_registry/publication_probe/process_tests.rs) launches the test executable as a child for process-exit and cross-process ownership cases.

The restore helper preserves logical source/current database data. SQLite read-only opens can still require or create shared-memory/WAL sidecars when permissions allow it. Do not interpret logical preservation as a promise of no filesystem activity. Do not set SQLite's `immutable` URI flag on a crash-left WAL database to avoid that activity; that flag assumes facts that have not been established.

## Ownership and first-time setup

**Implemented in the authorized test-only adapter:** `LocationLease` holds a persistent lock beside the dedicated registry root. It uses an `Arc<File>` so test coordinators and the actual worker can retain the same lease. The existing per-database locks remain additional protection. Production openers do not yet acquire this location lease.

Acquire this lease **before checking whether the registry location exists**. Place its lock file beside that location in the stable application-data parent, not inside a generation or the selector. Creating the registry directory merely to place a lock inside it would conflict with the approved first-run rule: an existing empty location is not automatically a fresh installation.

Under the lease:

- If the dedicated registry location is absent, claim it through exclusive, non-overwriting creation.
- If it exists, read and validate the selector. Missing or invalid metadata requires recovery, not initialization.
- Retain ownership across ordinary operation, shutdown draining, maintenance, publication and fresh opening.
- Make fallback worker draining retain the lease too. Dropping the application owner must not release it while admitted writes continue.
- Never replace or unlink the lock file while it can be held. Replacing its inode can create independent owners.

All production openers must follow this path. Merely adding a lock to the publisher does not stop another opener from reading the selector during maintenance. The lease is not a security boundary against arbitrary native programs modifying application data.

The `cfg(test)` `ProbeStartup` hook passes the lease into the actual worker before awaiting startup. The worker retains it through cleanup if the startup future is abandoned or the owner is dropped. Two regressions in [`worker_tests.rs`](../../src-tauri/src/plugin_registry/worker_tests.rs) check startup cancellation and owner-drop draining. Attaching a lease only after readiness would leave abandoned startup unprotected.

`ProbeSession` also prototypes a cleanup thread that awaits shutdown while retaining the lease. This is test scaffolding, not the selected production coordinator architecture. Production lifecycle contracts and application single-instance forwarding remain unchanged.

## SQLite preparation and sealing

SQLite WAL commits may reside in `registry.sqlite-wal`, not the main file. Copying or synchronizing only the main file while committed WAL pages remain is unsafe. The current backup API correctly copies the logical database. Its step loop requires completion and rejects contention rather than waiting indefinitely. See [SQLite backup](https://sqlite.org/c3ref/backup_finish.html) and [WAL](https://sqlite.org/wal.html).

For publication, prepare the new generation directly at its final directory and database basename. There is no need to rename either the database or its directory. Keep all sidecars with the database to which they belong. Never manually delete a crash-left WAL or journal to make the directory look clean. See [SQLite corruption hazards](https://sqlite.org/howtocorrupt.html).

**Approved production handoff; not implemented:** checked sealing will return an opaque private Rust value bound to the prepared physical generation and its retained ownership. Publication consumes that value, not an arbitrary database path. Normal preparation APIs cannot reopen or modify the sealed generation through it. The value requires successful validation, WAL checkpointing, checked SQLite close and synchronization of the closed database file. It does not certify directory barriers or selector publication; those checks remain separate. It enforces internal ordering, not authentication or protection against external file modification. Any returned connection on failure remains owned by the recovery-only coordinator. This does not enable Windows publication or choose a selector format. See the [ownership contract](registry-implementation-review.md#approved-production-ownership-boundary).

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

Apple distinguishes ordinary `fsync` from `F_FULLFSYNC`, which also asks the drive to flush buffered data. Device support still matters. See [Apple fsync](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) and [fcntl](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html).

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

The [consolidated Rust contract proposal](registry-implementation-review.md#consolidated-rust-contract-proposal) assembles the approved policies into a draft for owner review. The owner resolved the shutdown race identified by source review: shutdown or owner drop sets a persistent flag that immediately blocks new admission and ready-handle acquisition. Admitted maintenance completes its single attempt and records its outcome, then proceeds directly to cleanup without exposing a fresh service or waiting for interactive recovery. The location lock remains held through cleanup. Abandoning the shutdown waiter does not reverse shutdown or interrupt cleanup. Lifecycle revisions must also reject values from other coordinator lifetimes; this preserves the approved stale-request check. Concrete contracts and cleanup mechanics still need approval before production implementation. Selector encoding and application wiring remain separately gated. This approval does not promote the test-only cleanup thread or fixture format into production.

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

The private selector fixture is exactly **61 bytes**: the 13-byte magic `WIDE-PROBE-1\n`, a 16-byte generation ID and a 32-byte SHA-256 checksum of the preceding bytes. Parsing checks exact length, magic and checksum. It resolves the opaque ID within the fixture layout, not as an arbitrary path or logical namespace. The checksum detects malformed fixture metadata; it does not authenticate anything. This encoding is test-only, not a public or production format. Production encoding remains open. The mutable database is not checksummed as an immutable artifact; ordinary registry writes change it.

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

The current macOS publication-module suite has **34 tests**, including the missing/unusable selected-database regression. The two worker lease regressions are outside that module. Coverage includes:

- First creation and replacement through actual ready registry workers; old handles stay closed.
- Missing, invalid, oversized and checksummed selector parsing. An unusable selected database requires recovery without choosing a valid sibling.
- Fault injection at every named preparation/publication phase. Prepublication failures preserve staging and the old selection. Uncertain replacement/barrier outcomes return no session, preserve generations and do not retry or switch back.
- Partial selector writes followed by `WriteZero`, with partial staging preserved.
- Actual readiness failure after publication, by deleting a required settings row before fresh opening. The new selector remains selected; no fallback occurs.
- Child publisher exits before/after replacement, after the directory barrier and before reopening. Interrupted first creation requires recovery, not automatic resumption.
- Cross-process lease competition and lock release after a child is killed. Children have timeouts and kill/reap guards.

**Parent-run validation on macOS:** `cargo test --lib` passed **213 library tests**; `cargo check --lib`, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` all passed. The 34-test module result includes the added missing-selected-database case; the earlier 33-test subset is not the final suite. The two worker lease tests cover startup cancellation and owner-drop draining, not production lease integration. See the [cumulative record](change-log.md#native-registry-design).

The new [Native Registry workflow](../../.github/workflows/native_registry.yml) is configured for `macos-15`, `windows-latest` and `ubuntu-24.04` with stable Rust. It runs formatting, the full locked library suite and locked all-target Clippy. After the LF/CRLF documentation-test correction, remote formatting, complete library suites and all-target Clippy passed on macOS 15, Windows latest and Ubuntu 24.04. Minimum-macOS results remain unavailable. See the [verified run and local correction](change-log.md#native-registry-design). Platform-conditional tests differ; the macOS count is not a promised count on every OS.

These are runtime, failure-handling and barrier-call observations. They are not power-loss, kernel-crash, reboot, physical-device persistence, packaged-app or production authorization evidence.

## Recommended next work

1. Use the approved single-coordinator ownership boundary to prepare concrete Rust method/result and cleanup contracts for shared ownership and checked sealing. Review those contracts before implementation. The prototype changes no plugin SDK contracts.
2. Retain Windows publication as required follow-up research, not optional backlog or permanent exclusion. Define supported storage assumptions and success criteria, and resolve the evidence gap before enabling it. The owner approved keeping it blocked in the meantime, not reducing its guarantees.
3. Keep the authorized adapter, selector encoding, cleanup-thread prototype and worker hooks test-only. Production startup/publication still requires separate approval.
4. Maintain the implemented fault, sealing, lease and reopening regressions. Extend evidence where platform runs expose unsupported assumptions; do not silently weaken barriers to make a test pass.
5. Use OS CI for Windows/Linux and a minimum-macOS validation environment. Run process-termination tests separately from power-loss/storage testing. CI termination alone does not establish power-loss behavior.
6. Only after the protocol and evidence are accepted, implement the application lifecycle owner and production publication. Do not enable external plugins as a side effect.

The approved missing-selector recovery policy already handles unusable metadata. It does not prove durability of an operation reported as successful. If validation cannot justify the required Windows success condition, present the exact proposed guarantee and remaining risk to the owner before implementing a weaker policy. Do not reopen deferred redundant-record or automatic-generation-selection designs without a separate reason and approval.
