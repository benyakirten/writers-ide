export type Dispose = () => void;

export type FormattingMark =
	| 'bold'
	| 'italic'
	| 'superscript'
	| 'subscript'
	| 'underline'
	| 'overline'
	| 'strikethrough';

export type FormattingBlockCommand =
	| 'indent'
	| 'dedent'
	| 'align-left'
	| 'align-center'
	| 'align-right'
	| 'align-justify';

export type FormattingCommand = FormattingMark | FormattingBlockCommand;

export interface FormattingSnapshot {
	viewId: string;
	revision: number;
	marks: Record<FormattingMark, number>;
	blocks: Record<FormattingBlockCommand, number>;
	enabled: Record<FormattingCommand, boolean>;
}

export interface FormattingRequest {
	viewId: string;
	revision: number;
	command: FormattingCommand;
}

/**
 * The service validates view identity, revision, and command availability on execute.
 * Subscription setup must be atomic: undo partial registration if subscribe throws.
 */
export interface FormattingService {
	subscribe(listener: (snapshot: FormattingSnapshot | null) => void): Dispose;
	execute(request: FormattingRequest): boolean;
}

export type PluginCapability =
	| 'formatting.observe'
	| 'formatting.execute'
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
	readonly formatting: FormattingService;
	/** Returns an idempotent early-release handle; late ownership disposes immediately. */
	readonly own: (dispose: Dispose) => Dispose;
	readonly contributions: PluginContributions<Presentation>;
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
	readonly phase: 'activation' | 'cleanup';
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
	deactivate(id: string): PluginInfo;
}

export interface PluginInfo {
	readonly manifest: PluginManifest;
	readonly status: PluginStatus;
	readonly errors: readonly PluginError[];
	readonly contributions: readonly {
		readonly kind: ContributionKind;
		readonly id: string;
	}[];
}
