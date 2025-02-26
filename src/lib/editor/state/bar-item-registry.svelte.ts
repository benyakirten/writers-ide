import type { Snippet } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export type BarItem = {
	size: 1 | 2 | 3;
	Vertical: Snippet;
	Horizontal: Snippet;
};
export class BarItemRegistry {
	items = $state<SvelteMap<string, BarItem>>(new SvelteMap());
	register(item: BarItem, id: string = crypto.randomUUID()): [string, () => void] {
		this.items.set(id, item);
		return [id, () => this.items.delete(id)];
	}

	deregister(id: string) {
		this.items.delete(id);
	}
}

const Registry = new BarItemRegistry();
export default Registry;
