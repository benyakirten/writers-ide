<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import { ProseMirrorEventBusEventType } from '$lib/editor/state/event-bus.svelte';
	import type { ModularComponentProps } from '$lib/editor/state/shared.types';
	import type { TextMarkPresence } from '../../view/selection';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';
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

		getNeededInformation(editor.view);
	});
</script>

<div class="menu">
	<div class="section">
		<div class="grouping">
			{@render textMarkButtons(
				activeCodeMarks,
				m,
				editorView,
				props.proseMirror.actions,
				'vertical',
			)}
		</div>
	</div>
	<div class="section">
		<p>Block Settings</p>
		<div class="grouping">
			{@render blockMarkButtons(
				editorView,
				selection,
				m,
				props.proseMirror.actions,
				props.proseMirror.selections,
				'vertical',
			)}
		</div>
	</div>
</div>

<style>
	.menu {
		display: grid;
		gap: 10px;
		padding: 8px;
	}

	.grouping {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.section {
		display: grid;
		gap: 2px;

		& p {
			font-size: 14px;
		}
	}
</style>
