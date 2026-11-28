# Portable SDK declarations and standalone sample

Writer's IDE can generate TypeScript declarations for independently compiled frontend plugins. The declarations cover the exact curated author exports used by `writers-ide.frontend/1`. Svelte component props, snippets and generic signatures are included.

This is implemented tooling, not a published SDK release. The five generated packages are private local artifacts at their existing `0.1.0` versions. They contain no JavaScript. Production installation, authorized loading and public package publishing are not implemented.

## Build and check

Use the [contributor toolchain](../../CONTRIBUTING.md#toolchain) and installed repository dependencies. Run these commands from the repository root:

```sh
pnpm build:plugin-sdk
pnpm test:plugin-sdk
pnpm test:plugin-profile
```

`build:plugin-sdk` writes to `node_modules/.cache/plugin-sdk`. `test:plugin-sdk` runs declaration-builder and standalone sample Node tests. `test:plugin-profile` builds the fixtures and runs Chromium and WebKit integration checks. Use `--project=chromium` or `--project=webkit` to select an engine. The root `test:unit:ci` command includes portable SDK/sample checks alongside application units, SDK runtime/type checks and Node runtime-profile checks. It does not run the browser suite.

## Two separate builders

The [runtime-profile builder](../../tooling/plugin-profile/README.md) emits shared browser JavaScript, an exact import map and workspace-source `facades/*.ts` inputs. Those source facades are not portable declarations. The trusted host and runtime entries share one build graph so identity-sensitive libraries remain shared.

The separate [SDK declaration builder](../../tooling/plugin-sdk/README.md) exports `buildSdkDeclarations({ outDir })`. A repository build script supplies its output directory. It uses the runtime builder's curated facade lists and produces five declarations-only packages:

- `@writers-ide/plugins`
- `@writers-ide/word-processing`
- `@writers-ide/components`
- `@writers-ide/tasks`
- `@writers-ide/layout`

The returned index is also written to `outDir/index.json`. It records canonical package names, package-relative directories, exact export inventories, declaration entries, assets and external dependency versions. Each package has exact export maps and peer metadata for its reachable declaration dependencies. External peers refer to real third-party packages. This metadata does not add browser import-map entries.

Copy the generated package directories into a consumer's installation, or install them as local packages. Supply their declared peers too. Do not expect a plain registry `npm install` to fetch these five private artifacts. Do not add workspace source aliases to make them resolve. Use matching SDK artifacts and runtime-profile versions.

Public roots and subpaths expose only the curated exports. Deep imports into supporting declarations are not supported. The copied `@writers-ide/layout/dock-colors.css` input must be bundled into the plugin's declared stylesheet. The `@writers-ide/tasks/worker` declaration entry supports build-time worker compilation. The generated package contains no helper JavaScript. Either supply and bundle the optional matching helper implementation separately or implement the protocol with a type-only `TaskWorkerScope` import, as the sample does. It has no window import-map entry.

## Declaration and resolution checks

The builder uses TypeScript declaration emit and the official `svelte2tsx` declaration mode. It emits the reachable declaration graph instead of approximating Svelte components by hand. An AST audit rejects repository paths, compiler-helper leaks, triple-slash references and private cross-package references. Supporting relative declarations stay within their package. Cross-package links use approved canonical SDK entries.

The [standalone sample](../../examples/plugins/portable-sdk/README.md) is copied outside the checkout into a temporary project. The harness copies all five generated packages, required third-party dependency trees and build tools. These are real copies, not workspace links. No downloads are needed after repository dependencies are installed.

Real `svelte-check` runs with strict checking and `skipLibCheck: false`. The harness audits every source in its TypeScript language-service programs. All sources must remain inside the clean project, including TypeScript's standard libraries. There are no TypeScript path aliases, declaration stubs or workspace source fallbacks. Separate checks cover every SDK entry and exact export inventory.

Negative cases must reject unsupported exports and subpaths, invalid provider results, command argument/result mismatches, incorrect Svelte props and snippets, broken generic inference and missing dependencies. An otherwise valid out-of-project import must also fail the resolution audit.

The sample's own Vite configuration builds the same source in production mode. Only exact shared profile JavaScript imports remain external. Compatible private dependencies can be bundled. The sample bundles `prosemirror-commands` while keeping its shared ProseMirror core imports external. Its layout CSS is bundled as CSS, not treated as a JavaScript mapping.

## Activation and browser integration

The fixture's internal plugin host calls the named synchronous `activate(context)` export in the sample's `src/entry.ts`. The host constructs and supplies `SvelteFrontendContext`; the plugin does not construct it. The default application's bundled host does not load this sample.

The sample reads the `fixture.probe` provider API through the dependency alias `host`. The fixture registers that provider and its `double` command. They are test services supplied by this host, not built-in SDK APIs. The sample also publishes its own API for a host consumer. See the [sample's activation explanation](../../examples/plugins/portable-sdk/README.md#activation-and-provider-contracts) for the source roles and cleanup lifetime.

The profile fixture builds this sample into a separate accepted snapshot. Its immutable server verifies and retains both that snapshot and the original rich fixture snapshot. Open `/#portable-sdk` on the fixture server to select the sample. The mode reads `/sample-accepted.json` and uses the same trusted host and 27-entry shared runtime map. Both snapshots use ordinary module-worker tasks. The sample emits a separate self-contained `calculate.worker.js`, submits `21` from activation and handles the completed value `42`. Its worker uses a type-only `TaskWorkerScope` import and implements the protocol directly. Browser cases check worker results and cleanup alongside activation, providers, commands, Svelte context, generic content, styles, clicks, teardown and reactivation.

This remains trusted test infrastructure. Native import and stylesheet fetches rely on the immutable server and trusted transport. Prefetch verification alone does not bind later fetches to checked bytes. The module-only `TaskService`, advanced service/factory types and internal snapshot binding are implemented. Runtime exports and the 27 mappings are unchanged. Production native authorized byte sources and profile integration, publishing, installation, default-host migration and separately packaged Basic Menu remain outside this slice. See the [runtime-profile limits](runtime-profile.md#accepted-bytes-and-the-native-fetch-limit).
