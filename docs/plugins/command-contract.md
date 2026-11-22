# Shared application commands

**Status: contract shape approved; not implemented.** This page records the external-package command design. Today's `CommandContribution` takes no arguments and returns a synchronous boolean. There is no current plugin-facing command-invocation service or user-facing command routing.

An application command is a named action owned by a component. Another component can invoke it through a declared dependency. It is not a ProseMirror command or a live provider service. Registration does not create a button, shortcut or command-picker entry. See the [package specification](package-api-proposal.md) for component lifetimes and package installation.

## Choose an editor command or an application command

Writer's IDE has two command APIs. They serve different purposes. Synchronous editor commands are implemented today. The typed shared application command API described in this guide is approved but not implemented.

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

`definePluginCommand` is an approved future SDK helper, not an export available today. It infers argument/result types from Standard Schema-compatible validators. Standard Schema is an interoperability format for validation libraries. Zod is one author choice, not a mandatory host dependency. Other compatible validators can be used. No validation package is added by this design document.

The example accepts an object containing a bounded string and returns a nonnegative integer. Argument-free commands remain supported. Commands producing no value declare a `void` result. The exact no-argument convenience overloads are implementation work.

## Declaration-count limits

**Approved limits; enforcement is not implemented:** a component may declare at most 32 shared commands in its `commands` list. A consumer may request at most 32 commands in each dependency's `commands` list. Exceeding either limit rejects the whole manifest before plugin code is imported. These are host-owned engineering starting points that a plugin cannot raise. The 64 KiB whole-manifest limit also applies.

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

**Approved identifier rules; enforcement is not implemented:** command IDs, contract IDs and consumer command aliases must each be nonempty strings that are not whitespace-only, with at most 256 UTF-8 bytes. This is a byte limit, not JavaScript string length. All three allow flexible characters and match exactly, including case. The host will reject invalid values rather than trim, normalize or truncate them. These rules apply to manifest fields and their corresponding runtime definitions, registrations and lookups. They do not make command IDs globally unique. Consumer command aliases are scoped to a dependency, as explained below.

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

## Values, compatibility and lifetime

- Arguments and results are data-only and copied. Allow primitives, arrays, plain records and a documented set of structured-clone types. The exact extended-value list and resource budgets remain to be specified. Functions, DOM nodes, editor objects and live service handles are not command payloads. Use provider APIs for ongoing behavioral connections.
- Failures reject the promise. The result is not a universal handled/success boolean; a boolean can still be an explicitly declared result. Invocation settles when the action finishes, not merely when it starts a background task.
- Contract majors match exactly, independently of package-version ranges. Breaking argument/result changes require a new major. A provider can offer separate command registrations for older contracts. Validators and compatibility tests must enforce the documented promises; matching numbers alone do not prove compatible schemas.
- Each invocation receives a signal tied to caller cancellation, caller/provider teardown, command removal and its project connection. Cancellation rejects the pending invocation, suppresses late success and observes late failures. It does not stop unrelated provider work or revoke the provider credential.
- Cancellation is cooperative. Authors must propagate the signal and check before effects. It cannot interrupt arbitrary synchronous code or undo completed edits/native effects. A promise does not offload CPU work. Native operations still use the provider's own checked authority.

## Implementation details still requiring specification

The approved shape does not settle schema-transform/coercion semantics, the extended copied-value list, exact validation/cancellation error codes, validator budgets or optional-command availability reporting. Define these before implementing behavior that authors could depend on. Schema validation is not frontend isolation. Host code must also preserve the approved declaration, project-targeting and revocation rules.

The [implementation plan](implementation-plan.md#part-4--external-packages-and-user-facing-trust) tracks the remaining native security, persistence and packaged-runtime work. This contract approval does not approve a command picker, shortcut system or external loading before those prerequisites are met.
