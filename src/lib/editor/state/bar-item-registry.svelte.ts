import { type Snippet } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { ActionUtilities } from '../prosemirror/view/actions.js';
import type { SelectionUtilies } from '../prosemirror/view/selection.js';

type UtilFunctions = {
	actions: typeof ActionUtilities;
	selections: typeof SelectionUtilies;
};
export type BarItemComponentProps = {
	utils: UtilFunctions;
};

export type BarItem = {
	size: 1 | 2 | 3;
	Vertical: Snippet<[BarItemComponentProps]>;
	Horizontal: Snippet<[BarItemComponentProps]>;
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
