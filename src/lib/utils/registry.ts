import { IdGenerator } from '$lib/services/ids';

export type RegistryAction = 'get' | 'set' | 'update' | 'delete';
export type RegistryListener<T> = {
	type: RegistryAction[];
	action: (event: RegistryAction, key: string, value: T | null) => void | Promise<void>;
};

export class Registry<T> {
	private items: [string, T][] = [];
	private listeners: Map<string, RegistryListener<T>> = new Map();

	keys(): string[] {
		return this.items.map(([key]) => key);
	}

	values(): T[] {
		return this.items.map(([_, value]) => value);
	}

	get(key: string): T | null {
		const entry = this.items.find(([k]) => k === key);
		const data = entry?.[1] ?? null;

		this.trigger('get', key, data);
		return data;
	}

	insertBefore(needle: string, key: string, value: T): this {
		const idx = this.items.findIndex(([k]) => k === needle);
		if (idx === -1) {
			this.add(key, value);
		} else if (idx === 0) {
			this.items.unshift([key, value]);
		} else {
			this.items.splice(idx, 0, [key, value]);
		}

		this.trigger('set', key, value);
		return this;
	}

	insertAfter(needle: string, key: string, value: T): this {
		const idx = this.items.findIndex(([k]) => k === needle);
		if (idx === -1) {
			this.add(key, value);
		} else {
			this.items.splice(idx + 1, 0, [key, value]);
		}

		this.trigger('set', key, value);
		return this;
	}

	add(key: string, value: T): boolean {
		if (this.items.findIndex(([k]) => k === key) !== -1) {
			return false;
		}

		this.items.push([key, value]);
		this.trigger('set', key, value);
		return true;
	}

	set(key: string, value: T): this {
		const entry = this.items.find(([k]) => k === key);
		if (!entry) {
			this.items.push([key, value]);
			this.trigger('set', key, value);
			return this;
		}

		entry[1] = value;
		this.trigger('update', key, value);

		return this;
	}

	update(items: Map<string, T>): this {
		for (const [k, v] of items.entries()) {
			this.set(k, v);
		}
		return this;
	}

	delete(key: string): boolean {
		const idx = this.items.findIndex((entry) => entry[0] === key);
		if (idx === -1) {
			return false;
		}

		const [k, v] = this.items[idx];
		this.trigger('delete', k, v);

		this.items.splice(idx, 1);
		return true;
	}

	private trigger(event: RegistryAction, key: string, data: T | null) {
		for (const listener of this.listeners.values()) {
			if (listener.type.includes(event)) {
				listener.action(event, key, data);
			}
		}
	}

	on(
		event: RegistryAction | RegistryAction[],
		action: RegistryListener<T>['action']
	): { id: string; unsubscribe: () => void } {
		const id = IdGenerator.generate();
		const eventTypes = Array.isArray(event) ? [...event] : [event];
		this.listeners.set(id, { type: eventTypes, action });

		return { id, unsubscribe: () => this.off(id) };
	}

	updateListenerEvents(id: string, events: RegistryAction | RegistryAction[]): boolean {
		const listener = this.listeners.get(id);
		if (!listener) {
			return false;
		}

		const eventTypes = Array.isArray(events) ? [...events] : [events];
		listener.type = eventTypes;
		return true;
	}

	off(id: string): boolean {
		return this.listeners.delete(id);
	}
}
