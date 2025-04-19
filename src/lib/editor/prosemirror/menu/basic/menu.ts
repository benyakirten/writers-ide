import type { BarItem } from '$lib/editor/state/bar-item-registry.svelte';
import BasicMenuHorizontal from './BasicMenuHorizontal.svelte';
import BasicMenuVertical from './BasicMenuVertical.svelte';

export const MenuItem: {
	id: string;
	item: BarItem;
} = {
	id: 'basic-menu',
	item: {
		title: 'Basic Menu',
		vertical: {
			Component: BasicMenuVertical,
			size: 1
		},
		horizontal: {
			Component: BasicMenuHorizontal,
			size: 2
		}
	}
};
