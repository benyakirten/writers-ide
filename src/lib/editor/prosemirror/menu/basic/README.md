# Built-in formatting plugin

This directory implements the formatting toolbar feature. It supplies commands
such as bold and paragraph alignment, observes the active editor, and renders
horizontal or vertical controls. To use it, register `createFormattingPlugin()`
and the word-processing provider with the application plugin host. Activate the
formatting plugin; the host activates its required provider first.

This is a trusted bundled feature plugin. It is not a generic platform
formatting API or an isolated external extension. Reusable libraries supply
hosting, controls, and layout mechanics. This feature owns formatting behavior.
See the [general plugin guide](../../../../../../packages-js/plugins/README.md)
for contribution and lifecycle basics.

**Approved future work:** by the end of Part 4, Basic Menu must become a separate plugin package. It must use the same supported loading mechanism and public APIs as third-party plugins. Packaging is not implemented yet. See the [Part 4 deliverable](../../../../../../docs/plugins/implementation-plan.md#required-outcome-separately-packaged-basic-menu) for requirements and open design decisions.

## Approved separate-package boundary

**Implemented foundation:** `FormattingService` imports read-only grouping from the public `@writers-ide/word-processing/structure` entry. It exports `groupSelectedBlocks`, `identifyBlockGroup`, `BlockReference` and `SelectedBlockGroup`. See the [exact API and usage rules](../../../../../../packages-js/word-processing/README.md#read-only-document-structure-helpers). These understand the current page/block and paragraph-continuation model without accessing the pagination singleton, measuring DOM or dispatching transactions.

[`formatting-actions.ts`](formatting-actions.ts), [`selection-coverage.ts`](selection-coverage.ts) and [`formatting-policy.ts`](formatting-policy.ts) now own the feature's editing helpers, coverage and policy. The service no longer imports private app actions, selection helpers, PageLayout, constants or clamp. Legacy application `ActionUtilities` and `SelectionUtilities` delegate to this feature-owned code as interim source-compatibility wrappers. `splitParagraph` remains app-owned.

Basic Menu keeps mark coverage, mark toggles, indentation/alignment rules, availability calculations and summaries. The broader application action class and paginator do not become feature dependencies. For separate packaging, the menu must own translations and read the public locale service. It must bundle icons and small feature-local utilities, or use already-supported shared components. This migration has not happened: UI translations, icons and a string utility still use private app imports. The bundled host does not supply the public locale service.

The packaged feature must use the declared word-processing dependency and external activation API, with no private `$lib` imports or separate privileged app-registered copy. Structural extraction and packaging must preserve current caret, continuation, stale-target, focus, orientation-cost and undo behavior. The source below still describes today's bundled implementation.

## Composition and ownership

### Provider dependency

A provider API is a contract that one active plugin exposes to declared
consumers. This feature consumes the word-processing provider.

[`menu.ts`](menu.ts) exports `createFormattingPlugin()`. Its manifest declares
its identity, contributions, and
dependencies. It declares a required dependency on `WORD_PROCESSING_PLUGIN_ID`
and `wordProcessingApi` (major 1) from `@writers-ide/word-processing`.

Each activation lasts from plugin startup until it stops. During that lifetime,
this feature resolves the API through `context.apis.get`. It constructs a new
feature-local `FormattingService(api)`. The activation wrapper described below
connects that service to activation cleanup.

The application registers the provider alongside the formatting plugin. Each
activation owns its formatting service and provider connection.

### Feature and workbench responsibilities

The manifest's only contribution capability is `contributions.toolbar`. It
contributes `basic-menu` with a two-unit horizontal presentation and a one-unit
vertical presentation. The workbench owns docking, capacity, placement, and
rendering. The feature owns the formatting controls and editor behavior.

Other declared consumers can use the word-processing API without enabling this
toolbar. Formatting command names, summaries, availability, and policies remain
in this feature. They do not belong to the generic plugin host or the
word-processing provider.

Provider connections manage trusted in-process integration and lifetime. They
are not external permission grants or a sandbox.

## Local contracts and requests

[`contracts.ts`](contracts.ts) owns all `Formatting*` contracts. Import them
locally. The feature uses the generic `Dispose` type from `@writers-ide/plugins`
for cleanup.

### Read a snapshot

`FormattingService` offers `subscribe(listener)` and `execute(request)`.
Subscription immediately delivers a copied `FormattingSnapshot`. It delivers
`null` if no supported editor is active. Later updates follow editor and
active-view changes.

Snapshots contain no manuscript text, document, selection object, or mutable
editor reference. Their fields describe the target and formatting summary:

- `viewId` identifies the editor view, not a document or tab ID.
- `revision` identifies an in-memory state. Treat it as an opaque token: send it
  back unchanged rather than interpreting its value. Tokens keep increasing.
  They are not saved document versions.
- `marks` contains coverage ratios. `0` means absent; `1` means present throughout
  selected text. Intermediate values mean mixed coverage.
- `blocks` contains alignment coverage and normalized indentation indicators.
  When paragraphs are available, `dedent` complements `indent`.
- `enabled` reports command availability. Presentations need not reproduce
  editor rules.

### Send a request

This feature owns `bold`, `italic`, `superscript`, `subscript`, `underline`,
`overline`, `strikethrough`, `indent`, `dedent`, `align-left`, `align-center`,
`align-right`, and `align-justify`. These are service requests, not generic host
command contributions.

In a presentation's user-action handler, use its injected `formatting` service
and latest non-null `snapshot`. Send the snapshot's view and revision back with
the command:

```ts
formatting.execute({
	viewId: snapshot.viewId,
	revision: snapshot.revision,
	command: 'bold',
});
```

Execution returns `false` if the tokens are incorrect or stale, meaning they no
longer match the current target state. It also returns `false` if the target is
inactive or changed, the command is unavailable, or the activation has ended
and its service has been revoked.
Do not retry a stale action against the next active editor. Wait for a fresh
snapshot and a new user action.

## Editor integration versus the generic host

### Synchronous editor access

[`formatting-service.svelte.ts`](formatting-service.svelte.ts) exports
`FormattingService`. Its constructor requires a `WordProcessingApi` argument.
All live editor access goes through that API:

- `snapshot()` supplies active view/document identity and provider revision.
- `inspect()` synchronously derives summaries and command availability.
- `runCommand()` executes this feature's ProseMirror command with
  `{ requireActive: true, focus: true }`.

Between callbacks, the service retains only copied metadata and formatting
data. It never retains live views, states, selections, or transactions.

The application provider adapter owns editor registry and event subscriptions.
It resolves active-tab document IDs to registered view IDs. This feature does
not perform that application-specific work.

### Validation and editing policy

Before requesting execution, the formatting service checks the current active
target and provider revision against the snapshot's captured target. The
provider detects view replacement, document/state changes, and editability
changes synchronously. It does not wait for Svelte's pending reactive updates
to run. It checks again before dispatching the command's transaction.

Existing editing policies remain in effect. With only a caret and no selected
text, mark toggles are disabled and make no changes. Superscript and subscript
exclude each other. Paragraph operations account for paragraph continuations
created by pagination. Successful commands restore editor focus.

Availability queries are read-only. They do not create trial transactions to
determine whether a command can run.

### Subscriptions and revision lifetime

The first formatting subscription subscribes to the provider. The last
unsubscribe releases that subscription. This lets the provider release its
source event/effect resources when unused.

Formatting revisions are local tokens, distinct from provider revisions. They
keep increasing even when observation stops because there are no subscribers
and later starts again. An old request therefore cannot be replayed after
resubscription.

Update-listener failures are reported without interrupting other subscribers
or ProseMirror dispatch. If initial delivery fails, its subscription is released.

### Test integration and removed interfaces

Tests inject `createWordProcessingService` with controlled
`WordProcessingSources`. The application-source integration regression builds
sources from `Editors`/`TabState` in test code only.

Presentation tests use the feature-local `FormattingService`,
`FormattingSnapshot`, and `FormattingRequest` contracts.

## Activation scope and presentations

### Activation cleanup

[`scope-formatting-service.ts`](scope-formatting-service.ts) wraps each
activation's feature service. It uses only the activation's `own`, which
registers cleanup, and `signal`, which reports cancellation.

The wrapper takes responsibility for releasing subscriptions. It copies each
snapshot's nested records and each outgoing request.

After unsubscribe, callbacks stop. They also stop when the activation ends and
the wrapper is revoked. New subscriptions are rejected after the activation's
signal is aborted.

Retained execution handles return `false` after deactivation. They cannot become
live again when the plugin is re-enabled.

The source returns a cleanup handle when a subscription is established. If the
listener throws during its immediate first delivery, the wrapper releases that
handle before letting the error reach its caller.

If the source itself throws during subscription setup, it must undo any partial
registration. The wrapper cannot recover a cleanup handle it never received.

### Presentation mounts

Both presentations receive typed props `{ formatting: FormattingService }`.
`defineSveltePresentation(Component, props)` pairs those props with their
component. The service supplies copied summaries and validated formatting
requests to each presentation.

Each Svelte effect returns a subscription disposer, the function that releases
its subscription. Svelte calls it when the effect is cleaned up. Relocation or
remounting therefore cleans up that mount independently of plugin deactivation. A new mount
subscribes to the current summary through the same activation-scoped service.
Feature lifetime does not depend on a particular toolbar component surviving a
move.

## Source and tests

- [`menu.ts`](menu.ts) composes the plugin. [`BasicMenuHorizontal.svelte`](BasicMenuHorizontal.svelte),
  [`BasicMenuVertical.svelte`](BasicMenuVertical.svelte), and
  [`Snippets.svelte`](Snippets.svelte) implement orientations, controls, and request routing.
- [`menu.test.ts`](menu.test.ts) checks required-provider declaration and
  resolution, both real rendered presentations, and formatting interaction
  through feature-local props and contracts.
- [`scope-formatting-service.test.ts`](scope-formatting-service.test.ts) checks
  copy isolation, subscription cleanup, failure handling, activation revocation,
  and real provider/fresh-service composition across reactivation.
- [`formatting-service.svelte.test.ts`](formatting-service.svelte.test.ts) checks
  snapshots, revision/live-state validation, tab/view identity, lazy cleanup,
  quiet availability queries, and editing semantics.
- [`generic-presentation.svelte.test.ts`](../../../../plugins/generic-presentation.svelte.test.ts)
  checks generic typed props without a formatting dependency. Host tests remain
  under `src/lib/plugins`.
- [Docking browser tests](../../../../../../e2e/docking.test.ts) and
  [plugin-manager browser tests](../../../../../../e2e/plugin-manager.test.ts)
  check workbench integration. Pagination geometry requires real-browser tests,
  not jsdom.
