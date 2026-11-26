# Contributing

Writer's IDE is a word processor built with Svelte 5, ProseMirror, Tauri and Rust.
Keep changes focused. Follow the existing patterns and add tests when behavior changes.

## Toolchain

Use these versions:

| Tool    | Required version                       |
| ------- | -------------------------------------- |
| pnpm    | 12.4.1, pinned in `package.json`       |
| Node.js | `^22.22.2` or `^24.15.0` or `>=26.0.0` |
| Rust    | 1.90 or newer                          |

CI uses Node.js 24. The Node.js minimum follows jsdom's supported releases.

Install dependencies and browser test engines:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
```

On Linux, add `--with-deps` to the Playwright command to install system dependencies.

The frontend uses SvelteKit 3, Vite 8 and Tailwind CSS 4.
SvelteKit configuration lives in `vite.config.ts`, not `svelte.config.js`.

Tailwind 4 requires Safari 16.4+, Chrome 111+ or Firefox 128+.
The desktop application's browser engine must meet those requirements.
The macOS minimum is 13.3 Ventura, as set in `src-tauri/tauri.conf.json`.
Firefox is not part of the Tauri test matrix described below.

See [dependency maintenance](docs/dependencies.md) for upgrade commands and outstanding advisories.

## Code style

These rules apply to JavaScript, TypeScript and Svelte `<script>` blocks.

### Use types for data and interfaces for behavior

Use `type` for struct-like data: records, component props, options, snapshots, event payloads and registration descriptions. A data record can contain callbacks without becoming a behavioral contract. Context objects that group data and service references are also data types.

Use `interface` for behavioral contracts. These describe operations an implementation must provide, such as service methods, lifecycle methods or a callable function signature. A class can use `implements` to declare that it fulfills one of these contracts. An object literal can fulfill the same contract without a class. Behavioral interfaces may include state needed by their operations, such as a task handle's status and cancellation signal.

The following declarations illustrate the convention. They are not application APIs:

```ts
type DocumentSummary = {
	id: string;
	title: string;
};

interface DocumentReader {
	read(id: string): DocumentSummary | null;
}

interface Dispose {
	(): void;
}
```

Use type aliases for unions, tuples, mapped types and aliases of existing types as well. Use intersections to combine data shapes. Preserve method-versus-function-property syntax when refactoring; changing it can change TypeScript's function assignability rules.

Keep interfaces where TypeScript requires declaration merging or module augmentation. For example, adding a property to the browser's global `Window` interface requires another interface declaration. Do not rewrite generated declarations or third-party code to enforce this convention.

### Keep mutations out of conditions

Do not put assignments, `++` or `--` in an `if`, `while`, `do…while` or `for` condition.
Update values in separate statements.

```ts
// Avoid
if (owners++ === 0) {
	startWorker();
}

// Prefer
owners++;
if (owners === 1) {
	startWorker();
}
```

Preserve the original order of operations when making this change.
A postfix increment compares the old value. A prefix increment compares the new value.

Increment and decrement expressions are allowed outside conditions.
For example, they may appear in a `for` loop's update clause:

```ts
for (let index = 0; index < count; index++) {
	processItem(index);
}
```

Ordinary predicate calls such as `if (isReady())` are allowed.
Do not hide mutations in a predicate helper to avoid this rule.
Linting cannot generally detect that behavior.

### Always use braces for control flow

Use braces for `if`, `else`, `for`, `for…of`, `for…in`, `while` and `do…while` bodies.
This includes single statements. Ordinary `else if` chains are allowed.

```ts
// Avoid
if (stopped) return;

for (const job of jobs) job.cancel();

// Prefer
if (stopped) {
	return;
}

