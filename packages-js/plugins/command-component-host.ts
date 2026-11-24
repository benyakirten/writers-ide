import {
	createTaskService,
	WorkQueue,
	type TaskService,
	type WorkerTaskOptions,
} from '@writers-ide/tasks';
import type { ActivationIdentity, PluginLocale, ProjectReference } from './frontend';
import { ComponentProjectRegistry } from './component-project-registry';
import { ComponentProjectConnections } from './component-project-connections';
import {
	resolveProvider,
	routed,
	validateRegistration,
	type ConnectionScope,
} from './component-project-routing';
import { createActivationLocale } from './component-locale';
import { createCommandDispatcher } from './command-dispatcher';
import { ComponentApiManager } from './component-api-manager';
import { apiKey } from './component-api-declarations';
import type { CommandInvoker, CommandRegistration } from './commands';
import type { Dispose, ToolbarContribution, ViewContribution } from './index';
import {
	activationPlan,
	capture,
	compatible,
	own,
	published,
	removalPlan,
	synchronous,
	text,
	type Activation,
	type CommandContext,
	type ComponentDescriptor,
	type Entry,
} from './command-component-model';

export type PresentationRecord<Presentation = unknown> = {
	readonly id: string;
	readonly placementId: string;
	readonly identity: ActivationIdentity;
	readonly project: ProjectReference | null;
	readonly visible: boolean;
} & (
	| { readonly kind: 'toolbar'; readonly contribution: ToolbarContribution<Presentation> }
	| { readonly kind: 'view'; readonly contribution: ViewContribution<Presentation> }
);

type Snapshot = {
	readonly slotId: string;
	readonly status: Entry['status'];
	readonly instanceId?: string;
	readonly errors: readonly string[];
};
type Options = NonNullable<Parameters<typeof createCommandDispatcher>[0]> & {
	readonly locale: PluginLocale;
	readonly workQueue?: WorkQueue;
};
let nextInstance = 0;

