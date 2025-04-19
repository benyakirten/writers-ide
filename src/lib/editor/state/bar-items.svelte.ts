import type { Component } from 'svelte';

import * as m from '$lib/paraglide/messages';
import Registry, {
	type BarItemComponentProps,
	type BarItemSection
} from './bar-item-registry.svelte';

export type BarItemData = {
	id: string;
	Component: Component<BarItemComponentProps> | null;
	size: BarItemSection['size'];
	title: string;
};
export class BarItems {
	constructor(
		public isVertical: boolean,
		items: string[] = [],
		public readonly maxSize = 3
	) {
		items.forEach((id) => this.append(id));
	}

	#ids = $state<string[]>([]);
	get ids() {
		return this.#ids;
	}

	items: BarItemData[] = $derived(
		this.#ids.map((id) => {
			let Component: BarItemData['Component'] = null;
			let size: BarItemData['size'] = 1;
			let title = m.unknown_menu_title();

			const item = Registry.items.get(id);
			if (item) {
				Component = this.isVertical ? item.vertical.Component : item.horizontal.Component;
				size = this.isVertical ? item.vertical.size : item.horizontal.size;
				title = item.title;
			}

			const data: BarItemData = {
				id,
				Component,
				size,
				title
			};

			return data;
		})
	);

	availableSpace = $derived.by(() => {
		const usedSpace = this.#ids.reduce((acc, id) => acc + Registry.size(id, this.isVertical), 0);
		return Math.max(0, this.maxSize - usedSpace);
	});

	has(id: string | null): boolean {
		if (id === null) {
			return false;
		}
		return this.#ids.includes(id);
	}

	index(id: string | number): number {
		if (typeof id === 'number' && (id < 0 || id >= this.#ids.length)) {
			return -1;
		}
		return typeof id === 'string' ? this.#ids.findIndex((_id) => _id === id) : id;
	}

	append(id: string): boolean {
		if (this.has(id) || !this.canFit(id)) {
			return false;
		}

		this.#ids.push(id);
		return true;
	}

	canSwap(index1: number, index2: number): boolean {
		return !(
			index1 < 0 ||
			index1 >= this.#ids.length ||
			index2 < 0 ||
			index2 >= this.#ids.length ||
			index1 === index2
		);
	}

	swap(index1: number, index2: number): boolean {
		if (!this.canSwap(index1, index2)) {
			return false;
		}

		[this.#ids[index1], this.#ids[index2]] = [this.#ids[index2], this.#ids[index1]];
		return true;
	}

	insert(id: string, at: number): boolean {
		if (this.has(id) || at < 0 || !this.canFit(id)) {
			return false;
		}

		const index = Math.min(at, this.#ids.length);
		this.#ids.splice(index, 0, id);
		return true;
	}

	remove(id: string | number): boolean {
		const index = this.index(id);
		if (index === -1) {
			return false;
		}

		this.#ids.splice(index, 1);
		return true;
	}

	canFit(id: string): boolean {
		return this.availableSpace >= Registry.size(id, this.isVertical) && !this.has(id);
	}
}
