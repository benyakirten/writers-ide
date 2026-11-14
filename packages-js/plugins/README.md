# @writers-ide/plugins (private, Phase 1)

TypeScript-source contracts for **explicitly registered, trusted bundled plugins**. The root entry has no Svelte, ProseMirror, or application dependencies. `./svelte` is a type-only trusted presentation adapter; it is not an isolated UI protocol. There is no discovery, external loading, sandbox, persistence, or plugin-manager UI here.

## Integration

The application implementation is `src/lib/plugins/plugin-host.ts`, exporting `PluginHost<Presentation>` and `PluginHostOptions<Presentation>`. Supply a formatting service and three registry adapters:

```ts
interface PluginHostOptions<P> {
	readonly formatting: FormattingService;
	readonly registries: {
		readonly toolbar: ContributionRegistry<ToolbarContribution<P>>;
		readonly view: ContributionRegistry<ViewContribution<P>>;
		readonly command: ContributionRegistry<CommandContribution>;
	};
}

interface ContributionRegistry<C> {
	register(ownerId: string, contribution: C): () => void;
}
```

`new PluginHost(options)` exposes:

```ts
register(plugin: BundledPlugin<P>): PluginInfo;
activate(id: string): PluginInfo;
deactivate(id: string): PluginInfo;
get(id: string): PluginInfo | undefined;
list(): readonly PluginInfo[];
```

Registration does not activate. All lifecycle methods are synchronous. Unknown IDs, duplicate plugin registrations, invalid manifests, and reentrant lifecycle operations throw. Activation and cleanup failures are instead recorded in `PluginInfo.errors`; inspect the returned status. Repeated activation of an active plugin and repeated deactivation are idempotent. Call `activate` again to retry a failed plugin or re-enable a disabled plugin.

The host and tests import contracts from the package entry points. This directory is included in `pnpm-workspace.yaml` and the application depends on it through `workspace:*`. The package exports raw TypeScript without a build step. Svelte 5 is an optional peer for consumers of `./svelte`.

## Plugin API

```ts
interface BundledPlugin<P> {
	readonly manifest: PluginManifest;
	readonly activate: (context: PluginContext<P>) => void | (() => void);
}

interface PluginManifest {
	readonly id: string;
	readonly version: string;
	readonly apiVersion: 1;
	readonly name: string;
	readonly description: string;
	readonly capabilities: readonly PluginCapability[];
}

type PluginCapability =
	| 'formatting.observe'
	| 'formatting.execute'
	| 'contributions.toolbar'
	| 'contributions.view'
	| 'contributions.command';

interface PluginContext<P> {
	readonly signal: AbortSignal;
	readonly formatting: FormattingService;
	readonly own: (dispose: () => void) => () => void;
	readonly contributions: {
		toolbar(contribution: ToolbarContribution<P>): () => void;
		view(contribution: ViewContribution<P>): () => void;
		command(contribution: CommandContribution): () => void;
	};
}

interface ToolbarContribution<P> {
	readonly id: string;
	readonly name: string;
	readonly horizontal: { readonly presentation: P; readonly size: 1 | 2 | 3 };
	readonly vertical: { readonly presentation: P; readonly size: 1 | 2 | 3 };
}
interface ViewContribution<P> {
	readonly id: string;
	readonly name: string;
	readonly presentation: P;
}
interface CommandContribution {
	readonly id: string;
	readonly name: string;
	readonly execute: () => boolean;
}
```

Each toolbar orientation declares its presentation and capacity in units of `1 | 2 | 3`. The host validates both capacities before calling the registry adapter, and copies/freezes the section metadata. It does not freeze arbitrary presentation values. Toolbar adapters map each orientation's section to the application's registry plugin descriptor; aggregate capacity checks, placement, and docking remain the application's responsibility.

Declare each authority actually used. Observing without `formatting.observe` and registration without the corresponding contribution capability throw; formatting execution without `formatting.execute` returns `false`.

IDs are unique **per contribution kind across active plugins**, not automatically prefixed. Prefer stable plugin-qualified IDs such as `example.formatting/toolbar`. Different kinds may reuse an ID. The adapter receives the owner ID explicitly. It must register atomically: if registration throws, the adapter must undo its own partial external effects. Its returned disposer must remove the registration/presentation. The host releases its bookkeeping and continues other cleanup even if that disposer throws; it cannot guarantee repair of a broken external registry.

