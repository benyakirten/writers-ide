import { IdGenerator } from '$lib/services/ids';
import type { ModularComponent } from './shared.types';

export type TabItem = {
	component: ModularComponent;
};

export class TabStateRegistry {
	items = $state<Record<string, TabItem>>({});
	register(item: TabItem, id: string = IdGenerator.generate()): [string, () => void] {
		this.items[id] = item;
		return [id, () => this.deregister(id)];
	}

	deregister(id: string) {
		delete this.items[id];
	}
}

const TabRegistry = new TabStateRegistry();
export default TabRegistry;
