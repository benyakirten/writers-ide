export class IdGenerator {
	static ids = new Set<string>();
	static generate(): string {
		let id: string = crypto.randomUUID();
		while (this.ids.has(id)) {
			id = crypto.randomUUID();
		}
		this.ids.add(id);

		return id;
	}

	static register(id: string): () => void {
		this.ids.add(id);
		return () => this.ids.delete(id);
	}
}
