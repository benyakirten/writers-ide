# Plugin resource-loading prototype

This experiment tests how prebuilt plugin files could load in a packaged Tauri WebView. It uses application-owned fixtures only. It does not install plugins, issue native credentials or change the production application.

## Run on macOS

Install the repository dependencies first. Follow the [toolchain requirements](../../CONTRIBUTING.md#toolchain). You also need Rust, Apple Command Line Tools and a graphical desktop session. The required Cargo dependencies must be cached locally. The runner disables Cargo network access.

Run from the repository root:

```sh
node prototypes/plugin-resources/run.mjs
```

The runner builds a separate unsigned debug `.app`. It launches the executable inside that bundle in normal mode, then recovery mode. It captures native JSON results and exits unsuccessfully if a check fails or a report is missing. It does not launch the production application.

The build deadline is ten minutes. Each app launch has a forty-second external deadline. The frontend has a twenty-three-second deadline, and Rust has a thirty-second watchdog. Output is bounded. Deadlines stop the runner's child process groups. Normal native termination also closes the WebView and its workers.

Generated reports are in `prototypes/plugin-resources/reports/`. Read `result.json` for both runs. The build and per-mode logs are in the same directory. Reports and build artifacts are ignored by Git.

By default, Cargo output goes to `prototypes/plugin-resources/target/`. Set `CARGO_TARGET_DIR` to reuse a local cache. For example, this command also selects the supported Node installation available on the development machine used for this experiment:

```sh
env PATH=/opt/homebrew/opt/node@26/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin CARGO_TARGET_DIR=/Users/benyakirhorowitz/projects/writers-ide/src-tauri/target node prototypes/plugin-resources/run.mjs
```

The runner currently supports macOS only. Source configuration for other platforms is not proof that they work.

## What happens

1. Tauri runs `build.mjs` before building the native app. This creates a small host shell and a fixture package in `dist/`.
2. The build script bundles shared Svelte and ProseMirror modules once. It compiles the fixture against those shared modules. The host and fixture import the same runtime artifacts.
3. The build script creates `dist/fixture-record.json`. This is the trusted, build-time record of file lengths and SHA-256 hashes. The native build embeds that record and the exact files. It is not acceptance of an external package.
4. At startup, Rust extracts the embedded fixture into a temporary directory. The production integrity module verifies it against the embedded record. Rust deletes the temporary extraction and retains the verified bytes. It never regenerates expected hashes during loading. Build output in `dist/` is not deleted.
5. A prototype resource handler serves only those retained bytes. Two URL namespaces expose the same bytes under different module identities. Unknown files never fall back to application HTML or arbitrary filesystem reads.
6. The normal-mode shell installs an import map before importing the fixture. It checks shared runtime identity, Svelte rendering, styles, images, fonts, workers and cleanup. Recovery mode skips fixture and runtime imports and checks a small host-owned interface instead.
7. The frontend sends its bounded report through the harness-only `finish` command. Rust prints `RESOURCE_PROTOTYPE_RESULT` followed by JSON and exits. This command is a test mechanism, not a proposed public plugin API.

To build only the frontend fixtures, run this from the repository root:

```sh
node prototypes/plugin-resources/build.mjs
```

To run native tests after that build, run this from `prototypes/plugin-resources/src-tauri/`:

```sh
cargo test --offline --locked
```

## Observed result and limits

The unsigned packaged app passed 14 normal-mode checks and 4 recovery-mode checks on macOS 27.0.1. See the [investigation](../../docs/plugins/resource-loading-investigation.md) for the detailed evidence and remaining work.

Direct module workers from `fixture-resource://localhost/` failed to load on this machine. A self-contained worker built from fetched verified bytes worked through a Blob URL. That fallback changes `import.meta.url`. Relative worker assets are not supported by this experiment. Direct-worker refusal is an observation, not a failure of the fallback check.

The explicit CSP allowed the tested resources. Negative probes also confirmed that a nonce-less inline script and a data image were blocked. This is not a complete CSP audit. Opener is not registered in this app. Its unavailable-command response does not prove ACL enforcement for a registered opener. Automatic opener link handling is not tested.

The frontend records browser-normalized invalid URL results. Native unit tests separately check raw parser inputs. Neither proves hostile JavaScript isolation. Plugins would still share the frontend environment under the approved design.

This prototype does not implement installation, permission grants, activation credentials, registry recovery or the production management WebView. It does not promise module unloading. Windows, Linux and the macOS 13.3 minimum remain untested.

## Font notice

The build copies the existing Storybook dependency's `assets/browser/nunito-sans-regular.woff2`. It does not download a font. Nunito Sans is distributed under the SIL Open Font License 1.1. The copyright notice and complete license are in [OFL.txt](OFL.txt), sourced from the [Google Fonts Nunito Sans license](https://github.com/google/fonts/blob/main/ofl/nunitosans/OFL.txt).

The build includes the license in the fixture package and host shell. Preserve it when distributing the generated prototype or font. The font is not covered by the repository's MIT license.
