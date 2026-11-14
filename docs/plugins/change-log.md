# Plugins and reusable libraries — PR change log

For current concepts, boundaries, source entry points, and open decisions, read [context.md](context.md).

## In progress

### `bh/add-plugin-interface-js` — Plugin boundaries and staged implementation plan

**Status: In progress / unmerged.** PR identity and merge date are not established.

- Establishes plugins/core responsibilities and library reuse as separate architectural axes. Defines plugin packages, contributions, capabilities, and the distinction from ProseMirror plugins.
- Documents core hosting responsibilities and library boundaries using formatting, docking, and a future undo-tree view to explain feature UI, shared infrastructure, and reusable implementation.
- Records the owner-approved sequence: Stage 1 establishes contracts, a bundled-plugin host and formatting-plugin migration; Stage 2 extracts scoped private layout/component libraries and adds a host-owned plugin manager; Stage 3 implements isolation, messaging, validation and permissions before third-party installation/loading. Detailed APIs and isolation mechanisms remain open, not silently selected.
- Requires transportable data/command contracts from the outset while treating direct Svelte components as trusted adapters only. Stages 1 and 2 do not sandbox plugins, offer external installation, redesign pagination, or implement history storage.
- Records current trusted registries and package scaffolds, security/data-preservation constraints, and unresolved implementation choices. Links the new topic from the project context and documentation index.
- Documentation only: no runtime behavior, dependencies, package layout, or existing pagination architecture changes.
- Validation: focused Oxfmt checks passed for the four affected Markdown files; local Markdown file links resolved; `git diff --check` passed. Application tests were not run because this change is documentation-only.
- Follow-up: implement the approved stages; obtain owner approval for unresolved architectural choices and work beyond that scope. Finalize PR/merge metadata only when verified.

## Merged PRs

No merged entries recorded for this topic.
