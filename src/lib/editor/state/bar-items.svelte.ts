import Registry from './bar-item-registry.svelte.js';

export class BarItems {
	constructor(
		public isVertical: boolean,
		readonly maxSize = 3
	) {}

	get items() {
		return this.#ids.map((id) => {
			if (id === null) {
				return null;
			}

			const item = Registry.items.get(id);
			if (!item) {
				return null;
			}

			return this.isVertical ? item.vertical.Component : item.horizontal.Component;
		});
	}
	#ids = $state<(string | null)[]>([]);

	index(id: string | number): number {
		return typeof id === 'string' ? this.#ids.findIndex((_id) => _id === id) : id;
	}

	append(id: string | null): boolean {
		const availableSpace = this.availableSpace;
		if (availableSpace === 0 || Registry.size(id, this.isVertical) > availableSpace) {
			return false;
		}

		this.#ids.push(id);
		return true;
	}

	swap(index1: number, index2: number): boolean {
		if (
			index1 < 0 ||
			index1 >= this.#ids.length ||
			index2 < 0 ||
			index2 >= this.#ids.length ||
			index1 === index2
		) {
			return false;
		}

		[this.#ids[index1], this.#ids[index2]] = [this.#ids[index2], this.#ids[index1]];
		return true;
	}

	moveTo(id: string | number, toIndex: number): boolean {
		const fromIndex = this.index(id);
		if (
			fromIndex === -1 ||
			fromIndex > this.#ids.length - 1 ||
			toIndex < 0 ||
			toIndex > this.#ids.length - 1 ||
			fromIndex === toIndex
		) {
			return false;
		}

		return this.swap(fromIndex, toIndex);
	}

	remove(id: string | number): boolean {
		const index = this.index(id);
		if (index === -1) {
			return false;
		}

		this.#ids.splice(index, 1);
		return true;
	}

	get availableSpace(): number {
		const usedSpace = this.#ids.reduce((acc, id) => acc + Registry.size(id, this.isVertical), 0);
		return Math.max(0, this.maxSize - usedSpace);
	}
}
