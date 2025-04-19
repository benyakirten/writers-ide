<script lang="ts">
	import LocaleManager from '$lib/services/locale-manager.svelte';
	import TabState from './state/tab-state.svelte';
	import ProseMirrorEventBus from './state/event-bus.svelte';
	import type { ModularComponent } from './state/shared.types';
	import { ActionUtilities } from './prosemirror/view/actions';
	import { SelectionUtilities } from './prosemirror/view/selection';
	import FloaterBarState from './state/floater-state.svelte';
	import HorizontalBarState from './state/horizontal-bar-state.svelte';
	import VerticalBarState from './state/vertical-bar-state.svelte';
	import { schema } from './prosemirror/view/schema';

	let { index, Component }: { index: number; Component: ModularComponent } = $props();
</script>

<div class="tab">
	<!-- Tab Menu -->
	<!-- Component should be zoomable -->
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
</div>

<style>
	.tab {
		width: 100%;
		height: 100%;
		border: 1px solid black;
	}
</style>
