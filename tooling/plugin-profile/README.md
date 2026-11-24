# Internal frontend runtime profile builder

This tooling builds `writers-ide.frontend/1` for standalone fixtures. It does not enable external loading in the application. The profile is a compatibility contract, not a security boundary or a native permission grant.

## Build and test

Run these commands from the repository root:

```sh
pnpm build:plugin-profile
pnpm test:plugin-profile:build
pnpm test:plugin-profile
pnpm test:plugin-profile --project=webkit
```

Build tools can call the asynchronous function instead. The caller supplies an output directory. Relative output paths resolve against the process working directory. Optional `hostEntries` maps trusted fixture entry names to absolute source file paths. The example below belongs in a repository-root build script. Run it from the repository root. It includes this tooling's test host; a browser fixture should supply its own host source instead.

```js
import path from 'node:path';
import { buildRuntimeProfile } from './tooling/plugin-profile/build.mjs';

const manifest = await buildRuntimeProfile({
	outDir: 'node_modules/.cache/plugin-profile',
	hostEntries: { host: path.resolve('tooling/plugin-profile/fixtures/host.ts') },
});
console.log(manifest.id);
```

The builder checks the exact installed Svelte, ProseMirror and DnD versions before building. It rejects a baseline mismatch. It creates all runtime entries, trusted host entries and shared chunks in **one Vite/Rolldown build**. Host entry names must not collide with generated `profile-entry-N` names. Rebuilding empties the output directory's `modules/` subdirectory.

`test:plugin-profile:build` includes the tooling tests and fixture build/server Node tests. `test:plugin-profile` builds and runs the independent plugin browser fixture. See the [runtime profile guide](../../docs/plugins/runtime-profile.md) for its lifecycle, integrity guarantees and production limits.

## Output contract

Paths in the generated JSON files are relative to the output directory.

- `profile.json` is the returned manifest object. `id`, `versions` and `compiler` identify the profile and supported production browser compiler settings. Tracing and experimental async compilation are disabled. Svelte `5.57.3` has no public `tracing` option. Explicit `dev: false` disables trace instrumentation. A test compiles a fixture containing `$inspect.trace()` in both modes and verifies that only development output imports `svelte/internal/flags/tracing`.
- `hostEntries[name]` records each trusted host artifact path. It is an empty object when no host sources are supplied. Host entries are absent from `modules`, the author import map and the type facade inventory. The fixture imports them by their emitted URLs.
- `modules[specifier]` records each exact runtime import, its `artifact` path, its runtime `exports` and its `visibility`. Visibility is either `author` or `compiler-internal`.
- `import-map.json` contains `{ imports: { [specifier]: artifactPath } }` with 27 exact native ESM mappings. There are no prefix or wildcard entries. Explicit SDK facades exclude application registries, host constructors, management contracts and legacy bundled-author contracts.
- `modules/` contains the native ESM entries, shared chunks and emitted assets. Output modules must contain only relative module references. Unknown bare imports and nonliteral dynamic imports fail the build.
- `assets` lists emitted asset paths. `styles` lists the emitted shared component stylesheets. The fixture host must load those stylesheets. These lists do not make the layout library's separate `dock-colors.css` a runtime import. Plugin builds must bundle that input into their own declared stylesheet.
- `graph.chunks` records artifact imports, dynamic imports, exports and contributing source module IDs. `graph.sources` records the resolved source dependency graph. Source IDs replace the absolute repository path with `<project>`. Source IDs and compiler evidence keys use forward slashes on every platform. Virtual module imports and trusted host input paths also use forward slashes so Windows drive paths resolve through Vite.
- `graph.dependencies` records the installed dependency names and versions found in that source graph. These are implementation records, not additional author imports. For example, `orderedmap` is bundled privately. Without host entries, `rope-sequence` is absent because the shared profile does not include upstream history. Trusted host sources can add private implementation dependencies without adding author imports. The builder records the actual graph rather than adding unused dependencies.
- `compilerImports` records exact internal specifiers discovered from production compilation of representative fixtures and shared package sources. It includes source evidence and the internal imports observed during the actual shared build. Compiler fixtures cover runes, legacy components, stores, snippets, attachments, transitions, await blocks and boundaries.
- `facades/*.ts` contains explicit approved SDK value and type re-exports. `typeSurface.facades` records their exact inventories. The Svelte type-only paths `svelte/action` and `svelte/elements` have no runtime mappings.

The fixture server must resolve each import-map artifact path against its URL prefix for this output directory. Install that map before importing either the fixture host or a plugin. Both must use this **same emitted graph**, including compiler-internal mappings. Supply trusted host sources through `hostEntries` and import their recorded artifacts. This keeps relative imports of internal SDK code, including error classes, in the same graph as the author facades. Do not build a second host copy of Svelte, the SDK, ProseMirror or DnD. Serve all referenced shared chunks, and load `manifest.styles` from the same output.

`@writers-ide/tasks/worker` has no window mapping. The independent plugin fixture bundles the helper into each self-contained worker. Workers do not inherit the window import map.

## Validation and limits

The Node tests check exact runtime and type inventories, private-export rejection, baseline mismatch handling and closed module references. They inspect emitted namespace exports and mount a separately compiled component with the artifact's Svelte runtime in jsdom. They also verify shared ProseMirror constructors, Svelte context delivery and SDK error-class identity between relative internal host imports and public author imports. Host-entry tests check graph closure, author-map exclusion, input validation and builds without host entries. Path tests cover Windows-style drive paths and virtual IDs on any operating system. They do not replace a real Windows build.

The copied TypeScript facades are **workspace-source artifacts**, not a standalone declaration package. The no-emit TypeScript test resolves the existing workspace packages and Svelte declarations. It does not generate portable `.d.ts` files or replace Svelte component type checking. The separate [portable SDK builder](../plugin-sdk/README.md) now emits standalone `.d.ts` packages from these same curated facade lists. It does not change this runtime builder's source-backed output.

The tooling Node tests do not validate browser geometry, full DnD interaction, stylesheet behavior, packaged Tauri loading or native authorization. The separate [browser fixture](../../docs/plugins/runtime-profile.md) verifies shared runtime behavior, CSS ownership, assets, cancellation and verified-byte Blob workers. Its native import/link requests rely on an immutable server and trusted transport; prefetch checks alone cannot bind later fetch bytes. It does not complete the approved `module: URL` task API. The [standalone sample](../../examples/plugins/portable-sdk/README.md) separately checks portable declarations outside the checkout and runs against this profile. Packaged OS/WebView evidence and production integration remain outstanding. No production application loader is added here.
