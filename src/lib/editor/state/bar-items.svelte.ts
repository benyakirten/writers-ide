import Registry, { type BarItemSection } from './bar-item-registry.svelte.js';

export type BarItemData = (BarItemSection & { id: string }) | null;
export class BarItems {
	constructor(
		public isVertical: boolean,
		items: (string | null)[] = [],
		public readonly maxSize = 3
	) {
		items.forEach((id) => this.append(id));
	}

	#ids = $state<(string | null)[]>([]);
	get ids() {
		return this.#ids;
	}

	items: BarItemData[] = $derived(
		this.#ids.map((id) => {
			if (id === null) {
				return null;
			}

			const item = Registry.items.get(id);
			if (!item) {
				return null;
			}

			const part = this.isVertical ? item.vertical : item.horizontal;
			return {
				...part,
				id
			};
		})
	);

	has(id: string | null): boolean {
		if (id === null) {
			return false;
		}
		return this.#ids.includes(id);
	}

	index(id: string | number): number {
		return typeof id === 'string' ? this.#ids.findIndex((_id) => _id === id) : id;
	}

	append(id: string | null): boolean {
		const availableSpace = this.availableSpace;
		if (
			this.has(id) ||
			!Registry.isAllowed(id) ||
			Registry.size(id, this.isVertical) > availableSpace
		) {
			return false;
		}

		this.#ids.push(id);
		return true;
	}

	canSwap(index1: number, index2: number): boolean {
		return !(
			index1 < 0 ||
			index1 >= this.#ids.length ||
			index2 < 0 ||
			index2 >= this.#ids.length ||
			index1 === index2
		);
	}

	swap(index1: number, index2: number): boolean {
		if (!this.canSwap(index1, index2)) {
			return false;
		}

		[this.#ids[index1], this.#ids[index2]] = [this.#ids[index2], this.#ids[index1]];
		return true;
	}

	insert(id: string | null, at: number): boolean {
		if (
			this.has(id) ||
			!Registry.isAllowed(id) ||
			at < 0 ||
			Registry.size(id, this.isVertical) > this.availableSpace
		) {
			return false;
		}

		const index = Math.min(at, this.#ids.length);
		this.#ids.splice(index, 0, id);
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
