# Packaged resource-loading investigation

## Status and purpose

**Source investigation: verified. Platform feasibility: unverified.**
This supporting plugin document records the current loading paths and proposes a bounded experiment.
It does not approve a resource URL contract, token issuance protocol or security architecture.
No runtime prototype was implemented. Tests and packaged runtime checks were not executed.
No production code changed as part of this investigation.

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

## Candidate fixture-only prototype

Use a separate nonproduction test harness with application-owned fixtures only.
Do not add external installation, directory loading, permission issuance or production plugin activation.
Fixture records must be fixed trusted inputs supplied by the harness, not generated from candidate files during loading.
Run `verify_package` with bounded work off the UI-sensitive path and retain its `VerifiedPackage` owned bytes.
The candidate native handler must serve those bytes only. Never reopen source paths or fall back to app HTML.
Keep snapshot count, total retained bytes, requests and concurrency bounded.
Exact URL layout, scheme/origin, headers, cache policy and worker creation remain experimental.

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
These are framework expectations, not measured origins for this application or an approved URL contract.
Measure document/resource origins, `Origin` headers, CORS, secure-context status and request normalization.
A separate resource scheme may be cross-origin. Fetch success does not prove Worker construction is allowed.
Workers do not inherit the window import map. Blob workers may change relative URL behavior.

| Platform           | Required packaged evidence                                                                    | Current evidence                                           |
| ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Current macOS      | WKWebView ESM/maps, assets/fonts, direct/Blob workers, CSP, denied native routes and recovery | Source/tool inspection only; local OS is 27.0.1.           |
| macOS 13.3 minimum | Repeat the complete fixture matrix on the oldest supported OS                                 | Not measured. Current macOS results cannot establish this. |
| Windows            | Repeat in installed WebView2; record HTTP/HTTPS virtual-host behavior                         | Not measured.                                              |
| Linux              | Repeat in installed WebKitGTK; record scheme and worker behavior                              | Not measured.                                              |

Playwright Chromium/WebKit tests do not replace these installed-runtime tests.
A platform failure requires review of the mechanism, not weaker verification or broader native access.

## Local tools and bounded execution plan

Observed tools: pnpm 12.4.1, Tauri CLI 2.12.4, Rust/Cargo 1.99.1 and Apple Command Line Tools.
Default Node 24.6.0 is below the repository requirement.
Installed `/opt/homebrew/opt/node@26/bin/node` is Node 26.8.1 and satisfies it.
An older debug `.app` exists, but `build/` was empty. Neither proves a fresh prototype works.
Offline locked Cargo metadata without dependencies succeeded. Full offline build completeness is unverified.

After a harness is separately approved and implemented, build an unsigned `.app` rather than a DMG.
The existing root build command below uses the supported Node via a literal PATH and disables Cargo network access.
It builds the current application; it does not select a fixture harness that does not yet exist.
Run it from the repository root with an external time limit:

```sh
env PATH=/opt/homebrew/opt/node@26/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin CARGO_NET_OFFLINE=true pnpm exec tauri build --bundles app --no-sign --ci
```

Design the future native harness to emit bounded stdout JSON with engine/OS, observed origins and per-case results.
Exit with a success/failure code after completion. Add a watchdog and an external deadline that terminate the app and workers.
Cap diagnostic output and avoid credentials, manuscript data and absolute private paths.
Do not rely on an indefinitely running server, file watcher, manual window closure or an unbounded GUI launch.
No runnable harness script is introduced here. Builds, runtime tests and packaged verification remain unexecuted.
