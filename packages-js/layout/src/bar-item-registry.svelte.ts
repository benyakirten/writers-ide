export type BarItemSection = {
	Component?: unknown;
	size: 1 | 2 | 3;
};

export type BarItem<S extends BarItemSection = BarItemSection> = {
	title: string;
	vertical: S;
	horizontal: S;
};

export class BarItemRegistry<S extends BarItemSection = BarItemSection> {
	constructor(private readonly generateId: () => string) {}
	items = $state<Record<string, BarItem<S>>>({});
	#retainedSizes = $state<
		Record<string, { horizontal: BarItemSection['size']; vertical: BarItemSection['size'] }>
	>({});

	register(item: BarItem<S>, id: string = this.generateId()): [string, () => void] {
		this.items[id] = item;
		delete this.#retainedSizes[id];
		return [id, () => this.deregister(id)];
	}

	clear() {
		this.items = {};
		this.#retainedSizes = {};
	}

	deregister(id: string, preserveSize = false) {
		const item = this.items[id];
		if (preserveSize && item) {
			// Disabled plugin placements keep their capacity without retaining presentation contexts.
			this.#retainedSizes[id] = {
				horizontal: item.horizontal.size,
				vertical: item.vertical.size,
			};
		} else if (!preserveSize) {
			delete this.#retainedSizes[id];
		}
		delete this.items[id];
	}

	size(id: string | null, isVertical: boolean): 1 | 2 | 3 {
		if (!id) {
			return 1;
		}

		const item = this.items[id];
		if (item) {
			return isVertical ? item.vertical.size : item.horizontal.size;
		}

		const retained = this.#retainedSizes[id];
		return (isVertical ? retained?.vertical : retained?.horizontal) ?? 1;
	}
}
