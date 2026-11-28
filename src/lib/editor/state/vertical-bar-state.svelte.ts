import {
	VerticalBarState as LayoutVerticalBarState,
	type VerticalBar as LayoutVerticalBar,
} from '@writers-ide/layout';
import type { BarItemSection } from './bar-item-registry.svelte';
import { workbench } from './workbench.svelte';

export { VerticalBarPosition, HorizontalTextDirection } from '@writers-ide/layout';
export type VerticalBar = LayoutVerticalBar<BarItemSection>;

export class VerticalBarState extends LayoutVerticalBarState<BarItemSection> {
	constructor(minSize = 200, inlineStart: VerticalBar[] = [], inlineEnd: VerticalBar[] = []) {
		super(workbench.services, minSize, inlineStart, inlineEnd);
	}
}

export default workbench.vertical;
