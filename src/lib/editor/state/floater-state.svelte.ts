import {
	FloaterBarState as LayoutFloaterBarState,
	type FloatingBar as LayoutFloatingBar,
} from '@writers-ide/layout';
import type { BarItemSection } from './bar-item-registry.svelte';
import { workbench } from './workbench.svelte';

export type { FloatingPosition } from '@writers-ide/layout';
export type FloatingBar = LayoutFloatingBar<BarItemSection>;

export class FloaterBarState extends LayoutFloaterBarState<BarItemSection> {
	constructor() {
		super(workbench.services);
	}
}

export default workbench.floating;
