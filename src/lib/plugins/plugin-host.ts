import type {
	BundledPlugin,
	CommandContribution,
	ContributionKind,
	ContributionRegistry,
	Dispose,
	PluginApi,
	PluginApiConnection,
	PluginApiIdentity,
	PluginApis,
	PluginDependency,
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

interface ApiConnection {
	provider: Activation;
	consumer: Activation;
	key: string;
	live: boolean;
	facade?: object;
	revoke: Dispose;
}

interface ApiSubscription {
	consumer: Activation;
	entryId: string;
	providerId: string;
	contract: PluginApiIdentity;
	last: Activation | null | undefined;
	listener: (api: object | null) => void;
}

interface Activation {
	live: boolean;
	controller: AbortController;
	cleanups: Set<Dispose>;
	contributions: Map<string, Readonly<{ kind: ContributionKind; id: string }>>;
	providers: Map<string, (connection: PluginApiConnection) => object>;
	connections: Set<ApiConnection>;
	consumed: Map<string, ApiConnection>;
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
	#graphBusy = false;
	#notifyingApis = false;
	readonly #apiSubscriptions = new Set<ApiSubscription>();
	readonly #registries: PluginRegistries<Presentation>;
	readonly #workQueue: WorkQueue;

	constructor(options: PluginHostOptions<Presentation>) {
		this.#registries = Object.freeze({ ...options.registries });
		this.#workQueue = options.workQueue ?? new WorkQueue();
	}

	register(plugin: BundledPlugin<Presentation>): PluginInfo {
		this.#assertNotNotifying();
		this.#assertGraphIdle();
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
		if (this.#notifying || this.#notifyingApis) {
			throw new Error('Plugin management is busy notifying subscribers; defer lifecycle changes');
		}
	}

	/** Lifecycle failures are recorded in PluginInfo; invalid IDs/transitions throw. */
	activate(id: string): PluginInfo {
		const entry = this.#entry(id);
		this.#assertIdle(entry);
		this.#assertGraphIdle();
		if (entry.status === 'active') {
			return this.#info(entry);
		}
		this.#graphBusy = true;
		try {
			let order: Entry<Presentation>[];
			try {
				order = this.#activationPlan(entry);
			} catch (error) {
				entry.errors = [];
				entry.status = 'failed';
				this.#error(entry, 'dependency', error);
				return this.#info(entry);
			}
			for (const provider of order) {
				if (provider.status !== 'active') {
					this.#activateOne(provider);
				}
				if (provider.status !== 'active') {
					if (provider !== entry) {
						entry.errors = [];
						entry.status = 'failed';
						this.#error(
							entry,
							'dependency',
							new Error(
								`Required provider ${provider.plugin.manifest.id} failed activation for ${id}`,
							),
						);
					}
					break;
				}
			}
			return this.#info(entry);
		} finally {
			this.#graphBusy = false;
		}
	}

	#activateOne(entry: Entry<Presentation>): void {
		entry.errors = [];
		entry.status = 'activating';
		const activation: Activation = {
			live: true,
			controller: new AbortController(),
			cleanups: new Set(),
			contributions: new Map(),
			providers: new Map(),
			connections: new Set(),
			consumed: new Map(),
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
			for (const contract of entry.plugin.manifest.provides ?? []) {
				if (!activation.providers.has(this.#apiKey(contract))) {
					throw new Error(`Declared API not published: ${contract.id}@${contract.major}`);
				}
			}
			entry.status = 'active';
			this.#notifyApis();
		} catch (error) {
			this.#error(entry, 'activation', error);
			this.#stop(entry, activation);
			entry.status = 'failed';
		}
		this.#notify();
	}

	planDeactivation(id: string): readonly string[] {
		this.#entry(id);
		const result: string[] = [];
		const visited = new Set<string>();
		const visit = (provider: string) => {
			if (visited.has(provider)) {
				return;
			}
			visited.add(provider);
			for (const [consumerId, entry] of this.#entries) {
				if (
					entry.status === 'active' &&
					entry.plugin.manifest.dependencies?.some(
						(dependency) => !dependency.optional && dependency.provider === provider,
					)
				) {
					visit(consumerId);
				}
			}
			result.push(provider);
		};
		visit(id);
		return Object.freeze(result);
	}

	deactivate(id: string, options?: { cascade?: boolean }): PluginInfo {
		const entry = this.#entry(id);
		this.#assertIdle(entry);
		this.#assertGraphIdle();
		const plan = this.planDeactivation(id);
		if (plan.length > 1 && !options?.cascade) {
			throw new Error(
				`Plugin ${id} has active required dependents: ${plan.slice(0, -1).join(', ')}; cascade consent required`,
			);
		}
		if (plan.length === 1) {
			return this.#deactivateOne(entry);
		}
		this.#graphBusy = true;
		try {
			for (const affected of plan) {
				this.#deactivateOne(this.#entry(affected));
			}
			return this.#info(entry);
		} finally {
			this.#graphBusy = false;
		}
	}

	#deactivateOne(entry: Entry<Presentation>): PluginInfo {
		if (!entry.activation) {
			return this.#info(entry);
		}
		entry.status = 'deactivating';
		this.#notify();
		this.#stop(entry, entry.activation);
		entry.status = entry.errors.some(
			(error) =>
				error.phase === 'activation' || error.phase === 'dependency' || error.phase === 'cleanup',
		)
			? 'failed'
			: 'disabled';
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
			apis: this.#apis(entry, activation),
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
		for (const connection of [...activation.connections]) {
			connection.revoke();
		}
		this.#notifyApis();
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
			providers: Object.freeze(
				entry.status === 'active' ? [...(entry.plugin.manifest.provides ?? [])] : [],
			),
			dependencies: Object.freeze(
				(entry.plugin.manifest.dependencies ?? []).map((dependency) =>
					Object.freeze({
						...dependency,
						optional: dependency.optional ?? false,
						status: this.#dependencyStatus(dependency),
					}),
				),
			),
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
		const provides =
			manifest.provides === undefined ? undefined : this.#validateProvides(manifest.provides);
		const dependencies =
			manifest.dependencies === undefined
				? undefined
				: this.#validateDependencies(manifest.id, manifest.dependencies);
		return Object.freeze({
			...(provides === undefined ? {} : { provides }),
			...(dependencies === undefined ? {} : { dependencies }),
			id: manifest.id,
			name: manifest.name,
			description: manifest.description,
			version: manifest.version,
			apiVersion: manifest.apiVersion,
			capabilities: Object.freeze([...declared]),
		});
	}

	#assertGraphIdle(): void {
		if (this.#graphBusy) {
			throw new Error('Plugin dependency graph is busy; defer lifecycle changes');
		}
	}

	#apiKey(contract: PluginApiIdentity): string {
		return JSON.stringify([contract.id, contract.major]);
	}

	#validateIdentity(contract: PluginApiIdentity): void {
		this.#nonempty(contract.id, 'Plugin API ID');
		if (!Number.isSafeInteger(contract.major) || contract.major <= 0) {
			throw new Error('Plugin API major must be a positive safe integer');
		}
	}

	#validateProvides(provides: readonly PluginApiIdentity[]): readonly PluginApiIdentity[] {
		if (!Array.isArray(provides)) {
			throw new Error('Plugin provides must be an array');
		}
		const seen = new Set<string>();
		return Object.freeze(
			provides.map((contract) => {
				this.#validateIdentity(contract);
				const key = this.#apiKey(contract);
				if (seen.has(key)) {
					throw new Error(`Duplicate provided API: ${contract.id}@${contract.major}`);
				}
				seen.add(key);
				return Object.freeze({ id: contract.id, major: contract.major });
			}),
		);
	}

	#validateDependencies(
		id: string,
		dependencies: readonly PluginDependency[],
	): readonly PluginDependency[] {
		if (!Array.isArray(dependencies)) {
			throw new Error('Plugin dependencies must be an array');
		}
		const seen = new Set<string>();
		return Object.freeze(
			dependencies.map((dependency) => {
				this.#nonempty(dependency.provider, 'Dependency provider');
				this.#validateIdentity({ id: dependency.api, major: dependency.major });
				const key = JSON.stringify([dependency.provider, dependency.api, dependency.major]);
				if (dependency.provider === id || seen.has(key)) {
					throw new Error(`Self or duplicate dependency: ${dependency.provider}/${dependency.api}`);
				}
				if (dependency.optional !== undefined && typeof dependency.optional !== 'boolean') {
					throw new Error('Dependency optional must be a boolean');
				}
				seen.add(key);
				return Object.freeze({
					provider: dependency.provider,
					api: dependency.api,
					major: dependency.major,
					optional: dependency.optional ?? false,
				});
			}),
		);
	}

	#dependencyStatus(dependency: PluginDependency): PluginInfo['dependencies'][number]['status'] {
		const provider = this.#entries.get(dependency.provider);
		if (!provider) {
			return 'missing';
		}
		if (
			!provider.plugin.manifest.provides?.some(
				(contract) => contract.id === dependency.api && contract.major === dependency.major,
			)
		) {
			return 'incompatible';
		}
		return provider.status === 'active' && provider.activation?.live ? 'available' : 'inactive';
	}

	#activationPlan(target: Entry<Presentation>): Entry<Presentation>[] {
		const result: Entry<Presentation>[] = [];
		const visited = new Set<string>();
		const path: string[] = [];
		const visit = (entry: Entry<Presentation>) => {
			const id = entry.plugin.manifest.id;
			if (path.includes(id)) {
				throw new Error(
					`Required dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`,
				);
			}
			if (visited.has(id)) {
				return;
			}
			if (entry.status === 'activating' || entry.status === 'deactivating') {
				throw new Error(`Required provider lifecycle is busy: ${id}`);
			}
			path.push(id);
			for (const dependency of entry.plugin.manifest.dependencies ?? []) {
				if (dependency.optional) {
					continue;
				}
				const status = this.#dependencyStatus(dependency);
				if (status === 'missing' || status === 'incompatible') {
					throw new Error(
						`Required dependency ${id} -> ${dependency.provider}/${dependency.api}@${dependency.major} is ${status}`,
					);
				}
				visit(this.#entry(dependency.provider));
			}
			path.pop();
			visited.add(id);
			result.push(entry);
		};
		visit(target);
		return result;
	}

	#assertApiAccess(
		entry: Entry<Presentation>,
		activation: Activation,
		providerId: string,
		contract: PluginApiIdentity,
	): void {
		if (!activation.live) {
			throw new Error(`Plugin context revoked: ${entry.plugin.manifest.id}`);
		}
		this.#validateIdentity(contract);
		if (
			!entry.plugin.manifest.dependencies?.some(
				(dependency) =>
					dependency.provider === providerId &&
					dependency.api === contract.id &&
					dependency.major === contract.major,
			)
		) {
			throw new Error(`Undeclared dependency: ${providerId}/${contract.id}@${contract.major}`);
		}
	}

	#apis(entry: Entry<Presentation>, activation: Activation): PluginApis {
		return Object.freeze({
			provide: <T extends object>(
				contract: PluginApi<T>,
				factory: (connection: PluginApiConnection) => T,
			) => {
				this.#validateIdentity(contract);
				if (!activation.live || entry.status !== 'activating') {
					throw new Error('APIs may only be published during activation');
				}
				const key = this.#apiKey(contract);
				if (!entry.plugin.manifest.provides?.some((declared) => this.#apiKey(declared) === key)) {
					throw new Error(`Undeclared provided API: ${contract.id}@${contract.major}`);
				}
				if (activation.providers.has(key) || typeof factory !== 'function') {
					throw new Error(`Duplicate API or invalid factory: ${contract.id}`);
				}
				activation.providers.set(key, factory);
			},
			get: <T extends object>(providerId: string, contract: PluginApi<T>): T | null => {
				this.#assertApiAccess(entry, activation, providerId, contract);
				return this.#getApi(entry, activation, providerId, contract) as T | null;
			},
			subscribe: <T extends object>(
				providerId: string,
				contract: PluginApi<T>,
				listener: (api: T | null) => void,
			): Dispose => {
				this.#assertApiAccess(entry, activation, providerId, contract);
				const subscription: ApiSubscription = {
					consumer: activation,
					entryId: entry.plugin.manifest.id,
					providerId,
					contract: Object.freeze({ id: contract.id, major: contract.major }),
					last: undefined,
					listener: (api) => listener(api as T | null),
				};
				this.#apiSubscriptions.add(subscription);
				const release = this.#own(entry, activation, () => {
					this.#apiSubscriptions.delete(subscription);
				});
				this.#deliverApi(subscription);
				return release;
			},
		});
	}

	#getApi(
		consumerEntry: Entry<Presentation>,
		consumer: Activation,
		providerId: string,
		contract: PluginApiIdentity,
	): object | null {
		const providerEntry = this.#entries.get(providerId);
		const provider = providerEntry?.activation;
		const factory = provider?.providers.get(this.#apiKey(contract));
		if (!providerEntry || providerEntry.status !== 'active' || !provider?.live || !factory) {
			return null;
		}
		const key = JSON.stringify([providerId, contract.id, contract.major]);
		const existing = consumer.consumed.get(key);
		if (existing) {
			if (!existing.facade) {
				throw new Error(`Reentrant API factory: ${providerId}/${contract.id}`);
			}
			return existing.facade;
		}
		const controller = new AbortController();
		const cleanups = new Set<Dispose>();
		const connection: ApiConnection = {
			provider,
			consumer,
			key,
			live: true,
			revoke: () => {
				if (!connection.live) {
					return;
				}
				connection.live = false;
				consumer.consumed.delete(key);
				consumer.connections.delete(connection);
				provider.connections.delete(connection);
				controller.abort();
				for (const dispose of [...cleanups].reverse()) {
					dispose();
				}
			},
		};
		consumer.consumed.set(key, connection);
		consumer.connections.add(connection);
		provider.connections.add(connection);
		const live = () => connection.live && consumer.live && provider.live;
		const own = (dispose: Dispose): Dispose => {
			let owned = true;
			const release = () => {
				if (!owned) {
					return;
				}
				owned = false;
				cleanups.delete(release);
				try {
					dispose();
				} catch (error) {
					this.#error(providerEntry, 'provider', error);
				}
			};
			if (live()) {
				cleanups.add(release);
			} else {
				release();
			}
			return release;
		};
		try {
			const implementation = factory(
				Object.freeze({
					consumerId: consumerEntry.plugin.manifest.id,
					signal: controller.signal,
					own,
					guard: <Args extends unknown[], Result>(callback: (...args: Args) => Result) => {
						return function (this: unknown, ...args: Args): Result | undefined {
							if (live()) {
								return Reflect.apply(callback, this, args);
							}
							return undefined;
						};
					},
				}),
			);
			if (!live()) {
				throw new Error(`API connection revoked during factory: ${providerId}/${contract.id}`);
			}
			if (implementation === null || typeof implementation !== 'object') {
				throw new Error('API factory must return a synchronous method-only facade');
			}
			if (implementation instanceof Promise) {
				// Reject async factories without leaving their native promise rejection unhandled.
				void Promise.prototype.then.call(implementation, undefined, () => {});
				throw new Error('API factory must return a synchronous method-only facade');
			}
			const facade: Record<string, unknown> = Object.create(null);
			for (const name of Reflect.ownKeys(implementation)) {
				const descriptor = Object.getOwnPropertyDescriptor(implementation, name);
				if (
					typeof name !== 'string' ||
					name === 'then' ||
					!descriptor ||
					!('value' in descriptor) ||
					typeof descriptor.value !== 'function'
				) {
					throw new Error(
						'API facade must contain only own string-named methods (no accessors, symbols or thenables)',
					);
				}
				const method = descriptor.value;
				facade[name] = (...args: unknown[]) => {
					if (!live()) {
						throw new Error(`Plugin API revoked: ${providerId}/${contract.id}`);
					}
					return Reflect.apply(method, implementation, args);
				};
			}
			// Reject inherited thenables and prototype methods rather than silently exposing a partial API.
			const prototype = Object.getPrototypeOf(implementation);
			if (prototype !== null && prototype !== Object.prototype) {
				throw new Error('API facade must be a plain method-only object');
			}
			if (!live()) {
				throw new Error(`API connection revoked during factory: ${providerId}/${contract.id}`);
			}
			connection.facade = Object.freeze(facade);
			// A factory may subscribe to the connection it is still constructing.
			// Deliver only after the cached facade is ready, including on a later retry.
			for (const subscription of [...this.#apiSubscriptions]) {
				if (
					subscription.consumer === consumer &&
					subscription.providerId === providerId &&
					this.#apiKey(subscription.contract) === this.#apiKey(contract)
				) {
					this.#deliverApi(subscription);
				}
			}
			return connection.facade;
		} catch (error) {
			connection.revoke();
			this.#error(providerEntry, 'provider', error);
			throw error;
		}
	}

	#deliverApi(subscription: ApiSubscription): void {
		if (!subscription.consumer.live || !this.#apiSubscriptions.has(subscription)) {
			return;
		}
		const provider = this.#entries.get(subscription.providerId);
		const available =
			provider?.status === 'active' &&
			provider.activation?.live &&
			provider.activation.providers.has(this.#apiKey(subscription.contract))
				? provider.activation
				: null;
		if (subscription.last === available) {
			return;
		}
		const constructing = subscription.consumer.consumed.get(
			JSON.stringify([
				subscription.providerId,
				subscription.contract.id,
				subscription.contract.major,
			]),
		);
		if (available && constructing && !constructing.facade) {
			return;
		}
		subscription.last = available;
		const notifying = this.#notifyingApis;
		this.#notifyingApis = true;
		const entry = this.#entry(subscription.entryId);
		let resolved = false;
		try {
			const api = available
				? this.#getApi(entry, subscription.consumer, subscription.providerId, subscription.contract)
				: null;
			resolved = true;
			// Factory code can release this subscription while resolving its facade.
			if (subscription.consumer.live && this.#apiSubscriptions.has(subscription)) {
				subscription.listener(api);
			}
		} catch (error) {
			if (!resolved) {
				subscription.last = undefined;
			}
			this.#error(
				entry,
				'provider',
				new Error(
					`API subscription ${subscription.providerId}/${subscription.contract.id}: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
		} finally {
			this.#notifyingApis = notifying;
		}
	}

	#notifyApis(): void {
		for (const subscription of [...this.#apiSubscriptions]) {
			this.#deliverApi(subscription);
		}
	}

	#nonempty(value: string, label: string): void {
		if (typeof value !== 'string' || value.trim().length === 0) {
			throw new Error(`${label} must be a nonempty string`);
		}
	}
}
