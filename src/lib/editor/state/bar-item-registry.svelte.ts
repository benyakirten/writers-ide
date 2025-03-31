import { type Component } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

import type { ActionUtilities } from '../prosemirror/view/actions.js';
import type { SelectionUtilities } from '../prosemirror/view/selection.js';
import type { ProseMirrorEventBus } from './event-bus.svelte.js';
import type { VerticalBarState } from './vertical-bar-state.svelte.js';
import type { HorizontalBarState } from './horizontal-bar-state.svelte.js';
import type { FloaterBarState } from './floater-state.svelte.js';
import type { TabState } from './tab-state.svelte.js';
import type { schema } from '../prosemirror/view/schema.js';

type BarStates = {
	vertical: VerticalBarState;
	horizontal: HorizontalBarState;
	floater: FloaterBarState;
};

type ProseMirrorUtils = {
	actions: typeof ActionUtilities;
	selections: typeof SelectionUtilities;
	eventBus: ProseMirrorEventBus;
	schema: typeof schema;
};

export type BarItemComponentProps = {
	proseMirror: ProseMirrorUtils;
	bars: BarStates;
	tabs: TabState;
	locale: string;
};

export type BarItemSection = {
	Component: Component<BarItemComponentProps>;
	size: 1 | 2 | 3;
};

export type BarItem = {
	title: string;
	vertical: BarItemSection;
	horizontal: BarItemSection;
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

	size(id: string | null, isVertical: boolean): 1 | 2 | 3 {
		if (!id) {
			return 1;
		}

		const item = this.items.get(id);
		if (!item) {
			return 1;
		}

		return isVertical ? item.vertical.size : item.horizontal.size;
	}
}

const Registry = new BarItemRegistry();
export default Registry;
