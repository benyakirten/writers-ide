# Built-in formatting plugin

This directory owns the formatting toolbar feature: its local contracts, editor bridge, activation-scoped service, and horizontal/vertical presentations. It is a trusted bundled plugin, not a generic platform formatting API or an isolated external extension. See the [general plugin guide](../../../../../../packages-js/plugins/README.md) for contributions and lifecycle basics.

## Composition and ownership

[`menu.ts`](menu.ts) exports `createFormattingPlugin(formatting)`, an explicit factory accepting the local `FormattingService` contract. The [application route](../../../../../routes/+page.svelte) imports the `Formatting` singleton from this directory, calls `createFormattingPlugin(Formatting)`, then registers and activates the result. Only this plugin receives that dependency; it is not installed on every plugin context.

The manifest declares only `contributions.toolbar`. The feature contributes `basic-menu`, with a two-unit horizontal presentation and a one-unit vertical presentation. The workbench owns docking, capacity, placement, and rendering; the feature owns formatting controls and editor behavior.

There is no generic services registry and no `formatting.observe` or `formatting.execute` platform capability. Explicit injection here is trusted in-process composition, not an external permission grant or approval of a future sandbox API.

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

[`formatting-service.svelte.ts`](formatting-service.svelte.ts) implements the ProseMirror bridge and exports `Formatting`. Its default sources resolve active tab document IDs to registered view IDs and listen for editor changes; injectable `FormattingSources` support focused tests. This editor-specific integration belongs here, not in `src/lib/plugins` or the reusable plugin package.

The bridge checks live view identity, editor state, editability, revision, and availability before dispatch, including changes before a reactive flush. It preserves existing semantics: caret mark toggles are disabled no-ops, superscript/subscript exclude each other, and paragraph operations account for pagination continuations. Successful commands restore editor focus. Availability queries are read-only and do not generate speculative transactions.

The first subscription starts the shared event/effect bridge; the last unsubscribe releases it. Revisions keep increasing across stop/start. Update-listener failures are reported without interrupting other subscribers or ProseMirror dispatch; failed initial delivery releases its subscription.

## Activation scope and presentations

[`scope-formatting-service.ts`](scope-formatting-service.ts) wraps the injected dependency using only the activation's `own` and `signal`. It owns subscription disposal, copies each snapshot's nested records and outgoing requests, suppresses callbacks after unsubscribe/revocation, and rejects new subscriptions after abort. Retained execution handles return `false` after deactivation and cannot revive when the plugin is enabled again.

If an immediate listener throws, the wrapper releases the returned source handle before propagating the error. A source that throws during subscription setup must undo its own partial registration; the wrapper cannot recover a handle it never received.

Both presentations receive typed props `{ formatting: FormattingService }`, paired with their components by `defineSveltePresentation(Component, props)`. They do not receive a plugin context, editor, or legacy workspace props. Each Svelte effect returns its subscription disposer so relocation/remount cleans up independently of plugin deactivation. A new mount subscribes to the current summary through the same activation-scoped dependency.

## Source and tests

- [`menu.ts`](menu.ts), [`BasicMenuHorizontal.svelte`](BasicMenuHorizontal.svelte), [`BasicMenuVertical.svelte`](BasicMenuVertical.svelte), and [`Snippets.svelte`](Snippets.svelte): composition, orientations, controls, and request routing.
- [`menu.test.ts`](menu.test.ts): both presentations and formatting interaction through local contracts.
- [`scope-formatting-service.test.ts`](scope-formatting-service.test.ts): copy isolation, subscription cleanup, failure handling, and activation revocation.
- [`formatting-service.svelte.test.ts`](formatting-service.svelte.test.ts): snapshots, revision/live-state validation, tab/view identity, lazy cleanup, quiet availability queries, and editing semantics.
- [`generic-presentation.svelte.test.ts`](../../../../plugins/generic-presentation.svelte.test.ts): generic typed props without a formatting dependency; host tests remain under `src/lib/plugins`.
- [Docking browser tests](../../../../../../e2e/docking.test.ts) and [plugin-manager browser tests](../../../../../../e2e/plugin-manager.test.ts): workbench integration. Pagination geometry requires real-browser tests, not jsdom.
