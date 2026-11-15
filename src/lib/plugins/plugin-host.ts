import type {
	BundledPlugin,
	CommandContribution,
	ContributionKind,
	ContributionRegistry,
	Dispose,
	PluginCapability,
	PluginContext,
	PluginError,
	PluginInfo,
	PluginManifest,
	PluginManagementService,
	PluginRegistries,
	PluginStatus,
	ToolbarContribution,
	ViewContribution,
} from '@writers-ide/plugins';

import { createTaskService, WorkQueue } from '@writers-ide/tasks';

const capabilities = new Set<PluginCapability>([
	'contributions.toolbar',
	'contributions.view',
	'contributions.command',
]);

interface Activation {
	live: boolean;
	controller: AbortController;
	cleanups: Set<Dispose>;
	contributions: Map<string, Readonly<{ kind: ContributionKind; id: string }>>;
}

interface Entry<Presentation> {
	plugin: BundledPlugin<Presentation>;
	status: PluginStatus;
	errors: PluginError[];
	activation?: Activation;
}

export interface PluginHostOptions<Presentation> {
	readonly registries: PluginRegistries<Presentation>;
	/** Supply the application's shared queue; standalone hosts get an independent queue. */
	readonly workQueue?: WorkQueue;
}

/** Synchronous lifecycle for explicitly supplied, trusted bundled plugins; not a sandbox. */
export class PluginHost<Presentation> implements PluginManagementService {
	readonly #entries = new Map<string, Entry<Presentation>>();
	readonly #contributionIds = new Set<string>();
	readonly #listeners = new Set<(plugins: readonly PluginInfo[]) => void>();
	#notifying = false;
	#notificationPending = false;
	readonly #registries: PluginRegistries<Presentation>;
	readonly #workQueue: WorkQueue;

	constructor(options: PluginHostOptions<Presentation>) {
		this.#registries = Object.freeze({ ...options.registries });
		this.#workQueue = options.workQueue ?? new WorkQueue();
	}

	register(plugin: BundledPlugin<Presentation>): PluginInfo {
		this.#assertNotNotifying();
		const manifest = this.#validateManifest(plugin.manifest);
		if (this.#entries.has(manifest.id)) {
			throw new Error(`Plugin already registered: ${manifest.id}`);
		}
		if (typeof plugin.activate !== 'function') {
			throw new Error(`Plugin ${manifest.id} requires an activation function`);
		}
		const entry: Entry<Presentation> = {
			plugin: Object.freeze({ manifest, activate: plugin.activate }),
			status: 'disabled',
			errors: [],
		};
		this.#entries.set(manifest.id, entry);
		this.#notify();
		return this.#info(entry);
	}

	get(id: string): PluginInfo | undefined {
		const entry = this.#entries.get(id);
		return entry ? this.#info(entry) : undefined;
	}

	list(): readonly PluginInfo[] {
		return Object.freeze([...this.#entries.values()].map((entry) => this.#info(entry)));
	}

	subscribe(listener: (plugins: readonly PluginInfo[]) => void): Dispose {
		// Separate subscriptions remain independent even for the same callback.
		const subscription = (plugins: readonly PluginInfo[]) => listener(plugins);
		this.#listeners.add(subscription);
		const notifying = this.#notifying;
		this.#notifying = true;
		try {
			this.#deliver(subscription, this.list());
		} finally {
			this.#notifying = notifying;
		}
		if (!notifying && this.#notificationPending) {
			this.#notify();
		}
		return () => {
			this.#listeners.delete(subscription);
		};
	}

	#deliver(
		listener: (plugins: readonly PluginInfo[]) => void,
		plugins: readonly PluginInfo[],
	): void {
		try {
			listener(plugins);
		} catch {
			// Observers must not change lifecycle outcomes or interrupt rollback.
		}
	}

	#notify(): void {
		if (this.#listeners.size === 0) {
			return;
		}
		this.#notificationPending = true;
		if (this.#notifying) {
			return;
		}
		this.#notifying = true;
		try {
			while (this.#notificationPending) {
				this.#notificationPending = false;
				const plugins = this.list();
				for (const listener of [...this.#listeners]) {
					if (this.#listeners.has(listener)) {
						this.#deliver(listener, plugins);
					}
				}
			}
		} finally {
			this.#notifying = false;
		}
	}

	#assertNotNotifying(): void {
		if (this.#notifying) {
			throw new Error('Plugin management is busy notifying subscribers; defer lifecycle changes');
		}
	}

