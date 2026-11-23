import {
	DEFAULT_PAYLOAD_LIMITS,
	inspectCommandPayload,
	PayloadError,
	type PayloadInspection,
	type PayloadLimits,
} from './command-payload';

// Internal host primitives. Instance IDs must come from the host, not plugin input.
export type ReservationLimits = {
	readonly payload: Readonly<PayloadLimits>;
	readonly maxComponentBytes: number;
	readonly maxWindowBytes: number;
	readonly maxCallerPending: number;
	readonly maxProviderPending: number;
	readonly maxWindowPending: number;
};

export const DEFAULT_RESERVATION_LIMITS: ReservationLimits = Object.freeze({
	payload: DEFAULT_PAYLOAD_LIMITS,
	maxComponentBytes: 32 * 1024 * 1024,
	maxWindowBytes: 128 * 1024 * 1024,
	maxCallerPending: 32,
	maxProviderPending: 64,
	maxWindowPending: 256,
});

export type ComponentReservationSnapshot = {
	readonly id: string;
	readonly bytes: number;
	readonly callerPending: number;
	readonly providerPending: number;
};

export type ReservationSnapshot = {
	readonly bytes: number;
	readonly pending: number;
	readonly components: readonly ComponentReservationSnapshot[];
};

export interface ReservationRelease {
	(): void;
}

export interface CommandReservation {
	readonly limits: ReservationLimits;
	retain(value: unknown): ReservationRelease;
	// Trusted inspection from prepareCommandPayload; reserve before copying that snapshot.
	reserveCopy(inspection: PayloadInspection): ReservationRelease;
	// The host calls this only after running work settles and cleanup drops its data.
	release(): void;
}

export interface CommandReservationLedger {
	admit(callerId: string, providerId: string): CommandReservation;
	updateLimits(limits: ReservationLimits): void;
	snapshot(): ReservationSnapshot;
}

type Counters = { bytes: number; callerPending: number; providerPending: number };
type Allocation = { maximum: number; charges: Map<number, number> };
type Receipt = { inspection?: PayloadInspection };

function captureLimits(limits: ReservationLimits): ReservationLimits {
	const captured = {
		payload: Object.freeze({
			maxBytes: limits.payload.maxBytes,
			maxDepth: limits.payload.maxDepth,
			maxEntries: limits.payload.maxEntries,
		}),
		maxComponentBytes: limits.maxComponentBytes,
		maxWindowBytes: limits.maxWindowBytes,
		maxCallerPending: limits.maxCallerPending,
		maxProviderPending: limits.maxProviderPending,
		maxWindowPending: limits.maxWindowPending,
	};
	for (const value of [
		...Object.values(captured.payload),
		captured.maxComponentBytes,
		captured.maxWindowBytes,
		captured.maxCallerPending,
		captured.maxProviderPending,
		captured.maxWindowPending,
	]) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new RangeError('Command resource limits must be positive safe integers.');
		}
	}
	return Object.freeze(captured);
}

function requireCapacity(current: number, additional: number, limit: number): void {
	if (additional > limit - current) {
		throw new PayloadError('limit-exceeded');
	}
}

