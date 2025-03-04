<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	import type { BarItemComponentProps } from '../state/bar-item-registry.svelte.js';
	import TabState from '../state/tab-state.svelte.js';
	import { schema } from '../prosemirror/view/schema.js';
	import ProseMirrorEventBus from '../state/event-bus.svelte.js';
	import { SelectionUtilies } from '../prosemirror/view/selection.js';
	import { ActionUtilities } from '../prosemirror/view/actions.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';
	import FloaterBarState from '../state/floater-state.svelte.js';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';
	import type { BarItemData } from '../state/bar-items.svelte.js';

	let itemProps: BarItemComponentProps = {
		proseMirror: {
			actions: ActionUtilities,
			selections: SelectionUtilies,
			eventBus: ProseMirrorEventBus,
			schema
		},
		bars: {
			vertical: VerticalBarState,
			horizontal: HorizontalBarState,
			floater: FloaterBarState
		},
		tabs: TabState,
		internationalization: {
			translation: m
		}
	};

	let { Component, size }: { Component: BarItemData['Component']; size: BarItemData['size'] } =
		$props();
</script>

<div style:flex={size} class="renderer">
	{#if Component}
		<Component {...itemProps} />
	{/if}
</div>

<style>
	.renderer {
		flex: 1;
	}
</style>
