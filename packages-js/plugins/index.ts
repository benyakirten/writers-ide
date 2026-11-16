import type { TaskService } from '@writers-ide/tasks';

export type Dispose = () => void;

export interface PluginApiIdentity {
	readonly id: string;
	readonly major: number;
}

declare const apiType: unique symbol;

/** Immutable contract identity; the phantom member preserves its facade type. */
export interface PluginApi<T extends object> extends PluginApiIdentity {
	readonly [apiType]?: (value: T) => T;
}

export function definePluginApi<T extends object>(identity: PluginApiIdentity): PluginApi<T> {
	if (typeof identity.id !== 'string' || identity.id.trim().length === 0) {
		throw new Error('Plugin API ID must be a nonempty string');
	}
	if (!Number.isSafeInteger(identity.major) || identity.major <= 0) {
		throw new Error('Plugin API major must be a positive safe integer');
	}
	return Object.freeze({ id: identity.id, major: identity.major });
}

export interface PluginDependency {
	readonly provider: string;
	readonly api: string;
	readonly major: number;
	readonly optional?: boolean;
}

export interface PluginApiConnection {
	readonly consumerId: string;
	readonly signal: AbortSignal;
	readonly own: (dispose: Dispose) => Dispose;
	/** Attribute a provider-mediated failure to this consumer; ignored after revocation. */
	reportError(error: unknown): void;
	/** Late callbacks are ignored after either endpoint is revoked. */
	guard<Args extends unknown[], Result>(
		callback: (...args: Args) => Result,
	): (...args: Args) => Result | undefined;
}

export interface PluginApis {
	provide<T extends object>(
		contract: PluginApi<T>,
		factory: (connection: PluginApiConnection) => T,
	): void;
	get<T extends object>(providerId: string, contract: PluginApi<T>): T | null;
	subscribe<T extends object>(
		providerId: string,
		contract: PluginApi<T>,
		listener: (api: T | null) => void,
	): Dispose;
}

export type PluginCapability =
	| 'contributions.toolbar'
	| 'contributions.view'
	| 'contributions.command';

export interface PluginManifest {
	readonly id: string;
	readonly version: string;
	readonly apiVersion: 1;
	readonly name: string;
	readonly description: string;
	readonly capabilities: readonly PluginCapability[];
	readonly provides?: readonly PluginApiIdentity[];
	readonly dependencies?: readonly PluginDependency[];
}

/** Presentation values are interpreted only by the trusted host's rendering adapter. */
export interface ToolbarContribution<Presentation> {
	readonly id: string;
	readonly name: string;
	readonly horizontal: { readonly presentation: Presentation; readonly size: 1 | 2 | 3 };
	readonly vertical: { readonly presentation: Presentation; readonly size: 1 | 2 | 3 };
}

export interface ViewContribution<Presentation> {
	readonly id: string;
	readonly name: string;
	readonly presentation: Presentation;
}

export interface CommandContribution {
	readonly id: string;
	readonly name: string;
	readonly execute: () => boolean;
}

/** IDs are unique within each contribution kind across all active plugins. */
export interface PluginContributions<Presentation> {
	toolbar(contribution: ToolbarContribution<Presentation>): Dispose;
	view(contribution: ViewContribution<Presentation>): Dispose;
	command(contribution: CommandContribution): Dispose;
}

export interface PluginContext<Presentation> {
	readonly signal: AbortSignal;
	/** Returns an idempotent early-release handle; late ownership disposes immediately. */
	readonly own: (dispose: Dispose) => Dispose;
	readonly contributions: PluginContributions<Presentation>;
	/** Activation-owned helpers; optional to use, not a sandbox or editor API. */
	readonly tasks: TaskService;
	readonly apis: PluginApis;
}

/** Trusted bundled code only. Activation and the optional returned disposer are synchronous. */
export interface BundledPlugin<Presentation> {
	readonly manifest: PluginManifest;
	readonly activate: (context: PluginContext<Presentation>) => void | Dispose;
}

/** Adapters must register atomically (undo their own work if they throw). */
export interface ContributionRegistry<Contribution> {
	register(ownerId: string, contribution: Contribution): Dispose;
}

export interface PluginRegistries<Presentation> {
	readonly toolbar: ContributionRegistry<ToolbarContribution<Presentation>>;
	readonly view: ContributionRegistry<ViewContribution<Presentation>>;
	readonly command: ContributionRegistry<CommandContribution>;
}

export type PluginStatus = 'disabled' | 'activating' | 'active' | 'deactivating' | 'failed';
export type ContributionKind = 'toolbar' | 'view' | 'command';

export interface PluginError {
	readonly phase: 'activation' | 'cleanup' | 'task' | 'dependency' | 'provider';
	readonly message: string;
}

/** Host-owned management, never supplied as a plugin capability.
 * Snapshots contain only frozen metadata. Subscribe delivers immediately; listener
 * failures are isolated. Registration/lifecycle calls during notification throw:
 * schedule follow-up actions after the callback returns instead.
 */
export interface PluginManagementService {
	list(): readonly PluginInfo[];
	subscribe(listener: (plugins: readonly PluginInfo[]) => void): Dispose;
	activate(id: string): PluginInfo;
	planDeactivation(id: string): readonly string[];
	deactivate(id: string, options?: { cascade?: boolean }): PluginInfo;
}

export interface PluginInfo {
	readonly manifest: PluginManifest;
	readonly status: PluginStatus;
	readonly errors: readonly PluginError[];
	readonly providers: readonly PluginApiIdentity[];
	readonly dependencies: readonly {
		readonly provider: string;
		readonly api: string;
		readonly major: number;
		readonly optional: boolean;
		readonly status: 'available' | 'missing' | 'incompatible' | 'inactive';
	}[];
	readonly contributions: readonly {
		readonly kind: ContributionKind;
		readonly id: string;
	}[];
}
