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
	constructor() {
		super(() => IdGenerator.generate());
	}
}

const Registry = new BarItemRegistry();
export default Registry;
