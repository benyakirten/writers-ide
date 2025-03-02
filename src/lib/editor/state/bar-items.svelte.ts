import Registry from './bar-item-registry.svelte.js';

export class BarItems<T extends { id: string }> {
	constructor(
		public isVertical: boolean,
		readonly maxSize = 3
	) {}

	get items() {
		return this.#items.slice();
	}
	#items = $state<(T | null)[]>([]);

	append(item: T | null): boolean {
		const availableSpace = this.availableSpace;
		if (availableSpace === 0 || Registry.size(item?.id, this.isVertical) > availableSpace) {
			return false;
		}

		this.#items.push(item);
		return true;
	}

	remove(id: string): boolean {
		const index = this.#items.findIndex((item) => item?.id === id);
		if (index === -1) {
			return false;
		}

		this.#items.splice(index, 1);
		return true;
	}

	get availableSpace(): number {
		const usedSpace = this.#items.reduce((acc, item) => {
			if (!item) {
				return acc + 1;
			}

			const size = Registry.size(item.id, this.isVertical);
			return acc + size;
		}, 0);

		return Math.max(0, this.maxSize - usedSpace);
	}
}
