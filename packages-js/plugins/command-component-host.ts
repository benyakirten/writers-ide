import { createCommandDispatcher } from './command-dispatcher';
import type { CommandInvoker, CommandRegistration } from './commands';
import type { Dispose } from './index';
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

type Snapshot = {
	readonly slotId: string;
	readonly status: Entry['status'];
	readonly instanceId?: string;
	readonly errors: readonly string[];
};
type Options = NonNullable<Parameters<typeof createCommandDispatcher>[0]>;
let nextInstance = 0;

/** Internal trusted-descriptor harness. No loading, scope selection or native authority. */
export class CommandComponentHost {
	readonly #entries = new Map<string, Entry>();
	readonly #dispatcher;
	readonly #listeners = new Set<(snapshot: readonly Snapshot[]) => void>();
	#busy = false;
	#callbacks = 0;
	#cleanupCallbacks = 0;
	#disposed = false;

	constructor(options: Options = {}) {
		// Dispatcher diagnostics also run inside the lifecycle mutation guard.
		this.#dispatcher = createCommandDispatcher({
			...options,
			diagnostics: (data) => this.#callback(() => options.diagnostics?.(data)),
			inspectError: options.inspectError
				? (error, data) => this.#callback(() => options.inspectError?.(error, data))
				: undefined,
		});
	}

	register(descriptor: ComponentDescriptor): Snapshot {
		return this.#mutate(() => {
			const captured = capture(descriptor);
			if (this.#entries.has(captured.slotId)) {
				throw new Error('Component slot already registered');
			}
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

	activate(slotId: string): Snapshot {
		return this.#mutate(() => {
			const target = this.#entry(slotId);
			try {
				const plan = activationPlan(this.#entries, slotId);
				for (const id of plan) {
					const entry = this.#entry(id);
					if (entry.status !== 'active') {
						for (const dependency of entry.descriptor.dependencies) {
							if (
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
			this.#dispatcher.dispose();
			this.#listeners.clear();
		});
	}

	#entry(id: string): Entry {
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
			} finally {
				this.#busy = false;
			}
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

	#invoker(entry: Entry, activation: Activation): CommandInvoker {
		const invoker = this.#dispatcher.createInvoker({
			instanceId: activation.id,
			signal: activation.controller.signal,
			declarations: entry.descriptor.dependencies.flatMap((dependency) =>
				dependency.commands.map((command) => ({
					dependencyAlias: dependency.alias,
					commandAlias: command.alias,
					commandId: command.id,
					contractId: command.contractId,
					major: command.major,
					resolve: () => {
						const provider = this.#entries.get(dependency.providerSlot);
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

	#start(entry: Entry): void {
		nextInstance++;
		const activation: Activation = {
			id: `command-component-activation-${nextInstance}`,
			controller: new AbortController(),
			cleanups: new Set(),
			publications: new Map(),
			seen: new Set(),
			listeners: new Set(),
			phase: 'setup',
			invalid: false,
		};
		entry.activation = activation;
		const errors: string[] = [];
		entry.errors = errors;
		const context: CommandContext = Object.freeze({
			signal: activation.controller.signal,
			own: (dispose: Dispose) =>
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
				),
			commands: this.#invoker(entry, activation),
			contributions: Object.freeze({
				command: <AI, AO, RI, RO>(registration: CommandRegistration<AI, AO, RI, RO>) =>
					this.#publish(
						entry,
						activation,
						registration as CommandRegistration<unknown, unknown, unknown, unknown>,
					),
			}),
		});
		try {
			const result = entry.descriptor.activate(context);
			synchronous(result);
			if (typeof result === 'function') {
				context.own(result);
			} else if (result !== undefined) {
				throw new Error('Activation must return a disposer or undefined');
			}
			if (
				activation.invalid ||
				entry.descriptor.commands.some((command) => !activation.publications.has(command.id))
			) {
				throw new Error('Invalid or missing command publication');
			}
			activation.phase = 'active';
			entry.status = 'active';
			this.#bindingsChanged();
		} catch (error) {
			this.#revoke(entry);
			this.#cleanup(entry, activation);
			entry.status = 'failed';
			entry.errors.push('activation-failed');
			this.#bindingsChanged();
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
		entry.status = 'disabled';
		activation.controller.abort();
		for (const publication of activation.publications.values()) {
			publication.controller.abort();
		}
		activation.publications.clear();
		activation.listeners.clear();
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
		revokePublication();
		this.#bindingsChanged();
		for (const { entry, activation } of activations) {
			if (activation) {
				this.#cleanup(entry, activation);
			}
		}
	}
}
