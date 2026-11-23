# Internal command dispatcher

The dispatcher executes a typed application command on behalf of a component. It checks a declared dependency, validates and copies data, accounts for resources and tracks cancellation. This guide is for contributors connecting host services, not plugin authors installing packages. Read the [shared command contract](command-contract.md) for author-facing declarations and examples.

## Implementation boundary

[`command-dispatcher.ts`](../../packages-js/plugins/command-dispatcher.ts) is an internal module. It has no package export and is not connected to the bundled plugin host. Tests supply trusted dependency declarations, provider registrations and lifetime signals directly.

This slice implements execution and availability. It does not implement manifest-to-runtime assembly, activation publication checks, required-consumer activation planning, project selection or leases, external loading, native authorization, settings persistence or a settings menu. Creating a dispatcher does not authorize a component or make a registration valid against its manifest.

## What the host supplies

`createCommandDispatcher(options)` creates an independent dispatcher for one workspace window. Options can supply a reservation ledger, a monotonic clock, a metadata diagnostic observer and an explicit raw-error inspection observer. Without a ledger, it creates one with the approved defaults. No diagnostic storage or logging UI is created.

The host calls `createInvoker(source)` when constructing a consumer's activation or connection services. The source contains:

- The actual consumer component-instance ID and lifetime signal. A project connection should use a signal that also ends when that connection closes.
- Exact dependency-alias and command-alias declarations. Each declaration identifies the provider's local command ID and contract ID/major.
- A resolver for each declaration. It returns the current provider binding, or `undefined` when unavailable.
- A binding-change subscription. The host notifies after replacement or removal, even when the replacement is also available.

A provider binding contains the actual provider instance ID, provider lifetime signal, registration lifetime signal and command registration. Keep its object identity stable for that registration and connection. Return a new object when either changes. The dispatcher uses identity changes to revoke old in-flight calls; it does not redirect them to a replacement.

These inputs come from host-owned state, not from plugin-supplied instance IDs or arbitrary global command names. Instance IDs support accounting and attribution, not authentication of arbitrary frontend code. The host must still enforce manifest declarations and select the appropriate project/window instance.

## Availability

The returned object implements the SDK's `CommandInvoker` contract. `isAvailable()` resolves only a declared alias pair and exact contract. It checks current provider/registration lifetime and compatibility, not payload validity or spare capacity.

`subscribeAvailability()` delivers the initial boolean and later changes. The returned disposer ends the subscription early. Consumer or dispatcher teardown removes its binding and abort listeners. Listener failures are isolated and reported without changing other invocations. Failed subscription setup rolls back the dispatcher's own registrations.

No lookup installs or enables a provider. Availability is not a reservation. A caller must still handle rejection from `execute()`.

## Execution sequence

`execute()` always returns a promise, including for invalid references and synchronous implementations.

1. Check caller revocation, then explicit cancellation.
2. Check declared aliases and contract identity/major.
3. Resolve the provider and check its registration. Recheck lifetime after host callbacks.
4. Admit the call against caller, provider and window limits. Reject excess capacity immediately; do not queue or run validators.
5. Inspect and retain arguments. Prepare a graph snapshot, reserve its independent copy and copy it before invoking the provider's argument schema.
6. Await argument validation and use its successful transformed value. Recheck lifetime, permitted data and resource limits before implementation execution.
7. Execute the provider's implementation with an invocation-owned cancellation signal. Await completion.
8. Inspect the raw result, validate/transform it with the provider's result schema and check the output. Reserve and copy it before delivery.
9. Settle once and release host reservations after work and cleanup finish.

The caller's contract reference identifies the contract. It does not replace the provider's validators. Both immediate and promise-based schema results are supported. Reported schema issues use `invalid-arguments` or `invalid-result`; unexpected validator or implementation exceptions use `execution-failed`.

## Copying and reservations

[`command-payload.ts`](../../packages-js/plugins/command-payload.ts) supplies `prepareCommandPayload()`. Its inspection and copy use the same captured graph. Reserving one inspection and rescanning the sender for copying would allow proxy traps to change the copy's size between those operations.

[`command-reservations.ts`](../../packages-js/plugins/command-reservations.ts) reserves the prepared inspection before allocation. The provisional reservation represents the independent copy, not the sender's allocation identities. After copying, the dispatcher replaces it with accounting for the copy's actual identities. It does not require capacity for a third representation during that replacement.

Arguments and results are independent boundary copies. Within a copy, repeated references and shared backing buffers remain shared. Typed arrays carry binary state only. See [supported values and binary semantics](command-contract.md#binary-arguments-and-results).

Reservations cover distinct retained representations. Mutable schema inputs are inspected again after asynchronous work before their previous receipts are replaced. This is checkpoint accounting, not continuous mutation tracking. A plugin or transform can allocate memory before the dispatcher sees it. The limits do not bound the entire JavaScript heap or preempt synchronous work.

Updates to an injected ledger apply to new admissions. Existing calls retain their captured limits while continuing to contribute to shared counters. This implements the accounting behavior, not application-wide settings distribution or persistence.

## Cancellation and cleanup

The invocation signal combines explicit cancellation, consumer/connection teardown, provider teardown, registration removal and dispatcher disposal. Binding replacement also revokes the old invocation.

Cancellation rejects the public promise promptly and signals cooperative work. It does not start another phase or deliver a late result. Pending validators and implementations are still observed so late rejection does not become an unhandled promise rejection.

Capacity remains occupied until running work settles and cleanup drops its data. A never-settling operation can therefore retain capacity. Disposal revokes access; it does not prove that arbitrary JavaScript stopped. Completed edits or native effects do not roll back. One cancelled invocation does not abort unrelated calls or the provider's activation credential.

## Errors and diagnostics

Failures reject with `CommandInvocationError`, including its host-written message, approved code and opaque diagnostic ID. Unexpected plugin exceptions cannot select their public code or message by throwing an error with similar fields.

Ordinary diagnostics contain component-instance identities, command/contract identity, phase, timing and resource snapshots. They omit arguments, results and raw exception messages. The optional `inspectError` observer is an explicit host-only route for original exceptions. It is separate from ordinary metadata and has no console fallback or automatic persistence.

Observer failures are isolated. Observer-triggered teardown still ends invocation lifetime. Later failures may be diagnosed but cannot replace a settled outcome.

The dispatcher warns when a validator's initial synchronous call exceeds 16 ms. It records promise-based validation's total elapsed time separately. Neither measurement times out or rejects work. The initial measurement does not capture every synchronous segment after an asynchronous validator resumes.

## Validation entry points

- [`command-dispatcher.test.ts`](../../packages-js/plugins/command-dispatcher.test.ts): execution, schemas, availability, aliases, cancellation, replacement, reentrant callbacks, diagnostics, timing and copy-admission regressions.
- [`command-payload.test.ts`](../../packages-js/plugins/command-payload.test.ts): permitted data, graph snapshots, independent copying, binary relationships and inspection limits.
- [`command-reservations.test.ts`](../../packages-js/plugins/command-reservations.test.ts): capacity, retained representations, provisional copies, release and settings capture.

Run `pnpm --filter @writers-ide/plugins test` and `pnpm --filter @writers-ide/plugins check` from the repository root. Verified results belong in the [cumulative changelog](change-log.md). No standalone test establishes packaged-runtime, native authorization or full host integration.
