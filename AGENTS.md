# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Its contributor and code-style conventions apply throughout this repository.

## Project memory and architectural approval

Writer's IDE is a local-first, highly extensible word processor with an IDE-like workspace, initially focused on fiction authors. Tauri + Svelte 5 + ProseMirror + Rust are firm choices. Official features are free; cooperation and creativity, not monetization, guide the project.

Before substantive work, read [docs/project-context.md](docs/project-context.md). It distinguishes current implementation, accepted direction, and open decisions. Read only the additional topic context relevant to the task:

| Working on                                                   | Context and source entry points                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Pagination, footnotes, page geometry, cooperative scheduling | [docs/pagination.md](docs/pagination.md), then the source/tests linked there                                              |
| Bars, docking, drag-and-drop, tabs/views                     | Project context's implementation map; `src/lib/editor/bars/`, `src/lib/editor/state/`, `Editor.svelte`, `MainView.svelte` |
| Plugins, packages, security, i18n                            | Project context's platform, plugin safety, developer experience, and implementation sections                              |
| Persistence, history, collaboration, import/export           | Project context's content model and relevant feature sections; these are mostly planned, not implemented                  |

- Run every important architectural decision by the owner **before implementing it**. Present the proposal and tradeoffs; long-term direction is not blanket authorization for a migration.
- Keep these context documents current when behavior, architecture, or accepted decisions change. Record brief rationale and distinguish proposals from approved decisions. Do not append session transcripts.
- Treat GitHub issues as incomplete ideas/history, not automatically authoritative specifications. Verify them against code and confirmed decisions.
- Do not confuse current in-process registries with the planned isolated, permission-checked third-party plugin platform. Never introduce arbitrary native plugin execution or ambient host access as a shortcut.
- Aim for responsive operation on an 8 GB RAM baseline: incremental loading, viewport-focused work, virtualization where appropriate, and bounded cooperative/worker/backend processing. Promises alone do not offload CPU work.
- Preserve the current model-mutating pagination implementation unless a specific redesign is approved. Derived per-view layout is a future direction, not a completed migration.

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
