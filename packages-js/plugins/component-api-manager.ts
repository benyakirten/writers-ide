import type { ComponentApis, ComponentApiConnection } from './frontend';
import type { Dispose, PluginApi, PluginApiIdentity } from './index';
import { apiIdentity, apiKey } from './component-api-declarations';
import { compatible, synchronous, type Activation, type Entry } from './command-component-model';
import { resolveProvider, type ConnectionScope } from './component-project-routing';
import { createProviderFacade } from './provider-facade';

type Connection = {
	consumer: Activation;
	scope: ConnectionScope;
	provider: Activation;
	key: string;
	live: boolean;
	controller: AbortController;
	cleanups: Set<Dispose>;
	facade?: object;
};
type Subscription = {
	entry: Entry;
	consumer: Activation;
	scope: ConnectionScope;
	alias: string;
	contract: PluginApiIdentity;
	listener: (api: object | null) => void;
	last?: Activation | null;
};

/** Internal API bindings with activation-owned direct caches and independent lease caches. */
export class ComponentApiManager {
	readonly #direct = new WeakMap<Activation, ConnectionScope>();
	#nextScope = 0;
	readonly #connections = new Set<Connection>();
	readonly #subscriptions = new Set<Subscription>();
	readonly #pending = new Set<Subscription>();
	readonly #failedNotifications = new Set<string>();
	readonly #entries: ReadonlyMap<string, Entry>;
	readonly #callback: <T>(callback: () => T) => T;
	#notifying = false;

	constructor(entries: ReadonlyMap<string, Entry>, callback: <T>(callback: () => T) => T) {
		this.#entries = entries;
		this.#callback = callback;
	}

