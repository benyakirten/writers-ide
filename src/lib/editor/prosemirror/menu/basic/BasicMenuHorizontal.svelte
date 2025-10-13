<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import type { ModularComponentProps } from '$lib/editor/state/shared.types';
	import { ProseMirrorEventBusEventType } from '$lib/editor/state/event-bus.svelte';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';
	import type { TextMarkPresence } from '../../view/selection';

	let activeCodeMarks = $state<TextMarkPresence | null>(null);
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	let props: ModularComponentProps = $props();

	function getNeededInformation(view: EditorView) {
		activeCodeMarks = props.proseMirror.selections.findTextMarks(
			view.state.selection,
			view.state.doc,
		);
		editorView = view;
		selection = view.state.selection;
	}

	onMount(() => {
		const unsub = props.proseMirror.eventBus.subscribe(({ id, event }) => {
			const isNotInitOrUpdate =
				event.type !== ProseMirrorEventBusEventType.Init &&
				event.type !== ProseMirrorEventBusEventType.Update;
			if (id !== props.tabs.active || isNotInitOrUpdate) {
				return;
			}

			const { view } = event;
			getNeededInformation(view);
		});

		return () => unsub();
	});

	function resetState() {
		activeCodeMarks = null;
		editorView = null;
		selection = null;
	}

	$effect(() => {
		const activeId = props.tabs.active;

		if (!activeId) {
			resetState();
			return;
		}

		const editor = props.proseMirror.editors.get(activeId);
		if (!editor) {
			resetState();
			return;
		}

		getNeededInformation(editor);
	});
</script>

<div class="menu">
	<div class="grouping">
		{@render textMarkButtons(
			activeCodeMarks,
			m,
			editorView,
			props.proseMirror.actions,
			'horizontal',
		)}
	</div>
	<div class="grouping">
		{@render blockMarkButtons(
			editorView,
			selection,
			m,
			props.proseMirror.actions,
			props.proseMirror.selections,
			'horizontal',
		)}
	</div>
</div>

<style>
	.menu {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
	}

	.grouping {
		display: flex;
		align-items: center;
		gap: 2px;
	}
</style>
