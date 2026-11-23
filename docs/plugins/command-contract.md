# Shared application commands

**Status: source contracts/helpers and internal manifest checks implemented; invocation runtime not implemented.** This page records the external-package command design. Today's `CommandContribution` takes no arguments and returns a synchronous boolean. There is no current plugin-facing command-invocation service or user-facing command routing.

An application command is a named action owned by a component. Another component can invoke it through a declared dependency. It is not a ProseMirror command or a live provider service. Registration does not create a button, shortcut or command-picker entry. See the [package specification](package-api-proposal.md) for component lifetimes and package installation.

## Choose an editor command or an application command

Writer's IDE has two command APIs. They serve different purposes. Synchronous editor commands are implemented today. The typed shared application command contracts and definition/error helpers are exported. The internal Rust parser validates command declarations and the static resolver matches every requested command ID, contract ID and major. These checks do not verify runtime publication or implement invocation. See the [internal manifest guide](manifest-resolution.md).

| Need                                                                                 | Use                                                                     | Why                                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Perform a short edit against the current ProseMirror state                           | An editor command through the word-processing provider                  | It receives editor state and can build one transaction synchronously.                                    |
| Call a ProseMirror command already held by your plugin                               | `editor.runCommand(target, command)`                                    | No named registration is needed.                                                                         |
| Make a synchronous editing action available by ID through the editor provider        | `editor.registerCommand(...)`, then `editor.executeCommand(target, id)` | The provider owns the registration and validates the target at execution.                                |
| Expose a feature action with typed arguments and a typed result to another component | A shared application command                                            | The manifest declares the integration and the host validates the invocation contract.                    |
| Run an asynchronous workflow or coordinate worker/native work                        | A shared application command using managed tasks and approved services  | The caller can await its result and cancel the invocation. Native permissions still apply independently. |
| Offer ongoing service methods and subscriptions                                      | A provider API                                                          | A live service connection is a better fit than a single command invocation.                              |

### Use an editor command for a synchronous editing operation

Examples include inserting a date, toggling a mark or changing paragraph attributes. The author implements a ProseMirror command with the signature `(state, dispatch, view) => boolean`. The word-processing provider invokes it against a validated editor target. The callback must return synchronously and may dispatch at most one transaction through this API. Its boolean says whether it handled the action; it is not an arbitrary feature result.

