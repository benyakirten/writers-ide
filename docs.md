# Documentation index

Start with the guide that matches your goal:

- [Project context](docs/project-context.md): what Writer's IDE is, what works today, and what is planned. It also maps the main source files.
- [Contributing](CONTRIBUTING.md): toolchain setup, code style, documentation style, and validation commands.
- [Agent instructions](AGENTS.md): the reading and update workflow for coding agents.

## Topic documentation

| Topic                                         | Current design or guide                        | Change history                                       |
| --------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Bars, docking, and drag-and-drop              | [Context](docs/dnd/context.md)                 | [Change log](docs/dnd/change-log.md)                 |
| Pagination, footnotes, and shared scheduling  | [Context](docs/pagination/context.md)          | [Change log](docs/pagination/change-log.md)          |
| Browser performance tests                     | [Context](docs/browser-performance/context.md) | [Change log](docs/browser-performance/change-log.md) |
| Plugins, libraries, and core responsibilities | [Context](docs/plugins/context.md)             | [Change log](docs/plugins/change-log.md)             |
| Dependency maintenance                        | [Guide](docs/dependencies.md)                  | Kept in the standalone guide                         |

A topic's `context.md` explains its current design, rules, reasons, and limitations. It links to the relevant source and tests. Its `change-log.md` records what each pull request changed and how it was checked.

For plugin implementation work, see the [implementation plan](docs/plugins/implementation-plan.md). The [external package specification draft](docs/plugins/package-api-proposal.md) is for consolidated design review; its new contracts are not implemented. The [resource-loading investigation](docs/plugins/resource-loading-investigation.md) records source findings and the packaged prototype still needed. For current API usage, start with these package guides:

- [Plugins](packages-js/plugins/README.md): add features, manage their lifetime, and connect plugins through declared APIs.
- [Word processing](packages-js/word-processing/README.md): read and edit documents, register commands, and add editor behaviors.
- [Tasks](packages-js/tasks/README.md): schedule incremental work, manage asynchronous operations, and run workers.
- [Layout](packages-js/layout/README.md): reuse bar placement, capacity, and drag-and-drop logic.
- [Components](packages-js/components/README.md): reuse buttons, tooltips, and pointer components.

When updating topic documentation:

1. Update the context to describe the current design. Separate working behavior, approved plans, and open questions.
2. Create one changelog entry per pull request per affected topic when work begins. Put it under **In progress** and mark it **In progress / unmerged**. Link the pull request when known. Until then, use the branch name.
3. Update that same entry as the work changes. Describe the cumulative changes, reasons, outcomes, verified checks, and remaining work. Review the context and entry before each commit. If a commit is not authorized, leave the documentation changes in the working tree.
4. Finish the explanation before merge. After merge is confirmed, move the entry into **Merged PRs** in merge-date order. Finalize the status, date, and link using verified evidence. Never invent merge metadata.

Do not add an entry for every commit or session. Do not append conversation transcripts, intermediate-decision diaries, or repeated test logs. This page is an index, not another copy of topic histories.

Use the context/changelog pair for new substantive topics. Existing standalone guides can move to that structure when relevant work next touches them.
