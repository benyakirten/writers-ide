# Opt-in behavior proof consumers (Part 3B)

This directory contains three small feature plugins. They show how to add smart
punctuation, selection highlighting, and worker-based word analysis through the
public word-processing API. Use them as examples of registering editor behavior
and tying it to a plugin's lifetime.

A provider API is a contract exposed by an active plugin for other declared
consumers to use. Each factory here creates an independent `SveltePlugin` that
consumes the word-processing provider.

Register the factory with the generic plugin host, then activate its exported
plugin ID. Each plugin declares a required dependency on `wordProcessingApi`
from `WORD_PROCESSING_PLUGIN_ID`. The dependency requires an exact API major
version. The host activates that provider before the consumer. See the [editor API guide](../../../../../packages-js/word-processing/README.md)
for its callback and target contracts.

These feature plugins use ProseMirror plugins to implement editor behavior. The
ProseMirror plugins and their upstream packages are implementation libraries;
they are not separate application-plugin activations.

| Factory                              | Plugin ID                       | Public editor command ID         |
| ------------------------------------ | ------------------------------- | -------------------------------- |
| `createSmartPunctuationPlugin()`     | `SMART_PUNCTUATION_PLUGIN_ID`   | `UNDO_INPUT_RULE_COMMAND_ID`     |
| `createSelectionHighlightPlugin()`   | `SELECTION_HIGHLIGHT_PLUGIN_ID` | `HIGHLIGHT_SELECTION_COMMAND_ID` |
| `createWordAnalysisPlugin(options?)` | `WORD_ANALYSIS_PLUGIN_ID`       | `ANALYZE_SELECTION_COMMAND_ID`   |

All IDs are exported strings that include a namespace to distinguish their owner. A consumer with the same declared
provider dependency can call `api.executeCommand(target, commandId, options)`.
`api.commands()` exposes command owner and name metadata. These are editor
commands, so no generic host command contribution is required. A UI or shortcut
host may add its own command contribution separately.

The provider connections automatically clean up their registered behaviors and
editor commands. None of these plugins contributes UI, changes schemas, installs
node/mark views, imports Basic Menu, or accesses private editor registries.

To try them, use **Mount behavior proofs** in the dedicated word-processing
browser fixture. The application route does not mount them. Existing fixture
scenarios leave them disabled.

## Upstream input rules

[`createSmartPunctuationPlugin`](smart-punctuation.ts) installs the real upstream
`inputRules({ rules: [ellipsis, emDash] })` plugin separately for each view. Typing
the matching characters invokes those rules. Its command wraps upstream
`undoInputRule` to undo the latest input-rule change.

`undoInputRule` locates the original upstream plugin and reads its state. That
plugin has no explicit `PluginKey`, but ProseMirror still gives it a generated
key. The behavior wrapper must preserve that key, state access, and metadata
identity. Otherwise, upstream undo could no longer find the rule's state.

The browser test types actual characters and undoes the rule. It also checks a
view created after registration. This demonstrates this package integration,
not general compatibility with every upstream package or schema.

## View-local selected-range decorations

Decorations change how an editor view displays content without changing the
document. [`selectionHighlightKey`](selection-highlight.ts) is a
`PluginKey<DecorationSet>` that identifies this behavior's decoration state.
The highlight command adds transaction metadata for the current nonempty
selection. This metadata is extra information for the plugin, not a document
edit step. It changes only the view-local decorations.

Later transactions adjust the existing decoration positions through
`transaction.mapping`, which records how edits move document positions.
The behavior does not traverse all text, add an authored mark, or change the
manuscript. Removing it removes its state and decorations, not authored text or
history.

The exported `rangeDecorations` helper is also used by word analysis. Consumers
supply their own CSS for `.selection-highlight` and `.repeated-word`.

## Bounded worker analysis

[`createWordAnalysisPlugin`](word-analysis.ts) analyzes the selection only when
its command is explicitly invoked. It does not run on every keystroke. It copies
a bounded amount of selected text, sends that data to a bundled module worker,
and applies repeated-word ranges as decorations.

### Capture limits

The command copies at most the first 32,768 model positions of the selection.
It also stops at 1,024 text-node chunks. Model positions include document
structure, so this is not a promise to capture 32,768 visible characters.

JavaScript represents text using UTF-16 code units. Some characters occupy two
units. Copied text is at most 32,768 units, or 64 KiB of UTF-16 text data.
Worker messaging copies that data using structured cloning. The 64 KiB limit
does not include the extra memory needed for that copy operation.

The limit may cut a final word.
This deliberately small example is not a complete linguistic analysis or a
whole-manuscript search.

### Tokens and model offsets

A token here is a run of Unicode letters. The analysis ignores case when
counting repeated tokens.

Each chunk carries its own model `from` position. The
[worker](word-analysis.worker.ts) uses `@writers-ide/tasks/worker` to count those
tokens. It returns only `{ from, to }` ranges for repeated tokens. Offsets count
UTF-16 code units, not visible characters. This includes astral characters,
which occupy two code units.

Tokens never match across text nodes or chunk boundaries. This includes adjacent
text nodes split by marks and text in different paragraphs. For example, `hel`
and `lo` in separate nodes do not become the token `hello`. Complete repeated
tokens in different chunks do count together.

The capture does not flatten text with `textBetween`. Keeping each chunk's model
position prevents structural separators and mark boundaries from corrupting
returned offsets. Only copied data crosses the worker boundary. No live
ProseMirror state, view, or transaction is sent.

### Cancellation and stale results

The per-view behavior factory passes its signal to `context.tasks.worker`.
Ending that instance's lifetime cancels its work. Activation ownership also
cancels tasks when the plugin unloads.

Results apply through `api.applyResult(capturedTarget, ranges, ...)`. Its callback
synchronously constructs a fresh metadata transaction. It does not retain a
transaction while the worker runs.

The captured target includes an exact revision token identifying the editor
state used for the analysis. The exact-revision contract from Part 3A still
applies: a result is stale if that state has changed.

Selection changes and document edits make results stale. So do pagination that
changes the document model and reconfiguration of the editor's plugins. Stale
asynchronous output is discarded. Its positions are never adjusted through
later edits, and it is never applied to a different target. Decorations already
installed in a valid state still map normally through later edits.

### Optional delivery control

By default, results apply immediately. The optional `deliver(apply)` callback
lets a preview or confirmation UI hold a data-only result. That UI must
eventually call or discard the supplied callback. `onStatus` observes running,
application, stale, and cancellation outcomes.

The supplied application callback checks whether the view and plugin activation
are still live before calling the provider API. This avoids calling a revoked
API, whose methods are no longer usable after its connection ends.

The fixture holds and releases that callback explicitly. This lets it test
stale, disabled-plugin, and closed-view results without relying on timers to
arrange those cases.

## Browser proof boundary

[`BehaviorFixture.svelte`](../../../../../e2e/fixtures/word-processing/BehaviorFixture.svelte)
shares the parent's actual generic host, provider, and view sources. Helper
consumers use public API callbacks to inspect and edit state, test priorities,
and deliberately inject failures.

Its structural-layout control splits a paragraph without adding an undo-history
entry. That does not test real application pagination geometry. The pagination
regression suite tests that separately.

[`word-processing-behaviors.test.ts`](../../../../../e2e/word-processing-behaviors.test.ts)
contains six scenarios for Chromium and WebKit. They use no timing thresholds or
global editor escape hatches.
