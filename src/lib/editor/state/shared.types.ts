import { type Component } from 'svelte';

import type { ActionUtilities } from '../prosemirror/view/actions';
import type { SelectionUtilities } from '../prosemirror/view/selection';
import type { ProseMirrorEventBus } from './event-bus.svelte';
import type { VerticalBarState } from './vertical-bar-state.svelte';
import type { HorizontalBarState } from './horizontal-bar-state.svelte';
import type { FloaterBarState } from './floater-state.svelte';
import type { TabState } from './tab-state.svelte';
import type { schema } from '../prosemirror/view/schema';

export type BarItem = {
	id: string;
	size: 1 | 2 | 3;
};

type BarStates = {
	vertical: VerticalBarState;
	horizontal: HorizontalBarState;
	floater: FloaterBarState;
};

type ProseMirrorUtils = {
	actions: typeof ActionUtilities;
	selections: typeof SelectionUtilities;
	eventBus: ProseMirrorEventBus;
	schema: typeof schema;
};

export type ModularComponentProps = {
	proseMirror: ProseMirrorUtils;
	bars: BarStates;
	tabs: TabState;
	locale: string;
};

export type ModularComponent = Component<ModularComponentProps>;
