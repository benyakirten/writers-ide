import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import { BarItemRegistry as LayoutRegistry } from '@writers-ide/layout';
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

export class BarItemRegistry extends LayoutRegistry<BarItemSection> {
	#visibility = $state<Record<string, { owner: symbol; visible: boolean }>>({});

	constructor() {
		super(() => IdGenerator.generate());
	}

	override register(item: BarItem, id: string = IdGenerator.generate()): [string, () => void] {
		delete this.#visibility[id];
		return super.register(item, id);
	}

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

	override deregister(id: string, preserveSize = false): void {
		super.deregister(id, preserveSize);
		if (!preserveSize) {
			delete this.#visibility[id];
		}
	}

	override clear(): void {
		super.clear();
		this.#visibility = {};
	}
}

const Registry = new BarItemRegistry();
export default Registry;
