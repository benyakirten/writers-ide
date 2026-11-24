import type { TaskService } from '@writers-ide/tasks';
import type {
	Dispose,
	PluginApi,
	PluginApiConnection,
	ToolbarContribution,
	ViewContribution,
} from './index';
import type { CommandInvoker, CommandRegistration } from './commands';
import type { NativeServices } from './native';

/** Descriptive metadata, not credentials or proof of caller authority. */
export type ComponentIdentity = {
	readonly packageId: string;
	readonly componentId: string;
};

export type ActivationIdentity = ComponentIdentity & {
	readonly activationId: string;
	readonly projectOpeningId: string | null;
};

/** Host-issued reference to a live opening; copying its fields does not confer access. */
export type ProjectReference = {
	readonly id: string;
	readonly openingId: string;
	readonly name: string;
};

export interface ComponentApiConnection extends PluginApiConnection {
	readonly consumer: ActivationIdentity;
	readonly provider: ActivationIdentity;
}

export interface ComponentApis {
	provide<T extends object>(
		contract: PluginApi<T>,
		factory: (connection: ComponentApiConnection) => T,
	): void;
	get<T extends object>(alias: string, contract: PluginApi<T>): T | null;
	subscribe<T extends object>(
		alias: string,
		contract: PluginApi<T>,
		listener: (api: T | null) => void,
	): Dispose;
}

/** Registrations belong to one activation; IDs are local to its component and kind. */
export interface FrontendContributions<Presentation> {
	toolbar(contribution: ToolbarContribution<Presentation>): Dispose;
	view(contribution: ViewContribution<Presentation>): Dispose;
	command<ArgsInput, ArgsOutput, ResultInput, ResultOutput>(
		registration: CommandRegistration<ArgsInput, ArgsOutput, ResultInput, ResultOutput>,
	): Dispose;
}

/** Independent lease; disposal, project closure or consumer teardown revokes its services. */
export interface ProjectApiConnection {
	readonly project: ProjectReference;
	readonly commands: CommandInvoker;
	readonly signal: AbortSignal;
	get<T extends object>(alias: string, contract: PluginApi<T>): T | null;
	subscribe<T extends object>(
		alias: string,
		contract: PluginApi<T>,
		listener: (api: T | null) => void,
	): Dispose;
	dispose(): void;
}

export interface ProjectConnections {
	/** Delivers immediately and on changes; subscription belongs to activation lifetime. */
	subscribeSelected(listener: (project: ProjectReference | null) => void): Dispose;
	connect(project: ProjectReference): ProjectApiConnection;
}

export type LocaleSnapshot = {
	readonly languageTag: string;
	readonly direction: 'ltr' | 'rtl';
};

export interface PluginLocale {
	snapshot(): LocaleSnapshot;
	/** Delivers immediately and on changes; subscription belongs to activation lifetime. */
	subscribe(listener: (locale: LocaleSnapshot) => void): Dispose;
}

/** Author context; supplied by the internal no-native harness, not the current bundled host. */
export type FrontendContext<Presentation> = {
	readonly identity: ActivationIdentity;
	readonly signal: AbortSignal;
	readonly own: (dispose: Dispose) => Dispose;
	readonly contributions: FrontendContributions<Presentation>;
	readonly tasks: TaskService;
	readonly apis: ComponentApis;
	readonly commands: CommandInvoker;
	readonly locale: PluginLocale;
	readonly native: NativeServices;
} & (
	| { readonly project: ProjectReference; readonly projects: null }
	| { readonly project: null; readonly projects: ProjectConnections }
);

/** Named entry-module export. Setup and any returned disposer are synchronous. */
export interface FrontendEntry<Presentation> {
	activate(context: FrontendContext<Presentation>): void | Dispose;
}
