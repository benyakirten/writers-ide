# Built-in formatting plugin

This directory owns the formatting toolbar feature: its local contracts, editor bridge, activation-scoped service, and horizontal/vertical presentations. It is a trusted bundled plugin, not a generic platform formatting API or an isolated external extension. See the [general plugin guide](../../../../../../packages-js/plugins/README.md) for contributions and lifecycle basics.

## Composition and ownership

[`menu.ts`](menu.ts) exports `createFormattingPlugin()` with no injection arguments. Its manifest declares a required dependency on `WORD_PROCESSING_PLUGIN_ID` and `wordProcessingApi` (major 1) from `@writers-ide/word-processing`. During each activation it resolves that API through `context.apis.get`, constructs a new feature-local `FormattingService(api)`, and wraps it in the existing activation scope. There is no formatting singleton, default service constructor, or special route-injected formatting dependency. The application must register the word-processing provider alongside the formatting plugin; the host activates required dependencies first.

The manifest's only contribution capability is `contributions.toolbar`. The feature contributes `basic-menu`, with a two-unit horizontal presentation and a one-unit vertical presentation. The workbench owns docking, capacity, placement, and rendering; the feature owns formatting controls and editor behavior.

The shared word-processing API is available to other declared consumers without enabling this toolbar. Formatting command names, summaries, availability, and policies stay in this feature rather than moving into the generic plugin host or word-processing provider. There is no `formatting.observe` or `formatting.execute` platform capability. Provider connections are trusted in-process integration and lifecycle contracts, not an external permission grant or sandbox.

## Local contracts and requests

[`contracts.ts`](contracts.ts) owns all `Formatting*` contracts. Import them locally, not from `@writers-ide/plugins`; the feature uses the package's generic `Dispose` type only for cleanup.

`FormattingService` offers `subscribe(listener)` and `execute(request)`. Subscription immediately delivers a copied `FormattingSnapshot`, or `null` when no supported editor is active, followed by updates as the editor or active view changes. Snapshots contain no manuscript text, document, selection object, or mutable editor reference:

- `viewId` identifies the editor view, not its document/tab ID.
- `revision` is an opaque, monotonic in-memory state token, not a saved document version.
- `marks` contains coverage ratios: `0` absent, `1` present throughout selected text, intermediate values mixed.
- `blocks` contains alignment coverage and normalized indentation indicators; `dedent` complements `indent` when paragraphs are available.
- `enabled` reports command availability so presentations do not need to reproduce editor rules.

Commands owned by this feature are `bold`, `italic`, `superscript`, `subscript`, `underline`, `overline`, `strikethrough`, `indent`, `dedent`, `align-left`, `align-center`, `align-right`, and `align-justify`. These are service requests, not generic host command contributions.

Send the snapshot's view and revision back with a command:

```ts
formatting.execute({
	viewId: snapshot.viewId,
	revision: snapshot.revision,
	command: 'bold',
});
```

Execution returns `false` for stale/incorrect tokens, an inactive or changed target, an unavailable command, or a revoked activation. **Do not retry a stale action against the next active editor.** Wait for a fresh snapshot and a new user action.

## Editor integration versus the generic host

[`formatting-service.svelte.ts`](formatting-service.svelte.ts) exports the `FormattingService` class, requiring a `WordProcessingApi` constructor argument. All live editor access goes through that API: `snapshot()` supplies active view/document identity and provider revision, `inspect()` synchronously derives summaries and availability, and `runCommand()` executes this feature's ProseMirror command with `{ requireActive: true, focus: true }`. Only copied metadata and formatting data are retained between callbacks, never live views, states, selections, or transactions.

The application provider adapter, not this feature, owns editor registry/event subscriptions and resolves active tab document IDs to registered view IDs. Tests inject `createWordProcessingService` with controlled `WordProcessingSources`; the application-source integration regression builds sources from `Editors`/`TabState` in test code only. `FormattingSources`, the `Formatting` singleton, and the default export have been removed. The presentation-facing `FormattingService`, `FormattingSnapshot`, and `FormattingRequest` contracts are unchanged.

The bridge checks the current active target and provider revision against the snapshot's captured target before requesting execution. The provider detects view replacement, document/state changes, and editability changes synchronously, even before a reactive flush, and revalidates before dispatch. It preserves existing semantics: caret mark toggles are disabled no-ops, superscript/subscript exclude each other, and paragraph operations account for pagination continuations. Successful commands restore editor focus. Availability queries are read-only and do not generate speculative transactions.

The first formatting subscription subscribes to the provider; the last unsubscribe releases that subscription, allowing the provider to release its source event/effect resources when unused. Formatting revisions are local tokens distinct from provider revisions and keep increasing across lazy stop/start, so old requests cannot be replayed after resubscription. Update-listener failures are reported without interrupting other subscribers or ProseMirror dispatch; failed initial delivery releases its subscription.

## Activation scope and presentations

[`scope-formatting-service.ts`](scope-formatting-service.ts) wraps the per-activation feature service using only the activation's `own` and `signal`. It owns subscription disposal, copies each snapshot's nested records and outgoing requests, suppresses callbacks after unsubscribe/revocation, and rejects new subscriptions after abort. Retained execution handles return `false` after deactivation and cannot revive when the plugin is enabled again.

If an immediate listener throws, the wrapper releases the returned source handle before propagating the error. A source that throws during subscription setup must undo its own partial registration; the wrapper cannot recover a handle it never received.

Both presentations receive typed props `{ formatting: FormattingService }`, paired with their components by `defineSveltePresentation(Component, props)`. They do not receive a plugin context, editor, or legacy workspace props. Each Svelte effect returns its subscription disposer so relocation/remount cleans up independently of plugin deactivation. A new mount subscribes to the current summary through the same activation-scoped dependency.

## Source and tests

- [`menu.ts`](menu.ts), [`BasicMenuHorizontal.svelte`](BasicMenuHorizontal.svelte), [`BasicMenuVertical.svelte`](BasicMenuVertical.svelte), and [`Snippets.svelte`](Snippets.svelte): composition, orientations, controls, and request routing.
- [`menu.test.ts`](menu.test.ts): required provider declaration/resolution, both real rendered presentations, and formatting interaction through unchanged local props/contracts.
- [`scope-formatting-service.test.ts`](scope-formatting-service.test.ts): copy isolation, subscription cleanup, failure handling, activation revocation, and real provider/fresh-service composition across reactivation.
- [`formatting-service.svelte.test.ts`](formatting-service.svelte.test.ts): snapshots, revision/live-state validation, tab/view identity, lazy cleanup, quiet availability queries, and editing semantics.
- [`generic-presentation.svelte.test.ts`](../../../../plugins/generic-presentation.svelte.test.ts): generic typed props without a formatting dependency; host tests remain under `src/lib/plugins`.
- [Docking browser tests](../../../../../../e2e/docking.test.ts) and [plugin-manager browser tests](../../../../../../e2e/plugin-manager.test.ts): workbench integration. Pagination geometry requires real-browser tests, not jsdom.
