# Opt-in behavior proof consumers (Part 3B)

These are three independent `SveltePlugin` definitions. Register the desired
factory with the generic plugin host, then activate its exported plugin ID.
Each declares an exact-major required dependency on `wordProcessingApi` from
`WORD_PROCESSING_PLUGIN_ID`. None contributes UI, changes schemas, installs
node/mark views, imports Basic Menu, or accesses private editor registries.
They are mounted only by the dedicated word-processing browser fixture's
**Mount behavior proofs** control, not the application route. Existing fixture
scenarios leave them disabled.

| Factory                              | Plugin ID                       | Public editor command ID         |
| ------------------------------------ | ------------------------------- | -------------------------------- |
| `createSmartPunctuationPlugin()`     | `SMART_PUNCTUATION_PLUGIN_ID`   | `UNDO_INPUT_RULE_COMMAND_ID`     |
| `createSelectionHighlightPlugin()`   | `SELECTION_HIGHLIGHT_PLUGIN_ID` | `HIGHLIGHT_SELECTION_COMMAND_ID` |
| `createWordAnalysisPlugin(options?)` | `WORD_ANALYSIS_PLUGIN_ID`       | `ANALYZE_SELECTION_COMMAND_ID`   |

All IDs are exported qualified strings. A consumer with the same declared
provider dependency can call `api.executeCommand(target, commandId, options)`;
`api.commands()` exposes owner/name metadata. No host command contribution is
required. UI/shortcut hosts may add their own command contribution separately.
Connections own behavior and editor-command cleanup automatically.

## Upstream input rules

`createSmartPunctuationPlugin` registers the real
`inputRules({ rules: [ellipsis, emDash] })` plugin per view. Its command wraps
upstream `undoInputRule`, which locates the original unkeyed upstream plugin
and reads its state. The browser proof types actual characters and undoes the
rule, exercising wrapper key/state/metadata identity, including in a view
created after registration. This is not general upstream schema compatibility.

## View-local selected-range decorations

`selectionHighlightKey` is a `PluginKey<DecorationSet>`. The highlight command
sets metadata for the current nonempty selection; no document step is created.
Subsequent transactions map the existing set through `transaction.mapping`.
There is no full-text traversal, added mark, or manuscript mutation. Removing
the behavior removes its state and decorations, not authored text/history.
The exported `rangeDecorations` helper is also used by word analysis.
Consumers provide their own CSS for `.selection-highlight` and `.repeated-word`.

## Bounded worker analysis

Analysis runs **only on explicit command invocation**, not every keystroke.
It copies the first at most 32,768 model positions of the current selection
and at most 1,024 text-node chunks. Thus copied text is at most 32,768 UTF-16
code units (64 KiB of UTF-16 payload, excluding structured-clone overhead).
The limit may cut a final word; this intentionally small proof is not a
complete linguistic analysis or whole-manuscript search.

Each chunk carries its own model `from` position. The bundled module worker
uses `@writers-ide/tasks/worker`, counts case-insensitive Unicode-letter tokens,
and returns only `{ from, to }` ranges for repeated tokens. Offsets are UTF-16,
including astral characters. **Tokens never match across text nodes**, even
adjacent nodes split by marks, or across paragraph/chunk boundaries. Repeated
complete tokens in different chunks do count together. No `textBetween`
flattening is used: structural separators and mark boundaries cannot corrupt
model offsets. No ProseMirror state/view/transaction crosses the worker boundary.

The per-view behavior factory's signal is passed to `context.tasks.worker`;
activation ownership also cancels tasks on unload. Worker results apply through
`api.applyResult(capturedTarget, ranges, ...)`, constructing only a fresh metadata
transaction synchronously. Part 3A's exact revision contract is unchanged:
selection changes, model-mutating pagination, reconfiguration and document edits
stale results, with no mapping/retargeting of asynchronous output. Already
installed decorations still map normally on subsequent edits.

By default results apply immediately. Optional `deliver(apply)` allows a
preview/confirmation UI to hold a data-only result; it must eventually call or
discard the callback. `onStatus` observes running/application/stale/cancellation
outcomes. The callback checks view/activation lifetime before touching a revoked
facade. The fixture uses this explicit delivery gate, never timers, to test
stale, disabled and closed-view results deterministically.

## Browser proof boundary

`e2e/fixtures/word-processing/BehaviorFixture.svelte` shares the parent's actual
generic host, provider and view sources. Its helper consumers use public API
callbacks for inspection, editing, priorities and deliberate failure injection.
The structural-layout control is a non-history paragraph split, **not** a claim
to exercise real app pagination geometry; that regression suite remains separate.
`e2e/word-processing-behaviors.test.ts` contains six scenarios for Chromium and
WebKit, with no timing thresholds or global editor escape hatches.
