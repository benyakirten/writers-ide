<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import type { ModularComponentProps } from '$lib/editor/state/bar-item-registry.svelte';
	import type { TextMarkPresence } from '../../view/selection';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	let props: ModularComponentProps = $props();

	onMount(() => {
		const unsub = props.proseMirror.eventBus.subscribe(({ view }) => {
			const marks =
				view && props.proseMirror.selections.findTextMarks(view.state.selection, view.state.doc);
			activeCodeMarks = marks;
			editorView = view;
			selection = view.state.selection;
		});

		return () => unsub();
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
				'vertical'
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
				'vertical'
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
