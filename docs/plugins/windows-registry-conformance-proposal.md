# Windows registry conformance fixture — proposal

**Status: proposed; awaiting owner approval. No fixture has been implemented or run.**

Writer's IDE's registry publisher prepares a new SQLite generation, selects it through an `active` file and acknowledges publication only after required persistence barriers. Windows publication is currently blocked. The [Windows contract review](registry-publication-investigation.md#windows-ordinary-user-argument-still-to-complete) identifies unresolved directory-flush and renamed-selector guarantees.

This proposal tests how supported Win32 operations behave under ordinary-user privileges. It does not test crash durability, qualify NTFS or provide a production Windows publisher. Approval of the preceding research authorized preparing this design, not implementing or executing it.

## Approval requested

Approve a private test-only implementation of the 20 cases below, including its opt-in execution, token checks, resource limits, failure retention and report format. Permit later manual execution only in a verified non-elevated Windows environment that meets preflight. Do not create a VM or provision storage under this approval.

The implementation would use existing Rust dependencies. It would add only Windows test-dependency features needed for read-only token and OS metadata queries: `Win32_Security`, `Win32_System_Threading` and `Win32_System_Registry`. Keep the current `windows-sys` version and existing Foundation/FileSystem features. No new package, runtime dependency or public API is proposed.

Approval would not authorize production adapters, qualification tokens, native-service alternatives such as `NtFlushBuffersFile`, workflow changes, elevated execution, fault injection or a different storage protocol.

## Placement and execution boundary

- Add a private module under the existing test-only `src-tauri/src/plugin_registry/publication_probe/` module. The proposed file is `windows_conformance.rs`. Portable controller logic and fake-worker tests may compile on every test platform. Gate all Win32 calls and real fixture entries with `cfg(windows)`. None of this module may compile into the application.
- Reuse the existing raw `MoveFileExW` test adapter. Implement handle-based operations privately in the fixture. Do not widen existing visibility or implement a runtime publisher adapter.
- Use the production 64-byte selector codec from `selector.rs` for old/new byte records. Do not use the older probe's 61-byte selector. Payloads are test records, not accepted generations. This fixture creates no SQLite database and never invokes publication, readiness or the lifecycle coordinator.
- Mark the controller and worker test entries ignored. Require a second explicit opt-in in addition to selecting the ignored test. Broad `--ignored` execution without that opt-in must refuse to start the fixture.
- The controller runs one worker subprocess at a time using the same test executable. Each worker performs one fixed case. An internal run nonce and enumerated case ID prevent accidental cross-run confusion; they are not credentials, authority or an adversarial sandbox.
- The current Native Registry workflow remains unchanged. Ordinary `cargo test --locked --lib` must not execute the matrix. An elevated hosted runner must not be treated as ordinary-user evidence.

## Preflight and permitted observations

Before creating case data, inspect the process token with `OpenProcessToken` and `GetTokenInformation`. Refuse an elevated token, enabled backup/restore/volume-management privileges, or unavailable token observations. Never call `AdjustTokenPrivileges`, impersonate another user or attempt elevation. Apply these checks in the controller and every worker. A refusal is not a completed matrix.

Use only the default OS temporary location, resolved for this process. Create a uniquely named run directory exclusively. Accept no caller-supplied storage path, drive, device, filename or API flag. Resolve and verify the run directory's filesystem and drive type. Require NTFS and a fixed-drive result; reject remote paths and unknown observations. A fixed virtual drive does not prove physical locality or honest cache behavior. Record that limit.

Collect bounded read-only environment data: architecture, token-check outcomes, NTFS observations and Windows product/build fields from `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`. Query only `ProductName`, `DisplayVersion`, `CurrentBuildNumber` and `UBR`; do not enumerate the registry. Label these as registry-reported values. Report unavailable fields explicitly, and do not infer a tested release from `windows-latest` or a product label alone. Record source revision, dirty state, Rust version/commit and test-executable SHA-256 through the controller's build/run metadata. Missing build identity prevents attributing a completed report to a revision.

Case-data mutation is confined to the new run directory. Report writes are restricted to the ignored output directory described below. Check fixture-created objects for reparse points and unexpected identities before use and cleanup. Refuse unexpected entries or identities. This is cooperative test isolation, not protection against a hostile process that can modify the same user's temporary files.

## Fixed operation matrix

All cases use fresh objects. A failed call is not retried with different access rights, flags or APIs. A later comparison case is a separate experiment, not a fallback. Capture `GetLastError` immediately after a failed BOOL/handle-returning operation; do not interpret a stale last-error value after success. APIs that return status codes directly retain those codes.

Use synchronous file handles. For non-blocking test handles, permit `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`. Directory opens use `OPEN_EXISTING`, `FILE_FLAG_BACKUP_SEMANTICS` and `FILE_FLAG_OPEN_REPARSE_POINT`. Ordinary file creation uses `CREATE_NEW` and no temporary/delete-on-close attribute. Do not use `FILE_FLAG_NO_BUFFERING`, overlapped I/O or alignment padding.

| Group                                  |  Cases | Setup and operation                                                                                                                                                                              | Interpretation                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File-flush controls                    |      3 | Write and flush an exact selector record with a buffered read/write handle; repeat with `FILE_FLAG_WRITE_THROUGH`; separately reopen a prepared record read-only and attempt `FlushFileBuffers`. | The two writable controls must succeed and preserve exact bytes. The read-only control must be rejected under the documented write-access requirement. A mismatch stops the matrix.                                                                                                                |
| Directory-flush observations           |      6 | At each of three roles, compare `GENERIC_READ` with `GENERIC_READ                                                                                                                                | GENERIC_WRITE`: generation directory after creating `payload.bin`; registry root after renaming a prepared selector to `active`; stable parent after creating the registry root. Call `FlushFileBuffers` on that role's handle.                                                                    | Record open and flush results separately. A failed open means flush was not attempted. Unsupported or denied directory flushing is a capability observation, not evidence of a crash failure. No access-right fallback occurs. |
| Existing raw move adapter              |      3 | Call the existing `MoveFileExW` adapter once for exclusive creation into an absent name, exclusive creation with an existing target, and replacement of an existing target.                      | Success cases must expose the exact new record. Exclusive refusal must retain both original records. Never enable copy/delete or reboot-delayed behavior.                                                                                                                                          |
| Handle-based rename                    |      3 | Use `SetFileInformationByHandle(FileRenameInfo)` for the same absent/existing/replacement scenarios. Open the source with `GENERIC_READ                                                          | GENERIC_WRITE                                                                                                                                                                                                                                                                                      | DELETE`; use a bounded absolute sibling destination with `RootDirectory = NULL`.                                                                                                                                               | Check the same visible-name and byte outcomes. No `FileRenameInfoEx` or POSIX-semantics flags are included. Record failure rather than substituting another rename operation. |
| Sharing observations                   |      4 | For each rename API, attempt replacement while a separate read handle on the target omits `FILE_SHARE_DELETE`, then in a fresh case while it includes `FILE_SHARE_DELETE`.                       | The blocking case must reject replacement without changing records. Compatible sharing permits the request but does not promise that every legacy replacement path accepts an open target. Record rejection as an observation. On success, check the new path and the old reader's retained bytes. |
| Write-through rename-handle comparison |      1 | Repeat the successful handle-based replacement case, changing only the source handle to include `FILE_FLAG_WRITE_THROUGH`.                                                                       | Compare the result with the buffered handle case. Success is an API/visibility observation, not proof that the rename or ancestor entries are durable.                                                                                                                                             |
| **Total**                              | **20** | One attempt per case.                                                                                                                                                                            | No repeated sampling, automatic retry or native fault injection.                                                                                                                                                                                                                                   |

For handle-based rename cases, flush the prepared source before selection and attempt a diagnostic `FlushFileBuffers` through that same handle after successful rename. Record the post-rename flush independently. Its failure must not cause rollback or rename retry. Prepare and inspect exact old/new selector records through the production codec. Close recorded handles before path-based inspection when sharing would otherwise affect that inspection. Never repeat the rename after closing a blocker.

The directory cases use a small namespace skeleton under their private case directory. `payload.bin` is bounded ordinary data, not a SQLite file. File-write preparation and selector rename results must be checked before the directory flush is observed. The fixture records current names and bytes only. It cannot show which entries survive volatile-state loss.

## Allowed native surface

The proposed mutation surface is `CreateDirectoryW`, `CreateFileW`, bounded synchronous `WriteFile`, `FlushFileBuffers`, the existing `MoveFileExW` adapter, `SetFileInformationByHandle(FileRenameInfo)`, and owned-object deletion/handle close. Permit read-only file/type/volume/identity queries, byte reads, token queries and the four registry values listed above. Rust temporary-directory, process, clock and report helpers remain test-only.

Exclude volume/device handles, raw disk I/O, volume flushes, `DeviceIoControl` storage commands, `Nt`/`Zw` flush APIs, privileges, drivers, TxF, `ReplaceFileW`, hard links, ACL modification, forced handle closure in another process, and production registry paths. No existing guest or host disk images are opened.

## Limits and supervision

Proposed fixed limits:

| Resource                           | Limit                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| Matrix                             | 20 cases plus one preflight worker; sequential execution |
| Active workers                     | 1                                                        |
| Worker deadline                    | 10 seconds from spawn, including startup                 |
| Whole-run deadline                 | 5 minutes, including setup and cleanup                   |
| Fixture-created filesystem objects | 256 files/directories across the run                     |
| Total file payload written         | 1 MiB; selector records remain exactly 64 bytes          |
| Worker handles                     | At most 16 simultaneously, all owned by that worker      |
| Worker output                      | 32 KiB per worker; bounded structured records            |
| Retained machine-readable report   | 1 MiB per run                                            |

The parent drains both stdout and stderr while monitoring the child. Their combined size is subject to the worker-output limit. Parse only bounded, prefixed fixture records; test-harness banners and private diagnostics must not be copied into the shareable report. It must not wait for process exit before reading a potentially full pipe. On timeout, malformed/oversized output, an invalid case identity, unexpected mutation or a required-control mismatch, stop scheduling cases. Request termination and reap the active child before cleanup. Do not wait indefinitely for termination: report an unresolved child if bounded waiting fails. Windows or a filter driver may delay cancellation of blocked I/O; deadlines bound supervision attempts, not a guarantee that the OS completes cancellation or cleanup.

A child killed for a timeout is not a simulated crash-durability test. It only limits a conformance operation that failed to return.

## Results, privacy and cleanup

Write one run-ID-specific report under the proposed ignored output directory `src-tauri/target/registry-windows-conformance/`. Its private schema would be `writers-ide.registry-windows-conformance/1`. The controller initializes the report before the matrix and checkpoints bounded results after each case. Report-write failures stop further cases. Do not overwrite an earlier report.

Include the environment/build attribution, case ID, API, requested access/share/flag values, whether each call was attempted, return value/error code, elapsed time, exact-byte/codec checks, cleanup outcome and any incomplete work. Distinguish completed observations, preflight refusal, invariant failure and incomplete/timeout outcomes. A directory flush failure can appear in a completed observation report; it must not be described as publisher success. No result grants qualification.

Every report must state `qualified = false`, `runtime_publication_enabled = false` and `physical_power_loss_tested = false`. Omit usernames, SIDs, absolute paths, volume identifiers/serials, raw registry contents outside the allowed fields and unbounded formatted OS errors. Use logical case paths in JSON. A retained scratch directory's locator may be printed privately to the operator; it is not part of a shareable report. Do not add artifact uploads or new workflow execution in this slice.

Keep a separate private ownership receipt in the run directory, bounded to 64 KiB and included in the object/payload budgets. Record the current user's identity, run-root identity and created-object identities there. These private cleanup identifiers are not part of the shareable report. If receipt recording fails, stop and retain the tree; do not guess which unrecorded objects are safe to remove.

On normal completion, explicitly close owned handles and remove only the recorded fixture objects, deepest first. Do not rely on unconditional recursive temporary-directory destruction. Preserve the report. If an unexpected entry, changed identity, open/unreaped child or deletion failure prevents safe cleanup, leave the affected tree intact and report cleanup incomplete. Do not follow reparse points, repair ACLs or retry failed cleanup automatically.

On an invariant failure or timeout, retain scratch files for inspection after closing/reaping what can be closed safely. A later cleanup action needs explicit operator intent and the same ownership/identity checks. Accept only an enumerated cleanup action and a validated run ID, then derive the run location under the current default temporary directory. Require a non-elevated token, the same user and a matching private receipt. No cleanup action may take a caller-supplied deletion root. Retention is bounded by this single run's limits, not permission for an automatic second run.

## Validation and acceptance

Implementation approval would require portable tests for the fixed matrix/count, result classification, output/report bounds, opt-in checks, deadline handling, and fake-worker cleanup/refusal behavior. Test timeout behavior with fake workers rather than deliberately stalling a native filesystem operation. Existing selector-codec regressions remain the byte-format checks.

Windows validation must include compilation, formatting, all-target Clippy and the ordinary library suite with native entries still ignored. The matrix itself requires a separately verified non-elevated Windows/NTFS run. If only an elevated runner is available, validate refusal and report that ordinary-user execution remains missing. Do not silently skip it and call the matrix passed. Linux/macOS checks can validate portable control logic but cannot establish Windows API behavior.

If this design is approved, acceptance means the implementation stayed within that scope, collected attributable observations and preserved limits/failure evidence. It does not mean every directory flush succeeded, the publisher is safe to enable, or any platform is qualified. Review the findings against the [Windows dependency assessment](registry-publication-investigation.md#windows-dependency-assessment) before proposing any runtime adapter or storage experiment.
