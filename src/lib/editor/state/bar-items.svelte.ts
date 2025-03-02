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

	swap(index1: number, index2: number): boolean {
		if (
			index1 < 0 ||
			index1 >= this.#items.length ||
			index2 < 0 ||
			index2 >= this.#items.length ||
			index1 === index2
		) {
			return false;
		}

		[this.#items[index1], this.#items[index2]] = [this.#items[index2], this.#items[index1]];
		return true;
	}

	moveTo(id: string | number, toIndex: number): boolean {
		const fromIndex =
			typeof id === 'string' ? this.#items.findIndex((item) => item?.id === id) : id;
		if (
			fromIndex === -1 ||
			fromIndex > this.#items.length - 1 ||
			toIndex < 0 ||
			toIndex > this.#items.length - 1 ||
			fromIndex === toIndex
		) {
			return false;
		}

		return this.swap(fromIndex, toIndex);
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
