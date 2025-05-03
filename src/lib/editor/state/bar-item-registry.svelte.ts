import { IdGenerator } from '$lib/services/ids';
import type { ModularComponent } from './shared.types';

export type BarItemSection = {
	Component: ModularComponent;
	size: 1 | 2 | 3;
};

export type BarItem = {
	title: string;
	vertical: BarItemSection;
	horizontal: BarItemSection;
};

export class BarItemRegistry {
	items = $state<Record<string, BarItem>>({});
	register(item: BarItem, id: string = IdGenerator.generate()): [string, () => void] {
		this.items[id] = item;
		return [id, () => this.deregister(id)];
	}

	deregister(id: string) {
		delete this.items[id];
	}

	size(id: string | null, isVertical: boolean): 1 | 2 | 3 {
		if (!id) {
			return 1;
		}

		const item = this.items[id];
		if (!item) {
			return 1;
		}

		return isVertical ? item.vertical.size : item.horizontal.size;
	}
}

const Registry = new BarItemRegistry();
export default Registry;
