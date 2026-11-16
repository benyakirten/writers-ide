# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Its contributor and code-style conventions apply throughout this repository.

## Documentation: five required writing rules

Apply these rules whenever you write or update documentation, including READMEs, examples and design guides. Check your work against all five before finishing.

1. **Use simple sentences.** Include only necessary clauses. Write more sentences when that makes the explanation clearer.
2. **Choose clarity over cleverness.** Minimize metaphor. Use jargon only when it is the best term, and explain it before relying on it.
3. **Assume little or no project context.** Do not assume the reader knows the repository, earlier discussions or implementation history.
4. **Explain API-specific context.** Assume JavaScript knowledge, not knowledge of this project's API design. Explain where an example belongs, who calls it, when it runs and how its inputs are supplied. Make the example understandable on its own, or link directly to the prerequisite explanation. For example, do not mention `activate(context)` without explaining the plugin host's role or linking to that explanation.
5. **Keep discarded designs out of current guides.** Describe the current design and genuinely planned work. Remove mentions of ideas rejected during discussion and APIs replaced before release. Keep that history only in changelogs. Do not add migration notes for unreleased designs that nobody has used. Preserve warnings about real current limitations.

**Keep all documentation up to date.** When a change affects documented behavior, APIs, examples, setup or plans, update every affected guide in the same change. Check related references for contradictions. Do not leave known stale instructions for a later cleanup. Historical changelogs remain records of their time; update current guides instead of rewriting history.

See [Writing documentation](CONTRIBUTING.md#writing-documentation) for related maintenance guidance.

## Decision-making and human approval

- **Do not resolve important uncertainty by assumption.** First check the code, tests and approved documentation. If a design question remains unresolved, ask the owner before implementing a choice.
- **Get approval for overall architecture and API design.** This includes new or changed public contracts, responsibility boundaries, lifecycle behavior, data models, compatibility policy and security or permission rules. Approval of a broad goal is not approval of every design choice needed to reach it.
- **Make the decision understandable.** Explain the problem, relevant context, options, tradeoffs, risks and your recommendation in plain language. Identify what needs a decision. Give the owner enough information to choose, and wait for approval before implementing that choice.
- **Handle small implementation details independently.** Routine local choices that preserve approved behavior and contracts do not need consultation. Ask when a seemingly small choice changes the overall design or API semantics.

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

- Follow the [decision-making and approval rules](#decision-making-and-human-approval) before changing architecture or API design.
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
