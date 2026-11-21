# Shared application commands

**Status: contract shape approved; not implemented.** This page records the external-package command design. Today's `CommandContribution` takes no arguments and returns a synchronous boolean. There is no current plugin-facing command-invocation service or user-facing command routing.

An application command is a named action owned by a component. Another component can invoke it through a declared dependency. It is not a ProseMirror command or a live provider service. Registration does not create a button, shortcut or command-picker entry. See the [package specification](package-api-proposal.md) for component lifetimes and package installation.

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
