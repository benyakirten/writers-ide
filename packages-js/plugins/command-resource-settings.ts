import {
	createCommandReservationLedger,
	type CommandReservationLedger,
	type ReservationLimits,
} from './command-reservations';

// Internal fake-source model only. These objects are not IPC or plugin authority.
export type CommandResourceSettingsState = {
	readonly revision: string;
	readonly settings: ReservationLimits;
};
export type CommandResourceSettingsSnapshot = CommandResourceSettingsState & {
	readonly epoch: string;
};
export type CommandResourceSettingsWriteResult =
	| { readonly kind: 'saved'; readonly snapshot: CommandResourceSettingsState }
	| { readonly kind: 'conflict'; readonly snapshot: CommandResourceSettingsState }
	| { readonly kind: 'outcome-unknown' };

export interface CommandResourceSettingsSource {
	read(): Promise<CommandResourceSettingsState>;
	write(
		expectedRevision: string,
		settings: ReservationLimits,
	): Promise<CommandResourceSettingsWriteResult>;
}
export interface CommandResourceSettingsObserver {
	snapshot(snapshot: CommandResourceSettingsSnapshot, acknowledge: () => void): void;
	closed(): void;
}
export interface CommandResourceSettingsSubscription {
	close(): void;
}
export interface CommandResourceSettingsService {
	readonly epoch: string;
	subscribe(observer: CommandResourceSettingsObserver): CommandResourceSettingsSubscription;
	read(): Promise<CommandResourceSettingsSnapshot>;
}
export interface CommandResourceSettingsCoordinator extends CommandResourceSettingsService {
	write(
		expectedRevision: string,
		settings: ReservationLimits,
	): Promise<CommandResourceSettingsWriteResult>;
	close(): void;
}
export type CommandResourceSettingsClientStatus =
	| 'disconnected'
	| 'connecting'
	| 'ready'
	| 'stale'
	| 'disposed';
export interface CommandResourceSettingsClient {
	readonly ledger: CommandReservationLedger;
	readonly status: CommandResourceSettingsClientStatus;
	attach(service: CommandResourceSettingsService): void;
	disconnect(): void;
	dispose(): void;
}
export type CommandResourceSettingsCoordinatorOptions = {
	readonly maxOperations?: number;
	readonly maxSubscribers?: number;
};

export class CommandResourceSettingsError extends Error {
	constructor(
		readonly code: 'closed' | 'busy' | 'invalid-snapshot' | 'not-ready' | 'settings-owned',
	) {
		super(`Command resource settings: ${code}`);
		this.name = 'CommandResourceSettingsError';
	}
}

const MAX_REVISION = '9223372036854775807';
function revision(value: string): string {
	if (
		typeof value !== 'string' ||
		!/^(0|[1-9][0-9]*)$/.test(value) ||
		value.length > MAX_REVISION.length ||
		(value.length === MAX_REVISION.length && value > MAX_REVISION)
	) {
		throw new CommandResourceSettingsError('invalid-snapshot');
	}
	return value;
}
function compare(a: string, b: string): number {
	return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
}
function captureSettings(settings: ReservationLimits): ReservationLimits {
	const captured = {
		payload: Object.freeze({
			maxBytes: settings.payload.maxBytes,
			maxDepth: settings.payload.maxDepth,
			maxEntries: settings.payload.maxEntries,
		}),
		maxComponentBytes: settings.maxComponentBytes,
		maxWindowBytes: settings.maxWindowBytes,
		maxCallerPending: settings.maxCallerPending,
		maxProviderPending: settings.maxProviderPending,
		maxWindowPending: settings.maxWindowPending,
	};
	for (const value of [
		...Object.values(captured.payload),
		captured.maxComponentBytes,
		captured.maxWindowBytes,
		captured.maxCallerPending,
		captured.maxProviderPending,
		captured.maxWindowPending,
	]) {
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
			throw new CommandResourceSettingsError('invalid-snapshot');
		}
	}
	return Object.freeze(captured);
}
function capture(
	state: CommandResourceSettingsState,
	epoch: string,
): CommandResourceSettingsSnapshot {
	return Object.freeze({
		epoch,
		revision: revision(state.revision),
		settings: captureSettings(state.settings),
	});
}
function equal(a: ReservationLimits, b: ReservationLimits): boolean {
	return (
		a.maxComponentBytes === b.maxComponentBytes &&
		a.maxWindowBytes === b.maxWindowBytes &&
		a.maxCallerPending === b.maxCallerPending &&
		a.maxProviderPending === b.maxProviderPending &&
		a.maxWindowPending === b.maxWindowPending &&
		a.payload.maxBytes === b.payload.maxBytes &&
		a.payload.maxDepth === b.payload.maxDepth &&
		a.payload.maxEntries === b.payload.maxEntries
	);
}
function positive(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError('Settings fixture capacities must be positive safe integers.');
	}
	return value;
}
function isolated(callback: () => void): void {
	try {
		// Also consume rejected promises from callbacks implemented with async functions.
		void Promise.resolve(callback()).catch(() => {});
	} catch {
		// One observer must not prevent another association from closing.
	}
}

