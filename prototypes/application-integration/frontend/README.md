# Application integration fixture frontend

This frontend is an opt-in test shell. It does not change the normal application.
The native fixture owns startup, storage, window creation and authorization.
The implemented native fixture creates one manager, two workspaces and one probe as separate fixed-entry peers. All design choices and fixture budgets are approved for this isolated scope, not as release defaults. The [prototype README](../README.md) provides native tests, packaged-runner commands and production limits.
Both workspaces load the same HTML entry. Their native sessions distinguish them.
URL parameters do not supply identity or authority.

## Build and checks

Run these commands from the repository root with Node 26 on `PATH`:

```sh
node prototypes/application-integration/build.mjs
node --test prototypes/application-integration/frontend.test.mjs
```

The build uses the installed Vite and Svelte compiler dependencies.
It writes these entries under `prototypes/application-integration/dist/`:

- `manager.html` contains the eight-value settings form and save-result reconciliation.
- `workspace.html` creates the existing opt-in application component host.
- `probe.html` attempts unauthorized native operations and reports observations.

`import-graph.json` records emitted JavaScript imports and source attribution.
`manager-source-graph.json` records the manager's resolved source dependencies.
The build rejects editor, plugin, workspace-package and Svelte dependencies in the manager graph.
The workspace uses the real rune-compiled host and existing settings client.
No server is required to produce these static assets.

## Native contract

The shell calls `session_handshake` without arguments. Its response supplies the session,
role and next manager save sequence. Native markers are 32 lowercase hexadecimal characters.
Revisions and delivery sequences are canonical nonnegative signed-64-bit decimal strings.
Save request sequences and delivery sequences start at `1`.
Frontend challenges are UUID strings. They are not credentials.

Ordinary commands receive `{ payload: JSON.stringify(dto) }`.
`settings_attach` also receives a Tauri `Channel` as `events`.
`bootstrap_status` uses the same string-payload boundary, including the version and session.
Every request includes the native session. Native checks the actual invoking WebView, fixed entry, live document session and role-specific capability.
The frontend never supplies a filesystem path or an authoritative role.

`workspace-transport.mjs` exports `createWorkspaceTransport(options)` for fixture composition.
The workspace supplies native invocation, channel construction and the handshake session.
Tests can inject a monotonic clock and scheduler. Production fixture timing uses `performance.now()`.
One scheduler belongs to the workspace lifetime. It checks attach, read, acknowledgment,
renewal and initial-delivery deadlines. The ledger also checks deadlines synchronously.
A renewal is single-flight. Its response deadline is five seconds. Its lease expires
30 seconds after challenge send time. Renewal cadence is ten seconds.

The returned `client` is injected as `resourceSettingsClient` into the existing host.
It delegates to one existing client and ledger. Updates and explicit reattachment preserve counters.
`reattach()` is explicit. Native closure, invalid messages and expired deadlines make the adapter stale.
`dispose()` stops scheduling and requests native detachment. It does not certify native cleanup.
Native enforces attachment capacity and deadlines even if JavaScript cannot detach. Each selected wire snapshot retains its exact native subscription delivery until the matching post-application acknowledgment. Reads, save responses and successful channel sends do not release that delivery.
Tauri may allocate or retain IPC data before these application-level checks run.

The manager submits full settings and the current saved revision. Conflicts preserve the draft.
Transport timeout means an unconfirmed result. Native transaction uncertainty is displayed separately.
Neither condition resubmits the mutation. Check exact save result calls `settings_result`.
Expired results trigger an authoritative read and handshake sequence refresh.
That read does not prove whether an earlier request committed.
Application status is refreshed explicitly. It is separate from saved state.

## Controls and reports

Workspace buttons have stable IDs: `start-command`, `cancel-command`, `finish-command`,
`detach`, `reattach`, `freeze` and `report`. They run real command-host calls.
The fixture holds at most eight calls. Cancellation leaves the implementation unfinished.
Finish releases that implementation so the existing dispatcher can release its reservation.
Freeze deliberately blocks the workspace for 31 seconds to miss timer callbacks.
The subsequent admission check must reject an expired lease before the scheduler resumes.

Reports call only `fixture_report` with `{ version: 1, session, cases }` inside the ordinary JSON payload.
Each case has only `name` and `ok`. Reports have at most 32 cases.
There is no script-exposed mutation dispatcher or native test-control endpoint.
Native must treat case reports as observations, not authoritative evidence of honest application.

## Packaged campaign and evidence limits

Node tests exercise wire validation, build graphs, adapter timing and the real host's controlled calls.
The DOM test uses jsdom and a mocked native invocation boundary. It does not validate WebView layout,
IPC authorization, native persistence, navigation denial or shutdown draining.

The implemented native fixture and runner exercise capabilities, registered WebView lifetimes,
channel behavior, request bounds, result retention, persistence and awaited cleanup.
The two packaged policies check strict CSP and native requester denial separately.
The manager source graph is audited during build. The packaged fresh-service campaign destroys
old shells, swaps the native router and creates fresh frontend hosts at saved revision `0`.
Delayed old-document requests must fail. Reattachment within a surviving workspace preserves
its ledger and counters; destroyed WebViews do not preserve frontend objects.
The HTML permits local assets and the agreed IPC origins. It forbids inline scripts, remote scripts,
frames, forms, objects and workers. An HTML policy alone does not prove enforcement.
Native code sets up the verified inert asset and its resource associations. The requester-denial
campaign requires HTTP 200 for both workspaces and 403 for manager/probe requests to that same asset.
The frontend does not invent a resource URL or a resource-authority handshake field.
The fixture displays Keep waiting status only; a native Force quit action is not implemented.
Full production shutdown UX remains planned and must warn about unfinished or possibly committed work.
No packaged PASS or platform compatibility claim follows from frontend tests or implemented stages.
See the [consolidated changelog](../../../docs/plugins/change-log.md#consolidated-application-integration-design)
for verified validation. Normal app data/startup remain untouched. There is no publication call
or packaged schema-1 upgrade campaign. Windows research remains deferred.
