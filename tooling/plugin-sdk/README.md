# Portable SDK declarations

This builder creates five private, declarations-only packages for independently compiled frontend plugins. It does not publish packages or produce JavaScript. The browser host and plugin must still use the same [runtime profile](../plugin-profile/README.md).

Run these commands from the repository root:

```sh
pnpm build:plugin-sdk
pnpm test:plugin-sdk
```

`build:plugin-sdk` writes to `node_modules/.cache/plugin-sdk`. `test:plugin-sdk` runs this builder's Node tests and the [standalone sample tests](../../examples/plugins/portable-sdk/README.md). `test:unit:ci` includes both. Use the [contributor toolchain](../../CONTRIBUTING.md#toolchain), including supported Node.js 24 releases used in CI.

Build scripts can import the builder. The example below belongs in a repository-root build script run from that directory. The caller supplies the output directory. Relative paths resolve against the process working directory.

```js
import { buildSdkDeclarations } from './tooling/plugin-sdk/build.mjs';

const sdk = await buildSdkDeclarations({
	outDir: 'node_modules/.cache/plugin-sdk',
});
console.log(sdk.packages['@writers-ide/components']);
// packages/components
```

## Output contract

The returned object is also written to `outDir/index.json`. All artifact paths are relative to `outDir`.

- `packages` maps each canonical package name to its package directory. The five names are `@writers-ide/plugins`, `@writers-ide/word-processing`, `@writers-ide/components`, `@writers-ide/tasks` and `@writers-ide/layout`. Their directories are `packages/plugins`, `packages/word-processing`, `packages/components`, `packages/tasks` and `packages/layout`.
- `entries` maps each exact public module specifier to its declaration entry file.
- `inventory` records the exact runtime-value and type export names for each entry. Runtime-value names describe declaration exports. They do not imply that this builder emits JavaScript.
- `dependencies` records the exact installed versions of external packages directly referenced by the emitted declarations. The builder checks those versions against the runtime profile baseline. Install these real external packages in the consumer. Their own package dependencies remain their responsibility.
- `assets` lists the copied layout stylesheet.
- `declarations` lists every emitted `.d.ts` file, including supporting files.

Each package has a `package.json` with its existing `0.1.0` version, `private: true`, exact `exports`, and `peerDependencies` for its reachable declaration dependencies. SDK-to-SDK dependencies use canonical package names and exact local versions. External dependency metadata describes type resolution. It does not add runtime import-map entries or authorize browser imports of additional packages.

The package export maps allow only the curated roots and subpaths. They deny deep imports into supporting `internal/` declarations. The public facade lists come directly from `tooling/plugin-profile/facades/`, using the runtime builder's exported file list. The builder does not maintain a second copy of those lists. Supporting declarations may describe private implementation types needed by the public contracts. Those types are not added to public root exports.

The curated tasks root exports `TaskService`, `AdvancedTaskService`, `WorkerTaskOptions` for module requests and `WorkerFactoryTaskOptions` for advanced factories. The ordinary frontend context accepts module URLs only. Explicit `createTaskService()` returns the advanced contract. These type additions do not change runtime exports or the 27 runtime mappings.

`@writers-ide/tasks/worker` has declarations for build-time worker compilation. The generated package contains no helper JavaScript. Either supply and bundle the matching optional helper implementation separately or implement the task protocol directly with a type-only `TaskWorkerScope` import, as the standalone sample does. It has no window import-map entry. `@writers-ide/layout/dock-colors.css` exports a copied stylesheet. A plugin build must bundle that input into its own declared stylesheet.

To use these artifacts outside the repository, copy each generated package directory into the consumer's package installation or install it as a local package. Install its declared peers too. Do not add TypeScript paths to workspace source. These packages intentionally provide no runtime entry condition. Resolve frontend JavaScript through the shared runtime profile and worker JavaScript through the worker build.

Rebuilding replaces only the five generated package directories and `index.json`. Other files in the output directory remain untouched. Temporary compiler inputs are removed after success or failure.

## Declaration generation and checks

The builder transforms Svelte components with the official `svelte2tsx` declaration mode. The direct development dependency pins `svelte2tsx` to the already installed `0.7.63` version. Accurate Svelte declarations require this compiler support; handwritten component types would lose props, snippet and generic information. TypeScript then emits declarations for the transformed components and their reachable TypeScript sources. Compiler shims are build-only inputs. Emitted declarations must not refer to those shims or their helper names. Component props, snippets and generic signatures are preserved by the compiler rather than replaced with handwritten approximations.

An AST traversal checks declaration imports, exports, import types and module augmentations. Relative references stay within their owning package. Cross-package references use approved canonical SDK names. External references must use allowed dependency specifiers. Triple-slash references, compiler helpers and repository paths are rejected. No third-party declaration trees are copied.

The Node tests relocate the artifacts outside the repository. They install only the generated SDK packages and real external dependencies. TypeScript checks every public entry with `skipLibCheck: false` and no workspace aliases. The tests compare exact exports, inspect declaration links and dependency metadata, reject private exports and subpaths, and verify Svelte props, snippet types, generic presentations and the four distinct command argument/result roles.

The sample tests also run real strict `svelte-check` and audit every TypeScript program source, including standard libraries, inside a clean external project. There are no workspace paths, ambient stubs or source fallbacks. A separate production Vite build uses only exact runtime-profile imports as externals. It emits a separate self-contained worker without imports. The sample starts that worker through ordinary `context.tasks.worker({ module: URL, ... })` using the trusted fixture host's snapshot-bound source. Production native byte-source integration remains pending.

These Node checks do not mount components, run browser layout tests or enable production external loading. The [runtime-profile fixture](../../docs/plugins/runtime-profile.md) owns browser integration, including its `#portable-sdk` sample mode.