type Subscriber = {
	observer: CommandResourceSettingsObserver;
	active: boolean;
	inProgress?: CommandResourceSettingsSnapshot;
	latest?: CommandResourceSettingsSnapshot;
};

export function createCommandResourceSettingsCoordinator(
	source: CommandResourceSettingsSource,
	options: CommandResourceSettingsCoordinatorOptions = {},
): CommandResourceSettingsCoordinator {
	const epoch = globalThis.crypto.randomUUID();
	const maxOperations = positive(options.maxOperations ?? 16);
	const maxSubscribers = positive(options.maxSubscribers ?? 64);
	const subscribers = new Set<Subscriber>();
	const pendingDeliveries = new Set<Subscriber>();
	let deliveryScheduled = false;
	const operations = new Set<(error: Error) => void>();
	let closed = false;
	let current: CommandResourceSettingsSnapshot | undefined;
	let initializing: Promise<CommandResourceSettingsSnapshot> | undefined;

	function requireOpen(): void {
		if (closed) {
			throw new CommandResourceSettingsError('closed');
		}
	}
	function remove(subscriber: Subscriber, notify: boolean): void {
		if (!subscriber.active) {
			return;
		}
		subscriber.active = false;
		subscriber.inProgress = undefined;
		subscriber.latest = undefined;
		subscribers.delete(subscriber);
		pendingDeliveries.delete(subscriber);
		if (notify) {
			isolated(() => subscriber.observer.closed());
		}
	}
	function close(): void {
		if (closed) {
			return;
		}
		closed = true;
		current = undefined;
		for (const reject of operations) {
			reject(new CommandResourceSettingsError('closed'));
		}
		operations.clear();
		for (const subscriber of subscribers) {
			remove(subscriber, true);
		}
	}
	function deliver(subscriber: Subscriber): void {
		if (!subscriber.active || closed || subscriber.inProgress || !subscriber.latest) {
			return;
		}
		const snapshot = subscriber.latest;
		subscriber.latest = undefined;
		subscriber.inProgress = snapshot;
		let acknowledged = false;
		const acknowledge = () => {
			if (!subscriber.active || closed || acknowledged || subscriber.inProgress !== snapshot) {
				return;
			}
			acknowledged = true;
			subscriber.inProgress = undefined;
			schedule(subscriber);
		};
		try {
			void Promise.resolve(subscriber.observer.snapshot(snapshot, acknowledge)).catch(() => {
				remove(subscriber, true);
			});
		} catch {
			remove(subscriber, true);
		}
	}
	function scheduleDelivery(): void {
		if (closed || deliveryScheduled || pendingDeliveries.size === 0) {
			return;
		}
		deliveryScheduled = true;
		queueMicrotask(deliverPending);
	}
	function deliverPending(): void {
		// Keep the scheduled flag set during callbacks. Reentrant churn adds only live
		// subscribers to the removable set, never another closure for each subscription.
		const budget = pendingDeliveries.size;
		for (let index = 0; index < budget; index++) {
			const subscriber = pendingDeliveries.values().next().value;
			if (!subscriber) {
				break;
			}
			pendingDeliveries.delete(subscriber);
			deliver(subscriber);
		}
		deliveryScheduled = false;
		scheduleDelivery();
	}
	function schedule(subscriber: Subscriber): void {
		if (closed || !subscriber.active || subscriber.inProgress || !subscriber.latest) {
			return;
		}
		pendingDeliveries.add(subscriber);
		scheduleDelivery();
	}
	function reconcile(state: CommandResourceSettingsState): CommandResourceSettingsSnapshot {
		requireOpen();
		const snapshot = capture(state, epoch);
		if (current) {
			const order = compare(snapshot.revision, current.revision);
			if (order < 0) {
				return current;
			}
			if (order === 0) {
				if (!equal(snapshot.settings, current.settings)) {
					throw new CommandResourceSettingsError('invalid-snapshot');
				}
				return current;
			}
		}
		current = snapshot;
		for (const subscriber of subscribers) {
			subscriber.latest = snapshot;
			schedule(subscriber);
		}
		return snapshot;
	}
	function admit<T>(work: () => Promise<T>): Promise<T> {
		if (closed) {
			return Promise.reject(new CommandResourceSettingsError('closed'));
		}
		if (operations.size >= maxOperations) {
			return Promise.reject(new CommandResourceSettingsError('busy'));
		}
		const completion = new Promise<T>((resolve, reject) => {
			operations.add(reject);
			// The coordinator owns this continuation even if nobody awaits the returned promise.
			void Promise.resolve()
				.then(() => {
					requireOpen();
					return work();
				})
				.then(
					(value) => {
						operations.delete(reject);
						resolve(value);
					},
					(error: unknown) => {
						operations.delete(reject);
						reject(error);
					},
				);
		});
		// Abandoned admitted operations still have an owner for rejection handling.
		// The original promise retains its result for callers that do await it.
		void completion.catch(() => {});
		return completion;
	}
	async function authoritativeRead(): Promise<CommandResourceSettingsSnapshot> {
		try {
			requireOpen();
			return reconcile(await source.read());
		} catch (error) {
			close();
			throw error;
		}
	}
	function read(): Promise<CommandResourceSettingsSnapshot> {
		return admit(authoritativeRead);
	}
	return Object.freeze({
		epoch,
		read,
		close,
		subscribe(observer: CommandResourceSettingsObserver) {
			requireOpen();
			if (
				subscribers.size >= maxSubscribers ||
				(!current && !initializing && operations.size >= maxOperations)
			) {
				throw new CommandResourceSettingsError('busy');
			}
			const subscriber: Subscriber = { observer, active: true, latest: current };
			subscribers.add(subscriber);
			if (current) {
				schedule(subscriber);
			} else if (!initializing) {
				initializing = read();
				void initializing.catch(() => close());
			}
			return Object.freeze({ close: () => remove(subscriber, false) });
		},
		write(expectedRevision: string, settings: ReservationLimits) {
			let expected: string;
			let captured: ReservationLimits;
			try {
				requireOpen();
				expected = revision(expectedRevision);
				captured = captureSettings(settings);
			} catch (error) {
				return Promise.reject(error);
			}
			return admit(async () => {
				let result: CommandResourceSettingsWriteResult;
				try {
					result = await source.write(expected, captured);
				} catch (error) {
					// A rejected source write is not evidence of rollback either.
					await authoritativeRead();
					throw error;
				}
				requireOpen();
				if (result.kind === 'outcome-unknown') {
					// Resynchronization uses the admitted write's slot; it never retries the mutation.
					await authoritativeRead();
					return Object.freeze({ kind: 'outcome-unknown' as const });
				}
				try {
					if (result.kind !== 'saved' && result.kind !== 'conflict') {
						throw new CommandResourceSettingsError('invalid-snapshot');
					}
					const snapshot = capture(result.snapshot, epoch);
					reconcile(snapshot);
					// A confirmed commit stays a save even if a newer completion already won publication.
					return Object.freeze({ kind: result.kind, snapshot });
				} catch (error) {
					close();
					throw error;
				}
			});
		},
	});
}