Formatting subscriptions, contribution registrations, `own` resources, and the activation return disposer are automatically owned. Handles are idempotent early-release functions; manual release removes the resource from pending cleanup. Abort/revocation happens before reverse-order disposal. Cleanup failures are collected, not rethrown. `own` after revocation immediately disposes its argument. Stale registrations/subscriptions throw; stale formatting execution and retained contributed command callbacks return `false`, including after re-enabling. Ignoring these handles cannot resurrect an earlier activation.

## Formatting boundary

```ts
type FormattingMark =
	| 'bold'
	| 'italic'
	| 'superscript'
	| 'subscript'
	| 'underline'
	| 'overline'
	| 'strikethrough';
type FormattingBlockCommand =
	| 'indent'
	| 'dedent'
	| 'align-left'
	| 'align-center'
	| 'align-right'
	| 'align-justify';
type FormattingCommand = FormattingMark | FormattingBlockCommand;

interface FormattingSnapshot {
	viewId: string;
	revision: number;
	marks: Record<FormattingMark, number>;
	blocks: Record<FormattingBlockCommand, number>;
	enabled: Record<FormattingCommand, boolean>;
}
interface FormattingRequest {
	viewId: string;
	revision: number;
	command: FormattingCommand;
}
interface FormattingService {
	subscribe(listener: (snapshot: FormattingSnapshot | null) => void): () => void;
	execute(request: FormattingRequest): boolean;
}
```

The app-provided service owns formatting semantics, revision/view identity checks, and command availability validation; it must reject stale/invalid requests by returning `false`. The generic host enforces capability/lifetime checks and copies each delivered snapshot (including its records) and each outgoing request. No editor, selection, manuscript, or mutable workspace handle crosses this boundary. Subscription cleanup belongs to the plugin activation. If an immediately invoked listener throws, the host waits for the service's unsubscribe handle, disposes the subscription, then propagates the listener failure. If service setup itself throws, the host revokes any retained callback, but cannot obtain an unsubscribe handle: the service must undo its own partial registration before throwing. A subscription whose immediate callback deactivates its owner is disposed as soon as its handle returns. Exceptions from later notifications propagate normally; ownership remains intact for cleanup.

## Svelte presentation adapter

`@writers-ide/plugins/svelte` exports this descriptor and these type aliases:

```ts
interface SveltePresentation {
	readonly component: Component<{ context: SveltePluginContext }>;
	readonly context: SveltePluginContext;
}
type SveltePlugin = BundledPlugin<SveltePresentation>;
type SveltePluginContext = PluginContext<SveltePresentation>;
type SveltePluginRegistries = PluginRegistries<SveltePresentation>;
type SvelteToolbarContribution = ToolbarContribution<SveltePresentation>;
type SvelteViewContribution = ViewContribution<SveltePresentation>;
```

Construct `PluginHost<SveltePresentation>` with app-owned Svelte registry adapters. During activation, create descriptors `{ component: ToolbarComponent, context }` using the host-provided context and contribute them as each section's `presentation`. A view uses the same descriptor directly in its `presentation` field. Components declare a required `context: SveltePluginContext` prop; the adapter renders `descriptor.component` with `descriptor.context`. This carries the activation's scoped, revocable services explicitly, without closure wrappers, unstable Svelte internals, or mutable application props. The generic host does not inspect Svelte descriptors or instantiate components. The app adapter remains responsible for mounting/unmounting and mapping sections to registry plugin descriptors. Per-view instance metadata is out of scope.

## Management snapshots

```ts
type PluginStatus = 'disabled' | 'activating' | 'active' | 'deactivating' | 'failed';
type ContributionKind = 'toolbar' | 'view' | 'command';
interface PluginError {
	readonly phase: 'activation' | 'cleanup';
	readonly message: string;
}
interface PluginInfo {
	readonly manifest: PluginManifest;
	readonly status: PluginStatus;
	readonly errors: readonly PluginError[];
	readonly contributions: readonly {
		readonly kind: ContributionKind;
		readonly id: string;
	}[];
}
```

Snapshots, manifests/capability arrays, errors, and contribution metadata are frozen copies, not mutable host state. They contain metadata only, not plugin callbacks or presentations. Starting a fresh activation clears previous errors. Cleanup errors leave the plugin `failed` after deactivation, but do not prevent a later activation. During an otherwise active session, early-release cleanup failures appear in `errors` without automatically deactivating the feature. For this synchronous phase, management code can refresh `get`/`list` after its operations; there is no reactive management subscription yet.
