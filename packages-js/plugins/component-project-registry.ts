import type { ProjectReference } from './frontend';
import type { Dispose } from './index';

type Subscription = {
	readonly listener: (reference: ProjectReference | null) => void;
	active: boolean;
};

/** Internal, host-owned live project openings for one window. */
export class ComponentProjectRegistry {
	#live = new WeakSet<ProjectReference>();
	#openings = new Map<string, ProjectReference>();
	#ids = new Set<string>();
	#selected: ProjectReference | null = null;
	#subscriptions = new Set<Subscription>();
	#pending: Subscription[] = [];
	#busy = false;
	#delivering = false;

	open(id: string, name: string): ProjectReference {
		return this.#mutate(() => {
			if (typeof id !== 'string' || id.trim().length === 0) {
				throw new TypeError('Project ID must be a nonblank string.');
			}
			if (typeof name !== 'string') {
				throw new TypeError('Project name must be a string.');
			}
			if (this.#ids.has(id)) {
				throw new Error('Project is already open.');
			}
			const reference = Object.freeze({ id, openingId: crypto.randomUUID(), name });
			this.#live.add(reference);
			this.#openings.set(reference.openingId, reference);
			this.#ids.add(id);
			return reference;
		});
	}

	selected(): ProjectReference | null {
		return this.#selected;
	}

	reference(openingId: string): ProjectReference | undefined {
		return this.#openings.get(openingId);
	}

	assert(reference: ProjectReference): void {
		// Identity lookup must precede any field access, including on proxies.
		if (!this.#live.has(reference)) {
			throw new Error('Project reference is not a live opening issued by this registry.');
		}
	}

	select(reference: ProjectReference | null): void {
		this.#mutate(() => {
			if (reference !== null) {
				this.assert(reference);
			}
			if (this.#selected !== reference) {
				this.#selected = reference;
				this.#enqueueSelection();
			}
		});
	}

	subscribeSelected(listener: (reference: ProjectReference | null) => void): Dispose {
		if (typeof listener !== 'function') {
			throw new TypeError('Project selection listener must be a function.');
		}
		const subscription: Subscription = { listener, active: true };
		this.#subscriptions.add(subscription);
		this.#pending.push(subscription);
		if (!this.#busy) {
			this.#deliver();
		}
		return () => {
			subscription.active = false;
			this.#subscriptions.delete(subscription);
		};
	}

	close(reference: ProjectReference, beforeNotify: () => void): void {
		this.#mutate(() => {
			this.assert(reference);
			if (typeof beforeNotify !== 'function') {
				throw new TypeError('Project teardown callback must be a function.');
			}
			this.#live.delete(reference);
			this.#openings.delete(reference.openingId);
			this.#ids.delete(reference.id);
			if (this.#selected === reference) {
				this.#selected = null;
				this.#enqueueSelection();
			}
			beforeNotify();
		});
	}

	list(): readonly ProjectReference[] {
		return Object.freeze([...this.#openings.values()]);
	}

	#mutate<T>(operation: () => T): T {
		if (this.#busy || this.#delivering) {
			throw new Error('Project registry is busy.');
		}
		this.#busy = true;
		try {
			return operation();
		} finally {
			try {
				this.#deliver();
			} finally {
				this.#busy = false;
			}
		}
	}

	#enqueueSelection(): void {
		for (const subscription of this.#subscriptions) {
			this.#pending.push(subscription);
		}
	}

	#deliver(): void {
		if (this.#delivering) {
			return;
		}
		this.#delivering = true;
		try {
			// Nested subscriptions join the queue instead of recursively entering listeners.
			for (let index = 0; index < this.#pending.length; index++) {
				const subscription = this.#pending[index];
				if (!subscription.active) {
					continue;
				}
				try {
					const result = subscription.listener(this.selected());
					void Promise.resolve(result).catch(() => undefined);
				} catch {
					// Observers cannot interrupt teardown or sibling delivery. Do not log their data.
				}
			}
		} finally {
			this.#pending = [];
			this.#delivering = false;
		}
	}
}
