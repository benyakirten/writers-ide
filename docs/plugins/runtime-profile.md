# Tested frontend runtime profile fixture

This guide explains the generated `writers-ide.frontend/1` artifacts and their standalone browser fixture. The fixture builds a plugin separately from its host. It proves compatibility with a curated shared runtime, not external loading in the application.

The artifacts and browser tests are implemented. A production release profile and package delivery remain unfinished.

## Run the checks

Run these commands from the repository root with the [contributor toolchain](../../CONTRIBUTING.md#toolchain):

```sh
pnpm build:plugin-profile
pnpm test:plugin-profile:build
pnpm test:plugin-profile
pnpm test:plugin-profile --project=webkit
```

`build:plugin-profile` writes profile artifacts to `node_modules/.cache/plugin-profile`. It does not build a plugin or enable application loading. `test:plugin-profile:build` runs the Node profile, fixture-build and immutable-server tests. `test:unit:ci` includes these checks.

`test:plugin-profile` runs both configured engines by default. Use `--project=chromium` or `--project=webkit` to select one. It uses `playwright.profile.config.ts`. It builds the shared runtime and trusted fixture host, then independently compiles the plugin. Its output goes to `node_modules/.cache/runtime-profile-fixture`. The dedicated server supplies those artifacts to Chromium and WebKit. Main app Playwright excludes this isolated suite. Browser Smoke CI runs it for each selected engine.

## Profile artifacts and shared identity

The internal builder exports asynchronous `buildRuntimeProfile({ outDir, hostEntries? })`. Build scripts supply the output directory. Optional `hostEntries` maps trusted entry names to absolute source paths. See the [tooling README](../../tooling/plugin-profile/README.md) for a complete caller example and artifact fields.

The builder rejects installed versions that differ from the [exact baseline](package-api-proposal.md#runtime-profile-inventory). It uses production Svelte browser/client compilation with tracing off and experimental async disabled.

The output includes:

- `profile.json`: versions, compiler settings, exact runtime exports, type-facade inventories and dependency-graph evidence.
- `import-map.json`: 27 exact native ES-module mappings. It has no prefix or wildcard entries.
- `modules/`: runtime entries, trusted host entries, shared chunks and emitted assets.
- `facades/*.ts`: explicit approved SDK value and type re-exports. These are workspace-source artifacts, **not a portable `.d.ts` package**.

The map contains nine SDK entries, ten public Svelte entries, four ProseMirror roots and the public DnD root. The remaining three entries are compiler internals derived from actual production compilation: `svelte/internal/client`, `svelte/internal/disclose-version` and `svelte/internal/flags/legacy`. Representative compiler fixtures and shared package sources supply the evidence. Arbitrary Svelte internals are not public author APIs. Type-only `svelte/action` and `svelte/elements` have no runtime mappings.

The nine SDK facades cover plugins, plugins/Svelte, plugins/native, word processing, its Svelte and structure entries, components, tasks and layout. Their exact inventories are recorded in the generated manifest. They exclude application registries, host constructors, management contracts and legacy bundled-author contracts. Approved advanced library constructors remain available. The underlying workspace exports are unchanged.

**The trusted host and runtime entries use one Vite/Rolldown graph.** This preserves SDK error-class identity, Svelte contexts, ProseMirror constructors and DnD module identity. A second host bundle with another copy would not prove this contract. Trusted host artifacts are recorded separately from the author map and facade inventories. The server installs the map before importing either host or plugin.

## Independent plugin build

The fixture plugin lives in `e2e/fixtures/runtime-profile/plugin/`. Its build externalizes only exact mapped JavaScript specifiers. It rejects unsupported shared subpaths and private application/setup source imports. Compatible private dependencies may be bundled. For example, `prosemirror-commands` is not a shared profile import, but can be bundled while its ProseMirror core dependencies resolve to the shared roots. A build regression checks this distinction. Package-local dynamic chunks remain native modules.

The exact `@writers-ide/layout/dock-colors.css` input is bundled into the plugin's emitted stylesheet. The build declares that output in `manifest.toml`. CSS is not a JavaScript import-map entry. The host also loads the profile's shared component styles.

Each worker is built separately as one self-contained module. Worker helpers are bundled into it. `@writers-ide/tasks/worker` has no window mapping, and workers do not inherit the window import map.

## Accepted bytes and the native-fetch limit

At build time, the fixture records SHA-256 digests for every plugin file. It stores this accepted record outside the plugin snapshot. The snapshot ID derives from that complete record. The shared profile and trusted host artifacts are outside the plugin snapshot too. This is test acceptance data, not an installer or publisher authentication.

Before serving requests, the fixture server checks the complete snapshot inventory and every file against the accepted record. Changed, missing or extra files fail startup. It does not accept current disk contents by generating replacement hashes at runtime. After verification, it retains owned immutable buffers. Later requests never reopen package paths. Node tests mutate and remove files after startup and verify that repeated requests still return the accepted bytes.

The browser also prefetches and verifies package bytes before native import and stylesheet loading. **That prefetch does not bind later `import()` or `<link>` fetches to the checked bytes.** A browser regression deliberately substitutes the second import response. The substituted code executes, proving this limit rather than claiming protection against it.

Native module and stylesheet loading therefore relies on the immutable fixture server **and trusted transport**. This HTTP fixture is not the production native authorized resource route. It adds no WebView association checks, native authorization or application CSP integration. See the separate [resource-loading investigation](resource-loading-investigation.md) for native-route and packaged-runtime evidence.

## Activation, styles and workers

The fixture loads declared CSS before calling the plugin's named synchronous `activate(context)` export. The internal host supplies the context. CSS ownership is reference-counted by snapshot URL. Rollback, failed loading, cancellation and teardown release ownership. A shared stylesheet remains until its final owner releases it.

Asynchronous preparation uses cancellation and session-generation checks. Stop or replacement prevents an older start from activating or retaining CSS. Native import itself cannot be cancelled once underway. A late import may still evaluate top-level code, but it cannot resurrect a stopped activation. Plugins must keep activation-specific work in activation, not module evaluation.

The plugin requests workers through a **fixture host provider**. That provider verifies the requested snapshot bytes, creates a Blob from those returned bytes and uses the existing task service's `createWorker` factory. Completion, cancellation and startup failure terminate workers and revoke Blob URLs. Cancellation during byte acquisition creates neither a Blob nor a worker. Remote, filesystem and foreign-snapshot targets are rejected.

This tests verified-byte Blob workers through an advanced library callback. It does **not** implement the approved external `context.tasks.worker({ module: URL, ... })` API. That option/type and native resource integration remain outstanding. Worker `import.meta.url` names the Blob, so package-relative worker imports and assets are unsupported.

## Evidence and remaining work

The browser suite checks all 27 runtime namespaces. It exercises a separately compiled Svelte presentation, inherited host and tooltip contexts, declared CSS, image assets and a package-local dynamic import. It also checks typed command cooperation and ProseMirror constructors and transactions in both host-to-plugin and plugin-to-host directions. Rollback, render failure, teardown, stale handles, shared CSS owners, delayed starts, late imports and worker cleanup have regressions.

The builder records shared DnD identity, and the browser checks emitted dock-color CSS. This suite does not demonstrate a complete independent drag interaction or pagination geometry.

Focused validation is recorded in the [cumulative plugin changelog](change-log.md#tested-runtime-profile-and-independent-plugin-fixture). Remaining release work includes:

- Portable standalone declaration delivery and independent author type checking.
- Integration of the approved `module: URL` managed-worker API.
- Production authorized resource delivery, manifest-to-runtime assembly and loading gates.
- Packaged evidence across supported operating systems and installed WebViews, including the minimum supported macOS.

No application external loader, installer, native authority, CSP change, public host export, default-host migration or Basic Menu change is included. Compatibility artifacts are not a sandbox or permission grant.
