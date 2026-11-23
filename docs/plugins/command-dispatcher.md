# Internal command dispatcher

The dispatcher executes a typed application command on behalf of a component. It checks a declared dependency, validates and copies data, accounts for resources and tracks cancellation. This guide is for contributors connecting host services, not plugin authors installing packages. Read the [shared command contract](command-contract.md) for author-facing declarations and examples.

## Implementation boundary

[`command-dispatcher.ts`](../../packages-js/plugins/command-dispatcher.ts) is an internal module. It has no package export and is not connected to the bundled plugin host. Tests can supply trusted dependency declarations, provider registrations and lifetime signals directly. The [component lifecycle harness](#component-lifecycle-harness) now constructs these bindings from host-selected command component descriptors.

The dispatcher implements execution and availability. The internal harness adds synchronous activation, command publication checks and required-consumer lifecycle planning. Neither implements manifest-to-runtime assembly, project selection or leases, external loading, native authorization, settings persistence or a settings menu. Creating a dispatcher or harness does not grant permission to run external code.

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

## Component lifecycle harness

[`CommandComponentHost`](../../packages-js/plugins/command-component-host.ts) connects the dispatcher to a small command-only component lifecycle. It is internal test/implementation infrastructure, not the application's current bundled host or a public SDK constructor. [`command-component-model.ts`](../../packages-js/plugins/command-component-model.ts) contains descriptor capture and iterative dependency planning.

A host slot identifies a component instance that the host has already selected. For example, two project openings can have separate slots for the same component. This harness does not decide which project or package a slot represents. Future application assembly must supply that mapping from validated declarations and live scope.

Host code calls `register(descriptor)` with a slot ID, declared commands, exact provider-slot dependencies, command capability and synchronous activation callback. The harness copies and freezes declaration data. It checks applicable identifier, list-size, duplicate and self-dependency rules. This is not parsing `manifest.toml`, matching package versions or implementing general provider APIs. Planning is iterative but synchronous and can scan the full slot catalogue. The harness does not yet provide catalogue budgets or cooperative scheduling.

### Activation and publication

Host code calls `activate(slotId)` to enable a registered component. The harness checks the complete required dependency closure before calling any activation function. Missing/incompatible providers and required cycles fail this check. Required providers activate first. Optional providers are never enabled by lookup or consumer activation. A failed component does not stop unrelated active siblings or already-successful providers.

Each activation gets a fresh host-generated instance ID. The harness calls the descriptor's activation callback with only:

- `signal`: ends with this activation.
- `own(dispose)`: activation-owned, idempotent cleanup.
- `commands`: the dispatcher-backed consumer invoker.
- `contributions.command(registration)`: the generic SDK command-registration signature.

This is deliberately not a complete `FrontendContext`. It supplies no toolbar/view registration, tasks, provider APIs, native services, locale service or project connection.

Command registration is allowed only during synchronous setup and requires `contributions.command`. Each declared command must be published exactly once, with the exact ID/contract/major. Undeclared, duplicate, mismatched or missing publications fail activation. Catching an invalid registration inside author code does not make setup valid. Registrations are staged and invisible to consumers until setup succeeds. Promise/thenable activation results are rejected and their late failures are observed. Later publication attempts are rejected.

A failed activation aborts its signal and publications, then releases owned cleanup in reverse order. The optional returned disposer is owned too. Cleanup errors do not prevent remaining cleanup. Retained old contexts never become current after reactivation. Their late `own()` cleanup runs immediately, and its failure cannot be attributed to a replacement activation.

### Bindings and removal

Consumer invokers resolve exact slot/dependency/command identities. Registration bindings stay stable while live. Reactivation creates fresh bindings. Old consumer handles remain revoked; old pending calls cannot switch to new providers.

Optional command availability is per command. Removing command A does not hide a surviving command B or cancel B's pending calls merely because the consumer requests both through one dependency. Static compatibility still checks the dependency's declared requirements together.

`planDeactivation(slotId)` returns a frozen required-consumer-first plan. `deactivate` and `unregister` require explicit `{ cascade: true }` when active required consumers would also stop. Optional consumers remain active and receive availability changes.

An author can release its own command registration early. This is publication loss, not a user disable request. It revokes that registration and stops consumers that require the missing command, including their required dependents. It does not stop the provider or unrelated optional work. The command cannot be republished later in that activation.

The complete teardown plan is revoked before owned cleanup runs. Pending dispatcher calls reject promptly, but unfinished implementation work still retains capacity until it settles. `dispose()` revokes the harness's activations and dispatcher without claiming to terminate arbitrary code.

### Management and callback boundaries

`get` and `list` return frozen status snapshots. `subscribe` immediately delivers snapshots and returns an early disposer. Activation and cleanup failures use simple host-owned codes. This is not the production plugin-management UI or its persistence model.

Lifecycle changes during activation, notifications, diagnostics or cleanup are guarded. Callers must defer those changes until the callback returns. This includes disposing staged publications from an immediate availability callback. Ordinary direct disposal during setup is allowed, but leaves setup invalid because the promised publication is missing.

## Validation entry points

- [`command-component-host.test.ts`](../../packages-js/plugins/command-component-host.test.ts) and [`command-component-regressions.test.ts`](../../packages-js/plugins/command-component-regressions.test.ts): publication checks, required/optional activation, cascade consent, rollback, stale contexts, independent commands and guarded cleanup/notifications. [`command-component-fixture.ts`](../../packages-js/plugins/command-component-fixture.ts) contains shared test setup, not runtime discovery.
- [`command-dispatcher.test.ts`](../../packages-js/plugins/command-dispatcher.test.ts): execution, schemas, availability, aliases, cancellation, replacement, reentrant callbacks, diagnostics, timing and copy-admission regressions.
- [`command-payload.test.ts`](../../packages-js/plugins/command-payload.test.ts): permitted data, graph snapshots, independent copying, binary relationships and inspection limits.
- [`command-reservations.test.ts`](../../packages-js/plugins/command-reservations.test.ts): capacity, retained representations, provisional copies, release and settings capture.

Run `pnpm --filter @writers-ide/plugins test` and `pnpm --filter @writers-ide/plugins check` from the repository root. Verified results belong in the [cumulative changelog](change-log.md). No standalone test establishes packaged-runtime, native authorization or full host integration.
