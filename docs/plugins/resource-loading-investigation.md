# Packaged resource-loading investigation

## Status and purpose

**Fixture prototype implemented; packaged macOS results reported. Production feasibility remains open.**
This document records production loading paths and a separate fixture experiment in
[`prototypes/plugin-resources`](../../prototypes/plugin-resources/).
The packaged run passed 14 normal and four recovery cases in an unsigned debug macOS app.
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

| Entry point                                                                                  | Current behavior                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Native entry](../../src-tauri/src/main.rs) and [builder](../../src-tauri/src/lib.rs)        | Start Tauri, register opener and expose the `greet` command. No bootstrap gate, token registry or package resource handler exists. |
| [Cargo configuration](../../src-tauri/Cargo.toml)                                            | Tauri 2.12.5 and opener 2.7.3. Explicit Tauri features are empty, but default features remain enabled.                             |
| [Build script](../../src-tauri/build.rs)                                                     | Calls `tauri_build::build()` without custom loading setup.                                                                         |
| [Tauri configuration](../../src-tauri/tauri.conf.json)                                       | Development uses `http://localhost:1420`. Production builds run `pnpm build` and embed `../build`. CSP is `null`.                  |
| [Default capability](../../src-tauri/capabilities/default.json)                              | Grants `core:default` and `opener:default` to window `main`. No explicit remote-origin capability is configured.                   |
| [Integrity module](../../src-tauri/src/plugin_integrity/mod.rs)                              | Verifies the complete file set, lengths and SHA-256 hashes. Returns owned bytes through `VerifiedPackage::file`.                   |
| [Filesystem reader](../../src-tauri/src/plugin_integrity/filesystem.rs)                      | Performs bounded no-follow collection. Verification is synchronous and is not an atomic filesystem snapshot.                       |
| [HTML shell](../../src/app.html)                                                             | Has no import map or pre-module package bootstrap.                                                                                 |
| [Layout settings](../../src/routes/+layout.ts) and [layout](../../src/routes/+layout.svelte) | Use static client-only rendering, global CSS and frontend services.                                                                |
| [Main route](../../src/routes/+page.svelte)                                                  | Statically imports editor and feature modules, then registers and activates bundled plugins during initialization.                 |
| [Application host](../../src/lib/plugins/application-plugin-host.ts)                         | Adapts in-process contributions to workspace registries. It is not an installer or native authorization boundary.                  |
| [Demo route](../../src/routes/demo/+page.svelte)                                             | Calls `invoke('greet', ...)` directly.                                                                                             |
| [Vite configuration](../../vite.config.ts)                                                   | Has no runtime-profile export build or shared-module externalization for external packages.                                        |

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
- There is no accepted-record persistence, snapshot registry, resource URL parser or browser delivery layer.
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

The standalone harness uses application-owned fixtures and fixed trusted records.
It verifies a native temporary extraction and retains the checked bytes for resource responses.
The extraction is removed after verification; generated `dist/` build output remains.
It does not provide an installer, developer directory loader or production activation lifecycle.
Snapshot, retained-byte and request limits are fixture mechanisms, not approved production budgets.
Exact URL layout, scheme/origin, headers, cache policy and worker creation remain experimental.

### Packaged observations

The run used macOS **27.0.1, build 26A434, arm64** and WKWebView.
The user agent reported **AppleWebKit/605.1.15**. Its `10_15_7` OS text is misleading;
it is not the measured operating-system version.

| Area                       | Observed result                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origins                    | Document URL `tauri://localhost`; `secureContext` was `true`. Fixture bases were `fixture-resource://localhost/snapshot-a/` and `fixture-resource://localhost/snapshot-b/`. Request `Origin` headers were not measured.                                                                     |
| Modules and shared runtime | ESM relative imports and import-map resolution worked. Host and fixture used the same actual Svelte and identity-sensitive ProseMirror module instances. A ProseMirror transaction worked.                                                                                                  |
| UI and CSS                 | A compiled Svelte fixture mounted after CSS readiness, updated reactively and unmounted. Shared stylesheet owners and failure-path CSS cleanup passed. This is not a full activation-failure test.                                                                                          |
| Assets                     | Images loaded. Font checks included actual rendering metrics, not only response success or font readiness.                                                                                                                                                                                  |
| Retained snapshots         | Resources remained available after native temporary extraction removal. Distinct snapshot URLs produced distinct module instances from the same retained bytes. This does not prove unloading or reset-on-enable behavior.                                                                  |
| Workers                    | Direct verified-URL module worker loading failed with `Worker module load failed`. A self-contained Blob worker built from verified bytes passed copy/transfer checks, termination and Blob URL revocation. Blob loading changes `import.meta.url`; relative worker assets are unsupported. |
| CSP                        | Negative `inline-no-nonce` and `data-image` probes confirmed blocking under the unchanged fixture policy. No null-CSP native comparison was run. Production CSP remains unchanged.                                                                                                          |
| Raw opener                 | The call returned command-unavailable: `opener.open_url not allowed. Plugin not found`. This is not proof of ACL denial for a registered plugin. Automatic click-listener absence was not established.                                                                                      |
| Invalid routes             | Actual requests returned 400/404 without application HTML. Raw parser validation has separate Rust test coverage; browser-normalized requests do not establish every raw-parser case.                                                                                                       |
| Recovery                   | Four cases passed without a fixture/runtime import map or imports. An application-owned host button remained usable. This does not implement the production management/recovery WebView or registry recovery.                                                                               |

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

| Platform           | Required packaged evidence                                                             | Current evidence                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current macOS      | WKWebView ESM/maps, assets/fonts, direct/Blob workers, CSP, native routes and recovery | 14 normal and four recovery cases passed on macOS 27.0.1 arm64. Direct worker failed; verified-byte Blob fallback passed. Native ACL enforcement is not established. |
| macOS 13.3 minimum | Repeat the complete fixture matrix on the oldest supported OS                          | Not measured. Current macOS results cannot establish this.                                                                                                           |
| Windows            | Repeat in installed WebView2; record HTTP/HTTPS virtual-host behavior                  | Not measured.                                                                                                                                                        |
| Linux              | Repeat in installed WebKitGTK; record scheme and worker behavior                       | Not measured.                                                                                                                                                        |

Playwright Chromium/WebKit tests do not replace these installed-runtime tests.
A platform failure requires review of the mechanism, not weaker verification or broader native access.

## Runner and remaining validation

[`run.mjs`](../../prototypes/plugin-resources/run.mjs) builds the standalone prototype with
`tauri build --debug --bundles app --no-sign --ci`, then executes normal and recovery modes.
It bounds build/runtime duration and output, terminates process groups on deadline,
and writes logs and a JSON result under the prototype's `reports/` directory.
See the [prototype README](../../prototypes/plugin-resources/README.md) for prerequisites and commands.
Do not use the production app build as a substitute for this fixture.

Initial packaged attempts reached the watchdog because the navigation allowlist did not accept
exactly `tauri://localhost` without a trailing slash. The implementation narrowly added that URL;
it did not broaden the policy to arbitrary navigation. Subsequent packaged runs passed all 18 cases.

All 40 native tests passed with `cargo test --offline --locked --features custom-protocol`.
Cargo formatting and Clippy checks passed. Focused Oxfmt, Oxlint and JavaScript syntax checks also passed.
Raw parser tests are separate from packaged browser observations.
Full activation-failure and managed-task cancellation tests remain outstanding.
So do request-header measurements, a null-CSP native comparison, Windows, Linux and macOS 13.3 runs.
The experiment supports further design work. It does not establish production loading feasibility,
native permission enforcement, arbitrary package compatibility or complete platform support.
