export class Debouncer<Item> {
	static DEFAULT_DELAY_MS = 200;

	value: Item | null = null;
	private timeout: NodeJS.Timeout | null = null;
	constructor(
		private readonly callback: (value: Item) => void | Promise<void>,
		private readonly delay = Debouncer.DEFAULT_DELAY_MS
	) {}

	update(value: Item) {
		this.value = value;

		if (this.timeout) {
			clearTimeout(this.timeout);
		}

		this.timeout = setTimeout(() => {
			if (this.value === null) {
				return;
			}

			this.callback(this.value);
			this.timeout = null;
		}, this.delay);
	}

	cancel() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}
}
