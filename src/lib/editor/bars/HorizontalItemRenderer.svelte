<script lang="ts">
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
	import ErrorComponent from '../prosemirror/menu/ErrorComponent.svelte';
	import ItemRendererMenu from './ItemRendererMenu.svelte';
	import LocaleManager from '../state/locale-manager.state.js';

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
		locale: LocaleManager.locale
	};

	let {
		Component,
		size,
		title,
		onremove
	}: {
		Component: BarItemData['Component'];
		size: BarItemData['size'];
		title: string;
		onremove: () => void;
	} = $props();
</script>

<div class="renderer" draggable style:--size={size}>
	<ItemRendererMenu {title} {onremove} />
	<div class="component">
		{#if Component}
			<Component {...itemProps} />
		{:else}
			<ErrorComponent />
		{/if}
	</div>
</div>

<style>
	.renderer {
		--mr: 9px;
		margin-right: var(--mr);
		width: calc(var(--size) * 33% - var(--mr));
		height: 100%;

		position: relative;

		&:last-child {
			margin-bottom: 0;
		}
	}

	.component {
		height: 100%;
		border-top: 1px solid black;
	}
</style>
