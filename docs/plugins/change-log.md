# Plugins and reusable libraries — PR change log

For current concepts, boundaries, source entry points, and open decisions, read [context.md](context.md).

## In progress

### `bh/add-plugin-interface-js` — Stage 1 bundled plugins and formatting boundary

**Status: In progress / unmerged.** PR identity and merge date are not established.

- Establishes plugins/core responsibilities and library reuse as separate architectural axes. Defines plugin packages, contributions, capabilities, and the distinction from ProseMirror plugins.
- Documents core hosting responsibilities and library boundaries using formatting, docking, and a future undo-tree view to explain feature UI, shared infrastructure, and reusable implementation.
- Records the owner-approved sequence: Stage 1 establishes contracts, a bundled-plugin host and formatting-plugin migration; Stage 2 extracts scoped private layout/component libraries and adds a host-owned plugin manager; Stage 3 implements isolation, messaging, validation and permissions before third-party installation/loading. Detailed APIs and isolation mechanisms remain open, not silently selected.
- Requires transportable data/command contracts from the outset while treating direct Svelte components as trusted adapters only. Stages 1 and 2 do not sandbox plugins, offer external installation, redesign pagination, or implement history storage.
- Records current trusted registries and package scaffolds, security/data-preservation constraints, and unresolved implementation choices. Links the new topic from the project context and documentation index.
- Implements Stage 1 as a private `@writers-ide/plugins` workspace package with framework-independent data/lifecycle contracts and a separate trusted Svelte descriptor entry. Adds no external dependency or published package. The synchronous host provides exact API-version compatibility, explicit registration, declared-capability checks, contribution ownership/duplicate validation, rollback, reverse-order cleanup, revocation, and immutable management snapshots/errors.
- Adds application adapters for toolbar/view contributions and host-owned command handles. Renders plugin presentations with only their scoped context while retaining the legacy word-processing path. Route startup activates the formatting plugin and route teardown deactivates it. Central-view instance metadata, shortcut contribution routing, and general word-processor extraction remain deferred.
- Migrates horizontal/vertical formatting controls to copied snapshots and validated view/revision/command requests. Correctly resolves tab document IDs to independent registered view IDs and rejects stale active-view/state requests before reactive flush. Preserves mark exclusivity and peer-paragraph formatting, disables unavailable/no-op controls, and starts/releases shared subscription resources lazily. Availability queries are read-only rather than speculative formatting transactions; listener failures do not interrupt editor dispatch.
- Keeps disabled toolbar placement IDs and orientation costs, preventing disable/fill/re-enable capacity overflow. Does not introduce durable layout/state storage. Removes an existing raw document-node debug log from peer-group queries now used on the formatting hot path. Related topic entries: [docking](../dnd/change-log.md), [pagination](../pagination/change-log.md).
- Tests cover lifecycle failures, rollback, duplicate IDs and capabilities, stale contexts/commands, subscription cleanup and error isolation, separate document/view IDs, rendering/orientations, formatting ratios and exclusivity, continuation paragraphs, and disabled-placement capacity preservation.
- Validation: `pnpm lint` passed; all 746 unit tests in 34 files passed. `pnpm exec playwright test smoke.test.ts docking.test.ts --workers=2` passed all 52 cases across Chromium/WebKit after final review fixes, including a successful production build. Local Markdown file links and `git diff --check` passed. `pnpm check` remains blocked by the existing invalid `$props` type-argument syntax in `Modal.svelte` and reports five warnings in older generic DnD wrappers; no errors remain in the changed plugin/rendering files. Browser results do not validate packaged Tauri or third-party isolation.
- Follow-up: Stage 2 library extraction and the host-owned plugin manager; Stage 3 isolation/enforcement before external loading. Management snapshots are synchronous (no reactive manager subscription yet), activation preferences are not persisted, and in-process JavaScript is not sandboxed. The undo-tree/history storage model is not implemented. Finalize PR/merge metadata only when verified.

## Merged PRs

No merged entries recorded for this topic.
