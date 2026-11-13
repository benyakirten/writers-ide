# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Its contributor and code-style conventions apply throughout this repository.

## Project memory and architectural approval

Writer's IDE is a local-first, highly extensible word processor with an IDE-like workspace, initially focused on fiction authors. Tauri + Svelte 5 + ProseMirror + Rust are firm choices. Official features are free; cooperation and creativity, not monetization, guide the project.

Before substantive work, read [docs/project-context.md](docs/project-context.md). Keep it a relatively small general overview and topic index, distinguishing current implementation, accepted direction, and open decisions. Then read the relevant topic's `context.md` and only the historical changelog entries needed for the task; do not load all topic documents or all history by default. Follow the topic's links to relevant source/tests:

| Working on                                                   | Context and source entry points                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Pagination, footnotes, page geometry, cooperative scheduling | [docs/pagination/context.md](docs/pagination/context.md); [merged PR history](docs/pagination/change-log.md); source/tests linked there |
| Bars, docking, drag-and-drop                                 | [docs/dnd/context.md](docs/dnd/context.md); [merged PR history](docs/dnd/change-log.md); source/tests linked there                      |
| Browser performance tests, Storybook benchmarks              | [docs/browser-performance/context.md](docs/browser-performance/context.md); [merged PR history](docs/browser-performance/change-log.md) |
| Central tabs/views                                           | Project context's implementation map; `src/lib/editor/state/`, `Editor.svelte`, `MainView.svelte`                                       |
| Plugins, packages, security, i18n                            | Project context's platform, plugin safety, developer experience, and implementation sections                                            |
| Persistence, history, collaboration, import/export           | Project context's content model and relevant feature sections; these are mostly planned, not implemented                                |

- Run every important architectural decision by the owner **before implementing it**. Present the proposal and tradeoffs; long-term direction is not blanket authorization for a migration.
- Keep these context documents current when behavior, architecture, or accepted decisions change. Record brief rationale and distinguish proposals from approved decisions. Do not append session transcripts.
- Treat GitHub issues as incomplete ideas/history, not automatically authoritative specifications. Verify them against code and confirmed decisions.
- Do not confuse current in-process registries with the planned isolated, permission-checked third-party plugin platform. Never introduce arbitrary native plugin execution or ambient host access as a shortcut.
- Aim for responsive operation on an 8 GB RAM baseline: incremental loading, viewport-focused work, virtualization where appropriate, and bounded cooperative/worker/backend processing. Promises alone do not offload CPU work.
- Preserve the current model-mutating pagination implementation unless a specific redesign is approved. Derived per-view layout is a future direction, not a completed migration.

## Component context and merged-PR history

- Organize durable topic/component documentation as `docs/<topic>/context.md` and `docs/<topic>/change-log.md`. Use cohesive subsystems (for example `dnd`), not one folder for every class or Svelte component. Reuse an existing topic when appropriate.
- `context.md` describes the **current** philosophy, approach, contracts/invariants, important decisions and rationale, source/test entry points, limitations, and genuinely open questions. Update it alongside relevant implementation changes; distinguish working-branch behavior from confirmed merged behavior when that matters. Replace outdated descriptions rather than accumulating a diary.
- `change-log.md` records **completed, confirmed merged PRs only**, in chronological merge-date order. Use one consolidated entry per PR per affected topic: merge date (`YYYY-MM-DD`), PR number/link, what changed, final decisions and why, important outcomes/compatibility changes, and remaining limitations or follow-ups. Include validation only when verified and useful; do not copy repeated test-run logs.
- Never add current/unmerged PR entries, provisional merge dates, invented PR numbers, or session/intermediate-decision histories. Verify merge status, PR identity, and merge date from authoritative PR metadata or explicit merge evidence; a feature-branch commit alone is not evidence of merge. If unavailable, report the missing information rather than fabricate it. Backfill the entry after merge, including during the next documentation task when necessary; do not create an unrelated commit or branch to do so without permission.
- Historical entries remain a record of their time: later PRs supersede decisions through new entries; update current context separately. Correct factual errors transparently rather than rewriting old outcomes to match today's behavior.
- When substantive work introduces a new topic, create the pair, even if its changelog has no entries yet, and add it to the topic index in `docs/project-context.md`. For cross-topic PRs, document each topic's relevant impact and link to related entries rather than duplicate the full narrative.
- [docs.md](docs.md) is a navigation index for topic documentation, not a second copy of component histories. Existing standalone topic guides remain valid; migrate them incrementally when relevant, not through unrelated bulk rewrites.
- Every agent is responsible for this reading/update workflow, including providing relevant context to delegated agents. PR handoffs should state which context files changed and whether a merged-history entry remains pending.

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
