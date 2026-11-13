# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Its contributor and code-style conventions apply throughout this repository.

## Project memory and architectural approval

Writer's IDE is a local-first, highly extensible word processor with an IDE-like workspace, initially focused on fiction authors. Tauri + Svelte 5 + ProseMirror + Rust are firm choices. Official features are free; cooperation and creativity, not monetization, guide the project.

Before substantive work, read [docs/project-context.md](docs/project-context.md). Keep it a relatively small general overview and topic index, distinguishing current implementation, accepted direction, and open decisions. Then read the relevant topic's `context.md` and only the historical changelog entries needed for the task; do not load all topic documents or all history by default. Follow the topic's links to relevant source/tests:

| Working on                                                   | Context and source entry points                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pagination, footnotes, page geometry, cooperative scheduling | [docs/pagination/context.md](docs/pagination/context.md); [PR change log](docs/pagination/change-log.md); source/tests linked there |
| Bars, docking, drag-and-drop                                 | [docs/dnd/context.md](docs/dnd/context.md); [PR change log](docs/dnd/change-log.md); source/tests linked there                      |
| Browser performance tests, Storybook benchmarks              | [docs/browser-performance/context.md](docs/browser-performance/context.md); [PR change log](docs/browser-performance/change-log.md) |
| Central tabs/views                                           | Project context's implementation map; `src/lib/editor/state/`, `Editor.svelte`, `MainView.svelte`                                   |
| Plugins, packages, security, i18n                            | Project context's platform, plugin safety, developer experience, and implementation sections                                        |
| Persistence, history, collaboration, import/export           | Project context's content model and relevant feature sections; these are mostly planned, not implemented                            |

- Run every important architectural decision by the owner **before implementing it**. Present the proposal and tradeoffs; long-term direction is not blanket authorization for a migration.
- Keep these context documents current when behavior, architecture, or accepted decisions change. Record brief rationale and distinguish proposals from approved decisions. Do not append session transcripts.
- Treat GitHub issues as incomplete ideas/history, not automatically authoritative specifications. Verify them against code and confirmed decisions.
- Do not confuse current in-process registries with the planned isolated, permission-checked third-party plugin platform. Never introduce arbitrary native plugin execution or ambient host access as a shortcut.
- Aim for responsive operation on an 8 GB RAM baseline: incremental loading, viewport-focused work, virtualization where appropriate, and bounded cooperative/worker/backend processing. Promises alone do not offload CPU work.
- Preserve the current model-mutating pagination implementation unless a specific redesign is approved. Derived per-view layout is a future direction, not a completed migration.

## Component context and PR change logs

- Organize durable topic/component documentation as `docs/<topic>/context.md` and `docs/<topic>/change-log.md`. Use cohesive subsystems (for example `dnd`), not one folder for every class or Svelte component. Reuse an existing topic when appropriate.
- `context.md` describes the **current** philosophy, approach, contracts/invariants, important decisions and rationale, source/test entry points, limitations, and genuinely open questions. Update it alongside relevant implementation changes; distinguish working-branch behavior from confirmed merged behavior when that matters. Replace outdated descriptions rather than accumulating a diary.
- Create **one consolidated entry per PR per affected topic when work begins**, under an `In progress` section in `change-log.md`. Mark it **In progress / unmerged**, link the PR when its identity is known, or use the branch name until a PR exists. Do not invent PR numbers or merge dates.
- **Update the same entry with every commit while working on the PR.** Keep it accurate for the cumulative diff: what changed, decisions and why, important outcomes/compatibility changes, verified validation, and remaining limitations or follow-ups. Review affected context and entries before each commit and include needed documentation updates in that commit. If not authorized to commit, leave these updates in the working tree with the code changes.
- The entry should be complete and ready to read **before the owner merges**; do not defer writing the explanation until after merge. Rewrite its summary as the implementation evolves, removing superseded experiments or labeling genuinely unresolved decisions. Do not append one entry per commit, session transcripts, intermediate-decision diaries, or repeated test-run logs.
- Keep `In progress` entries separate from `Merged PRs`. Once a merge is confirmed, move the completed entry into chronological merge-date order and replace its unmerged status with the verified merge date (`YYYY-MM-DD`) and PR link. Only merge-status/date metadata should remain to finalize; the substantive narrative must already be complete. Verify metadata from the authoritative PR record or explicit merge evidence, never from a feature-branch commit. If metadata is unavailable, leave the status unmerged/unknown and report it rather than fabricate it.
- Merged historical entries remain a record of their time: later PRs supersede decisions through new entries; update current context separately. Correct factual errors transparently rather than rewriting old outcomes to match today's behavior.
- When substantive work introduces a new topic, create the pair, start its in-progress PR entry, and add it to the topic index in `docs/project-context.md`. For cross-topic PRs, document each topic's relevant impact and link to related entries rather than duplicate the full narrative.
- [docs.md](docs.md) is a navigation index for topic documentation, not a second copy of component histories. Existing standalone topic guides remain valid; migrate them incrementally when relevant, not through unrelated bulk rewrites.
- Every agent is responsible for this reading/update workflow, including providing relevant context to delegated agents. PR handoffs should state which context/changelog files changed, confirm the in-progress entry matches the current PR, and identify any unresolved work or merge metadata still to finalize.

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
