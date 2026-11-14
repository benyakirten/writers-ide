import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import { IdGenerator } from '$lib/services/ids';
import type { ModularComponent } from './shared.types';

export type BarItemSection = {
	Component?: ModularComponent;
	plugin?: SveltePresentation;
	size: 1 | 2 | 3;
};

export type BarItem = {
	title: string;
	vertical: BarItemSection;
	horizontal: BarItemSection;
};

export class BarItemRegistry {
	items = $state<Record<string, BarItem>>({});
	#retainedSizes = $state<
		Record<string, { horizontal: BarItemSection['size']; vertical: BarItemSection['size'] }>
	>({});

	register(item: BarItem, id: string = IdGenerator.generate()): [string, () => void] {
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

const Registry = new BarItemRegistry();
export default Registry;