	scope(
		activation: Activation,
		openingId?: string,
		signal = activation.controller.signal,
		isLive = () => activation.phase !== 'stopped',
	): ConnectionScope {
		this.#nextScope++;
		return { id: this.#nextScope, openingId, signal, isLive };
	}
	context(entry: Entry, activation: Activation, scope?: ConnectionScope): ComponentApis {
		if (!scope) {
			scope = this.#direct.get(activation);
			if (!scope) {
				scope = this.scope(activation);
				this.#direct.set(activation, scope);
			}
		}
		const lifetime = scope;
		return Object.freeze({
			provide: <T extends object>(
				contract: PluginApi<T>,
				factory: (connection: ComponentApiConnection) => T,
			) => {
				try {
					const identity = apiIdentity(contract);
					const key = apiKey(identity);
					if (activation.phase !== 'setup' || entry.activation !== activation) {
						throw new Error('APIs may only be published during synchronous activation');
					}
					if (
						!(entry.descriptor.provides ?? []).some((provided) => apiKey(provided) === key) ||
						activation.apis.has(key) ||
						typeof factory !== 'function'
					) {
						throw new Error('Undeclared or duplicate API publication, or invalid factory');
					}
					activation.apis.set(key, factory);
				} catch (error) {
					activation.invalid = true;
					throw error;
				}
			},
			get: <T extends object>(alias: string, contract: PluginApi<T>): T | null =>
				this.#callback(() => {
					try {
						return this.#get(entry, activation, alias, apiIdentity(contract), lifetime) as T | null;
					} catch (error) {
						this.#report(entry, activation, 'api-resolution-failed');
						throw error;
					}
				}),
			subscribe: <T extends object>(
				alias: string,
				contract: PluginApi<T>,
				listener: (api: T | null) => void,
			): Dispose =>
				this.#callback(() => {
					const identity = apiIdentity(contract);
					this.#target(entry, activation, alias, identity, lifetime);
					if (typeof listener !== 'function') {
						throw new Error('API subscription listener required');
					}
					const subscription: Subscription = {
						entry,
						consumer: activation,
						scope: lifetime,
						alias,
						contract: identity,
						listener: (api) => listener(api as T | null),
					};
					this.#subscriptions.add(subscription);
					this.#enqueue(subscription);
					return () => this.#remove(subscription);
				}),
		});
	}

	#report(entry: Entry, activation: Activation, code: string): void {
		// Never attribute an old context's failures to its replacement.
		if (entry.activation === activation) {
			entry.errors.push(code);
		}
	}
	#target(
		entry: Entry,
		consumer: Activation,
		alias: string,
		contract: PluginApiIdentity,
		scope: ConnectionScope,
	): Activation | null {
		if (entry.activation !== consumer || consumer.phase === 'stopped' || !scope.isLive()) {
			throw new Error('Component API consumer is revoked');
		}
		const dependency = entry.descriptor.dependencies.find((value) => value.alias === alias);
		if (!dependency || !(dependency.apis ?? []).some((api) => apiKey(api) === apiKey(contract))) {
			throw new Error('Undeclared API dependency alias or contract');
		}
		const provider = resolveProvider(this.#entries, entry, dependency, scope.openingId);
		if (
			provider &&
			compatible(provider, dependency) &&
			provider.activation?.phase === 'active' &&
			provider.activation.apis.has(apiKey(contract))
		) {
			return provider.activation;
		}
		if (dependency.optional) {
			return null;
		}
		throw new Error('Required API provider is missing, incompatible or inactive');
	}
	#get(
		entry: Entry,
		consumer: Activation,
		alias: string,
		contract: PluginApiIdentity,
		scope: ConnectionScope,
	): object | null {
		const provider = this.#target(entry, consumer, alias, contract, scope);
		if (!provider) {
			return null;
		}
		const key = apiKey(contract);
		const existing = this.#find(consumer, provider, key, scope);
		if (existing) {
			if (!existing.facade) {
				throw new Error('Reentrant API factory');
			}
			return existing.facade;
		}
		return this.#connect(entry, consumer, provider, key, scope);
	}
	#find(
		consumer: Activation,
		provider: Activation,
		key: string,
		scope: ConnectionScope,
	): Connection | undefined {
		return [...this.#connections].find(
			(connection) =>
				connection.live &&
				connection.consumer === consumer &&
				connection.scope === scope &&
				connection.provider === provider &&
				connection.key === key,
		);
	}
	#connect(
		entry: Entry,
		consumer: Activation,
		provider: Activation,
		key: string,
		scope: ConnectionScope,
	): object {
		const providerEntry = [...this.#entries.values()].find(
			(value) => value.activation === provider,
		)!;
		const connection: Connection = {
			consumer,
			scope,
			provider,
			key,
			live: true,
			controller: new AbortController(),
			cleanups: new Set(),
		};
		const live = () =>
			connection.live &&
			scope.isLive() &&
			consumer.phase !== 'stopped' &&
			provider.phase === 'active';
		this.#connections.add(connection);
		const metadata: ComponentApiConnection = Object.freeze({
			consumerId: consumer.id,
			consumer: consumer.identity,
			provider: provider.identity,
			signal: connection.controller.signal,
			own: (dispose: Dispose): Dispose => {
				let owned = true;
				const release = () => {
					if (!owned) {
						return;
					}
					owned = false;
					connection.cleanups.delete(release);
					try {
						this.#callback(() => synchronous(dispose()));
					} catch {
						this.#report(providerEntry, provider, 'api-cleanup-failed');
					}
				};
				if (live()) {
					connection.cleanups.add(release);
				} else {
					release();
				}
				return release;
			},
			guard: <Args extends unknown[], Result>(callback: (...args: Args) => Result) =>
				function (this: unknown, ...args: Args): Result | undefined {
					return live() ? Reflect.apply(callback, this, args) : undefined;
				},
			reportError: (_error: unknown) => {
				if (live()) {
					this.#report(entry, consumer, 'api-provider-reported');
				}
			},
		});
		try {
			const implementation = this.#callback(() => provider.apis.get(key)!(metadata));
			connection.facade = createProviderFacade(
				implementation,
				live,
				'Component API connection revoked',
			);
			if (!live()) {
				throw new Error('Component API connection revoked during factory');
			}
			this.#failedNotifications.delete(this.#notificationKey(scope, provider, key));
			for (const subscription of [...this.#subscriptions]) {
				const dependency = subscription.entry.descriptor.dependencies.find(
					(value) => value.alias === subscription.alias,
				);
				if (
					subscription.consumer === consumer &&
					subscription.scope === scope &&
					apiKey(subscription.contract) === key &&
					dependency &&
					resolveProvider(this.#entries, subscription.entry, dependency, scope.openingId)
						?.activation === provider
				) {
					this.#enqueue(subscription);
				}
			}
			return connection.facade;
		} catch (error) {
			if (this.#notifying) {
				this.#failedNotifications.add(this.#notificationKey(scope, provider, key));
			}
			this.#mark(connection);
			this.#drain(connection);
			this.#report(providerEntry, provider, 'api-factory-failed');
			throw error;
		}
	}

	#remove(subscription: Subscription): void {
		this.#subscriptions.delete(subscription);
		this.#pending.delete(subscription);
	}
	#notificationKey(scope: ConnectionScope, provider: Activation, key: string): string {
		return JSON.stringify([scope.id, provider.id, key]);
	}
	#enqueue(subscription: Subscription): void {
		this.#pending.add(subscription);
		this.#flush();
	}
	#flush(): void {
		if (this.#notifying) {
			return;
		}
		this.#notifying = true;
		try {
			while (this.#pending.size > 0) {
				const next = this.#pending.values().next().value!;
				this.#pending.delete(next);
				this.#callback(() => this.#deliver(next));
			}
		} finally {
			this.#failedNotifications.clear();
			this.#notifying = false;
		}
	}
	#deliver(subscription: Subscription): void {
		const { entry, consumer, alias, contract, scope } = subscription;
		if (!this.#subscriptions.has(subscription) || consumer.phase === 'stopped' || !scope.isLive()) {
			return;
		}
		let resolved = false;
		try {
			const provider = this.#target(entry, consumer, alias, contract, scope);
			if (subscription.last === provider) {
				return;
			}
			if (provider) {
				const constructing = this.#find(consumer, provider, apiKey(contract), scope);
				if (constructing && !constructing.facade) {
					return;
				}
				// A failed factory can queue self-subscriptions. Retry only on a later pass or get.
				if (
					!constructing &&
					this.#failedNotifications.has(this.#notificationKey(scope, provider, apiKey(contract)))
				) {
					return;
				}
			}
			subscription.last = provider;
			const facade = this.#get(entry, consumer, alias, contract, scope);
			resolved = true;
			if (this.#subscriptions.has(subscription)) {
				void Promise.resolve(subscription.listener(facade)).catch(() => {
					this.#report(entry, consumer, 'api-listener-failed');
				});
			}
		} catch {
			this.#report(entry, consumer, resolved ? 'api-listener-failed' : 'api-resolution-failed');
			if (!resolved) {
				subscription.last = undefined;
			}
		}
	}
	changed(): void {
		for (const subscription of this.#subscriptions) {
			this.#pending.add(subscription);
		}
		this.#flush();
	}
	#mark(connection: Connection): void {
		connection.live = false;
	}
	#drain(connection: Connection): void {
		this.#connections.delete(connection);
		this.#callback(() => connection.controller.abort());
		for (const release of [...connection.cleanups].reverse()) {
			release();
		}
	}
	/** Mark all plan endpoints first; abort only after command revocation is complete. */
	revoke(activation: Activation): void {
		for (const subscription of [...this.#subscriptions]) {
			if (subscription.consumer === activation) {
				this.#remove(subscription);
			}
		}
		for (const connection of this.#connections) {
			if (connection.consumer === activation || connection.provider === activation) {
				this.#mark(connection);
			}
		}
	}
	revokeScope(scope: ConnectionScope): void {
		for (const subscription of [...this.#subscriptions]) {
			if (subscription.scope === scope) {
				this.#remove(subscription);
			}
		}
		for (const connection of this.#connections) {
			if (connection.scope === scope) {
				this.#mark(connection);
			}
		}
	}
	drain(): void {
		const revoked = [...this.#connections].filter((connection) => !connection.live);
		// Signals for the entire batch precede connection-owned cleanup too.
		for (const connection of revoked) {
			this.#callback(() => connection.controller.abort());
		}
		for (const connection of revoked) {
			this.#drain(connection);
		}
	}
}
