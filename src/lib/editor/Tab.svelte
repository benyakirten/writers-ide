<script lang="ts">
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import PluginPresentation from '$lib/plugins/PluginPresentation.svelte';
	import Editors from './prosemirror/prose-mirror-editor.svelte';
	import LocaleManager from '$lib/services/locale-manager.svelte';
	import TabState from './state/tab-state.svelte';
	import ProseMirrorEventBus from './state/event-bus.svelte';
	import { ActionUtilities } from './prosemirror/view/actions';
	import { SelectionUtilities } from './prosemirror/view/selection';
	import FloaterBarState from './state/floater-state.svelte';
	import HorizontalBarState from './state/horizontal-bar-state.svelte';
	import VerticalBarState from './state/vertical-bar-state.svelte';
	import { schema } from './prosemirror/view/schema';
	import type { TabComponent } from './state/tab-state-registry.svelte';

	let {
		id,
		data,
		Component,
		plugin,
	}: {
		index: number;
		id: string;
		data?: object;
		Component: TabComponent;
		plugin?: SveltePresentation;
	} = $props();
</script>

<div class="tab">
	<!-- Tab Menu -->
	<!-- Component should be zoomable -->
	{#if plugin}
		<PluginPresentation presentation={plugin} />
	{:else}
		<Component
			{id}
			{data}
			proseMirror={{
				actions: ActionUtilities,
				selections: SelectionUtilities,
				eventBus: ProseMirrorEventBus,
				schema,
				editors: Editors,
			}}
			bars={{
				vertical: VerticalBarState,
				horizontal: HorizontalBarState,
				floater: FloaterBarState,
			}}
			tabs={TabState}
			locale={LocaleManager.locale}
		/>
	{/if}
</div>

<style>
	.tab {
		min-height: 0;
		min-width: 0;
		width: 100%;
		height: 100%;
	}
</style>