for (const job of jobs) {
	job.cancel();
}
```

### Formatting and linting

Use the existing Oxfmt and Oxlint configuration.
Oxfmt formats code, including Svelte components and Tailwind classes.
Oxlint checks code rules. Formatting does not replace those checks.

```sh
pnpm lint
pnpm lint:fix
```

`lint` checks formatting and lint rules.
`lint:fix` applies safe lint fixes, then formats the files.

For a focused change, check the files you touched:

```sh
pnpm exec oxfmt --check path/to/file.ts
pnpm exec oxlint path/to/file.ts
```

Oxlint preserves the supported rules from the previous ESLint configuration.
This includes the underscore-prefix exception for unused variables.
It checks Svelte `<script>` blocks, not templates.
It therefore does not replace every `eslint-plugin-svelte` check.
Use `pnpm check` for Svelte and TypeScript diagnostics.

Do not assume either tool adds braces or removes mutations from conditions.
The project rules still apply when a tool does not enforce them.
They do not prohibit all uses of `++` or `--`.

Use the project's toolchain requirements above, even if an individual tool supports an older Node.js version.

## Writing documentation

These five rules apply to all documentation, including READMEs, examples and design guides. Review all five before finishing a documentation change.

1. **Use simple sentences.** Include only necessary clauses. Split a sentence when it tries to explain several things. More short sentences can be clearer than one dense sentence.
2. **Choose clarity over cleverness.** Minimize metaphor. Use jargon only when it is the best term. Explain unfamiliar terms before relying on them.
3. **Assume little or no project context.** Write for someone who does not know the repository, surrounding conversation or implementation history. Start with the document's purpose and what the reader needs to know.
4. **Explain API-specific context.** Assume JavaScript knowledge, not knowledge of this project's API design. Explain where an example belongs, who calls it, when it runs and how its inputs are supplied. Make it understandable on its own, or link directly to the prerequisite explanation. For example, explain that the plugin host calls `activate(context)` when enabling a registered plugin. Do not expect readers to infer that lifecycle from a code fragment.
5. **Keep discarded designs out of current guides.** Describe current behavior and genuinely planned work. Remove ideas rejected during discussion and APIs replaced before release. Keep that history only in changelogs. There is no need for migration commentary about unreleased designs that nobody has used. Preserve warnings about real current limitations.

Separate current behavior, approved plans and open decisions. Put detailed history and verified test results in changelogs. Do not make readers decode branch names or phase numbers before understanding a feature.

Keep examples accurate and supply their prerequisites. Link to exact sections rather than asking the reader to search another guide.

**Keep all documentation up to date.** Review documentation whenever behavior, APIs, examples, setup or plans change. Update every affected guide in the same change, including related references. Do not defer known stale instructions to a later cleanup. Preserve historical changelogs as records of their time; keep current guidance accurate separately.

Keep commit IDs, branch status and merge metadata in changelogs rather than general overviews. General guides should explain the current system without requiring an edit for every commit or merge.

## Validation

Start with tests for the changed behavior. Then run broader checks as needed:

```sh
pnpm check
pnpm test:unit:ci
pnpm test:e2e
pnpm build
```

`pnpm test:unit:ci` runs the application unit suite, SDK runtime tests, SDK compile-time checks, Node profile/build/server tests and portable SDK/sample checks. Run `pnpm test:plugin-profile:build` for focused profile/build/server checks. Run `pnpm test:plugin-sdk` for portable declaration and standalone sample checks. The sample is copied outside the checkout with real SDK packages, third-party dependencies and build tools. It uses strict `svelte-check` and audits compiler resolution without workspace aliases or source fallbacks.

Run `pnpm build:plugin-profile` to generate shared runtime artifacts. Run `pnpm build:plugin-sdk` to generate five private declarations-only packages in `node_modules/.cache/plugin-sdk`. They are not published npm packages and contain no JavaScript. The [portable SDK guide](docs/plugins/portable-sdk.md) explains local package delivery and the independent sample. Neither builder enables application external loading. For package-local SDK work, optionally run `pnpm --filter @writers-ide/plugins test` and `pnpm --filter @writers-ide/plugins check` directly.

### Native registry checks

Run these commands from `src-tauri`:

```sh
cargo test --locked --lib plugin_registry::location
cargo test --locked --lib plugin_registry::generation
cargo test --locked --lib plugin_registry::selector
cargo test --locked --lib plugin_registry::publication_platform
cargo test --locked --lib plugin_registry::generation::publisher
cargo test --locked --lib plugin_registry::generation::publisher::crash_tests
cargo test --locked --lib plugin_registry::qualification_evidence
cargo test --locked --lib plugin_registry::worker::lifecycle::publication_tests
cargo test --locked --lib plugin_registry::worker::lifecycle
cargo test --locked --lib plugin_registry::publication_probe
cargo test --locked --lib plugin_registry::worker::tests::probe_
cargo test --locked --lib
cargo check --locked --lib
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
```

The module-filtered test commands are focused subsets, not replacements for the full library suite. Selector tests cover the strict 64-byte codec and bounded, no-follow metadata reads. Publisher tests use `plugin_registry::generation::publisher`, despite the source file being `publisher.rs`. Platform tests cover candidate operations and production refusal. `plugin_registry::worker::lifecycle::publication_tests` covers native publication and retained failures on the SQLite thread. Location tests cover sibling-lock ownership without root initialization. Generation tests cover fresh directory/database creation, checked sealing and ownership retained on failure. The lifecycle module is `plugin_registry::worker::lifecycle`, despite its source file being [`lifecycle.rs`](src-tauri/src/plugin_registry/lifecycle.rs). Its tests cover admission/draining, same-thread service replacement, old-handle and stale-revision rejection, sticky shutdown, recovery-only retention and owned-startup cancellation.

The test-only [cache-aware campaign](src-tauri/src/plugin_registry/publication_crash_tests.rs) exercises the actual publisher sequence against an abstract persistence model. It reconstructs 972 primary crash-state scenarios and includes missing-barrier negative controls. This is not native filesystem/device power-loss qualification. The [environment collector](src-tauri/src/plugin_registry/qualification_evidence.rs) observes the default temporary-fixture and repository filesystems without serializing their paths or volume identifiers. Its local report is `src-tauri/target/registry-qualification/storage-evidence-local.json`. CI uploads only its run-ID/attempt-specific report as a storage-evidence artifact, not qualification proof. See the [model assumptions and artifact limits](docs/plugins/registry-publication-investigation.md#cache-aware-model-and-environment-observations).

The shared lifecycle and generation code is production-compiled but not connected to application startup. `Registry::open_owned` validates a supplied existing database beneath a leased root; it does not select or initialize a generation. Maintenance request constructors are `cfg(test)` closures only. The consuming publisher and native candidates are runtime-compiled behind a qualification gate. Production maintenance request adapters remain absent.

The owner-authorized [`publication_probe`](src-tauri/src/plugin_registry/publication_probe/mod.rs) harness is compiled only for tests. Cargo tests supply isolated temporary directories, limits and fixture inputs. No application entry point calls it. It shares checked sealing mechanics and exercises native selector candidates, faults and child-process boundaries. Test-only worker hooks retain a location lease before the startup await through actual worker cleanup. The prototype's leased-session cleanup thread is not adopted by the shared core.

The harness's 61-byte selector is private test data, not the implemented 64-byte production selector. Neither checksum authenticates data. Production `InitialRoot::claim` and `publish` always return `Unavailable` through preflight because no platform/storage configuration is qualified. Only `cfg(test)` bypasses exercise native publication candidates. Windows integrated publication deliberately returns an unsupported directory-barrier error before selector creation and returns no session. This unsupported barrier is a required cross-platform plugin-management and Part 4 gate, not permanent Windows exclusion. Separate Windows raw move tests include blocked sharing handles; passing them would not establish directory durability. Process-exit and successful barrier-call tests are not power-loss tests. See the [publication investigation](docs/plugins/registry-publication-investigation.md) for coverage and the [cumulative changelog](docs/plugins/change-log.md#native-registry-design) for recorded validation.

The new [Native Registry workflow](.github/workflows/native_registry.yml) is configured for stable Rust on `macos-15`, `windows-latest` and `ubuntu-24.04`. It runs `cargo fmt --check`, `cargo test --locked --lib` and `cargo clippy --locked --all-targets -- -D warnings`. It responds to native/workflow changes and manual dispatch. The [plugin changelog](docs/plugins/change-log.md#native-registry-design) records verified per-platform results and outstanding failures. The gated selector, publisher, platform-candidate and publication-lifecycle implementation has verified passing formatting, library-test and Clippy results on all three platforms after the Windows import-guard correction. The cache-aware campaign, environment collector and artifact upload also passed three-platform CI after the Windows empty-lock-file fixture correction. The inspected reports provide environment observations, not durability proof; see the [storage findings](docs/plugins/registry-publication-investigation.md#inspected-ci-storage-observations). Later changes require their own validation. Minimum-macOS evidence is a separate requirement. These checks do not validate packaged startup, native authorization, management/public UI, external loading or production publication.

### Cross-engine browser smoke tests

Browser tests use Chromium and WebKit. Run these commands from the repository root:

```sh
pnpm test:smoke
pnpm test:smoke --project=webkit
pnpm test:tasks
pnpm test:plugins
pnpm test:plugin-profile
pnpm test:plugin-profile --project=webkit
pnpm test:word-processing
pnpm test:e2e
pnpm exec playwright show-report browser-report
```

The suites have different purposes:

| Command                | Coverage                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `test:smoke`           | Startup, fonts, typing, selection, formatting, undo, menus, focus, visible page geometry, locale fallback and plugin management           |
| `test:tasks`           | Shared task ownership, emitted worker modules, buffer transfers, cancellation and worker errors                                           |
| `test:plugins`         | Provider dependencies, removal/consent, presentation lifetimes and opt-in application assembly with project-filtered production bars/tabs |
| `test:plugin-profile`  | Independent fixture and portable SDK sample against shared runtime artifacts, CSS/assets, cancellation and verified-byte Blob workers     |
| `test:word-processing` | Public editor access, independent formatting, history, worker results, input rules, mapped decorations and behavior failures              |
| `test:e2e`             | The full app suite, including pagination, docking and stylesheet compatibility                                                            |

`test:smoke` includes the dedicated pagination-selection regressions.
They check carets through page creation and forward/reversed ranges through formatting, reflow and undo.
The suite replaced the old starter `<h1>` test.

The task, plugin, runtime-profile and word-processing suites each build a separate small test application.
The main app e2e configuration excludes their test files.
Run their dedicated commands alongside app tests.
Browser Smoke CI runs each dedicated suite, including `test:plugin-profile`, for its selected engine. The [runtime profile guide](docs/plugins/runtime-profile.md) explains generated artifacts, the immutable fixture server and the limits of browser prefetch verification. Both independently built plugins use ordinary `context.tasks.worker({ module: URL, ... })` requests. The trusted fixture host supplies snapshot-bound verified-byte sources. Browser cases cover URL ownership, cancellation during loading, posting/transfer timing and Blob Worker cleanup. Production native byte-source and profile integration remain pending.

Tests check that content fits and is preserved.
They do not require identical page breaks across browser engines.
Use real-browser tests for DOM layout; jsdom has no layout engine.

### What CI does and does not verify

Browser Smoke CI uses:

| Operating system | Engine   |
| ---------------- | -------- |
| Windows          | Chromium |
| macOS 15         | WebKit   |
| Linux            | WebKit   |

These represent the engine families used by Tauri's WebView2, WKWebView and WebKitGTK runtimes.
They are not tests of those installed runtimes themselves.
Firefox/Gecko is outside the Tauri matrix.

Failures retain traces, screenshots and an HTML report.
The tests run against built frontend code.
They do not verify Tauri IPC, production asset protocols, packaged-app startup or macOS 13.3 specifically.
Before release, test the packaged app on each supported platform, including the oldest supported macOS.

For every change, report which checks passed, failed or could not run.
Do not present an old test result as validation of a new change.
