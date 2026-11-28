# Windows registry conformance fixture

**Status: owner-approved and implemented / unmerged. A reviewed owner-pasted report records successful preflight, all 20 cases and confirmed cleanup. No storage qualification or production enablement follows.**

Writer's IDE's registry publisher prepares a new SQLite generation, selects it through an `active` file and acknowledges publication only after required persistence barriers. Windows publication is currently blocked. The [post-conformance contract assessment](registry-publication-investigation.md#post-conformance-contract-assessment) distinguishes documented flush primitives, observed cases and unresolved full publication dependencies.

This test-only fixture observes how supported Win32 operations behave under ordinary-user privileges. It does not test crash durability, qualify NTFS or provide a production Windows publisher. The owner approved implementation and later manual execution only when ordinary-user Windows/NTFS preflight succeeds. A reviewed owner-pasted report records a completed corrected run on non-elevated Windows ARM64/fixed NTFS. Its fresh-helper hash and source/compiler observations match within the supplied evidence. This remains cooperative attribution, not independent binary reproduction. See [current Windows evidence](#current-windows-evidence) for attribution and remaining gaps.

## Approved boundary

The approved scope is the 20 cases below, including opt-in execution, token checks, resource limits, failure retention and the private report format. Manual execution requires successful preflight in a verified non-elevated Windows environment. Fixture approval alone does not authorize VM creation or storage provisioning. The owner separately created the Windows VM described in the [current evidence](#current-windows-evidence).

The implementation uses existing Rust dependencies. It adds only Windows test-dependency features needed for read-only token and OS metadata queries: `Win32_Security`, `Win32_System_Threading` and `Win32_System_Registry`. The `windows-sys` version and existing Foundation/FileSystem features are unchanged. There is no new package, runtime dependency or public API.

Approval does not authorize production adapters, qualification tokens, native-service alternatives such as `NtFlushBuffersFile`, workflow changes, elevated execution, fault injection or a different storage protocol.

## Placement and execution boundary

- The private controller is [`windows_conformance.rs`](../../src-tauri/src/plugin_registry/publication_probe/windows_conformance.rs), under the existing test-only publication probe. Portable controller logic and fake-worker tests may compile on every test platform. Gate all Win32 calls and real fixture entries with `cfg(windows)`. None of this module may compile into the application.
- Reuse the existing raw `MoveFileExW` test adapter. Implement handle-based operations privately in the fixture. Do not widen existing visibility or implement a runtime publisher adapter.
- Use the production 64-byte selector codec from `selector.rs` for old/new byte records. Do not use the older probe's 61-byte selector. Payloads are test records, not accepted generations. This fixture creates no SQLite database and never invokes publication, readiness or the lifecycle coordinator.
- Mark the controller, worker and read-only `inspect_token` test entries ignored. Require a second explicit opt-in in addition to selecting the ignored test. Broad `--ignored` execution without that opt-in must refuse to start the fixture.
- The controller runs one worker subprocess at a time using the same test executable. Each worker performs one fixed case. An internal run nonce and enumerated case ID prevent accidental cross-run confusion; they are not credentials, authority or an adversarial sandbox.
- The current Native Registry workflow remains unchanged. Ordinary `cargo test --locked --lib` must not execute the matrix. An elevated hosted runner must not be treated as ordinary-user evidence.

## Preflight and permitted observations

Before creating case data, inspect the process token with `OpenProcessToken` and `GetTokenInformation`. Refuse an elevated token, enabled backup/restore/volume-management privileges, or unavailable token observations. Never call `AdjustTokenPrivileges`, impersonate another user or attempt elevation. Apply these checks in the controller and every worker. A refusal is not a completed matrix. The implemented, unmerged diagnostic reporting retains a static failure context and optional native error code without changing these checks. Controller refusals store and print those fields before build validation or worker execution.

Use only the default OS temporary location, resolved for this process. Create a uniquely named run directory exclusively. Accept no caller-supplied storage path, drive, device, filename or API flag. Resolve and verify the run directory's filesystem and drive type. Require NTFS and a fixed-drive result; reject remote paths and unknown observations. A fixed virtual drive does not prove physical locality or honest cache behavior. Record that limit.

Collect bounded read-only environment data: architecture, token-check outcomes, NTFS observations and Windows product/build fields from `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`. Query only `ProductName`, `DisplayVersion`, `CurrentBuildNumber` and `UBR`; do not enumerate the registry. Label these as registry-reported values. Report unavailable fields explicitly, and do not infer a tested release from `windows-latest` or a product label alone. Record source revision, dirty state, Rust version/commit and test-executable SHA-256 through the controller's build/run metadata. Missing build identity prevents attributing a completed report to a revision.

Case-data mutation is confined to the new run directory. Report writes are restricted to the ignored output directory described below. Check fixture-created objects for reparse points and unexpected identities before use and cleanup. Refuse unexpected entries or identities. This is cooperative test isolation, not protection against a hostile process that can modify the same user's temporary files.

## Building and running on Windows

Run these instructions from the repository root in **non-elevated Windows PowerShell**, not macOS Terminal or the Linux VM. The owner supplied successful helper output from native Windows PowerShell 5.1. Helper output alone is not independent reproduction or a completed matrix; the separately supplied completed report is discussed below. Do not bypass a machine's script policy. A session-only `RemoteSigned` setting is permitted only with owner approval and no managed policy; do not override machine/user policy or use `Bypass`.

Initialize the matching MSVC compiler environment before starting PowerShell so the helper inherits it. On the owner's ARM64 VM, automatic compiler discovery failed; explicitly initializing `vcvarsall.bat arm64 -vcvars_ver=14.44` resolved the build setup. Use the installed, matching compiler and SDK. The helper does not initialize that environment for you.

The [build-only helper](../../tooling/registry-windows-conformance/build.ps1) compiles the library test executable without running tests. It uses an exclusively created fresh target directory under `src-tauri/target/registry-windows-conformance-build/` and two build jobs. It compares bounded source fingerprints and compiler identities before and after the build, then records the executable hash. Do not edit source or change toolchains during the build. These are cooperative endpoint observations, not proof against changes that occur and are restored between observations. Ignored/external build inputs are not a complete authenticated source snapshot.

Build records are created without overwriting prior records under `src-tauri/target/registry-windows-conformance/`. After the controller token check and before scratch creation or worker preflight, the controller requires a matching record for its own executable hash. Runtime checkout/compiler observations are labeled separately. Missing or mismatched build records stop the run. Do not rebuild through a different Cargo invocation and assume the record still matches.

```powershell
$build = & .\tooling\registry-windows-conformance\build.ps1
if ($null -eq $build) { throw 'Build attribution was not created.' }
$env:WIDE_WINDOWS_CONFORMANCE_OPT_IN = '1'
$env:WIDE_WINDOWS_CONFORMANCE_ACTION = 'execute'
Remove-Item Env:WIDE_WINDOWS_CONFORMANCE_RUN_ID -ErrorAction SilentlyContinue
try {
    & $build.Executable --ignored --exact plugin_registry::publication_probe::windows_conformance::run_fixture --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Conformance refused or incomplete; inspect its retained report.' }
} finally {
    Remove-Item Env:WIDE_WINDOWS_CONFORMANCE_OPT_IN -ErrorAction SilentlyContinue
    Remove-Item Env:WIDE_WINDOWS_CONFORMANCE_ACTION -ErrorAction SilentlyContinue
}
```

The helper returns the actual executable path privately to this PowerShell session. The fixture does not accept storage paths. The report and any retained scratch locator are printed privately; no artifact upload or workflow step is added. Build outputs are ordinary developer artifacts and are not covered by the small case-data budgets below. The helper bounds captured tool output to 8 MiB, source fingerprint inputs to 10,000 files/256 MiB and the Cargo build to ten minutes, subject to blocked-I/O limitations.

For later explicit cleanup, use the same attributed executable and session. Set `WIDE_WINDOWS_CONFORMANCE_ACTION` to `cleanup`, set `WIDE_WINDOWS_CONFORMANCE_OPT_IN` to `1`, and supply the exact retained report's `run_id` through `WIDE_WINDOWS_CONFORMANCE_RUN_ID`. Invoke the same `run_fixture` entry. Remove those fixture environment variables afterward. Never supply a directory path or choose a run by guessing. A new cleanup report records partial or unconfirmed removal. An active worker's exclusive admission guard blocks a separate cleanup invocation.

### Optional read-only token diagnostic

The elevation-query correction and `inspect_token` diagnostic are implemented / unmerged. After applying the incremental correction, the owner reports 38 focused Windows tests passed and this exact ignored diagnostic passed once. Full summaries/logs were not supplied, and the results were not independently verified. This establishes reported corrected-code compilation and native token-only success, not full Windows validation. Unlike the matrix controller, this ignored Windows-only entry calls only `native::check_token`. It performs no filesystem setup, build-record validation, matrix work or cleanup. It requires `WIDE_WINDOWS_CONFORMANCE_OPT_IN=1` but does not read `WIDE_WINDOWS_CONFORMANCE_ACTION` or need a build manifest.

The focused commands below remain available for token-only checks from `src-tauri`, in the non-elevated Windows PowerShell session with the inherited compiler environment described above. Cargo can reuse the normal build; the build-only helper is not required for these checks. Latest corrected-source full Windows library-suite, library-check and all-target Clippy results remain unconfirmed. The subsequent completed matrix report does not supply them. A fresh helper build was supplied for that run. Do not repeat the completed matrix or perform explicit cleanup merely to fill the ordinary-check evidence gap. Token-only success alone is never matrix authorization or completed filesystem preflight.

```powershell
cargo test --locked --lib --jobs 2 windows_conformance
if ($LASTEXITCODE -ne 0) { throw 'Focused tests failed; stop before the token diagnostic.' }
```

```powershell
$env:WIDE_WINDOWS_CONFORMANCE_OPT_IN = '1'
try {
    cargo test --locked --lib --jobs 2 plugin_registry::publication_probe::windows_conformance::inspect_token -- --ignored --exact --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Token diagnostic refused or failed; retain its output.' }
} finally {
    Remove-Item Env:WIDE_WINDOWS_CONFORMANCE_OPT_IN -ErrorAction SilentlyContinue
}
```

The entry prints admission success or a static refusal context with an optional native code. Retain its output for review. Success establishes only that this process passed token admission. It does not validate NTFS, build attribution or any matrix case. The Cargo command may create ordinary compiler output; the diagnostic itself performs no filesystem setup. Do not treat it as a matrix retry. A completed matrix must use an executable and build record for its actual source. The supplied completed report uses a fresh-helper hash, not the earlier stale executable. Never reuse an old manifest for a rebuilt executable.

## Current Windows evidence

The owner supplied the full 61,181-byte JSON report for a subsequent corrected approved run. Its status is `completed_observations_not_qualified`. Reviewed transcript evidence records successful non-elevated Windows ARM64/fixed-NTFS preflight, all 20 unique cases and confirmed cleanup. No worker failure, timeout or unresolved child is reported. Cleanup dispatch, attempt and completion are confirmed, with `cleanup_complete = true` and no operator intervention required. This is report evidence, not independent filesystem inspection. No retry or explicit cleanup is needed. Preserve the original token-refusal report separately; it was not changed into a success report.

The JSON was pasted by the owner, not independently downloaded or hashed. Its build record is available and matches the supplied fresh-helper hash. Source revision, dirty state and compiler observations agree between build and invocation. Two transferred code patches account for the dirty checkout; this is not evidence for the clean baseline alone. Attribution remains cooperative, without authenticated independent binary reproduction. Detailed report identity, hashes and registry-reported build fields are in the [cumulative evidence record](change-log.md#native-registry-design).

Buffered and write-through writable file controls passed exact 64-byte production-codec checks; read-only flush refused. All six directory opens succeeded. Read-only directory flushes refused, while read/write directory flushes succeeded for generation, root and stable parent. Both rename APIs passed absent-target and closed-target replacement cases and refused exclusive creation over an existing target. Both also refused replacement with either tested open-reader sharing mode, including delete-compatible sharing. Successful handle-based renames and the write-through comparison passed post-rename flush checks. See the [compact findings and limits](registry-publication-investigation.md#decision-gate-and-bounded-follow-up).

These are observed cases, not POSIX replacement semantics or storage qualification. The native `FILE_RENAME_INFORMATION` contract restricts open targets. `FILE_SHARE_DELETE` permits access sharing; it does not promise legacy replacement of an open target. Extended POSIX rename flags were not tested or adopted. Unchanged source records in refused cases do not establish a general every-error guarantee. Selection-attempt errors remain `OutcomeUnknown` in the publisher.

**Current assessment:** Microsoft documents directory-structure flushing in MS-FSA, with an NTFS-specific implementation note. The [post-conformance assessment](registry-publication-investigation.md#post-conformance-contract-assessment) explains why this documented primitive and the observed writable flushes do not yet establish the full local Win32 persistence contract. The [dependency assessment](registry-publication-investigation.md#windows-dependency-assessment) maps the remaining gaps. The fixture's handle-held rename comparison is not a drop-in replacement for the publisher, which closes the source before path selection. Its generation/root/stable-parent barriers precede selection; the final root barrier follows selection.

**Deferred future work:** the owner paused the remaining persistence-contract investigation while independent plugin work continues. Preserve the [questions about child bindings, supporting metadata, newly created parents and rename recovery](registry-publication-investigation.md#windows-contract-clarification-request). They may be revisited through public-source review or separately approved evidence. Contacting Microsoft is optional; no external submission or paid support is planned. Do not repeat the completed matrix merely to ask whether directory flushing can succeed. No Windows protocol is approved. Physical locality, cache honesty, x64/minimum-version coverage and cache/crash evidence remain open. API availability minima do not establish an approved Windows baseline. All report/result qualification, runtime-publication and physical-power-loss flags remain false. Production preflight remains `Unavailable`; Windows candidates remain `Unsupported`.

The implemented / unmerged correction uses a typed four-byte `TOKEN_ELEVATION` query through a mockable helper. It requires the exact returned size and rejects nonzero elevation or API failure. Bounded 16 KiB variable-length user and privilege queries, diagnostic contexts and controller reporting remain unchanged. No gate bypass is introduced. Three Windows-only fake-query regressions are implemented. Current host formatting, portable tests, full library suite, library check and all-target Clippy passed. An isolated Windows GNU test-target check also compiled and linted the current code and all three regressions with warnings denied. The isolated check itself is not a full Windows-project build or Windows test execution. The owner subsequently reports `cargo test --locked --lib --jobs 2 windows_conformance` passed 38 tests and the exact ignored `inspect_token` test passed one test after applying the correction. These aggregate results were not independently verified; full summaries/logs were not supplied. Do not infer individual regression results from the aggregate count. The token-only diagnostic performed no filesystem setup, NTFS checks, build-record validation or matrix work. The original refused invocation created no scratch directory. The owner supplied a fresh-helper result and completed matrix JSON, but latest corrected-source Windows full-suite, check and Clippy results remain unconfirmed. The earlier owner-reported full checks predate the transferred patches. Do not infer latest ordinary-check counts or success from matrix completion.

## Fixed operation matrix

All cases use fresh objects. A failed call is not retried with different access rights, flags or APIs. A later comparison case is a separate experiment, not a fallback. Capture `GetLastError` immediately after a failed BOOL/handle-returning operation; do not interpret a stale last-error value after success. APIs that return status codes directly retain those codes.

Use synchronous file handles. For non-blocking test handles, permit `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`. Directory opens use `OPEN_EXISTING`, `FILE_FLAG_BACKUP_SEMANTICS` and `FILE_FLAG_OPEN_REPARSE_POINT`. Ordinary file creation uses `CREATE_NEW` and no temporary/delete-on-close attribute. Do not use `FILE_FLAG_NO_BUFFERING`, overlapped I/O or alignment padding.

| Group                                  |  Cases | Setup and operation                                                                                                                                                                                                                                                                                      | Interpretation                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File-flush controls                    |      3 | Write and flush an exact selector record with a buffered read/write handle; repeat with `FILE_FLAG_WRITE_THROUGH`; separately reopen a prepared record read-only and attempt `FlushFileBuffers`.                                                                                                         | The two writable controls must succeed and preserve exact bytes. The read-only control must be rejected under the documented write-access requirement. A mismatch stops the matrix.                                                                                                                |
| Directory-flush observations           |      6 | At each of three roles, compare `GENERIC_READ` with `GENERIC_READ` plus `GENERIC_WRITE`: generation directory after creating `payload.bin`; registry root after renaming a prepared selector to `active`; stable parent after creating the registry root. Call `FlushFileBuffers` on that role's handle. | Record open and flush results separately. A failed open means flush was not attempted. Unsupported or denied directory flushing is a capability observation, not evidence of a crash failure. No access-right fallback occurs.                                                                     |
| Existing raw move adapter              |      3 | Call the existing `MoveFileExW` adapter once for exclusive creation into an absent name, exclusive creation with an existing target, and replacement of an existing target.                                                                                                                              | Success cases must expose the exact new record. Exclusive refusal must retain both original records. Never enable copy/delete or reboot-delayed behavior.                                                                                                                                          |
| Handle-based rename                    |      3 | Use `SetFileInformationByHandle(FileRenameInfo)` for the same absent/existing/replacement scenarios. Open the source with `GENERIC_READ` plus `GENERIC_WRITE` plus `DELETE`; use a bounded absolute sibling destination with `RootDirectory = NULL`.                                                     | Check the same visible-name and byte outcomes. No `FileRenameInfoEx` or POSIX-semantics flags are included. Record failure rather than substituting another rename operation.                                                                                                                      |
| Sharing observations                   |      4 | For each rename API, attempt replacement while a separate read handle on the target omits `FILE_SHARE_DELETE`, then in a fresh case while it includes `FILE_SHARE_DELETE`.                                                                                                                               | The blocking case must reject replacement without changing records. Compatible sharing permits the request but does not promise that every legacy replacement path accepts an open target. Record rejection as an observation. On success, check the new path and the old reader's retained bytes. |
| Write-through rename-handle comparison |      1 | Repeat the successful handle-based replacement case, changing only the source handle to include `FILE_FLAG_WRITE_THROUGH`.                                                                                                                                                                               | Compare the result with the buffered handle case. Success is an API/visibility observation, not proof that the rename or ancestor entries are durable.                                                                                                                                             |
| **Total**                              | **20** | One attempt per case.                                                                                                                                                                                                                                                                                    | No repeated sampling, automatic retry or native fault injection.                                                                                                                                                                                                                                   |

For handle-based rename cases, flush the prepared source before selection and attempt a diagnostic `FlushFileBuffers` through that same handle after successful rename. Record the post-rename flush independently. Its failure must not cause rollback or rename retry. Prepare and inspect exact old/new selector records through the production codec. Close recorded handles before path-based inspection when sharing would otherwise affect that inspection. Never repeat the rename after closing a blocker.

The directory cases use a small namespace skeleton under their private case directory. `payload.bin` is bounded ordinary data, not a SQLite file. File-write preparation and selector rename results must be checked before the directory flush is observed. The fixture records current names and bytes only. It cannot show which entries survive volatile-state loss.

## Allowed native surface

The mutation surface is `CreateDirectoryW`, `CreateFileW`, bounded synchronous `WriteFile`, `FlushFileBuffers`, the existing `MoveFileExW` adapter, `SetFileInformationByHandle(FileRenameInfo)`, and owned-object deletion/handle close. Permit read-only file/type/volume/identity queries, byte reads, token queries and the four registry values listed above. Rust temporary-directory, process, clock and report helpers remain test-only.

Exclude volume/device handles, raw disk I/O, volume flushes, `DeviceIoControl` storage commands, `Nt`/`Zw` flush APIs, privileges, drivers, TxF, `ReplaceFileW`, hard links, ACL modification, forced handle closure in another process, and production registry paths. No existing guest or host disk images are opened.

## Limits and supervision

Fixed limits:

| Resource                           | Limit                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Matrix                             | 20 cases, separate preflight and cleanup workers; sequential execution |
| Active workers                     | 1                                                                      |
| Worker deadline                    | 10 seconds from spawn, including startup                               |
| Whole-run deadline                 | 5 minutes, including setup and cleanup                                 |
| Fixture-created filesystem objects | 256 files/directories across the run                                   |
| Total file payload written         | 1 MiB; selector records remain exactly 64 bytes                        |
| Worker handles                     | At most 16 simultaneously, all owned by that worker                    |
| Worker output                      | 32 KiB per worker; bounded structured records                          |
| Retained machine-readable report   | 1 MiB per run                                                          |

The parent drains both stdout and stderr while monitoring the child. Their combined size is subject to the worker-output limit. Parse only bounded, prefixed fixture records; test-harness banners and private diagnostics must not be copied into the shareable report. It must not wait for process exit before reading a potentially full pipe. On timeout, malformed/oversized output, an invalid case identity, unexpected mutation or a required-control mismatch, stop scheduling cases. Request termination and reap the active child before cleanup. Do not wait indefinitely for termination: report an unresolved child if bounded waiting fails. Windows or a filter driver may delay cancellation of blocked I/O; deadlines bound supervision attempts, not a guarantee that the OS completes cancellation or cleanup.

A child killed for a timeout is not a simulated crash-durability test. It only limits a conformance operation that failed to return.

## Results, privacy and cleanup

Write one run-ID-specific report under the ignored output directory `src-tauri/target/registry-windows-conformance/`. Its private schema is `writers-ide.registry-windows-conformance/1`. The controller initializes the report before the matrix and checkpoints bounded results after each case. Report-write failures stop further cases. Do not overwrite an earlier report.

Include the environment/build attribution, case ID, API, requested access/share/flag values, whether each call was attempted, return value/error code, elapsed time, exact-byte/codec checks, cleanup outcome and any incomplete work. Distinguish completed observations, preflight refusal, invariant failure and incomplete/timeout outcomes. A directory flush failure can appear in a completed observation report; it must not be described as publisher success. No result grants qualification.

Every report must state `qualified = false`, `runtime_publication_enabled = false` and `physical_power_loss_tested = false`. Omit usernames, SIDs, absolute paths, volume identifiers/serials, raw registry contents outside the allowed fields and unbounded formatted OS errors. Use logical case paths in JSON. A retained scratch directory's locator may be printed privately to the operator; it is not part of a shareable report. Do not add artifact uploads or new workflow execution in this slice.

Keep a separate private ownership receipt in the run directory, bounded to 64 KiB and included in the object/payload budgets. Every admitted worker holds a receipt-recorded exclusive `admission.lock` handle. Cases and cleanup must acquire this guard before mutating the run. Identity checks use the held handle. Cleanup cannot enter while an earlier unresolved worker retains the guard, and cases cannot enter after cleanup starts. Record the current user's identity, run-root identity and created-object identities there. These private cleanup identifiers are not part of the shareable report. If receipt recording fails, stop and retain the tree; do not guess which unrecorded objects are safe to remove.

On normal completion, explicitly close case handles and remove only the recorded fixture objects, deepest first. Checkpoint successful removals before proceeding. Only explicit cleanup of a marked run may reconcile missing known objects; ordinary case admission remains strict. Retire the admission guard through owned-object `FileDispositionInfo` deletion, not a close-then-delete race. Final root removal reserves recovery budget and retains receipt bytes/root identity in memory. A returned deletion failure can restore a fresh guard and receipt inside the verified original root using exclusive creation. There is no out-of-root recovery sidecar.

Cleanup is not crash-atomic. Process interruption during final receipt/guard/root deletion may leave incomplete ownership evidence or an empty root. Missing or changed evidence requires operator intervention; it is never guessed or automatically recreated by a later worker. Do not rely on unconditional recursive temporary-directory destruction. Preserve the report. If an unexpected entry, changed identity, open/unreaped child or deletion failure prevents safe cleanup, leave the affected tree intact and report cleanup incomplete. Do not follow reparse points, repair ACLs or retry failed cleanup automatically.

On an invariant failure or timeout, retain scratch files for inspection after closing/reaping what can be closed safely. A later cleanup action needs explicit operator intent and the same ownership/identity checks. Accept only an enumerated cleanup action and a validated run ID, then derive the run location under the current default temporary directory. Require a non-elevated token, the same user and a matching private receipt. No cleanup action may take a caller-supplied deletion root. Retention is bounded by this single run's limits, not permission for an automatic second run.

## Validation and acceptance

Portable tests cover the fixed matrix/count, result classification, output/report bounds, opt-in checks, deadline handling, and fake-worker cleanup/refusal behavior. Test timeout behavior with fake workers rather than deliberately stalling a native filesystem operation. Existing selector-codec regressions remain the byte-format checks.

Windows validation must include compilation, formatting, all-target Clippy and the ordinary library suite with native entries still ignored. The matrix itself requires a separately verified non-elevated Windows/NTFS run. If only an elevated runner is available, validate refusal and report that ordinary-user execution remains missing. Do not silently skip it and call the matrix passed. Linux/macOS checks can validate portable control logic but cannot establish Windows API behavior.

Acceptance requires staying within the approved scope, collecting attributable observations and preserving limits and failure evidence. It does not mean every directory flush succeeded, the publisher is safe to enable, or any platform is qualified. Review the findings against the [Windows dependency assessment](registry-publication-investigation.md#windows-dependency-assessment) before proposing any runtime adapter or storage experiment.
