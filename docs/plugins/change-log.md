# Plugins and reusable libraries — PR change log

For current concepts, boundaries, source entry points, and open decisions, read [context.md](context.md).

## In progress

### `bh/add-plugin-interface-js` — Plugin, library, and core distinction

**Status: In progress / unmerged.** PR identity and merge date are not established.

- Establishes plugins/core responsibilities and library reuse as separate architectural axes. Defines plugin packages, contributions, capabilities, and the distinction from ProseMirror plugins.
- Documents core hosting responsibilities and candidate library boundaries without authorizing extraction, selecting public APIs, or claiming isolation exists. Uses formatting, docking, and a future undo-tree view to explain the separation of feature UI, shared infrastructure, and reusable implementation.
- Records current trusted registries and package scaffolds, security/data-preservation constraints, and unresolved implementation choices. Links the new topic from the project context and documentation index.
- Documentation only: no runtime behavior, dependencies, package layout, or existing pagination architecture changes.
- Validation: focused Oxfmt checks passed for the four affected Markdown files; local Markdown file links resolved; `git diff --check` passed. Application tests were not run because this change is documentation-only.
- Follow-up: concrete API and extraction proposals require owner approval; finalize PR/merge metadata only when verified.

## Merged PRs

No merged entries recorded for this topic.
