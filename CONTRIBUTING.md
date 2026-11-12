# Contributing

Writer's IDE is an extensible word processor built with Svelte 5 and ProseMirror.
Keep changes focused, follow existing project patterns, and add or update tests when behavior changes.

## Toolchain

Use pnpm 12.4.1 (pinned in `package.json`), Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, and Rust 1.90 or newer. CI uses Node.js 24. Install frontend dependencies with `pnpm install --frozen-lockfile`; install the matching browser with `pnpm exec playwright install chromium` before browser tests. The Node.js minimum follows jsdom's supported releases.

The frontend uses SvelteKit 3, Vite 8, and Tailwind CSS 4. SvelteKit configuration lives in `vite.config.ts`, not `svelte.config.js`. Tailwind 4 requires Safari 16.4+, Chrome 111+, or Firefox 128+; desktop WebViews must satisfy that baseline too. The macOS application requires macOS 13.3 Ventura or newer, as configured in `src-tauri/tauri.conf.json`. See [dependency maintenance](docs/dependencies.md) for update/audit commands and outstanding upstream advisories.

## Code style

These conventions apply to JavaScript and TypeScript, including scripts in Svelte components.

### Keep mutations out of conditions

Conditions should evaluate state, not change it. Do not use assignments or increment/decrement expressions in `if`, `while`, `do…while`, or `for` conditions. Perform mutations in separate statements.

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

Preserve the original behavior when separating a mutation from a condition: postfix and prefix updates evaluate differently.

Increment and decrement operators are allowed outside conditions, including the update clause of a `for` loop:

```ts
for (let index = 0; index < count; index++) {
	processItem(index);
}
```

Ordinary predicate calls such as `if (isReady())` are fine. Avoid hiding mutations in predicate functions; linting cannot generally determine whether a function call has side effects.

### Always use braces for control flow

Use brace bodies for every `if`, `else`, `for`, `for…of`, `for…in`, `while`, and `do…while`, even when the body contains only one statement. Ordinary `else if` chains are allowed.

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

Use the repository's Oxfmt (`.oxfmtrc.json`) and Oxlint (`.oxlintrc.json`) configuration rather than introducing personal formatting rules. Oxfmt formats code, including Svelte components and Tailwind CSS classes; it does not replace semantic lint rules or the conventions above.

```sh
pnpm lint
pnpm lint:fix
```

`lint` checks formatting and lint rules. `lint:fix` applies safe lint fixes, then formats the result.

For a focused change, check only the files you touched:

```sh
pnpm exec oxfmt --check path/to/file.ts
pnpm exec oxlint path/to/file.ts
```

Oxlint preserves the supported rules from the previous ESLint configuration, including the underscore-prefixed unused-variable exemptions. It lints Svelte `<script>` blocks, not templates, so it does not replace `eslint-plugin-svelte`'s template rules. Continue to run `pnpm check` for Svelte and TypeScript diagnostics.

The brace and mutation conventions above still apply even where lint rules do not enforce them. Do not replace the condition-specific increment/decrement restriction with a blanket ban on `++` and `--`.

Oxfmt and Oxlint's own Node.js minimum is lower than the project's toolchain requirement above; use the project requirement when installing dependencies.

## Validation

Start with tests covering the changed behavior, then run broader checks as appropriate:

```sh
pnpm check
pnpm test:unit:ci
pnpm test:e2e
pnpm build
```

DOM layout and pagination geometry require real-browser tests; jsdom does not provide a layout engine. Report any checks you could not run or existing failures separately from failures introduced by your change.