	/** Lifecycle failures are recorded in PluginInfo; invalid IDs/transitions throw. */
	activate(id: string): PluginInfo {
		const entry = this.#entry(id);
		this.#assertIdle(entry);
		if (entry.status === 'active') {
			return this.#info(entry);
		}
		entry.errors = [];
		entry.status = 'activating';
		const activation: Activation = {
			live: true,
			controller: new AbortController(),
			cleanups: new Set(),
			contributions: new Map(),
		};
		entry.activation = activation;
		this.#notify();
		try {
			const dispose = entry.plugin.activate(this.#context(entry, activation));
			if (dispose !== undefined) {
				if (typeof dispose !== 'function') {
					throw new Error('Activation must return a synchronous disposer or undefined');
				}
				this.#own(entry, activation, dispose);
			}
			entry.status = 'active';
		} catch (error) {
			this.#error(entry, 'activation', error);
			this.#stop(entry, activation);
			entry.status = 'failed';
		}
		this.#notify();
		return this.#info(entry);
	}

	deactivate(id: string): PluginInfo {
		const entry = this.#entry(id);
		this.#assertIdle(entry);
		if (!entry.activation) {
			return this.#info(entry);
		}
		entry.status = 'deactivating';
		this.#notify();
		this.#stop(entry, entry.activation);
		entry.status = entry.errors.some((error) => error.phase !== 'task') ? 'failed' : 'disabled';
		this.#notify();
		return this.#info(entry);
	}

	#context(entry: Entry<Presentation>, activation: Activation): PluginContext<Presentation> {
		const tasks = createTaskService({
			queue: this.#workQueue,
			ownerId: entry.plugin.manifest.id,
			signal: activation.controller.signal,
			onError: ({ key, label, error }) => {
				if (entry.activation === activation) {
					const message = error instanceof Error ? error.message : String(error);
					this.#error(entry, 'task', new Error(`${label} [${key}]: ${message}`));
				}
			},
		});
		this.#own(entry, activation, () => tasks.dispose());
		const requireCapability = (capability: PluginCapability) => {
			if (!activation.live) {
				throw new Error(`Plugin context revoked: ${entry.plugin.manifest.id}`);
			}
			if (!entry.plugin.manifest.capabilities.includes(capability)) {
				throw new Error(`Plugin ${entry.plugin.manifest.id} lacks capability: ${capability}`);
			}
		};
		return Object.freeze({
			signal: activation.controller.signal,
			tasks,
			own: (dispose: Dispose) => this.#own(entry, activation, dispose),
			contributions: Object.freeze({
				toolbar: (contribution: ToolbarContribution<Presentation>) => {
					requireCapability('contributions.toolbar');
					for (const orientation of ['horizontal', 'vertical'] as const) {
						const section = contribution[orientation];
						if (!section || ![1, 2, 3].includes(section.size)) {
							throw new Error(`Toolbar ${orientation} size must be 1, 2, or 3`);
						}
					}
					return this.#contribute(
						entry,
						activation,
						'toolbar',
						{
							...contribution,
							horizontal: Object.freeze({ ...contribution.horizontal }),
							vertical: Object.freeze({ ...contribution.vertical }),
						},
						this.#registries.toolbar,
					);
				},
				view: (contribution: ViewContribution<Presentation>) => {
					requireCapability('contributions.view');
					return this.#contribute(entry, activation, 'view', contribution, this.#registries.view);
				},
				command: (contribution: CommandContribution) => {
					requireCapability('contributions.command');
					let registered = true;
					const execute = contribution.execute;
					let release: Dispose;
					try {
						release = this.#contribute(
							entry,
							activation,
							'command',
							{ ...contribution, execute: () => activation.live && registered && execute() },
							this.#registries.command,
						);
					} catch (error) {
						registered = false;
						throw error;
					}
					return this.#own(entry, activation, () => {
						registered = false;
						release();
					});
				},
			}),
		});
	}

	#contribute<Contribution extends { readonly id: string; readonly name: string }>(
		entry: Entry<Presentation>,
		activation: Activation,
		kind: ContributionKind,
		contribution: Contribution,
		registry: ContributionRegistry<Contribution>,
	): Dispose {
		this.#nonempty(contribution.id, 'Contribution ID');
		this.#nonempty(contribution.name, 'Contribution name');
		const key = `${kind}:${contribution.id}`;
		if (this.#contributionIds.has(key)) {
			throw new Error(`Duplicate ${kind} contribution: ${contribution.id}`);
		}
		this.#contributionIds.add(key);
		activation.contributions.set(key, Object.freeze({ kind, id: contribution.id }));
		let dispose: Dispose | undefined;
		const release = this.#own(entry, activation, () => {
			this.#contributionIds.delete(key);
			activation.contributions.delete(key);
			try {
				dispose?.();
			} finally {
				this.#notify();
			}
		});
		try {
			dispose = registry.register(entry.plugin.manifest.id, Object.freeze({ ...contribution }));
			if (typeof dispose !== 'function') {
				throw new Error(`Registry for ${kind} must return a disposer`);
			}
			// An adapter may synchronously trigger deactivation before returning its handle.
			if (!activation.live) {
				this.#own(entry, activation, dispose);
			}
		} catch (error) {
			release();
			throw error;
		}
		this.#notify();
		return release;
	}

	#own(entry: Entry<Presentation>, activation: Activation, dispose: Dispose): Dispose {
		let owned = true;
		const release = () => {
			if (!owned) {
				return;
			}
			owned = false;
			activation.cleanups.delete(release);
			try {
				dispose();
			} catch (error) {
				this.#error(entry, 'cleanup', error);
			}
		};
		if (activation.live) {
			activation.cleanups.add(release);
		} else {
			release();
		}
		return release;
	}

	#stop(entry: Entry<Presentation>, activation: Activation): void {
		activation.live = false;
		try {
			activation.controller.abort();
		} catch (error) {
			this.#error(entry, 'cleanup', error);
		}
		for (const dispose of [...activation.cleanups].reverse()) {
			dispose();
		}
		entry.activation = undefined;
	}

	#entry(id: string): Entry<Presentation> {
		const entry = this.#entries.get(id);
		if (!entry) {
			throw new Error(`Unknown plugin: ${id}`);
		}
		return entry;
	}

	#assertIdle(entry: Entry<Presentation>): void {
		this.#assertNotNotifying();
		if (entry.status === 'activating' || entry.status === 'deactivating') {
			throw new Error(`Plugin lifecycle is busy: ${entry.plugin.manifest.id}`);
		}
	}

	#error(entry: Entry<Presentation>, phase: PluginError['phase'], error: unknown): void {
		entry.errors.push(
			Object.freeze({ phase, message: error instanceof Error ? error.message : String(error) }),
		);
		this.#notify();
	}

	#info(entry: Entry<Presentation>): PluginInfo {
		return Object.freeze({
			manifest: entry.plugin.manifest,
			status: entry.status,
			errors: Object.freeze([...entry.errors]),
			contributions: Object.freeze([...(entry.activation?.contributions.values() ?? [])]),
		});
	}

	#validateManifest(manifest: PluginManifest): PluginManifest {
		for (const field of ['id', 'version', 'name', 'description'] as const) {
			this.#nonempty(manifest[field], `Plugin ${field}`);
		}
		if (manifest.apiVersion !== 1) {
			throw new Error(`Unsupported plugin API version: ${manifest.apiVersion}; expected 1`);
		}
		if (!Array.isArray(manifest.capabilities)) {
			throw new Error('Plugin capabilities must be an array');
		}
		const declared = new Set<PluginCapability>();
		for (const capability of manifest.capabilities) {
			if (!capabilities.has(capability) || declared.has(capability)) {
				throw new Error(`Unknown or duplicate capability: ${capability}`);
			}
			declared.add(capability);
		}
		return Object.freeze({
			id: manifest.id,
			name: manifest.name,
			description: manifest.description,
			version: manifest.version,
			apiVersion: manifest.apiVersion,
			capabilities: Object.freeze([...declared]),
		});
	}

	#nonempty(value: string, label: string): void {
		if (typeof value !== 'string' || value.trim().length === 0) {
			throw new Error(`${label} must be a nonempty string`);
		}
	}
}
