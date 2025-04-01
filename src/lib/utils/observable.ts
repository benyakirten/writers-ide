/**
 * Base class for making a value and its change into an observable. It does not store the current value.
 */
export class Observable<Data> {
	#subscribers: Map<string, (data: Data) => void | Promise<void>> = new Map();

	/**
	 * Subscribe to this observable for every this it's called. Returns a function to unsubscribe.
	 */
	subscribe(callback: (data: Data) => void | Promise<void>): () => void {
		const id = crypto.randomUUID();
		this.#subscribers.set(id, callback);
		return () => this.#subscribers.delete(id);
	}

	/**
	 * Send a new value to all subscribers.
	 *
	 * NOTE: It will not call the callback on subscription, only on future updates.
	 */
	update(data: Data) {
		for (const subscriber of this.#subscribers.values()) {
			subscriber(data);
		}
	}
}

/**
 * Similar to an observable, but it requires an initial value. Unlike the base observable,
 * it will immediately call the callback with the current value.
 */
export class RequiredObservable<Data> extends Observable<Data> {
	protected _data: Data;

	constructor(data: Data) {
		super();
		this._data = data;
	}

	get data() {
		return this._data;
	}

	/**
	 * Sets the data and calls all subscribers with the new value.
	 */
	set data(data: Data) {
		this._data = data;
		this.update(data);
	}

	/**
	 * Similar to a normal observable but will immediately call the callback with the current value.
	 */
	subscribe(callback: (data: Data) => void | Promise<void>): () => void {
		callback(this._data);
		return super.subscribe(callback);
	}
}
