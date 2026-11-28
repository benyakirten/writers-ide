import {
	HorizontalBarState as LayoutHorizontalBarState,
	type HorizontalBar as LayoutHorizontalBar,
} from '@writers-ide/layout';
import type { BarItemSection } from './bar-item-registry.svelte';
import { workbench } from './workbench.svelte';

export { HorizontalBarPosition } from '@writers-ide/layout';
export type HorizontalBar = LayoutHorizontalBar<BarItemSection>;

export class HorizontalBarState extends LayoutHorizontalBarState<BarItemSection> {
	constructor(windowMinSize = 100, editorMinSize = 100) {
		super(workbench.services, windowMinSize, editorMinSize);
	}
}

export default workbench.horizontal;
