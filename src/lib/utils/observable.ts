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
