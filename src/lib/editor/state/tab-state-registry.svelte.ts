import { IdGenerator } from '$lib/services/ids';
import type { Component } from 'svelte';
import ErrorTab from '../prosemirror/ErrorTab.svelte';
import type { ModularComponentProps } from './shared.types';

export type TabComponentProps = ModularComponentProps & {
	id: string;
	data: object;
};
export type TabComponent = Component<TabComponentProps>;
export type TabItem = {
	component: TabComponent;
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

	get(name: string): TabComponent {
		return this.items[name]?.component ?? ErrorTab;
	}
}

const TabRegistry = new TabStateRegistry();
export default TabRegistry;
