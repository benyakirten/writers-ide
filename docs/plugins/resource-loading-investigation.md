# Packaged resource-loading investigation

## Status and purpose

**Fixture prototype implemented; packaged macOS results reported. Production feasibility remains open.**
This document records production loading paths and a separate fixture experiment in
[`prototypes/plugin-resources`](../../prototypes/plugin-resources/).
The integrated packaged run passed 21 normal and five recovery checks in an unsigned debug macOS app, including native pool stages.
The prototype is a standalone Tauri crate. It changes no production loading or CSP configuration.
It installs no arbitrary code and implements no activation tokens or native authorization.
The experiment does not approve a resource URL contract or production security architecture.

Approved direction includes trusted shared frontend code, Rust permission tokens, immutable verified URLs,
native ESM import maps, single-bundle workers, host-owned CSS and restrictive native operations.
Exact mechanisms remain subject to review and packaged tests.
See [builds, assets and activation checks](package-api-proposal.md#7-builds-assets-and-activation-checks),
[verified resource delivery](implementation-plan.md#verified-resource-delivery) and
[native authorization](implementation-plan.md#native-request-attribution-and-authorization).

## Verified source and configuration

Paths below link to the inspected source. Installed dependency source was also inspected locally.

| Entry point                                                                                  | Current behavior                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Native entry](../../src-tauri/src/main.rs) and [builder](../../src-tauri/src/lib.rs)        | Start Tauri, register opener and expose the `greet` command. No bootstrap gate, token registry or package resource handler exists.                                                                                           |
| [Cargo configuration](../../src-tauri/Cargo.toml)                                            | Tauri 2.12.5 and opener 2.7.3. Explicit Tauri features are empty, but default features remain enabled.                                                                                                                       |
| [Build script](../../src-tauri/build.rs)                                                     | Calls `tauri_build::build()` without custom loading setup.                                                                                                                                                                   |
| [Tauri configuration](../../src-tauri/tauri.conf.json)                                       | Development uses `http://localhost:1420`. Production builds run `pnpm build` and embed `../build`. CSP is `null`.                                                                                                            |
| [Default capability](../../src-tauri/capabilities/default.json)                              | Grants `core:default` and `opener:default` to window `main`. No explicit remote-origin capability is configured.                                                                                                             |
| [Integrity module](../../src-tauri/src/plugin_integrity/mod.rs)                              | Verifies the complete file set, lengths and SHA-256 hashes. Returns owned bytes through `VerifiedPackage::file`.                                                                                                             |
| [Snapshot pool](../../src-tauri/src/plugin_resources/mod.rs)                                 | Internal verified-buffer sharing, supplied budgets and opaque WebView-lifetime associations. No production runtime owner, resource route or actual-requester adapter is connected. The fixture supplies its own integration. |
| [Filesystem reader](../../src-tauri/src/plugin_integrity/filesystem.rs)                      | Performs bounded no-follow collection. Verification is synchronous and is not an atomic filesystem snapshot.                                                                                                                 |
| [HTML shell](../../src/app.html)                                                             | Has no import map or pre-module package bootstrap.                                                                                                                                                                           |
| [Layout settings](../../src/routes/+layout.ts) and [layout](../../src/routes/+layout.svelte) | Use static client-only rendering, global CSS and frontend services.                                                                                                                                                          |
| [Main route](../../src/routes/+page.svelte)                                                  | Statically imports editor and feature modules, then registers and activates bundled plugins during initialization.                                                                                                           |
| [Application host](../../src/lib/plugins/application-plugin-host.ts)                         | Adapts in-process contributions to workspace registries. It is not an installer or native authorization boundary.                                                                                                            |
| [Demo route](../../src/routes/demo/+page.svelte)                                             | Calls `invoke('greet', ...)` directly.                                                                                                                                                                                       |
| [Vite configuration](../../vite.config.ts)                                                   | Has no runtime-profile export build or shared-module externalization for external packages.                                                                                                                                  |

Tauri's enabled defaults include Wry and dynamic ACL support.
Neither `protocol-asset` nor `custom-protocol` is explicitly configured in this manifest.
That does not prevent registering a custom URI handler.
The installed Tauri API provides synchronous and asynchronous URI scheme registration.
Use the Tauri packaging path to test production asset loading, not ordinary `cargo run`.

## Existing native routes and security blockers

- `greet` is an application command without an activation-token check. It is a starter command, not a protected service.
- Opener registers `plugin:opener|open_url`, `open_path` and `reveal_item_in_dir`.
  Registration alone does not mean every command is allowed by the capability.
- The installed opener default permission allows URL opening and file-explorer reveal.
  Its default URL scope includes HTTP, HTTPS, `mailto` and `tel`, beyond the approved HTTP/HTTPS service.
- Opener also injects a click handler by default. Qualifying links call `plugin:opener|open_url` directly.
  A future token-checked wrapper would not protect this alternate path.
- Window capabilities do not distinguish components sharing that window.
  Audit `core:default`, plugin commands, link handling and other native routes before enabling external code.
- CSP is disabled. A successful test under that configuration would not prove a restrictive policy works.
- The production application's internal snapshot pool has no runtime owner, Tauri requester adapter or close-event wiring. The separate fixture now supplies these integrations without changing production source. Accepted-record persistence, production resource URL parsing and browser delivery remain unimplemented.
  Integrity records must remain outside package-controlled files. Never regenerate them to accept a mismatch.
- The current route cannot provide recovery-before-import by adding a late activation check.
  Its static imports already evaluate feature modules.
- Shared dependencies currently participate in the normal frontend bundle.
  Mapping plugin imports to a second bundle does not establish shared runtime identity.

## Bootstrap boundary and remaining design

**Approved responsibility boundary; not implemented:** permission/package management and recovery use a separate application-owned WebView that never imports plugins. Rust must authorize management routes using the actual invoking WebView identity and capabilities. Plugin hosts must not create, navigate or impersonate that WebView or grant themselves authority. Exact control commands, credential delivery, persistence and lifecycle coordination remain under review. This approval does not establish packaged enforcement.

Choose recovery mode in application-owned startup before importing any packaged plugin, including official packages.
Keep recovery UI independent of plugin modules.
Before normal component import, establish verified resources, runtime compatibility, dependency checks and required consent.
Install the host import map before modules that depend on it execute.
Load owned styles before calling the component's synchronous `activate(context)` function.

Rust must own authoritative identities, grants, token validity and operation validation.
Do not expose a general command that issues credentials for a caller-selected component ID.
The owner approved exact Rust-authorized pending activations with one-use attachment tickets bound to their target WebView. Redemption rechecks native authorization; successful synchronous setup confirmation releases the native gate. This is not implemented. Exact IPC/confirmation envelopes, expiry, response-loss handling and cleanup still need specification and tests.
See [native request identity and limits](context.md#native-request-identity-and-token-enforcement).

This bootstrap is an ordering boundary, not hostile same-realm isolation.
Plugins share frontend execution, globals and DOM access. CSS is not isolated either.
Private closures, import maps, CSP and virtual URLs do not prove which JavaScript initiated a request.
Tokens identify the activation credential exercised, not an authenticated JavaScript caller.
Stronger hostile-caller guarantees would require a separately approved isolation design.

## Implemented fixture-only prototype

The standalone harness uses application-owned fixtures and a fixed embedded build-time record.
It imports the production integrity module and `SnapshotPool` through `#[path]`, without production source changes.
Its resource handler owns a `Mutex`-protected pool and a host label-to-opaque-handle registry.
Only native `UriSchemeContext.webview_label()` supplies resource requester identity.
Main and peer independently verify temporary extractions against the embedded record.
Both sources are removed; the second admission deduplicates into the first allocation.
Generated `dist/` build output remains. Denied is not registered or associated.
Fixed `snapshot-a` and `snapshot-b` aliases resolve to one `SnapshotId` while producing distinct browser module identities.
These labels and aliases are harness contracts, not production URL or general lifecycle approval.

Rust collects 14 main, one peer and one denied initial checks. It then closes peer.
Only actual `WindowEvent::Destroyed` removes the pool handle and advances the sequence.
Native usage must remain one snapshot. Rust requests a main-window helper fetch, which must return 200 and the accepted SHA-256 digest.
Rust then closes main. Its actual destruction must release the last snapshot.
Denied must again fetch an empty 403 response, even with `X-Resource-WebView: main` spoofing.
The frontend cannot select actions or target windows.

The sole native `finish` command is capability-limited explicitly to main/peer/denied.
It grants no native service APIs or arbitrary setup/close commands.
Rust validates the actual caller's role, run mode, stage and required probe cases, and rejects duplicate or out-of-order reports.
Reports are bounded to 65,536 serialized bytes, 2,048 JSON nodes, depth 12, 8,192-byte strings and 128-byte keys.
Recovery skips native extraction and admission. It creates only the main shell, with no package resources or fixture/runtime imports.
It does not provide an installer, developer directory loader or production activation lifecycle.
Snapshot, retained-byte and request limits are fixture mechanisms, not approved production budgets.
The fixture's concrete URLs and headers are not a production implementation. The owner has separately approved snapshot-addressed paths, a dedicated resource origin and initial response policies. See [verified resource delivery](implementation-plan.md#verified-resource-delivery) for current decisions and remaining validation.

### Packaged observations

The run used macOS **27.0.1, build 26A434, arm64** and WKWebView.
The user agent reported **AppleWebKit/605.1.15**. Its `10_15_7` OS text is misleading;
it is not the measured operating-system version.

| Area                       | Observed result                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origins                    | Document URL `tauri://localhost`; `secureContext` was `true`. Fixture bases were `fixture-resource://localhost/snapshot-a/` and `fixture-resource://localhost/snapshot-b/`. Request `Origin` headers were not measured.                                                                                                                                                                                                                                  |
| Modules and shared runtime | ESM relative imports and import-map resolution worked. Host and fixture used the same actual Svelte and identity-sensitive ProseMirror module instances. A ProseMirror transaction worked.                                                                                                                                                                                                                                                               |
| UI and CSS                 | A compiled Svelte fixture mounted after CSS readiness, updated reactively and unmounted. Shared stylesheet owners and failure-path CSS cleanup passed. This is not a full activation-failure test.                                                                                                                                                                                                                                                       |
| Assets                     | Images loaded. Font checks included actual rendering metrics, not only response success or font readiness.                                                                                                                                                                                                                                                                                                                                               |
| Retained snapshots         | Both temporary extractions were removed. Main and peer shared one production-pool snapshot with 555,913 retained file-payload bytes. Usage stayed unchanged after actual peer destruction and reached zero after actual main destruction. A real main fetch after peer closure returned 200 with the accepted SHA-256 digest. Aliases produced distinct module instances from the same bytes. This does not prove unloading or reset-on-enable behavior. |
| Requester access           | Denied received 403 with an empty body before and after the last associated closure, including with a spoofed `X-Resource-WebView: main` header. Identity came from native URI context, not request data. This is not hostile-JavaScript isolation or a network restriction.                                                                                                                                                                             |
| Workers                    | Direct verified-URL module worker loading failed with `Worker module load failed`. A self-contained Blob worker built from verified bytes passed copy/transfer checks, termination and Blob URL revocation. Blob loading changes `import.meta.url`; relative worker assets are unsupported.                                                                                                                                                              |
| CSP                        | Negative `inline-no-nonce` and `data-image` probes confirmed blocking under the unchanged fixture policy. No null-CSP native comparison was run. Production CSP remains unchanged.                                                                                                                                                                                                                                                                       |
| Raw opener                 | The call returned command-unavailable: `opener.open_url not allowed. Plugin not found`. This is not proof of ACL denial for a registered plugin. Automatic click-listener absence was not established.                                                                                                                                                                                                                                                   |
| Invalid routes             | Actual requests returned 400/404 without application HTML. Raw parser validation has separate Rust test coverage; browser-normalized requests do not establish every raw-parser case.                                                                                                                                                                                                                                                                    |
| Recovery                   | Five aggregate checks passed, including a native zero-usage assertion. Recovery skipped extraction/admission, created only main and had no package resources, fixture/runtime import map or imports. An application-owned host button remained usable. This does not implement the production management/recovery WebView or registry recovery.                                                                                                          |

The following matrix remains the broader validation checklist. The observations above cover only part of it.

| Test area           | Required observations and assertions                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESM graph           | Import a fixture entry and relative child module. Check MIME handling, `import.meta.url` and package-relative asset URLs.                                                                                        |
| Import map          | Install the map before dependent imports. Resolve supported bare specifiers without a custom module-registration API.                                                                                            |
| Shared identity     | Compare host and fixture exports from Svelte and identity-sensitive ProseMirror modules. Both sides must consume the actual same shared artifacts, not a second facade bundle with duplicated dependencies.      |
| Svelte integration  | Compile a small fixture component against the candidate profile. Mount it through the supported host integration, exercise reactivity and destroy it. Identity comparisons alone are insufficient.               |
| CSS ownership       | Load declared CSS before activation. Acquire it for two owners, release one, and confirm it remains. Release the last owner and check removal. Test activation-failure cleanup.                                  |
| Assets and font     | Load a CSS-relative image and font plus a module-relative asset. Check response types, font readiness and actual font use rather than only HTTP success.                                                         |
| Direct worker       | Construct a module Worker from the candidate verified URL. Exchange copied and transferred data, then terminate it through managed ownership.                                                                    |
| Blob worker         | If direct construction fails, test a narrowly scoped Blob route consuming verified bytes. Record changed base URLs, `import.meta.url`, asset resolution and Blob cleanup.                                        |
| Worker output       | Use one self-contained module bundle with worker-side helpers. Do not rely on the window import map or shared window runtime instances.                                                                          |
| CSP                 | Compare a diagnostic null-CSP run with an explicit candidate restrictive policy. Test script/import-map, worker, style, font, image and connection directives. Do not silently broaden the policy.               |
| Capabilities        | Use minimal harness capabilities. Assert raw opener commands and automatic opener link paths cannot produce native effects outside the intended test policy.                                                     |
| Adversarial routes  | Reject unknown snapshots/files, traversal, encoded separators, double decoding, absolute-path forms, unsupported methods and malformed URLs. Never expose arbitrary filesystem paths or serve app fallback HTML. |
| Snapshot lifetime   | Overwrite/delete fixture source files after verification. Responses must retain the verified bytes. Distinct snapshots must not reuse a mutable resource identity.                                               |
| Activation lifetime | Disable/re-enable and repeat owner acquisition. Check task cancellation, worker termination, CSS cleanup and failure cleanup. Do not claim module unloading or reset module state.                               |
| Recovery            | Select recovery before fixture imports. Assert no fixture top-level code executes and application-owned recovery UI remains usable.                                                                              |

Native authorization tests belong in the separately reviewed enforcement work.
They must cover absent, invalid and revoked tokens, forged identity arguments and alternate native routes.
A resource-loading experiment must not claim those guarantees from mocked IPC.
See [worker output](implementation-plan.md#worker-build-output) and
[shared dependencies](implementation-plan.md#frontend-builds-and-shared-dependencies).

## Runtime origin questions and platform matrix

Installed Tauri source documents custom schemes as `<scheme>://localhost/...` on macOS/Linux.
Windows normally uses `http://<scheme>.localhost/...`, with an HTTPS option.
These are framework expectations, not an approved URL contract.
The fixture's measured macOS URLs and secure-context result are recorded above.
Request `Origin` headers remain unmeasured. CORS and request normalization still need broader platform validation.
A separate resource scheme may be cross-origin. Fetch success does not prove Worker construction is allowed.
Workers do not inherit the window import map. Blob workers may change relative URL behavior.

| Platform           | Required packaged evidence                                                             | Current evidence                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current macOS      | WKWebView ESM/maps, assets/fonts, direct/Blob workers, CSP, native routes and recovery | 21 normal and five recovery checks passed on macOS 27.0.1 arm64, including native stages. Direct worker failed; verified-byte Blob fallback passed. Native ACL enforcement is not established. |
| macOS 13.3 minimum | Repeat the complete fixture matrix on the oldest supported OS                          | Not measured. Current macOS results cannot establish this.                                                                                                                                     |
| Windows            | Repeat in installed WebView2; record HTTP/HTTPS virtual-host behavior                  | Not measured.                                                                                                                                                                                  |
| Linux              | Repeat in installed WebKitGTK; record scheme and worker behavior                       | Not measured.                                                                                                                                                                                  |

Playwright Chromium/WebKit tests do not replace these installed-runtime tests.
A platform failure requires review of the mechanism, not weaker verification or broader native access.

## Runner and remaining validation

[`run.mjs`](../../prototypes/plugin-resources/run.mjs) builds the standalone prototype with
`tauri build --debug --bundles app --no-sign --ci`, then executes normal and recovery modes.
It bounds build/runtime duration and output, terminates process groups on deadline,
and writes logs and a JSON result under the prototype's `reports/` directory.
Success requires `poolIntegration.complete: true` and `stage: "complete"`, not merely frontend `ok`.
The normal report includes frontend probes and three native usage assertions. Recovery includes four frontend checks and one native zero-usage assertion.
The measured 555,913 bytes count current fixture file payloads, not a production budget. Production numerical defaults remain deferred.
See the [prototype README](../../prototypes/plugin-resources/README.md) for prerequisites and commands.
Do not use the production app build as a substitute for this fixture.

The integrated unsigned debug packaged run passed all 21 normal and five recovery checks on the measured macOS runtime above.
User agent, origin, CSP and worker limitations remain unchanged from the earlier fixture run.
All 68 native tests passed with `cargo test --offline --locked --features custom-protocol`.
Rust formatting and Clippy checks passed, including all targets with warnings denied.
The 15 persistent Node built-in tests in [resource-probe.test.mjs](../../prototypes/plugin-resources/resource-probe.test.mjs) passed under Node 26.
They cover positive probes, wrong digests, nonempty denial bodies, request/body/digest errors, timer aborts and stage validation.
See the [README test command](../../prototypes/plugin-resources/README.md#what-happens).
Native handler coverage includes label reopening, poisoned-state fail-closed behavior, cap failure and denial-header spoofing.
Raw parser tests are separate from packaged browser observations.
The final packaged repeat also passed all 21 normal and five recovery checks.
Full activation-failure and managed-task cancellation tests remain outstanding.
So do request-header measurements, a null-CSP native comparison, Windows, Linux and macOS 13.3 runs.
The experiment supports further design work. It does not establish production loading feasibility,
native permission enforcement, arbitrary package compatibility or complete platform support.
