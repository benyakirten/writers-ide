import {
	BarItems as LayoutBarItems,
	type BarItemData as LayoutBarItemData,
} from '@writers-ide/layout';
import * as m from '$lib/paraglide/messages';
import Registry, { type BarItemSection } from './bar-item-registry.svelte';

export type { BarMetadata } from '@writers-ide/layout';
export type BarItemData = LayoutBarItemData<BarItemSection>;

export class BarItems extends LayoutBarItems<BarItemSection> {
	constructor(isVertical: boolean, items: string[] = [], maxSize = 3) {
		super(Registry, () => m.unknown_menu_title(), isVertical, items, maxSize);
	}
}
