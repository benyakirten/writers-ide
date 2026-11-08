<script lang="ts">
	import { onMount } from 'svelte';
	import 'prosemirror-view/style/prosemirror.css';

	import type { TabComponentProps } from '$lib/editor/state/tab-state-registry.svelte';
	import { schema } from './schema';
	import {
		barelyTooLongPage,
		emptyPage,
		longPage,
		mediumPage,
		mediumPageInterrupted,
		multiplePages,
		shortPage,
		shortPageInterrupted,
		shortPages,
	} from './sample-data';
	import { ProseMirrorEventBusEventType } from '@/editor/state/event-bus.svelte';
	import { createView } from './editor';

	let { id, proseMirror }: TabComponentProps = $props();

	let el: HTMLElement;
	let viewport: HTMLElement;
	let initialState = schema.node('doc', null, [
		// emptyPage,
		// barelyTooLongPage,
		barelyTooLongPage,
		// mediumPageInterrupted,
		// shortPage,
		// shortPage,
		// emptyPage,
		// mediumPage,
		// shortPage,
		// ...multiplePages,
		// longPage,
		// shortPage,
		// emptyPage,
		// shortPageInterrupted,
		// ...shortPages,
		// mediumPage,
		// emptyPage,
	]);

	onMount(() => {
		const deregister = createView(id, 'Test', initialState, el, viewport);
		return () => deregister();
	});

	function setThisToActiveTab() {
		proseMirror.eventBus.update({ id, event: { type: ProseMirrorEventBusEventType.SetActiveTab } });
	}
</script>

<div class="document-viewport" bind:this={viewport} onfocusincapture={() => setThisToActiveTab()}>
	<div class="editor-host" bind:this={el}></div>
</div>

<style>
	.document-viewport {
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: auto;
	}

	.editor-host {
		& > :global([contenteditable]) {
			outline: none;
		}
	}
</style>
