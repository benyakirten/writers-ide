<script lang="ts">
	import { onMount } from 'svelte';

	import IconButton from '$lib/components/IconButton.svelte';
	import type { BarItemComponentProps } from '$lib/editor/state/bar-item-registry.svelte.js';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import type { TextMarkPresence } from '../../view/selection.js';

	import { blockMarks, textMarks } from './buttons.js';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	let props: BarItemComponentProps = $props();

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
	<div class="grouping">
		{@render textMarkButtons(
			textMarks,
			activeCodeMarks,
			props.internationalization.translation,
			editorView,
			props.proseMirror.actions
		)}
	</div>
	<div class="grouping">
		{@render blockMarkButtons(
			blockMarks,
			editorView,
			selection,
			props.internationalization.translation,
			props.proseMirror.actions,
			props.proseMirror.selections
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
