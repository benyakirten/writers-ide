<script lang="ts">
	import { onMount } from 'svelte';

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
		const deregister = createView(id, initialState, el);
		return () => deregister();
	});

	function setThisToActiveTab() {
		proseMirror.eventBus.update({ id, event: { type: ProseMirrorEventBusEventType.SetActiveTab } });
	}
</script>

<div onfocusincapture={() => setThisToActiveTab()}>
	<div class="editor-host" bind:this={el}></div>
</div>

<style>
	.editor-host {
		& > :global([contenteditable]) {
			outline: none;
		}
	}
</style>
