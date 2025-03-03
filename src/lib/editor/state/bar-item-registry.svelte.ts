import { type Snippet } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import * as m from '$lib/paraglide/messages.js';

import type { ActionUtilities } from '../prosemirror/view/actions.js';
import type { SelectionUtilies } from '../prosemirror/view/selection.js';
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
	actions: ActionUtilities;
	selections: SelectionUtilies;
	eventBus: ProseMirrorEventBus;
	schema: typeof schema;
};

type InternationlizationUtils = {
	translation: typeof m;
};

export type BarItemComponentProps = {
	proseMirror: ProseMirrorUtils;
	bars: BarStates;
	tabs: TabState;
	internationalization: InternationlizationUtils;
};

export type BarItemSection = {
	Component: Snippet<[BarItemComponentProps]>;
	size: 1 | 2 | 3;
};

export type BarItem = {
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

	isAllowed(id: string | null): boolean {
		if (!id) {
			return true;
		}

		return this.items.has(id);
	}
}

const Registry = new BarItemRegistry();
export default Registry;
