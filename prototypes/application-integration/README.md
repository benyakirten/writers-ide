# Application integration fixture

This opt-in prototype connects the real Rust registry and settings coordinator to a separate Tauri shell. Its design choices and fixture budgets are owner-approved. It is implemented / unmerged in PR #81. It does not change normal application startup, app-data paths, CSP, capabilities or the default bundled plugin host.

Read the [approved integration guide](../../docs/plugins/application-integration-plan.md) for contracts and production boundaries. Read the [consolidated changelog section](../../docs/plugins/change-log.md#consolidated-application-integration-design) for validation results. Implementation alone does not establish a passing packaged campaign.

## Build and test

Install the repository dependencies first. Use the toolchain in [CONTRIBUTING.md](../../CONTRIBUTING.md#toolchain), with Node 26 on `PATH` for these fixture commands. Run all commands below from the repository root:

```sh
node prototypes/application-integration/build.mjs
node --test prototypes/application-integration/frontend.test.mjs
node --test prototypes/application-integration/run.test.mjs
cargo test --locked --manifest-path prototypes/application-integration/src-tauri/Cargo.toml --lib
cargo check --locked --manifest-path prototypes/application-integration/src-tauri/Cargo.toml --all-targets
cargo fmt --manifest-path prototypes/application-integration/src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path prototypes/application-integration/src-tauri/Cargo.toml --all-targets -- -D warnings
```

The frontend build writes static entries and import/source-graph audits to `dist/`. The manager graph rejects editor, plugin-host, workspace-package and Svelte dependencies. No development server is needed. See the [frontend guide](frontend/README.md) for adapter composition and controls.

The prototype's native suite compiles shared registry, integrity, manifest and resource modules alongside fixture-specific tests. It is separate from the main application's native suite. For changes to shared opening and settings adapters, also run these checks from the repository root:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib bootstrap
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib opening_attempt
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib command_resource_settings
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

The native seed and campaign processes use the fixture directory as their working directory when launched by the runner. Do not manually launch the native executable against an arbitrary path or real app data.

## Packaged macOS campaign

Run this command from the repository root on macOS:

```sh
node prototypes/application-integration/run.mjs
```

The runner takes no arguments. It builds an unsigned debug `.app` with the repository's Tauri CLI and builds the separate `seed` binary. Cargo network access is disabled for those builds, so the required Cargo dependencies must already be cached. Build output stays in this prototype's `src-tauri/target/`.

The runner creates a fresh invocation directory under `reports/`. Each policy gets a separate disposable `scratch/` parent with an exact ownership marker and random run ID. The seed prepares two closed schema-2 databases and matching selectors there. One is the primary input. The other is the fixed replacement input at saved revision `0`. Preseeding is test preparation, not publication or a publication receipt. Neither seed nor campaign calls publication APIs or qualification bypasses. No schema-1 upgrade campaign is implemented.

The runner executes six campaigns in separate disposable processes. Two check resource policies:

- `strict-baseline` checks the restrictive shell CSP, including blocked custom-resource connectivity.
- `requester-denial` permits connectivity to the fixed inert resource for the authorization test. Native requester checks must allow both associated workspaces with HTTP 200 and deny the manager and probe with HTTP 403. This is not permission to load package scripts.

Each run creates four separate native peers: a plugin-free manager, two real command-hosting workspaces and an unauthorized probe. The campaign checks persistence, conflicts, no-ops, duplicate-save handling, acknowledgments, cancellation accounting, frozen-workspace expiry, explicit reattachment, navigation/popup denial, reload and label reuse. The reload campaign explicitly detaches and awaits native cleanup before requiring a fresh acknowledged attachment, so it works whether the previous attachment is healthy or expired. It also performs an explicit fresh-service replacement. The stable native router switches only after old admission closes. Old shells are destroyed and recreated with fresh document lifetimes. Real frontend hosts attach to the fresh revision-`0` service. Delayed old-document requests must fail. This is controlled fixture replacement, not generation publication, restoration or automatic recovery.

The other four campaigns check `slow`, `failure`, `active-save` and `force` shutdown. The failure is synthetic; real drains still run and retain the original failure warning. The active-save scenario holds an admitted native save before execution, then releases and drains it after ordinary admission closes. It does not interrupt an already-executing SQLite transaction.

Success for the two integration policies requires every mandatory native stage, both policy-specific checks, fresh-service frontend evidence and awaited cleanup. The runner compares the retained native report with stdout before removing scratch storage. It verifies ownership again before deletion. Failed runs retain scratch evidence. Logs and aggregate `result.json` remain outside scratch storage. Deadlines and output budgets are bounded. A timeout, watchdog termination, unexpected cleanup failure or missing stage fails the run even if other stages passed. The explicit `force` scenario is different: the runner requires exit code `2`, native `ok: false`, `cleanupComplete: false` and retained scratch. Its scenario PASS means expected incomplete termination was verified, never successful cleanup or rollback. WebView-reported cases are observations, not proof that hostile JavaScript applied settings honestly.

## Native and frontend contracts

Rust creates each fixed-entry WebView and records its role and random document-lifetime session. Every protected operation checks the actual invoking WebView, fixed entry, role capability and live session. URL parameters, copied markers and caller-supplied roles do not confer authority. Navigation and destruction revoke the old lifetime. The fixture registers no opener plugin or general filesystem, SQL, window-control or credential endpoint.

Ordinary invokes pass `{ payload: JSON.stringify(dto) }`. `settings_attach` also passes a Tauri channel as `events`. Only `session_handshake` has no arguments. `bootstrap_status` requires the ordinary version/session payload. Rust checks the 4 KiB raw UTF-8 string bound before strict object DTO decoding. Tauri may allocate the invoke envelope before this check. Native markers are 32 lowercase hexadecimal characters. Revisions and sequences are canonical nonnegative signed-64-bit decimal strings; save and delivery sequences start at `1`.

Each selected wire snapshot retains its exact native subscription snapshot. Only the matching post-application acknowledgment releases native delivery capacity. Channel-send success, reads and save responses are not application acknowledgments. Each subscriber keeps one in-progress and one latest snapshot, not a history queue.

Single-flight renewal uses a ten-second cadence, five-second response deadline and 30-second local lease measured from challenge send time. Initial attach and delivery acknowledgment each have a ten-second deadline. The frontend uses one lifetime scheduler and checks the lease synchronously on command admission. Expiry marks the client stale even if a frozen JavaScript thread missed timer callbacks. Explicit reattachment within a workspace lifetime preserves its existing ledger, dispatcher and counters. Recreated WebViews instead create fresh frontend hosts.

Save IDs are consecutive sequences within a manager lifetime. Native admission reserves bounded result capacity and advances a constant-space high-water mark together. Identical retained duplicates share their original result; changed payloads fail. Expired or evicted IDs never become new writes. Completed results expire after ten minutes or oldest-completed capacity eviction. Pending writes are not evicted or canceled by closing the manager. A transport timeout is an unconfirmed result, not rollback. Native transaction uncertainty remains a separate error.

All approved numerical bounds are listed in the [fixture budget table](../../docs/plugins/application-integration-plan.md#approved-fixture-budgets). They are not release defaults. The eight resource-setting defaults and policies remain unchanged.

## Shared adapters and cleanup

The fixture compiles shared modules directly; it does not expose a public Rust registry SDK. Source entry points are:

- [`bootstrap.rs`](../../src-tauri/src/plugin_registry/bootstrap.rs): ownership before strict selector validation, schema-2 selected opening and no fallback initialization.
- [`worker.rs`](../../src-tauri/src/plugin_registry/worker.rs): `Registry::begin_owned`, `RegistryOpening`, `OpeningFailure` and separate awaited cleanup.
- [`command_resource_settings.rs`](../../src-tauri/src/plugin_registry/command_resource_settings.rs): the real settings coordinator and multiple independent `SettingsAssociation::closed().await` waiters.
- [`campaign.rs`](src-tauri/src/campaign.rs), [`owned.rs`](src-tauri/src/owned.rs) and [`replacement.rs`](src-tauri/src/replacement.rs): disposable ownership, startup, draining and explicit replacement.
- [`router.rs`](src-tauri/src/router.rs), [`commands.rs`](src-tauri/src/commands.rs), [`policy.rs`](src-tauri/src/policy.rs), [`wire.rs`](src-tauri/src/wire.rs) and [`transport.rs`](src-tauri/src/transport.rs): stable routing, authorization, strict DTOs, result retention and acknowledged delivery.
- [`shutdown.rs`](src-tauri/src/shutdown.rs), [`shutdown_commands.rs`](src-tauri/src/shutdown_commands.rs) and [`shutdown_window.rs`](src-tauri/src/shutdown_window.rs): cleanup observation, exclusive native commands and dedicated status-window authority.
- [`shutdown_campaign.rs`](src-tauri/src/shutdown_campaign.rs): isolated shutdown scenarios and bounded evidence.
- [`run.mjs`](run.mjs): build, seed, six packaged campaigns, report validation and owned cleanup.

A failed opening preserves its original typed error separately from its cleanup receipt. Awaiting that receipt observes worker completion. Initial database-open failures already close their partial connection in the store helper; no failed connection is reconstructed or magically retained. Maintenance failures that actually return owned resources follow the existing recovery-only retention policy. Dropping an opening attempt or owner requests cleanup but does not certify completion.

Normal exit is intercepted until attachment tasks, the native scheduler, admitted saves/results, settings operations/delivery/watchers and registry cleanup finish. Location ownership survives that cleanup. Closure notification is not drain completion. Shared `drain_settings` first waits for wire-admitted save results, then calls `settings.shutdown()`. Normal shutdown, setup-error cleanup and replacement cleanup all use this ordering so a reserved save can still enter the coordinator.

The approved [shutdown interface](../../docs/plugins/application-integration-plan.md#implemented-fixture-shutdown-interface) is implemented in a dedicated plugin-free `shutdown.html` WebView with its own native document lifetime. It appears after two seconds, or immediately on failure. Ordinary manager/workspace authority stays closed. Only the actual shutdown caller can use its four commands, through strict 4 KiB JSON payloads. It retains at most one progress channel and one confirmation token, valid for 30 seconds.

Keep waiting has default focus. Force quit opens a separate confirmation with this exact warning: “Unfinished changes may not be saved. A transaction may already have committed without a delivered response.” Cancel, Escape and closing the panel discard the token and keep waiting. Native prevents status-window closure while cleanup remains unfinished. There is no automatic force termination. Completed cleanup atomically claims normal completion before writing its report or requesting exit. If force termination wins, the normal path writes no normal result. Real failed cleanup remains unfinished in the status UI with manual Force quit available; it never automatically exits. Channel callback invocation and destruction are panic-isolated outside state locks. Confirmed force termination records failed/incomplete evidence before exit code `2`. Neither force termination nor waiting proves rollback. Four packaged reload stages verify shutdown-window destruction/recreation, a fresh lifetime and progress channel, Keep waiting focus, and old-session/token denial. The cancellation check dispatches the dialog's `cancel` event; it does not send an OS-level Escape keystroke. The full production shutdown interface remains planned.

## Limits

This fixture imports no external plugin package. Its resource asset is verified and inert. It implements no production installer, permission grants, recovery actions, application launch forwarding, first-run publication or upgrade-backup retention policy. Normal application data and startup remain untouched.

Production publication qualification is blocked. Windows research remains deferred. macOS fixture results cannot qualify Windows, Linux, macOS 13.3, device power-loss behavior or production release settings. Current validation belongs in the changelog, not an inferred PASS from implemented campaign code.