export function createCommandResourceSettingsClient(
	underlying: CommandReservationLedger = createCommandReservationLedger(),
): CommandResourceSettingsClient {
	let status: CommandResourceSettingsClientStatus = 'disconnected';
	let generation = 0;
	let subscription: CommandResourceSettingsSubscription | undefined;
	let current: CommandResourceSettingsSnapshot | undefined;
	let applying = false;
	function detach(next: CommandResourceSettingsClientStatus): number {
		generation++;
		const detached = generation;
		status = next;
		current = undefined;
		const previous = subscription;
		subscription = undefined;
		if (previous) {
			isolated(() => previous.close());
		}
		return detached;
	}
	const ledger: CommandReservationLedger = Object.freeze({
		admit(callerId: string, providerId: string) {
			if (status !== 'ready') {
				throw new CommandResourceSettingsError('not-ready');
			}
			return underlying.admit(callerId, providerId);
		},
		updateLimits() {
			throw new CommandResourceSettingsError('settings-owned');
		},
		snapshot: () => underlying.snapshot(),
	});
	return Object.freeze({
		ledger,
		get status() {
			return status;
		},
		attach(service: CommandResourceSettingsService) {
			if (status === 'disposed') {
				throw new CommandResourceSettingsError('closed');
			}
			const attached = detach('connecting');
			// Prior cleanup may dispose the client or attach another service.
			if (attached !== generation) {
				return;
			}
			try {
				const epoch = service.epoch;
				if (typeof epoch !== 'string' || epoch.length === 0) {
					throw new CommandResourceSettingsError('invalid-snapshot');
				}
				const next = service.subscribe({
					closed() {
						if (attached === generation) {
							detach('stale');
						}
					},
					snapshot(message, acknowledge) {
						if (attached !== generation) {
							return;
						}
						try {
							if (applying) {
								throw new CommandResourceSettingsError('invalid-snapshot');
							}
							if (message.epoch !== epoch) {
								throw new CommandResourceSettingsError('invalid-snapshot');
							}
							const snapshot = capture(message, epoch);
							if (attached !== generation) {
								return;
							}
							if (current) {
								const order = compare(snapshot.revision, current.revision);
								if (order < 0) {
									return;
								}
								if (order === 0) {
									if (!equal(snapshot.settings, current.settings)) {
										throw new CommandResourceSettingsError('invalid-snapshot');
									}
									acknowledge();
									return;
								}
							}
							status = 'connecting';
							applying = true;
							try {
								underlying.updateLimits(snapshot.settings);
							} finally {
								applying = false;
							}
							if (attached !== generation) {
								return;
							}
							current = snapshot;
							status = 'ready';
							acknowledge();
						} catch {
							if (attached === generation) {
								detach('stale');
							}
						}
					},
				});
				// subscribe may synchronously close, deliver, or reenter attach/disconnect.
				if (attached === generation) {
					subscription = next;
				} else {
					isolated(() => next.close());
				}
			} catch {
				if (attached === generation) {
					detach('stale');
				}
			}
		},
		disconnect() {
			if (status !== 'disposed') {
				detach('disconnected');
			}
		},
		dispose() {
			detach('disposed');
		},
	});
}
