# Plugin resource-loading prototype

This experiment tests how prebuilt plugin files could load in a packaged Tauri WebView. It uses application-owned fixtures only. It does not install plugins, issue native credentials or change the production application.

## Run on macOS

Install the repository dependencies first. Follow the [toolchain requirements](../../CONTRIBUTING.md#toolchain). You also need Rust, Apple Command Line Tools and a graphical desktop session. The required Cargo dependencies must be cached locally. The runner disables Cargo network access.

Run from the repository root:

```sh
node prototypes/plugin-resources/run.mjs
```

The runner builds a separate unsigned debug `.app`. It launches the executable inside that bundle in normal mode, then recovery mode. It captures native JSON results and exits unsuccessfully if a check fails or a report is missing. Success requires `stage: "complete"` and `poolIntegration.complete: true`, not merely a passing frontend report. It does not launch the production application.

The build deadline is ten minutes. Each app launch has a forty-second external deadline. The frontend has a twenty-three-second deadline, and Rust has a thirty-second watchdog. Output is bounded. Deadlines stop the runner's child process groups. Normal native termination also closes the WebView and its workers.

Generated reports are in `prototypes/plugin-resources/reports/`. Read `result.json` for both runs. The build and per-mode logs are in the same directory. Reports and build artifacts are ignored by Git.

By default, Cargo output goes to `prototypes/plugin-resources/target/`. Set `CARGO_TARGET_DIR` to reuse a local cache. For example, this command also selects the supported Node installation available on the development machine used for this experiment:

```sh
env PATH=/opt/homebrew/opt/node@26/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin CARGO_TARGET_DIR=/Users/benyakirhorowitz/projects/writers-ide/src-tauri/target node prototypes/plugin-resources/run.mjs
```

The runner currently supports macOS only. Source configuration for other platforms is not proof that they work.

## What happens

1. Tauri runs `build.mjs`. It emits the host shell, `dist/package/` and `dist/package-second/`.
2. The build bundles shared Svelte and ProseMirror modules once. Host and fixture import the same runtime artifacts.
3. Each package has a fixed build-time record: `dist/fixture-record.json` and `dist/fixture-record-second.json`. Records contain exact file lengths and SHA-256 hashes. The secondary entry module has a fixed extra comment, so it has a different snapshot identity. Rust embeds both records and file sets. This is not external installation acceptance.
4. In normal mode, Rust verifies separate primary extractions for `main` and `peer`. Their admissions share one retained allocation. Main also verifies and retains the secondary package. All three temporary sources are removed. Build output in `dist/` is not deleted. Expected hashes are never regenerated during loading.
5. The fixture imports the internal integrity module, `SnapshotPool` and `ResourceRoute` through `#[path]`. The application registers no new resource protocol. A mutex protects the pool. Only native `UriSchemeContext.webview_label()` selects the live host-owned handle.
6. The shared route generates `/snapshots/<fingerprint>/<encoded-path>` URLs. It supports GET/HEAD, exact decoded filenames, fixed CORS, `no-store`, `nosniff` and generic binary types. Response bytes borrow retained storage until the adapter checks delivery limits and copies them. There is no filesystem or HTML fallback.
7. Main checks shared runtime identity, Svelte, CSS, images, fonts and workers. It also checks encoded names, response metadata, binary MIME and verified WebAssembly. WebAssembly runs in the main WebView and a Blob worker. JavaScript evaluation remains blocked in both. Remote script and direct bootstrap import probes require enforced CSP violations.
8. Recovery skips extraction and admission. It creates only the host shell and imports no fixture or runtime modules.
9. Frontends submit bounded reports through `finish`. Only the fixed main/peer/denied windows have this reporting capability. Rust checks the real caller, role, stage and required cases. This command grants no native feature services or caller-selected setup/close actions.
10. After the 20 main checks and initial peer/denied probes pass, Rust closes peer. A real destruction event removes its handle. Both snapshots must remain available to main. Main then checks GET, HEAD and the accepted digest again.
11. Rust closes main. Its real destruction must release both snapshots. Denied has no association and must receive empty GET/HEAD 403 responses before and after cleanup, even with a spoofed identity header. Error metadata must not expose package length.
12. Rust aggregates the checks, prints `RESOURCE_PROTOTYPE_RESULT` followed by JSON, and exits. The fixed labels and close stages are fixture controls, not general lifecycle APIs. Reports are limited to 65,536 serialized bytes, 2,048 nodes, depth 12, 8,192-byte strings and 128-byte keys.

To build only the frontend fixtures, run this from the repository root:

```sh
node prototypes/plugin-resources/build.mjs
```

To run native tests after that build, run this from `prototypes/plugin-resources/src-tauri/`:

```sh
cargo test --offline --locked
```

Run the persistent resource-probe unit tests from the repository root:

```sh
node --test prototypes/plugin-resources/resource-probe.test.mjs
```

These 30 Node built-in tests cover positive paths, incorrect digests, nonempty denial bodies, request/body/digest errors, timer aborts and stage validation. They do not replace packaged WebView tests.

## Observed result and limits

The unsigned packaged debug app passed 27 normal-mode checks and 7 recovery-mode checks on macOS 27.0.1 arm64. Counts include native stages. The measured packaged build retained two snapshots with 1,114,143 file-payload bytes before and after peer closure, then zero after main closure. These are fixture measurements, not production budgets. Artifact sizes can differ between direct frontend and Tauri builds; each build emits its own fixed records. See the [investigation](../../docs/plugins/resource-loading-investigation.md) for the detailed evidence and remaining work.

Direct module workers from `fixture-resource://localhost/` failed to load on this machine. A self-contained worker built from fetched verified bytes worked through a Blob URL. That fallback changes `import.meta.url`. Relative worker assets are not supported by this experiment. Direct-worker refusal is an observation, not a failure of the fallback check.

The fixture CSP allows `wasm-unsafe-eval`, not JavaScript `unsafe-eval`. Main and Blob-worker probes confirm WebAssembly execution and JavaScript evaluation rejection. Remote script and direct bootstrap imports produce enforced violations. External module entry tags have no nonce; the import map alone uses one. Inline-script and data-image probes remain blocked. This is not a complete CSP audit or same-environment isolation. Opener is not registered in this app. Its unavailable-command response does not prove ACL enforcement for a registered opener. Automatic opener link handling is not tested.

The frontend records browser-normalized invalid URL results. Native unit tests separately check raw parser inputs. Neither proves hostile JavaScript isolation. Plugins would still share the frontend environment under the approved design.

This fixture now has a real runtime pool owner, actual-requester adapter and close-event wiring. The production application has none of those integrations. Native handler tests cover label reopening, poisoned-state fail-closed behavior, cap failure and denied-request header spoofing. These tests establish neither network restrictions nor hostile-JavaScript isolation.

This prototype does not implement installation, permission grants, activation credentials, registry recovery or the production management WebView. It does not promise module unloading. Windows, Linux and the macOS 13.3 minimum remain untested.

## Font notice

The build copies the existing Storybook dependency's `assets/browser/nunito-sans-regular.woff2`. It does not download a font. Nunito Sans is distributed under the SIL Open Font License 1.1. The copyright notice and complete license are in [OFL.txt](OFL.txt), sourced from the [Google Fonts Nunito Sans license](https://github.com/google/fonts/blob/main/ofl/nunitosans/OFL.txt).

The build includes the license in the fixture package and host shell. Preserve it when distributing the generated prototype or font. The font is not covered by the repository's MIT license.
