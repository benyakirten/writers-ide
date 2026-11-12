# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Its contributor and code-style conventions apply throughout this repository.

## Required code style

- Keep mutations out of conditions. Do not use assignments, `++`, or `--` inside `if`, `while`, `do…while`, or `for` conditions. Perform updates in separate statements and preserve prefix/postfix semantics.
- Increment/decrement expressions are allowed outside conditions, including a `for` loop's update clause.
- Always use braces for control-flow bodies, including single-statement `if`, `else`, and loop bodies. Ordinary `else if` chains are allowed.
- Ordinary predicate calls are allowed, but do not hide mutations inside predicate helpers to bypass these conventions.
- Follow the existing Oxfmt and Oxlint configuration. Do not assume Oxfmt adds missing braces or removes side effects from conditions.

## Working in this repository

- The frontend uses Svelte 5. Follow existing rune-based state and component patterns.
- The document editor uses ProseMirror. Keep model transactions and DOM measurements consistent; account for edits and cancellation between cooperative work steps.
- Keep changes focused. Preserve existing user changes and avoid unrelated fixes or dependency additions.
- Add or update tests when behavior changes. Use real-browser tests for pagination geometry; jsdom cannot validate layout.
- Run relevant checks described in CONTRIBUTING.md. Report what passed, what failed, and what could not be run; do not claim unverified validation.
- Do not commit changes or create branches unless the user requests it.