For a button that already holds its editing implementation, call `runCommand()` directly. Register the command only when it needs a reusable editor-registry ID. Not every button needs a named command. Registration does not add a shortcut, button or palette entry. See the [editor command examples and dispatch rules](../../packages-js/word-processing/README.md#commands-and-ownership).

`EditorCommandRegistration` describes the registration. `EditorCommandSnapshot` describes copied command metadata returned by `editor.commands()`. Editor command IDs currently belong to the word-processing service's registry. They are not shared application command references and are not resolved through the application command manifest declarations.

### Use an application command for a shared feature action

Examples include counting words and returning the count, analyzing a chapter in a worker, or running a feature workflow that eventually edits the document. An application command has a shared, versioned argument/result contract. Consumers declare the provider component and requested command in their manifest. They invoke it through the host's application command API, not `editor.executeCommand()`.

Application commands may complete immediately or asynchronously; callers await the invocation either way. They need not edit a document or use ProseMirror. Arguments and results are copied data, not live editor, DOM or service objects. Their implementation can use provider APIs to obtain live services when needed. This guide's remaining sections explain definition, publication and invocation.

### The two APIs can work together

A shared analysis command can run a managed worker, check that its captured editor target is still valid, then perform a short synchronous edit through the word-processing provider. It can use `edit()`, `runCommand()` or an existing registered editor command for that final operation. It does not need to register a new editor command just because it edits text.

Do not keep an unfinished transaction, live editor callback context or dispatch callback across `await` or a cooperative yield. If the target is stale, discard or deliberately recompute the result. Do not apply old document positions to a newly acquired state without validating or mapping them under a separately supported policy. Awaiting an application command does not make ProseMirror command callbacks asynchronous.

The two APIs have separate lifetimes and error contracts. Editor operations return `EditorResult`; a successful editor-command operation contains its handled boolean. Shared application command invocations return promises with their declared results and reject on failure or cancellation. Cancelling a workflow does not undo edits already dispatched.

## Define the shared contract

The provider and consumer import this contract from a small shared library. The library defines types and validation, not the action's implementation. Importing it does not activate the provider.

```ts
import { definePluginCommand } from '@writers-ide/plugins';
import { z } from 'zod';

export const countWords = definePluginCommand({
	id: 'example.count-words',
	major: 1,
	args: z.object({
		text: z.string().max(32_768),
	}),
	result: z.number().int().nonnegative(),
});
```

`definePluginCommand` is now exported from the workspace SDK. It validates a non-whitespace-only contract ID of at most 256 UTF-8 bytes and a positive safe-integer major, then freezes the descriptor. It does not register an implementation, execute commands or validate payloads. It infers argument-schema input/output and result-schema input/output separately from Standard Schema-compatible validators. `PluginCommand` and `CommandRegistration` preserve all four roles. Consumer invocation takes argument input and resolves result output; the implementation receives argument output and returns result input. Standard Schema is an interoperability format for validation libraries. Zod is one author choice, not a mandatory host dependency. Other compatible validators can be used. No validation package is added by this design document.

The example accepts an object containing a bounded string and returns a nonnegative integer. Argument-free commands remain supported. Commands producing no value declare a `void` result. The current helper requires explicit `args` and `result` schemas, including schemas for `undefined` or `void` when appropriate.

## Declaration-count limits

**Approved limits; internal parser checks implemented:** a component may declare at most 32 shared commands in its `commands` list. A consumer may request at most 32 commands in each dependency's `commands` list. Exceeding either limit rejects the whole manifest before plugin code is imported. These are host-owned engineering starting points that a plugin cannot raise. The 64 KiB whole-manifest limit also applies.

Internal event handlers and individual methods on a provider API do not count toward these command limits. A toolbar does not need to expose each button handler as a shared application command. Choose shared commands for named actions that other components should invoke. Use provider APIs for service contracts, not merely to avoid a command-count limit.

## Declare and implement the provider

This TOML fragment belongs under the provider's component record in `manifest.toml`:

```toml
[[components.commands]]
id = "count-words"
contract = "example.count-words"
major = 1
```

Here, `count-words` is local to the component. The contract identity and major describe the operation's public inputs/results. Different components can reuse the same local command ID.

**Approved identifier rules; manifest and contract helper checks implemented, host runtime checks pending:** command IDs, contract IDs and consumer command aliases must each be nonempty strings that are not whitespace-only, with at most 256 UTF-8 bytes. This is a byte limit, not JavaScript string length. All three allow flexible characters and match exactly, including case. The manifest parser rejects invalid values rather than trimming, normalizing or truncating them. Corresponding host runtime registration and lookup checks remain outstanding. These rules apply to manifest fields and their corresponding runtime definitions, registrations and lookups. They do not make command IDs globally unique. Consumer command aliases are scoped to a dependency, as explained below.

The provider's entry module exports the following function. The host calls it synchronously when enabling the component. Its component must declare the `contributions.command` capability.

```ts
import { countWords } from './contracts.js';

export function activate(context) {
	context.contributions.command({
		id: 'count-words',
		name: 'Count words',
		contract: countWords,
		execute({ text }, { signal }) {
			signal.throwIfAborted();
			return (text.match(/\S+/gu) ?? []).length;
		},
	});
}
```

This registers the implementation; it does not run it. The example uses short synchronous work over bounded input. A heavier action can return a promise and use the existing cooperative, async or worker task helpers. Activation and ProseMirror edit callbacks remain synchronous.

### Publication checks during activation

**Approved checks; not implemented:** every command declared by a provider component must be registered exactly once before its synchronous activation finishes. Reject undeclared registrations, duplicates, mismatched contract identities/majors and missing promised registrations. These errors fail provider activation rather than waiting for a consumer invocation. Exact identity/major matching does not prove schema compatibility; authors still need contract tests.

Required consumers activate only when their required commands are available. Optional consumers may remain active without them. These checks do not run command implementations or make activation asynchronous.

## Declare and invoke the consumer dependency

This fragment belongs under the consuming component in a different package. The provider package/component names are examples:

```toml
[[components.dependencies]]
alias = "analysis"
package = "@example/text-analysis"
component = "commands"

[[components.dependencies.commands]]
alias = "word-count"
id = "count-words"
contract = "example.count-words"
major = 1
```

`analysis` names the component dependency. `word-count` names the command within that dependency. Command aliases are unique within their dependency. This two-level lookup avoids requiring a global command alias namespace. Required and optional dependencies follow the approved activation/consent policy; optional dependencies do not enable providers automatically.

Inside the consumer's UI handler, invoke it like this:

```ts
const total = await context.commands.execute(
	'analysis',
	'word-count',
	countWords,
	{ text },
	{ signal },
);
```

The consumer imports `countWords` from the shared contract library. Its activation supplies `context` to its own UI or handler. The feature supplies `text` from its input and an optional caller cancellation signal. `total` is inferred as `number`. No UI is generated by declaring or invoking the command.

The host resolves the declared package/component/command for the appropriate project/window activation. It checks the contract ID and exact major, validates arguments, invokes the implementation, awaits completion, then validates the result before delivery. Data is copied at the invocation boundary. Do not select a command by an unqualified name or registration order.

## Check command availability

**Approved consumer methods; not implemented:** `context.commands.isAvailable(dependencyAlias, commandAlias, contract)` returns a boolean. `context.commands.subscribeAvailability(dependencyAlias, commandAlias, contract, listener)` returns `Dispose`. Project-bound command access uses the same methods on `connection.commands`.

Both methods resolve only declared dependency/command aliases and check the supplied contract identity/major. Invalid aliases or mismatched contract references are author errors, not an unavailable result. Availability means the declared command can currently be invoked, not that it will succeed, pass argument validation or have spare concurrency capacity.

Subscriptions deliver immediately and when availability changes. They belong to the consumer activation or project-connection lifetime. The returned disposer supports early unsubscribe. Checking availability never enables or installs a provider. An availability check does not reserve the command; it can disappear before execution, so callers still handle invocation errors.

For example, the following code belongs inside a consumer's synchronous `activate(context)`. The host calls that function when enabling the component. The consumer imports `countWords` from its shared contract library and creates reactive `ui` state for its own presentation before subscribing:

```ts
context.commands.subscribeAvailability('analysis', 'word-count', countWords, (available) => {
	ui.canCountWords = available;
});
```

The aliases refer to the consumer manifest shown above. The boolean lets its own UI enable or disable a control. Failure details come from invocation errors and plugin management, not a global command-registry listing.

Tests must cover initial delivery, availability transitions, activation/connection cleanup, early unsubscribe, invalid references, contract mismatches and disappearance between a check and execution. Publication tests must cover missing, undeclared, duplicate and mismatched registrations, required-consumer blocking and optional-consumer operation without a provider.

## Values, compatibility and lifetime

- Arguments and results are data-only and copied. Use the explicit supported-value list below, not every value the runtime can clone. Resource budgets still need specification. Use provider APIs for ongoing behavioral connections.
- Failures reject the promise. The result is not a universal handled/success boolean; a boolean can still be an explicitly declared result. Invocation settles when the action finishes, not merely when it starts a background task.
- Contract majors match exactly, independently of package-version ranges. Breaking argument/result changes require a new major. A provider can offer separate command registrations for older contracts. Validators and compatibility tests must enforce the documented promises; matching numbers alone do not prove compatible schemas.
- Each invocation receives a signal tied to caller cancellation, caller/provider teardown, command removal and its project connection. Cancellation rejects the pending invocation, suppresses late success and observes late failures. It does not stop unrelated provider work or revoke the provider credential.
- Cancellation is cooperative. Authors must propagate the signal and check before effects. It cannot interrupt arbitrary synchronous code or undo completed edits/native effects. A promise does not offload CPU work. Native operations still use the provider's own checked authority.

## Supported command values

**Approved initial value list; not implemented:** allow only these values in command arguments and results:

- `null`, `undefined`, strings, booleans, numbers and `bigint`.
- Arrays and plain records.
- `Date`, `Map` and `Set`.
- `ArrayBuffer`, typed arrays and `DataView`.

Validate nested contents under the declared shared schema. Apply the copying, reference and resource rules described below. Schema transformations must also produce supported values. Reject unsupported values clearly rather than silently converting them or discarding their prototype/properties. The runtime's ability to clone a value does not make it part of this contract.

Initially reject `RegExp`, `Error`, `Blob`, `File`, `URL` objects and arbitrary class instances. Also reject functions, symbols, promises, DOM objects, live service/editor handles, shared memory and cycles. These are payload restrictions, not restrictions on the error values that reject command invocations. Additional payload types can be considered later through explicit contract review.

An author can define a plain representation in the shared schema. For example, pass a URL's `.href`, a regular expression's `source` and `flags`, or a file's name, media type and bytes. Perform conversion in the caller's asynchronous action before invocation when it requires asynchronous work. The host does not infer or perform those conversions.

Validation must cover every allowed type and rejection of unsupported values at nested locations and in transformed outputs. Do not rely on a successful `structuredClone` call as the only payload check.

## Binary arguments and results

**Approved payload support; not implemented:** shared commands accept `ArrayBuffer`, typed arrays and `DataView` in their declared arguments and results. The shared contract must validate these values like any other payload. This lets file-processing components exchange bytes without base64 or ordinary-number-array conversion.

Copy buffers and views at the command boundary. Preserve the buffer/view type and view range. The recipient's copy must not alias the sender's memory. Do not transfer ownership or detach the sender's buffer. Exclude `SharedArrayBuffer` and views backed by shared memory. Binary support does not approve every structured-clone type or select payload-size limits.

Validation must cover buffer and view types, nonzero view offsets/ranges, sender/recipient mutation independence, undetached sender buffers and rejection of shared memory. Bound copy work and memory under the resource policy still to be specified.

## Dates, maps and sets

**Approved payload support; not implemented:** shared commands accept `Date`, `Map` and `Set` in declared arguments and results. Copy these values with their standard type behavior preserved. Recipient mutations must not affect sender containers or nested mutable data. Map keys, map values and set members must themselves be permitted command data. Shared contracts must validate the declared types and their contents. Resource accounting must include nested contents, not just the outer container.

Command payloads do not need to be JSON-serializable. An individual contract can choose JSON-compatible representations when its feature needs them. Supporting these three types does not approve arbitrary class instances or every structured-clone type. Cycles are rejected under the policy below. The supported-value list above is explicit; resource budgets still need specification.

Validation must cover retained types, nested permitted/disallowed values, date values under the declared schema and mutation independence for maps, sets and their nested data.

## Cycles and repeated references

**Approved reference policy; not implemented:** reject cyclic command arguments and results initially. A cycle is a reference path that leads back to an object already on that path. Report a clear payload-validation failure. Authors can represent parent/back relationships using IDs instead of cycles. Cycle support can be considered later; it is not an initial requirement.

Allow repeated references that do not form a cycle. Preserve those relationships within the boundary copy. For example, if `payload.selected === payload.chapters[0]`, the copied payload retains that equality. Its mutable data remains independent of the sender. This applies to permitted containers and their contents, including map keys/values and set members.

Host traversal must distinguish cycles from repeated references. Tests must cover direct and indirect cycles, cycles through maps/sets, permitted repeated references and preserved relationships without sender-memory sharing. Copying preserves reference relationships. Schema transformations may deliberately reconstruct or change them under the policy below.

## Schema outputs and transformations

**Approved validation policy; not implemented:** use the schema validator's successful output, not the original value, for the next step. A schema may define conversions, defaults or normalization. The host does not add implicit coercion of its own.

| Boundary          | Author supplies                             | Recipient receives                             |
| ----------------- | ------------------------------------------- | ---------------------------------------------- |
| Command arguments | Consumer supplies argument-schema input     | Implementation receives argument-schema output |
| Command results   | Implementation supplies result-schema input | Consumer receives result-schema output         |

Infer these input and output types separately from the Standard Schema-compatible contract. They need not be identical. For example, a contract can accept a date string and supply a validated `Date` to its implementation. That conversion must be declared by the shared schema.

For arguments, copy the caller's permitted data before validation/transformation, then pass the successful output to the implementation. For results, validate/transform the implementation's result, then copy the successful output for delivery. Check permitted-payload and resource rules before and after transformation. A transform cannot introduce functions, live handles, shared memory or cycles. Schema validation failure prevents argument execution or result delivery, respectively.

Transforms may construct new objects or change repeated-reference relationships. The copying step preserves the relationships present at that step; it does not undo a schema's deliberate reconstruction. Tests must cover distinct input/output inference, successful conversions/defaults, validation failures, copy independence and rejection of prohibited or over-budget transformed values. Budget categories and validator diagnostics are approved below. Numerical defaults and detailed accounting mechanics remain undecided.

## Synchronous and asynchronous validation

**Approved validator support; not implemented:** accept both immediate results and promises from Standard Schema-compatible argument and result validators. Await validation when needed and use its successful output under the transformation policy above.

After argument validation, recheck invocation cancellation and command availability before starting the implementation. After result validation, recheck invocation lifetime before delivery. Cancellation during argument validation prevents implementation execution. Late validation completion must not restart a cancelled invocation or deliver its result. Observe late validation failures so they do not become unhandled rejections.

Awaiting validation does not offload CPU work. Standard Schema's validation method does not receive the host invocation's `AbortSignal`. The host cannot forcibly stop arbitrary validator code or promise work. Preserve cooperative cancellation semantics without claiming that rejecting an invocation stops the validator itself. Activation, ProseMirror hooks and editor transactions remain synchronous.

Tests must cover immediate and promise-based argument/result validation, cancellation during either phase, command removal or provider teardown during validation, late success/failure and prevention of implementation execution or result delivery after cancellation. Budget categories and validator diagnostics are approved below. Numerical defaults and detailed accounting mechanics remain undecided.

## Invocation errors

**Error types/guard exported; runtime normalization not implemented:** normalize shared-command invocation failures into typed errors. The public names are `CommandInvocationErrorCode`, `CommandInvocationError` and `isCommandInvocationError`. These are separate from native-service errors and synchronous editor results.

```ts
type CommandInvocationErrorCode =
	| 'cancelled'
	| 'revoked'
	| 'unavailable'
	| 'invalid-reference'
	| 'contract-mismatch'
	| 'invalid-arguments'
	| 'invalid-result'
	| 'limit-exceeded'
	| 'execution-failed';

type CommandInvocationError = Error & {
	readonly code: CommandInvocationErrorCode;
};

declare function isCommandInvocationError(value: unknown): value is CommandInvocationError;
```

| Code                | Meaning                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `cancelled`         | The caller cancelled the invocation.                                                                     |
| `revoked`           | The caller, provider, command registration or project connection ended while the invocation was pending. |
| `unavailable`       | The declared command is unavailable when requested, such as an absent optional provider.                 |
| `invalid-reference` | The caller used an undeclared dependency or command alias.                                               |
| `contract-mismatch` | The requested contract identity or major does not match its declaration or registration.                 |
| `invalid-arguments` | Argument data violates permitted-payload rules or its schema.                                            |
| `invalid-result`    | Returned data violates permitted-payload rules or its schema.                                            |
| `limit-exceeded`    | A host concurrency or payload limit was exceeded.                                                        |
| `execution-failed`  | The implementation or validator threw or rejected unexpectedly.                                          |

A schema's reported validation failure uses `invalid-arguments` or `invalid-result`, depending on the phase. An unexpected validator exception uses `execution-failed`. Keep original exceptions available to host diagnostics. Callers do not need to understand a provider's private thrown values. Recognizing an error establishes neither origin nor authority.

Use typed command results for expected domain outcomes, such as no matching records. Do not turn every domain outcome into an invocation error. The contract does not change errors outside command invocation. Root SDK exports are approved in the [SDK assembly](sdk-export-review.md#approved-sdk-assembly). The guard is a nonthrowing Error-representation and known-code check. It supports other JavaScript realms without authenticating origin or granting authority. Detailed failure precedence and runtime normalization still need specification and implementation. Tests must cover the codes, validator failures versus exceptions, implementation throws/rejections and lifecycle races.

## Concurrency overload

**Approved admission policy; not implemented:** reject an invocation immediately when host command-concurrency limits are reached. Do not queue it for later execution. An invocation rejected for concurrency must run neither its schema validators nor its implementation. Reject with `CommandInvocationError` code `limit-exceeded`, not a native-service error.

Callers can disable controls during work, combine repeated requests or retry deliberately with their own bounded policy. The host must not introduce hidden delayed execution. A bounded host waiting queue is future work if demonstrated workflows need it.

### Accounting and capacity release

**Approved accounting policy; not implemented:** each admitted invocation occupies capacity for its calling activation, provider activation and plugin-hosting window. Reject admission if any applicable concurrency limit is reached. This bounds one caller's requests across providers, aggregate requests to one provider and aggregate window work. Numerical limits remain undecided.

Count the invocation through argument validation, implementation execution and result validation. Keep it counted until running validator/implementation work settles and host cleanup finishes. Cancellation settles the caller's promise promptly and signals cooperative cancellation, but does not release capacity for work that continues running. Do not start later phases after cancellation. Observe late failures and release capacity after settlement/cleanup, not merely after the public promise rejects.

A never-settling operation can retain capacity. Make retained unfinished work visible in diagnostics rather than claiming it stopped. The host cannot forcibly terminate arbitrary frontend code. Activation teardown likewise does not prove its running code stopped.

A nested command call is a separate invocation and occupies its own caller/provider/window capacity. Its parent remains counted while awaiting it. Immediate overload rejection prevents waiting for capacity held by the parent; it does not guarantee a nested call succeeds.

Tests must cover each accounting scope, validation/execution/result phases, cancellation with late settlement, retained capacity for never-settling work, nested invocation accounting and release after cleanup. Retain overload tests for no validators/execution on rejected calls and no delayed execution when capacity becomes available.

## Payload budgets and validator diagnostics

**Approved resource policy; not implemented:** enforce host-owned limits on payload bytes, nesting depth, visited objects/entries and aggregate in-flight payload reservations. Numerical defaults remain undecided. Bound inspection itself; do not fully traverse an arbitrarily large payload merely to discover that it exceeds a limit.

Check inputs before copying or schema validation. Check transformed outputs and command results as well. Exceeding a host budget rejects with `CommandInvocationError` code `limit-exceeded`. Account for memory actually retained or copied, including backing buffers rather than only a view's visible byte length. Aggregate reservations prevent many individually acceptable payloads from bypassing the overall memory policy. Detailed accounting and reservation mechanics still need implementation design.

Measure validator duration and report slow validation through diagnostics. Preserve cancellation and lifetime checks around asynchronous boundaries. Do not require validators to be generators or run in workers. No new timeout API or numerical duration threshold is selected.

These budgets bound host-managed processing, not arbitrary trusted frontend execution. A timer cannot interrupt a synchronous validator. The host cannot prevent plugin code from allocating memory or blocking its thread, and a transform can allocate a large output before the host rejects it. Do not describe payload reservations as a hard bound on process memory or total validator work.

Tests must cover byte/depth/object/entry limits, aggregate reservations, large backing buffers behind small views, transformed outputs and results exceeding budgets, and bounded host inspection. Verify slow-validator diagnostics without claiming forced interruption. Numerical thresholds, accounting mechanics and responsiveness measurements remain outstanding.

## Implementation details still requiring specification

The approved shape does not settle numerical concurrency/payload limits, detailed accounting mechanics, slow-validator thresholds, detailed error precedence and invocation-runtime implementation. Define these before implementing behavior that authors could depend on. Schema validation is not frontend isolation. Host code must also preserve the approved declaration, project-targeting and revocation rules.

The [implementation plan](implementation-plan.md#part-4--external-packages-and-user-facing-trust) tracks the remaining native security, persistence and packaged-runtime work. This contract approval does not approve a command picker, shortcut system or external loading before those prerequisites are met.
