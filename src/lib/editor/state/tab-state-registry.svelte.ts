import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import type { Component } from 'svelte';
import ErrorTab from '../prosemirror/ErrorTab.svelte';
import type { ModularComponentProps } from './shared.types';

export type TabComponentProps = ModularComponentProps & {
	id: string;
	data?: object;
};
export type TabComponent = Component<TabComponentProps>;
export type TabItem = {
	component?: TabComponent;
	plugin?: SveltePresentation;
};

export class TabStateRegistry {
	items = $state<Record<string, TabItem>>({});
	#visibility = $state<Record<string, { owner: symbol; visible: boolean }>>({});

	setVisibility(id: string, owner: symbol, visible: boolean): void {
		if (this.#visibility[id]?.owner !== owner || this.#visibility[id]?.visible !== visible) {
			this.#visibility[id] = { owner, visible };
		}
	}

	releaseVisibility(id: string, owner: symbol): void {
		if (this.#visibility[id]?.owner === owner) {
			delete this.#visibility[id];
		}
	}

	isVisible(id: string): boolean {
		return this.#visibility[id]?.visible ?? true;
	}

	register(item: TabItem, id: string): [string, () => void] {
		delete this.#visibility[id];
		this.items[id] = item;
		return [id, () => this.deregister(id)];
	}

	deregister(id: string, preserveVisibility = false) {
		delete this.items[id];
		if (!preserveVisibility) {
			delete this.#visibility[id];
		}
	}

	get(name: string): TabComponent {
		return this.items[name]?.component ?? ErrorTab;
	}
}

const TabRegistry = new TabStateRegistry();
export default TabRegistry;
