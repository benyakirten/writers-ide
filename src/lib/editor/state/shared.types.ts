import { type Component } from 'svelte';

import type { ActionUtilities } from '../prosemirror/view/actions.js';
import type { SelectionUtilities } from '../prosemirror/view/selection.js';
import type { ProseMirrorEventBus } from './event-bus.svelte.js';
import type { VerticalBarState } from './vertical-bar-state.svelte.js';
import type { HorizontalBarState } from './horizontal-bar-state.svelte.js';
import type { FloaterBarState } from './floater-state.svelte.js';
import type { TabState } from './tab-state.svelte.js';
import type { schema } from '../prosemirror/view/schema.js';

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

export type BarItemComponentProps = {
	proseMirror: ProseMirrorUtils;
	bars: BarStates;
	tabs: TabState;
	locale: string;
};

export type ModularComponent = Component<BarItemComponentProps>;
