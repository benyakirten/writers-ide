# Contributing

Writer's IDE is an extensible word processor built with Svelte 5 and ProseMirror.
Keep changes focused, follow existing project patterns, and add or update tests when behavior changes.

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

Use the repository's Prettier and ESLint configuration rather than introducing personal formatting rules. Prettier formats code; it does not replace semantic lint rules or the conventions above.

```sh
pnpm lint
```

For a focused change, check only the files you touched:

```sh
pnpm exec prettier --check path/to/file.ts
pnpm exec eslint path/to/file.ts
```

ESLint's `curly: ['error', 'all']` rule can enforce brace bodies, and `no-cond-assign: ['error', 'always']` can prohibit assignments in conditions. Restricting increment/decrement expressions specifically inside conditions requires an AST selector rule; do not replace that restriction with a blanket ban on `++` and `--`.

## Validation

Start with tests covering the changed behavior, then run broader checks as appropriate:

```sh
pnpm check
pnpm test:unit:ci
pnpm test:e2e
pnpm build
```

DOM layout and pagination geometry require real-browser tests; jsdom does not provide a layout engine. Report any checks you could not run or existing failures separately from failures introduced by your change.
