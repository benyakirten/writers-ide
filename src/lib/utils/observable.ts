export class Observable<Data> {
	#subscribers: Map<string, (data: Data) => void | Promise<void>> = new Map();

	subscribe(callback: (data: Data) => void | Promise<void>): () => void {
		const id = crypto.randomUUID();
		this.#subscribers.set(id, callback);
		return () => this.#subscribers.delete(id);
	}

	update(data: Data) {
		for (const subscriber of this.#subscribers.values()) {
			subscriber(data);
		}
	}
}

export class RequiredObservable<Data> extends Observable<Data> {
	protected _data: Data;

	constructor(data: Data) {
		super();
		this._data = data;
	}

	get data() {
		return this._data;
	}

	set data(data: Data) {
		this._data = data;
		this.update(data);
	}

	subscribe(callback: (data: Data) => void | Promise<void>): () => void {
		callback(this._data);
		return super.subscribe(callback);
	}
}
