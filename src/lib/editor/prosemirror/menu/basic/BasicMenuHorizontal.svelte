<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import type { BarItemComponentProps } from '$lib/editor/state/bar-item-registry.svelte';
	import type { TextMarkPresence } from '../../view/selection';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	let props: BarItemComponentProps = $props();

	onMount(() => {
		const unsub = props.proseMirror.eventBus.subscribe(({ view }) => {
			activeCodeMarks = props.proseMirror.selections.findTextMarks(
				view.state.selection,
				view.state.doc
			);
			editorView = view;
			selection = view.state.selection;
		});

		return () => unsub();
	});
</script>

<div class="menu">
	<div class="grouping">
		{@render textMarkButtons(
			activeCodeMarks,
			m,
			editorView,
			props.proseMirror.actions,
			'horizontal'
		)}
	</div>
	<div class="grouping">
		{@render blockMarkButtons(
			editorView,
			selection,
			m,
			props.proseMirror.actions,
			props.proseMirror.selections,
			'horizontal'
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
