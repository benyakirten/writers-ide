/** Tooltip-local debounce: repeated values keep the original deadline. */
export class TooltipDebouncer {
	value: boolean | null = null;
	#timeout: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly callback: (value: boolean) => void,
		private readonly delay: number,
	) {}

	update(value: boolean) {
		if (this.value === value) {
			return;
		}
		this.cancel();
		this.value = value;
		this.#timeout = setTimeout(() => {
			this.#timeout = null;
			if (this.value !== null) {
				this.callback(this.value);
			}
		}, this.delay);
	}

	cancel() {
		if (this.#timeout !== null) {
			clearTimeout(this.#timeout);
			this.#timeout = null;
		}
	}
}
