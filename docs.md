# Documentation index

Start with [project context](docs/project-context.md) for the general overview, accepted direction, implementation map, and topic index. Read [CONTRIBUTING.md](CONTRIBUTING.md) for code style and validation, and [AGENTS.md](AGENTS.md) for the agent reading/update workflow.

## Topic documentation

| Topic                                                        | Current context / guide                        | PR change log (in progress + merged)                       |
| ------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| Bars, docking, drag-and-drop                                 | [Context](docs/dnd/context.md)                 | [Change log](docs/dnd/change-log.md)                       |
| Pagination, footnotes, page geometry, cooperative scheduling | [Context](docs/pagination/context.md)          | [Change log](docs/pagination/change-log.md)                |
| Browser performance testing                                  | [Context](docs/browser-performance/context.md) | [Change log](docs/browser-performance/change-log.md)       |
| Dependency maintenance                                       | [Guide](docs/dependencies.md)                  | General maintenance reference, kept as a standalone guide. |

New substantive topics use `docs/<topic>/context.md` for current philosophy, contracts, rationale, source/tests, and limitations, plus `docs/<topic>/change-log.md` for consolidated PR entries maintained throughout development and retained as merged history. Existing standalone guides remain valid and can migrate incrementally when relevant.

Create one entry per PR per affected topic when work begins, under **In progress**, marked **In progress / unmerged** and linked to the PR (or identified by branch until a PR exists). Update that same entry with every commit so the cumulative changes, decisions and rationale, outcomes, verified validation, and remaining work are complete before merge. Review affected entries and current context before each commit; if not authorized to commit, leave their updates with the implementation in the working tree.

After confirmed merge, move the completed entry into **Merged PRs** in chronological merge-date order and finalize only verified status/date/link metadata. Do not defer the substantive explanation until after merge. Do not append one entry per commit, agent-session transcripts, intermediate-decision diaries, repeated test-run logs, invented PR numbers, or unverified merge dates. This index does not duplicate component histories.
