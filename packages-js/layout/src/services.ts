import type { BarItemSection } from './bar-item-registry.svelte';
import type { BarItems } from './bar-items.svelte';

/** Host policies shared by a workbench's collections; no ambient application services. */
export type LayoutServices<S extends BarItemSection> = {
	generateId: () => string;
	createItems: (vertical: boolean, ids?: string[]) => BarItems<S>;
	newBarTitle: () => string;
};
