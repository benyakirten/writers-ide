export type DebounceOptions = {
	delay: number;
	resetIfSameValue: boolean;
};

export class Debouncer<Item> {
	static DEFAULT_DELAY_MS = 200;
	private readonly options: DebounceOptions;

	value: Item | null = null;
	private timeout: NodeJS.Timeout | null = null;
	constructor(
		private readonly callback: (value: Item) => void | Promise<void>,
		options: Partial<DebounceOptions> = {}
	) {
		this.options = {
			delay: options.delay ?? Debouncer.DEFAULT_DELAY_MS,
			resetIfSameValue: options.resetIfSameValue ?? false
		};
	}

	update(value: Item) {
		// If the value hasn't changed, continue the timeout
		if (!this.options.resetIfSameValue && this.value === value) {
			return;
		}

		if (this.timeout) {
			clearTimeout(this.timeout);
		}

		this.value = value;
		this.timeout = setTimeout(() => {
			if (this.value === null) {
				return;
			}

			this.callback(this.value);
			this.timeout = null;
		}, this.options.delay);
	}

	cancel() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}
}