/** Creates independent counters for one workspace window. No cancellation is performed. */
export function createCommandReservationLedger(
	initialLimits: ReservationLimits = DEFAULT_RESERVATION_LIMITS,
): CommandReservationLedger {
	let configured = captureLimits(initialLimits);
	let bytes = 0;
	let pending = 0;
	const components = new Map<string, Counters>();
	const counters = (id: string): Counters =>
		components.get(id) ?? { bytes: 0, callerPending: 0, providerPending: 0 };
	const prune = (id: string, state: Counters) => {
		if (state.bytes === 0 && state.callerPending === 0 && state.providerPending === 0) {
			components.delete(id);
		}
	};

	return {
		updateLimits(limits) {
			configured = captureLimits(limits);
		},
		snapshot() {
			return Object.freeze({
				bytes,
				pending,
				components: Object.freeze(
					Array.from(components, ([id, state]) => Object.freeze({ id, ...state })),
				),
			});
		},
		admit(callerId, providerId) {
			if (
				typeof callerId !== 'string' ||
				callerId.length === 0 ||
				typeof providerId !== 'string' ||
				providerId.length === 0
			) {
				throw new TypeError('Command reservations require nonempty component instance IDs.');
			}
			const limits = configured;
			const caller = counters(callerId);
			const provider = callerId === providerId ? caller : counters(providerId);
			requireCapacity(pending, 1, limits.maxWindowPending);
			requireCapacity(caller.callerPending, 1, limits.maxCallerPending);
			requireCapacity(provider.providerPending, 1, limits.maxProviderPending);
			requireCapacity(bytes, 0, limits.maxWindowBytes);
			requireCapacity(caller.bytes, 0, limits.maxComponentBytes);
			requireCapacity(provider.bytes, 0, limits.maxComponentBytes);

			components.set(callerId, caller);
			components.set(providerId, provider);
			pending++;
			caller.callerPending++;
			provider.providerPending++;
			let released = false;
			const allocations = new Map<object, Allocation>();
			const receipts = new Set<Receipt>();
			const adjustBytes = (delta: number) => {
				bytes += delta;
				caller.bytes += delta;
				if (provider !== caller) {
					provider.bytes += delta;
				}
			};
			const requireActive = () => {
				if (released) {
					throw new Error('Command reservation has already been released.');
				}
			};
			const drop = (receipt: Receipt) => {
				const inspection = receipt.inspection;
				if (inspection === undefined) {
					return;
				}
				receipt.inspection = undefined;
				receipts.delete(receipt);
				let removed = inspection.scalarBytes;
				for (const [object, charge] of inspection.allocations) {
					const allocation = allocations.get(object)!;
					const count = allocation.charges.get(charge)!;
					if (count === 1) {
						allocation.charges.delete(charge);
					} else {
						allocation.charges.set(charge, count - 1);
					}
					let maximum = 0;
					for (const retainedCharge of allocation.charges.keys()) {
						maximum = Math.max(maximum, retainedCharge);
					}
					removed += allocation.maximum - maximum;
					allocation.maximum = maximum;
					if (allocation.charges.size === 0) {
						allocations.delete(object);
					}
				}
				adjustBytes(-removed);
			};

			const retainInspection = (inspection: PayloadInspection): ReservationRelease => {
				// Inspection can reenter host code through proxy traps and release this call.
				requireActive();
				let additional = inspection.scalarBytes;
				for (const [object, charge] of inspection.allocations) {
					const increase = Math.max(0, charge - (allocations.get(object)?.maximum ?? 0));
					requireCapacity(additional, increase, Number.MAX_SAFE_INTEGER);
					additional += increase;
				}
				requireCapacity(bytes, additional, limits.maxWindowBytes);
				requireCapacity(caller.bytes, additional, limits.maxComponentBytes);
				requireCapacity(provider.bytes, additional, limits.maxComponentBytes);
				for (const [object, charge] of inspection.allocations) {
					let allocation = allocations.get(object);
					if (allocation === undefined) {
						allocation = { maximum: 0, charges: new Map() };
						allocations.set(object, allocation);
					}
					allocation.charges.set(charge, (allocation.charges.get(charge) ?? 0) + 1);
					allocation.maximum = Math.max(allocation.maximum, charge);
				}
				adjustBytes(additional);
				const receipt: Receipt = { inspection };
				receipts.add(receipt);
				return () => drop(receipt);
			};

			return Object.freeze({
				limits,
				retain(value: unknown) {
					requireActive();
					// Receipts are point-in-time measurements, not mutation tracking.
					return retainInspection(inspectCommandPayload(value, limits.payload));
				},
				reserveCopy(inspection: PayloadInspection) {
					requireActive();
					requireCapacity(0, inspection.bytes, limits.payload.maxBytes);
					requireCapacity(0, inspection.depth, limits.payload.maxDepth);
					requireCapacity(0, inspection.entries, limits.payload.maxEntries);
					return retainInspection({
						...inspection,
						allocations: new Map(
							Array.from(inspection.allocations.values(), (charge) => [{}, charge]),
						),
					});
				},
				release() {
					if (released) {
						return;
					}
					released = true;
					for (const receipt of receipts) {
						drop(receipt);
					}
					pending--;
					caller.callerPending--;
					provider.providerPending--;
					prune(callerId, caller);
					prune(providerId, provider);
				},
			});
		},
	};
}
