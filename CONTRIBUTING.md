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

`pnpm test:unit:ci` runs the application unit suite, SDK runtime tests and SDK compile-time checks. For focused SDK work, optionally run `pnpm --filter @writers-ide/plugins test` and `pnpm --filter @writers-ide/plugins check` directly.

### Cross-engine browser smoke tests

Browser tests use Chromium and WebKit. Run these commands from the repository root:

```sh
pnpm test:smoke
pnpm test:smoke --project=webkit
pnpm test:tasks
pnpm test:plugins
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
| `test:word-processing` | Public editor access, independent formatting, history, worker results, input rules, mapped decorations and behavior failures              |
| `test:e2e`             | The full app suite, including pagination, docking and stylesheet compatibility                                                            |

`test:smoke` includes the dedicated pagination-selection regressions.
They check carets through page creation and forward/reversed ranges through formatting, reflow and undo.
The suite replaced the old starter `<h1>` test.

The task, plugin and word-processing suites each build a separate small test application.
The main app e2e configuration excludes their test files.
Run their dedicated commands alongside app tests.
Browser Smoke CI runs each dedicated suite for its selected engine.

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
