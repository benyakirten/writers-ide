<script lang="ts">
	import LocaleManager from '$lib/services/locale-manager.svelte';
	import { schema } from '$lib/editor/prosemirror/view/schema.js';
	import TabState from '$lib/editor/state/tab-state.svelte.js';
	import ProseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import { SelectionUtilities } from '$lib/editor/prosemirror/view/selection.js';
	import { ActionUtilities } from '$lib/editor/prosemirror/view/actions.js';
	import VerticalBarState from '$lib/editor/state/vertical-bar-state.svelte.js';
	import FloaterBarState from '$lib/editor/state/floater-state.svelte.js';
	import HorizontalBarState from '$lib/editor/state/horizontal-bar-state.svelte.js';
	import type { BarItemData } from '$lib/editor/state/bar-items.svelte.js';
	import ErrorComponent from '$lib/editor/prosemirror/menu/ErrorComponent.svelte';
	import type { BarTransferLocation } from '$lib/editor/state/bar-transfer-handler.svelte.js';
	import ItemRendererMenu from './ItemRendererMenu.svelte';
	import type { MoveDetails } from './BarLocation.svelte';

	let {
		Component,
		size,
		title,
		position,
		moveDetails,
		onremove,
		onrelocate,
		onmove
	}: {
		Component: BarItemData['Component'];
		size: BarItemData['size'];
		title: string;
		position: BarTransferLocation;
		moveDetails: MoveDetails;
		onremove: () => void;
		onrelocate: (to: BarTransferLocation) => void;
		onmove: (direction: 'up' | 'down' | 'left' | 'right') => void;
	} = $props();
</script>

<div class="renderer" style:--size={size}>
	<ItemRendererMenu {moveDetails} {position} {title} {onremove} {onrelocate} {onmove} />
	<div class="component">
		{#if Component}
			<Component
				proseMirror={{
					actions: ActionUtilities,
					selections: SelectionUtilities,
					eventBus: ProseMirrorEventBus,
					schema
				}}
				bars={{
					vertical: VerticalBarState,
					horizontal: HorizontalBarState,
					floater: FloaterBarState
				}}
				tabs={TabState}
				locale={LocaleManager.locale}
			/>
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
