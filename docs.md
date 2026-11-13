# Documentation index

Start with [project context](docs/project-context.md) for the general overview, accepted direction, implementation map, and topic index. Read [CONTRIBUTING.md](CONTRIBUTING.md) for code style and validation, and [AGENTS.md](AGENTS.md) for the agent reading/update workflow.

## Topic documentation

| Topic                                                        | Current context / guide                        | Confirmed merged PR history                                |
| ------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| Bars, docking, drag-and-drop                                 | [Context](docs/dnd/context.md)                 | [Change log](docs/dnd/change-log.md)                       |
| Pagination, footnotes, page geometry, cooperative scheduling | [Context](docs/pagination/context.md)          | [Change log](docs/pagination/change-log.md)                |
| Browser performance testing                                  | [Context](docs/browser-performance/context.md) | [Change log](docs/browser-performance/change-log.md)       |
| Dependency maintenance                                       | [Guide](docs/dependencies.md)                  | General maintenance reference, kept as a standalone guide. |

New substantive topics use `docs/<topic>/context.md` for current philosophy, contracts, rationale, source/tests, and limitations, plus `docs/<topic>/change-log.md` for completed, confirmed merged PRs. Existing standalone guides remain valid and can migrate incrementally when relevant.

Changelogs use chronological merge-date order and one consolidated entry per PR per affected topic. Record what shipped, final decisions and why, and important outcomes/follow-ups. Do not record in-PR progress, agent-session histories, provisional dates, or unverified merges. This index does not duplicate component histories.