/** Internal trusted-descriptor harness. No package loading, persistence or native authority. */
export class CommandComponentHost<Presentation = unknown> {
	readonly #entries = new Map<string, Entry<Presentation>>();
	readonly #presentations = new WeakMap<
		Activation,
		Map<string, PresentationRecord<Presentation>>
	>();
	readonly #presentationListeners = new Set<
		(snapshot: readonly PresentationRecord<Presentation>[]) => void
	>();
	readonly #pendingPresentationListeners = new Set<
		(snapshot: readonly PresentationRecord<Presentation>[]) => void
	>();
	#deliveringPresentations = false;
	readonly #dispatcher;
	readonly #locale: PluginLocale;
	readonly #workQueue: WorkQueue;
	readonly #apis = new ComponentApiManager(this.#entries, (callback) => this.#callback(callback));
	readonly #projects = new ComponentProjectRegistry();
	readonly #connections = new ComponentProjectConnections(
		this.#projects,
		this.#apis,
		(entry, owner, scope) => this.#invoker(entry, owner, scope),
		(callback) => this.#callback(callback),
		() => {
			this.#dispatcher.markRevoked();
			this.#callback(() => this.#dispatcher.drainRevocations());
		},
	);
	readonly #listeners = new Set<(snapshot: readonly Snapshot[]) => void>();
	#busy = false;
	#callbacks = 0;
	#cleanupCallbacks = 0;
	#disposed = false;

	constructor(options: Options) {
		const { locale, workQueue, ...dispatcherOptions } = options;
		this.#locale = locale;
		this.#workQueue = workQueue ?? new WorkQueue();
		// Dispatcher diagnostics also run inside the lifecycle mutation guard.
		this.#dispatcher = createCommandDispatcher({
			...dispatcherOptions,
			diagnostics: (data) => this.#callback(() => options.diagnostics?.(data)),
			inspectError: options.inspectError
				? (error, data) => this.#callback(() => options.inspectError?.(error, data))
				: undefined,
		});
	}

	openProject(id: string, name: string): ProjectReference {
		return this.#mutate(() => this.#projects.open(id, name));
	}
	selectProject(reference: ProjectReference | null): void {
		this.#mutate(() => this.#projects.select(reference));
	}
	closeProject(reference: ProjectReference): void {
		this.#mutate(() =>
			this.#projects.close(reference, () => {
				const plan = new Set<string>();
				for (const [id, entry] of this.#entries) {
					if (entry.descriptor.identity.projectOpeningId === reference.openingId) {
						for (const member of removalPlan(this.#entries, id)) {
							plan.add(member);
						}
					}
				}
				this.#connections.revokeOpening(reference.openingId);
				this.#stop([...plan]);
			}),
		);
	}

	#assertOpening(entry: Pick<Entry, 'descriptor'>): void {
		const opening = entry.descriptor.identity.projectOpeningId;
		if (opening !== null && !this.#projects.reference(opening)) {
			throw new Error('Component project opening is unknown or closed');
		}
	}

	register(descriptor: ComponentDescriptor<Presentation>): Snapshot {
		return this.#mutate(() => {
			const captured = capture(descriptor);
			if (this.#entries.has(captured.slotId)) {
				throw new Error('Component slot already registered');
			}
			this.#assertOpening({ descriptor: captured });
			validateRegistration(this.#entries, captured);
			this.#entries.set(captured.slotId, { descriptor: captured, status: 'disabled', errors: [] });
			return this.get(captured.slotId)!;
		});
	}

	get(slotId: string): Snapshot | undefined {
		const entry = this.#entries.get(slotId);
		return entry
			? Object.freeze({
					slotId,
					status: entry.status,
					instanceId: entry.activation?.id,
					errors: Object.freeze([...entry.errors]),
				})
			: undefined;
	}
	list(): readonly Snapshot[] {
		return Object.freeze([...this.#entries.keys()].map((id) => this.get(id)!));
	}
	subscribe(listener: (snapshot: readonly Snapshot[]) => void): Dispose {
		if (this.#disposed) {
			throw new Error('Component host is disposed');
		}
		const subscription = (snapshot: readonly Snapshot[]) => listener(snapshot);
		this.#listeners.add(subscription);
		this.#deliver(() => subscription(this.list()));
		return () => {
			this.#listeners.delete(subscription);
		};
	}

	presentations(): readonly PresentationRecord<Presentation>[] {
		const records: PresentationRecord<Presentation>[] = [];
		for (const entry of this.#entries.values()) {
			const activation = entry.activation;
			if (activation?.phase !== 'active') {
				continue;
			}
			for (const record of this.#presentations.get(activation)?.values() ?? []) {
				records.push(
					Object.freeze({
						...record,
						visible: record.project === null || record.project === this.#projects.selected(),
					}),
				);
			}
		}
		return Object.freeze(records);
	}

	subscribePresentations(
		listener: (snapshot: readonly PresentationRecord<Presentation>[]) => void,
	): Dispose {
		if (this.#disposed) {
			throw new Error('Component host is disposed');
		}
		if (typeof listener !== 'function') {
			throw new TypeError('Presentation listener must be a function');
		}
		const subscription = (snapshot: readonly PresentationRecord<Presentation>[]) =>
			listener(snapshot);
		this.#presentationListeners.add(subscription);
		this.#pendingPresentationListeners.add(subscription);
		if (!this.#busy) {
			this.#drainPresentations();
		}
		return () => {
			this.#presentationListeners.delete(subscription);
			this.#pendingPresentationListeners.delete(subscription);
		};
	}

	activate(slotId: string): Snapshot {
		return this.#mutate(() => {
			const target = this.#entry(slotId);
			try {
				const plan = activationPlan(this.#entries, slotId);
				for (const id of plan) {
					this.#assertOpening(this.#entry(id));
				}
				for (const id of plan) {
					const entry = this.#entry(id);
					if (entry.status !== 'active') {
						for (const dependency of entry.descriptor.dependencies) {
							if (
								dependency.binding !== 'selected-project' &&
								!dependency.optional &&
								!published(this.#entry(dependency.providerSlot), dependency)
							) {
								throw new Error('Required provider has not published its commands');
							}
						}
						this.#start(entry);
					}
				}
			} catch (error) {
				if (target.status !== 'active') {
					target.status = 'failed';
					target.errors.push('activation-or-dependency-failed');
				}
				throw error;
			}
			return this.get(slotId)!;
		});
	}

	planDeactivation(slotId: string): readonly string[] {
		this.#entry(slotId);
		return removalPlan(this.#entries, slotId);
	}
	deactivate(slotId: string, options: { readonly cascade?: boolean } = {}): readonly Snapshot[] {
		return this.#mutate(() => {
			const plan = this.planDeactivation(slotId);
			if (plan.length > 1 && options.cascade !== true) {
				throw new Error(
					'Required consumers would stop; explicit cascade: true consent is required',
				);
			}
			this.#stop(plan);
			return Object.freeze(plan.map((id) => this.get(id)!));
		});
	}
	unregister(slotId: string, options: { readonly cascade?: boolean } = {}): void {
		this.#mutate(() => {
			const plan = this.planDeactivation(slotId);
			if (plan.length > 1 && options.cascade !== true) {
				throw new Error(
					'Required consumers would stop; explicit cascade: true consent is required',
				);
			}
			this.#stop(plan);
			this.#entries.delete(slotId);
		});
	}
	dispose(): void {
		if (this.#busy || this.#callbacks > 0 || this.#cleanupCallbacks > 0) {
			this.#assertIdle();
		}
		if (this.#disposed) {
			return;
		}
		this.#mutate(() => {
			const plan = new Set<string>();
			for (const id of [...this.#entries.keys()].sort()) {
				for (const member of removalPlan(this.#entries, id)) {
					plan.add(member);
				}
			}
			this.#disposed = true;
			this.#stop([...plan]);
			for (const project of this.#projects.list()) {
				this.#projects.close(project, () => undefined);
			}
			this.#dispatcher.dispose();
			this.#listeners.clear();
		});
	}

	#entry(id: string): Entry<Presentation> {
		const entry = this.#entries.get(id);
		if (!entry) {
			throw new Error('Component slot is not registered');
		}
		return entry;
	}
	#assertIdle(ownedRegistration = false): void {
		if (this.#busy || this.#callbacks > 0 || (!ownedRegistration && this.#cleanupCallbacks > 0)) {
			throw new Error('Component host is busy; defer lifecycle changes until callbacks return');
		}
		if (this.#disposed) {
			throw new Error('Component host is disposed');
		}
	}
	#mutate<T>(callback: () => T, ownedRegistration = false): T {
		this.#assertIdle(ownedRegistration);
		this.#busy = true;
		try {
			return callback();
		} finally {
			try {
				for (const listener of [...this.#listeners]) {
					if (this.#listeners.has(listener)) {
						this.#deliver(() => listener(this.list()));
					}
				}
				for (const listener of this.#presentationListeners) {
					this.#pendingPresentationListeners.add(listener);
				}
				this.#drainPresentations();
				if (this.#disposed) {
					this.#presentationListeners.clear();
				}
			} finally {
				this.#busy = false;
			}
		}
	}
	#drainPresentations(): void {
		if (this.#deliveringPresentations) {
			return;
		}
		this.#deliveringPresentations = true;
		try {
			const snapshot = this.presentations();
			// Nested initial subscriptions join the same queue, never the callback stack.
			for (const listener of this.#pendingPresentationListeners) {
				this.#pendingPresentationListeners.delete(listener);
				if (this.#presentationListeners.has(listener)) {
					this.#deliver(() => listener(snapshot));
				}
			}
		} finally {
			this.#pendingPresentationListeners.clear();
			this.#deliveringPresentations = false;
		}
	}

	#callback<T>(callback: () => T): T {
		this.#callbacks++;
		try {
			return callback();
		} finally {
			this.#callbacks--;
		}
	}
	#deliver(callback: () => void): void {
		try {
			const result = this.#callback(callback);
			void Promise.resolve(result).catch(() => undefined);
		} catch {
			// Observers do not control lifecycle outcomes or sibling delivery.
		}
	}
	#bindingsChanged(): void {
		this.#apis.changed();
		for (const entry of this.#entries.values()) {
			const activation = entry.activation;
			if (activation && activation.phase !== 'stopped') {
				for (const listener of [...activation.listeners]) {
					if (activation.listeners.has(listener)) {
						this.#deliver(listener);
					}
				}
			}
		}
	}

	#invoker(entry: Entry, activation: Activation, scope?: ConnectionScope): CommandInvoker {
		const invoker = this.#dispatcher.createInvoker({
			instanceId: activation.id,
			signal: scope?.signal ?? activation.controller.signal,
			isLive: () => activation.phase !== 'stopped' && (scope?.isLive() ?? true),
			declarations: entry.descriptor.dependencies.flatMap((dependency) =>
				dependency.commands.map((command) => ({
					dependencyAlias: dependency.alias,
					commandAlias: command.alias,
					commandId: command.id,
					invalidRoute: !routed(dependency, scope?.openingId),
					contractId: command.contractId,
					major: command.major,
					resolve: () => {
						const provider = resolveProvider(this.#entries, entry, dependency, scope?.openingId);
						if (
							activation.phase === 'stopped' ||
							!provider ||
							!compatible(provider, dependency) ||
							provider.activation?.phase !== 'active'
						) {
							return undefined;
						}
						return provider.activation?.publications.get(command.id)?.binding;
					},
				})),
			),
			subscribeBindings: (listener) => {
				activation.listeners.add(listener);
				return () => {
					activation.listeners.delete(listener);
				};
			},
		});
		return Object.freeze({
			isAvailable: invoker.isAvailable.bind(invoker),
			execute: invoker.execute.bind(invoker),
			subscribeAvailability: (dependency, command, contract, listener) =>
				this.#callback(() =>
					invoker.subscribeAvailability(dependency, command, contract, (available) =>
						this.#callback(() => listener(available)),
					),
				),
		} satisfies CommandInvoker);
	}

	#tasks(
		activation: Activation,
		onError: () => void,
		owned: (dispose: Dispose) => Dispose,
	): TaskService {
		const service = createTaskService({
			queue: this.#workQueue,
			ownerId: activation.id,
			signal: activation.controller.signal,
			onError,
		});
		owned(() => service.dispose());
		const assertLive = () => {
			if (activation.phase === 'stopped') {
				throw new Error('Task service has been disposed');
			}
		};
		return Object.freeze({
			forEach: (options) => {
				assertLive();
				return service.forEach(options);
			},
			cooperative: (options) => {
				assertLive();
				return service.cooperative(options);
			},
			async: (options) => {
				assertLive();
				return service.async(options);
			},
			worker: <I, O>(options: WorkerTaskOptions<I, O>) => {
				assertLive();
				return service.worker<I, O>({
					...options,
					apply: (value, context) => {
						// The whole stop plan is revoked before its signals are aborted in sequence.
						if (activation.phase === 'stopped') {
							service.dispose();
							return;
						}
						options.apply?.(value, context);
					},
				});
			},
			dispose: () => service.dispose(),
		} satisfies TaskService);
	}

	#start(entry: Entry<Presentation>): void {
		nextInstance++;
		const id = `command-component-activation-${nextInstance}`;
		const activation: Activation = {
			id,
			identity: Object.freeze({ ...entry.descriptor.identity, activationId: id }),
			apis: new Map(),
			controller: new AbortController(),
			cleanups: new Set(),
			publications: new Map(),
			seen: new Set(),
			presentationIds: new Set(),
			listeners: new Set(),
			phase: 'setup',
			invalid: false,
		};
		entry.activation = activation;
		const errors: string[] = [];
		entry.errors = errors;
		const owned = (dispose: Dispose) =>
			own(
				activation,
				() => {
					this.#cleanupCallbacks++;
					try {
						return dispose();
					} finally {
						this.#cleanupCallbacks--;
					}
				},
				() => {
					errors.push('cleanup-failed');
				},
			);
		try {
			const tasks = this.#tasks(activation, () => errors.push('task-failed'), owned);
			const locale = createActivationLocale({
				source: this.#locale,
				isLive: () => activation.phase !== 'stopped',
				signal: activation.controller.signal,
				own: owned,
				callback: <T>(callback: () => T) => this.#callback(callback),
				onError: () => {
					errors.push('locale-listener-failed');
				},
			});
			const project =
				entry.descriptor.identity.projectOpeningId === null
					? null
					: this.#projects.reference(entry.descriptor.identity.projectOpeningId)!;
			const projectContext =
				project === null
					? { project: null, projects: this.#connections.context(entry, activation, owned) }
					: { project, projects: null };
			const context: CommandContext<Presentation> = Object.freeze({
				...projectContext,
				identity: activation.identity,
				apis: this.#apis.context(entry, activation),
				signal: activation.controller.signal,
				own: owned,
				tasks,
				locale,
				commands: this.#invoker(entry, activation),
				contributions: Object.freeze({
					toolbar: (contribution: ToolbarContribution<Presentation>) =>
						this.#publishPresentation(entry, activation, project, 'toolbar', contribution),
					view: (contribution: ViewContribution<Presentation>) =>
						this.#publishPresentation(entry, activation, project, 'view', contribution),
					command: <AI, AO, RI, RO>(registration: CommandRegistration<AI, AO, RI, RO>) =>
						this.#publish(
							entry,
							activation,
							registration as CommandRegistration<unknown, unknown, unknown, unknown>,
						),
				}),
			});
			const result = entry.descriptor.activate(context);
			synchronous(result);
			if (typeof result === 'function') {
				context.own(result);
			} else if (result !== undefined) {
				throw new Error('Activation must return a disposer or undefined');
			}
			if (
				activation.invalid ||
				(entry.descriptor.provides ?? []).some((api) => !activation.apis.has(apiKey(api))) ||
				entry.descriptor.commands.some((command) => !activation.publications.has(command.id))
			) {
				throw new Error('Invalid or missing API or command publication');
			}
			activation.phase = 'active';
			entry.status = 'active';
			this.#bindingsChanged();
		} catch (error) {
			this.#revoke(entry);
			this.#abort(activation);
			this.#apis.drain();
			this.#cleanup(entry, activation);
			entry.status = 'failed';
			entry.errors.push('activation-failed');
			this.#bindingsChanged();
			throw error;
		}
	}

	#publishPresentation(
		entry: Entry<Presentation>,
		activation: Activation,
		project: ProjectReference | null,
		kind: 'toolbar' | 'view',
		input: ToolbarContribution<Presentation> | ViewContribution<Presentation>,
	): Dispose {
		try {
			if (activation.phase !== 'setup' || this.#callbacks > 0) {
				throw new Error('UI publication is only allowed during synchronous activation');
			}
			if (!entry.descriptor.capabilities.includes(`contributions.${kind}`)) {
				throw new Error('UI contribution capability required');
			}
			const id = input.id;
			text(id, 'Contribution ID');
			const key = JSON.stringify([kind, id]);
			let records = this.#presentations.get(activation);
			if (!records) {
				records = new Map();
				this.#presentations.set(activation, records);
			}
			// Keep consumed IDs after early disposal, just as for command publications.
			if (activation.presentationIds.has(key)) {
				throw new Error('Duplicate UI publication');
			}
			// Reserve before reading more author getters. Reentrant attempts must not overwrite it.
			activation.presentationIds.add(key);
			const name = input.name;
			if (typeof name !== 'string' || name.trim().length === 0) {
				throw new Error('Contribution name must be nonempty');
			}
			let captured;
			if (kind === 'toolbar') {
				const toolbar = input as ToolbarContribution<Presentation>;
				const orientation = (value: ToolbarContribution<Presentation>['horizontal']) => {
					if (!value || !('presentation' in value)) {
						throw new Error('Toolbar orientation requires presentation and size 1, 2 or 3');
					}
					const size = value.size;
					const presentation = value.presentation;
					if (![1, 2, 3].includes(size)) {
						throw new Error('Toolbar orientation requires presentation and size 1, 2 or 3');
					}
					return Object.freeze({ presentation, size });
				};
				captured = {
					kind,
					contribution: Object.freeze({
						id,
						name,
						horizontal: orientation(toolbar.horizontal),
						vertical: orientation(toolbar.vertical),
					}),
				};
			} else {
				if (!('presentation' in input)) {
					throw new Error('View presentation required');
				}
				captured = {
					kind,
					contribution: Object.freeze({
						id,
						name,
						presentation: input.presentation,
					}),
				};
			}
			if (activation.invalid) {
				throw new Error('Invalid UI publication during setup');
			}
			const record: PresentationRecord<Presentation> = Object.freeze({
				...captured,
				id: JSON.stringify([activation.id, kind, id]),
				placementId: JSON.stringify([
					activation.identity.packageId,
					activation.identity.componentId,
					kind,
					id,
					project?.id ?? null,
				]),
				identity: activation.identity,
				project,
				visible: project === null || project === this.#projects.selected(),
			});
			records.set(key, record);
			let live = true;
			return () => {
				if (!live || activation.phase === 'stopped') {
					return;
				}
				const remove = () => {
					live = false;
					records.delete(key);
				};
				if (activation.phase === 'setup') {
					if (this.#callbacks > 0) {
						this.#assertIdle();
					}
					remove();
				} else {
					this.#mutate(remove, true);
				}
			};
		} catch (error) {
			activation.invalid = true;
			throw error;
		}
	}

	#publish(
		entry: Entry,
		activation: Activation,
		input: CommandRegistration<unknown, unknown, unknown, unknown>,
	): Dispose {
		try {
			if (activation.phase !== 'setup') {
				throw new Error('Command publication is only allowed during synchronous activation');
			}
			if (!entry.descriptor.capabilities.includes('contributions.command')) {
				throw new Error('Command contribution capability required');
			}
			text(input.id, 'Command ID');
			if (typeof input.name !== 'string' || input.name.trim().length === 0) {
				throw new Error('Command name must be nonempty');
			}
			text(input.contract.id, 'Contract ID');
			const declaration = entry.descriptor.commands.find((command) => command.id === input.id);
			if (
				!declaration ||
				declaration.contractId !== input.contract.id ||
				declaration.major !== input.contract.major
			) {
				throw new Error('Undeclared command or mismatched contract');
			}
			if (activation.seen.has(input.id)) {
				throw new Error('Duplicate command publication');
			}
			if (typeof input.execute !== 'function') {
				throw new Error('Command implementation required');
			}
			const registration = Object.freeze({
				id: input.id,
				name: input.name,
				contract: Object.freeze({ ...input.contract }),
				execute: input.execute,
			});
			const controller = new AbortController();
			const publication = {
				controller,
				binding: Object.freeze({
					instanceId: activation.id,
					signal: activation.controller.signal,
					registrationSignal: controller.signal,
					registration,
				}),
			};
			activation.seen.add(input.id);
			activation.publications.set(input.id, publication);
			return () => {
				if (controller.signal.aborted) {
					return;
				}
				const remove = () => {
					activation.publications.delete(registration.id);
					// Author-owned loss is not a user disable request. Required consumers cannot continue.
					const affected = new Set<string>();
					for (const [id, consumer] of this.#entries) {
						if (
							consumer.status === 'active' &&
							consumer.descriptor.dependencies.some(
								(dependency) =>
									dependency.binding !== 'selected-project' &&
									!dependency.optional &&
									dependency.providerSlot === entry.descriptor.slotId &&
									dependency.commands.some((command) => command.id === registration.id),
							)
						) {
							for (const member of removalPlan(this.#entries, id)) {
								affected.add(member);
							}
						}
					}
					entry.errors.push('command-publication-lost');
					this.#stop([...affected], () => controller.abort());
				};
				if (activation.phase === 'setup') {
					if (this.#callbacks > 0) {
						this.#assertIdle();
					}
					activation.publications.delete(registration.id);
					controller.abort();
					activation.invalid = true;
				} else {
					this.#mutate(remove, true);
				}
			};
		} catch (error) {
			activation.invalid = true;
			throw error;
		}
	}

	#revoke(entry: Entry): void {
		const activation = entry.activation;
		if (!activation || activation.phase === 'stopped') {
			return;
		}
		activation.phase = 'stopped';
		this.#presentations.get(activation)?.clear();
		this.#presentations.delete(activation);
		entry.status = 'disabled';
		this.#apis.revoke(activation);
		this.#connections.revokeOwner(activation);
		activation.listeners.clear();
	}
	#abort(activation: Activation): void {
		this.#connections.drain();
		activation.controller.abort();
		for (const publication of activation.publications.values()) {
			publication.controller.abort();
		}
		activation.publications.clear();
		activation.apis.clear();
	}
	#cleanup(entry: Entry, activation: Activation): void {
		for (const release of [...activation.cleanups].reverse()) {
			release();
		}
		if (entry.activation === activation) {
			entry.activation = undefined;
		}
	}
	#stop(plan: readonly string[], revokePublication: Dispose = () => undefined): void {
		const activations = plan.map((id) => ({
			entry: this.#entry(id),
			activation: this.#entry(id).activation,
		}));
		// Revoke the complete plan before running any author cleanup.
		for (const { entry } of activations) {
			this.#revoke(entry);
		}
		this.#connections.drain();
		for (const { activation } of activations) {
			if (activation) {
				this.#abort(activation);
			}
		}
		revokePublication();
		this.#apis.drain();
		this.#bindingsChanged();
		for (const { entry, activation } of activations) {
			if (activation) {
				this.#cleanup(entry, activation);
			}
		}
	}
}
