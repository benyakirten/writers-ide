# Word-processing browser fixtures

This directory builds a small browser application for testing the public word-processing provider. It is separate from the default Writer's IDE application. The plugin host enables registered feature plugins and supplies their activation context. Consumers resolve the provider through their declared dependency, then use connection-owned editor APIs.

Read the [connection setup](../../../packages-js/word-processing/README.md#connect-your-feature) and [renderer author guide](../../../packages-js/word-processing/README.md#part-3c-renderers-for-existing-content) before reusing the examples. These are trusted, bundled examples, not externally loaded packages or finished user features.

## Run the fixtures

From the repository root, with the [required toolchain and browser engines](../../../CONTRIBUTING.md#toolchain) installed:

```sh
pnpm test:word-processing
```

To run only the renderer suites on one engine:

```sh
pnpm test:word-processing --project=chromium e2e/word-processing-renderers.test.ts e2e/word-processing-renderer-pagination.test.ts
pnpm test:word-processing --project=webkit e2e/word-processing-renderers.test.ts e2e/word-processing-renderer-pagination.test.ts
```

[`playwright.word-processing.config.ts`](../../../playwright.word-processing.config.ts) builds this fixture with Vite, then serves the production build on port 4177. It selects Chromium and WebKit. The main app e2e suite excludes these tests. Test references here describe coverage, not a recorded pass result. See the [plugin changelog](../../../docs/plugins/change-log.md) for verified outcomes.

## Choose a scenario

[`main.ts`](main.ts) mounts [`WordProcessingFixture.svelte`](WordProcessingFixture.svelte). Its initial scenario uses a small schema with `paragraph` nodes and `strong` marks. It provides two independent editor views, history, public API controls, and worker examples. Views are not synchronized copies of one document.

Additional scenarios are opt-in:

| Control                             | Mounted component                                                    | Purpose                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mount behavior proofs**           | [`BehaviorFixture.svelte`](BehaviorFixture.svelte)                   | Input rules, mapped decorations, and bounded worker analysis. See the [behavior examples](../../../src/lib/editor/prosemirror/behaviors/README.md). |
| **Mount renderer proofs**           | [`RendererFixture.svelte`](RendererFixture.svelte)                   | Existing-type Svelte node/mark views, lifecycle, conflicts, and failure recovery.                                                                   |
| **Mount paginated renderer proofs** | [`PaginatedRendererFixture.svelte`](PaginatedRendererFixture.svelte) | A separate production-schema editor and real pagination geometry.                                                                                   |

The normal application route does not enable these examples. Mounting renderer controls does not itself enable the example renderer plugin. Use **Enable Svelte renderers** or **Enable paginated renderer** after mounting the corresponding scenario.

## Svelte node and mark example

`RendererFixture.svelte` registers feature plugins with a required word-processing dependency. The host calls each plugin's `activate(context)` when enabled. Activation resolves the API and calls `registerNodeView` for `paragraph` and `registerMarkView` for `strong`. Their per-view factories receive `EditorRendererContext` and return constructors from `@writers-ide/word-processing/svelte`.

- [`RendererNode.svelte`](RendererNode.svelte) receives current node/decorations/selection props, `getPos`, and a `contentDOM` action. Its native button and input are non-document UI. Its empty editable host uses the action so ProseMirror owns the children.
- [`RendererMark.svelte`](RendererMark.svelte) receives the current mark, inline flag, and the same editable-content action. The adapter supports `MarkView.update`. Marks have no node-specific selection callbacks.
- Each adapter receives `onError: ctx.reportError`. This ties later Svelte boundary failures to the owning registration rather than losing connection ownership.

The controls can release just the paragraph renderer, reject a conflicting registration, open a later view, or disable the feature. Release and disable return content to normal schema rendering. They do not delete content or serialize component UI.

[`AsyncFailureRendererNode.svelte`](AsyncFailureRendererNode.svelte) and [`AsyncFailureRendererMark.svelte`](AsyncFailureRendererMark.svelte) fail from independent reactive state. The failure controls enable one of these variants without enabling the ordinary renderers first. **Trigger independent reactive failure** then changes Svelte state without dispatching a ProseMirror transaction. Only one view throws, but quarantine removes that registration from all views. The adapter rescues editable content before boundary teardown.

[`word-processing-renderers.test.ts`](../../word-processing-renderers.test.ts) covers typing, range and node selection, navigation, native controls, schema serialization, stored marks, history, later views, disable/re-enable, conflicts, and constructor/update/async-boundary failures. Synthetic composition events exercise event routing only. They do not simulate an operating-system IME. Arbitrary event-handler, timer, and promise failures are not universally caught by Svelte boundaries.

## Production pagination example

`PaginatedRendererFixture.svelte` creates a separate document using the production schema and `createView`. It mounts the production `Paginator` and connects the provider to the app's source adapter. It does not replace the current model-mutating pagination implementation.

[`PaginatedRendererNode.svelte`](PaginatedRendererNode.svelte) adds resizable Svelte UI around existing paragraph content. **Grow renderer UI** and **Shrink renderer UI** change component state without a document transaction. Optional `sources.invalidateLayout(viewId)` calls `PageObserver.invalidate` in the app adapter. One lazy resize observer per editor view is shared across renderers. Inline renderers also observe a containing layout box. A shared child-list observer refreshes targets after mounting or reparenting. The first size delivery only records a baseline. Actual installed renderer-set changes and subsequent dimension changes request coalesced frame invalidation. Selection updates and ordinary source notifications do not each restart layout work.

[`word-processing-renderer-pagination.test.ts`](../../word-processing-renderer-pagination.test.ts) measures real page-content bounds. It checks settled pagination after renderer installation, UI growth/shrink, removal, editing, and undo. The [mark example](PaginatedRendererMark.svelte) changes font size without a transaction. Its tests verify reflow without forcing inline marks into block-like wrappers. The suite also checks text and caret preservation and that idle or selection-only activity does not continuously invalidate geometry. These browser tests, not the small-schema scenario or jsdom tests, exercise pagination geometry.

## Scope and related tests

The first Part 3C slice renders existing types only. It does not add nodes or marks, define schema lifecycle, preserve unknown custom content, or establish support for columns and other arbitrary layouts. Those need separate approval. External package loading and native restrictions also remain design gates. See the [implementation plan](../../../docs/plugins/implementation-plan.md#3c--custom-content-and-svelte-node-views).

Related unit/integration coverage lives in:

- `src/lib/testing/word-processing-renderers.svelte.test.ts`: registration, scope conflicts, ownership, callback guards, schema fallback, and layout integration.
- `src/lib/testing/word-processing-svelte-views.svelte.test.ts`: adapter props, stable editable hosts, reactive updates, boundary recovery, and teardown.
- `src/lib/editor/prosemirror/renderer-layout.svelte.test.ts`: shared observation, size baselines, coalescing, and cleanup.

These paths are relative to the repository root. See the [plugin source/test map](../../../docs/plugins/context.md#source-and-test-entry-points) for provider, behavior, host, and worker coverage. Browser tests do not verify packaged Tauri permissions or native isolation.
