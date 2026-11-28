# Portable SDK sample

This is a standalone npm project for the generated Writer's IDE frontend SDK declarations. It is also a runtime-profile fixture example. It does not enable plugin loading in the application. The SDK packages are private generated artifacts, not published npm packages.

## Run from the checkout

Use the [contributor toolchain](../../../CONTRIBUTING.md#toolchain) and installed repository dependencies. Supported Node.js 24 releases work; CI uses Node.js 24. From the repository root, run:

```sh
pnpm build:plugin-sdk
pnpm test:plugin-sdk
pnpm test:plugin-profile
```

`build:plugin-sdk` writes the declarations-only packages to `node_modules/.cache/plugin-sdk`. `test:plugin-sdk` runs declaration-builder and sample checks. `test:unit:ci` includes both. To run only this sample's Node tests, use `node --test e2e/fixtures/runtime-profile/sample.test.mjs`.

The Node test copies this project into `os.tmpdir()`, outside the checkout. `prepareSample()` generates SDK declarations with `buildSdkDeclarations({ outDir })`. It uses the returned canonical package names and relative directories to copy all five packages into the sample's `node_modules`. It copies the declared third-party dependencies and their installed dependency trees too. It preserves conflicting dependency versions in nested installations. There are no source aliases or package symlinks. No downloads are needed.

The sample's `npm run check` script runs real `svelte-check` with strict TypeScript checking and `skipLibCheck: false`. Checking does not require `profile-imports.json`. The Vite configuration defers loading that file until a production build. The harness runs the same checker executable and audits its TypeScript language-service programs. Every source file must be inside the clean project. This includes copied TypeScript standard libraries. A separate TypeScript program checks every generated SDK entry and export inventory. Negative tests check private exports, unsupported paths, provider results, command arguments and results, real Svelte props and snippets, generic inference, and missing dependencies. A negative resolution test imports an otherwise valid file outside the clean project and requires the audit to reject it.

The sample's `npm run build` script runs Vite in production mode. The harness invokes that Vite executable with this project's configuration. It supplies `profile-imports.json` from the generated runtime import map. A build fails if that inventory is missing or empty. Only exact profile JavaScript imports stay external. Unsupported shared subpaths fail. `prosemirror-commands` is a private bundled dependency; its shared ProseMirror imports remain external. The layout stylesheet is bundled, not mapped as JavaScript.

To prepare a copy yourself, import `prepareSample`, `checkSample`, and `buildSample` from `e2e/fixtures/runtime-profile/sample.mjs`. Call `prepareSample()` with no arguments. Its result contains `project`, `sdk`, and an asynchronous `dispose()` method. Pass `project` to `checkSample(project)`. Pass `project`, a `Set` of exact generated runtime import-map keys, and an absolute output directory to `buildSample(project, exact, outDir)`. Always call `dispose()` after use. The helper also copies the build tools so their package resolution is independent of the checkout.

Do not run a plain registry install expecting the five SDK packages to exist there. For another environment, supply the generated packages locally and install the third-party packages listed by the SDK output. Use the same SDK and runtime profile versions. Declarations provide no JavaScript implementation. The browser must install the matching runtime import map before importing the built plugin. This example does not claim compatibility with arbitrary SDK or Svelte versions.

## Activation and provider contracts

The fixture's internal plugin host calls the named synchronous `activate(context)` export in `src/entry.ts`. The host supplies `SvelteFrontendContext`. That context contains activation identity, locale, cleanup ownership, provider access, command invocation, and UI contributions. It is not constructed by the plugin. The default application's bundled host does not load this example.

The fixture registers a provider under the dependency alias `host`. The sample requests its `fixture.probe` API through `context.apis.get('host', probeApi)`. The probe records browser test events. It is a host-provided test API, not a built-in SDK service. The same provider exposes the `double` command alias. The sample invokes it with `21` and records `42`.

The sample publishes `fixture.published` through `context.apis.provide`. The host's consumer connects to it and calls `inspect(view)` with its ProseMirror editor view. The implementation uses the privately bundled `selectAll` command. Provider connections and returned API access belong to the host-managed activation lifetime. The host disconnects them on teardown. Cleanup callbacks use the probe's lifecycle callback so tests can observe teardown after disconnection.

`src/api-checks.ts` is checked but is not an entry module. It exercises context and provider types, SDK component snippet props, generic Svelte presentations, and four distinct command type roles. `fourRoles` in `src/contracts.ts` accepts a caller string, validates it into a handler number, accepts a handler boolean result, and transforms that into a caller `Date`. Its small conversion schemas demonstrate typing, not robust validation for untrusted inputs.

## Managed worker

During `activate(context)`, `src/entry.ts` calls `context.tasks.worker` with a module URL and the input `21`. The URL is relative to the compiled entry module. The sample's Vite configuration builds `src/calculate.worker.ts` as the separate, self-contained `calculate.worker.js` module. Activation submits the task and attaches result handling synchronously. It does not wait for the worker. The task completes with `42` and records a `portable:worker` event through the fixture probe. The input is supplied by this example, not read from an editor.

The trusted fixture host binds the sample component to its accepted snapshot. Its internal worker source reads bytes through the existing integrity verifier. The task library creates a Blob worker from those bytes. It terminates the worker and revokes the Blob URL on completion, failure or cancellation. A component with no snapshot binding cannot run a module worker. Authors do not supply a worker factory to `context.tasks`. The URL is copied before loading. Input objects and transfer arrays are not deep-snapshotted at submission; mutable contents can change while bytes load. Transfer happens only when the library posts the task message. A cancelled read cannot start a worker later.

The worker imports `TaskWorkerScope` only as a type. It handles the task protocol directly: it receives `{ type: 'tasks:run', input }` and sends `{ type: 'tasks:result', value }` or `{ type: 'tasks:error', error: { name, message } }`. It handles only one request. This sample needs no runtime worker helper dependency. The generated SDK is declarations-only, including `@writers-ide/tasks/worker`. To use the optional `defineTaskWorker` helper instead, a build must separately supply and bundle its matching JavaScript implementation. The declarations do not provide that implementation. Workers have no window import map. Their `import.meta.url` names the Blob, so package-relative imports and assets inside the worker are unsupported. Send required data through messages or transfers. The sample build audit rejects emitted worker imports.

## Browser mode

The profile build creates separate accepted snapshots for the rich fixture plugin and this sample. The same immutable fixture server verifies both snapshots before serving them. The same trusted host and 27-entry runtime import map are used for both.

Open `/#portable-sdk` on the profile fixture server to select the sample. The host reads `/sample-accepted.json` instead of `/accepted.json`. The sample browser test checks activation events, command and worker results, provider use, inherited Svelte context, rendered generic content, styles, clicks, teardown, and reactivation. The rich fixture retains its original browser scenarios. Additional cases exercise ordinary module task ownership, cancellation, failure cleanup and verified-byte loading in Chromium and WebKit.

The browser fixture is trusted test infrastructure. It is not a sandbox, installer, native authority, or production external loader. See the [runtime-profile guide](../../../docs/plugins/runtime-profile.md) for its integrity and transport limits.
