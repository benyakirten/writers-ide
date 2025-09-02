<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import { keymap } from 'prosemirror-keymap';
	import { undo, redo, history } from 'prosemirror-history';
	import { baseKeymap } from 'prosemirror-commands';

	import type { TabComponentProps } from '$lib/editor/state/tab-state-registry.svelte';
	import { schema } from './schema';
	import { ActionUtilities } from './actions';
	import TabState from '../../state/tab-state.svelte';
	import { createShortcuts } from '../plugins/shortcut.plugin';
	import ProseMirrorPlugins from '../plugins.svelte';
	import Editors from '../prose-mirror-editor.svelte';
	import {
		emptyPage,
		longPage,
		mediumPage,
		mediumPageInterrupted,
		multiplePages,
		shortPage,
		shortPageInterrupted,
		shortPages
	} from './sample-data';
	import { handleTransaction } from './transaction-handler';
	import PageLayout from '@/editor/state/page-layout.svelte';

	let { id }: TabComponentProps = $props();

	let el: HTMLElement;
	let state: EditorState;
	let view: EditorView;
	let initialState = schema.node('doc', null, [
		emptyPage,
		mediumPage,
		mediumPage,
		mediumPage,
		mediumPage,
		mediumPage
	]);

	onMount(() => {
		state = EditorState.create({
			doc: initialState,
			schema,
			plugins: [
				history(),
				createShortcuts({
					splitParagraph: (state, dispatch) => ActionUtilities.splitParagraph(state, dispatch),
					subscript: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('superscript', state, dispatch, view, 'subscript'),
					superscript: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('subscript', state, dispatch, view, 'superscript'),
					strikethrough: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('strikethrough', state, dispatch, view),
					'align-left': (state, dispatch) =>
						ActionUtilities.setTextAlignment('left', state, dispatch),
					'align-right': (state, dispatch) =>
						ActionUtilities.setTextAlignment('right', state, dispatch),
					'align-center': (state, dispatch) =>
						ActionUtilities.setTextAlignment('center', state, dispatch),
					'align-justify': (state, dispatch) =>
						ActionUtilities.setTextAlignment('justify', state, dispatch),
					undo: undo,
					redo: redo,
					bold: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('bold', state, dispatch, view),
					italic: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('italic', state, dispatch, view),
					dedent: (state, dispatch) => ActionUtilities.dent('dedent', state, dispatch),
					indent: (state, dispatch) => ActionUtilities.dent('indent', state, dispatch),
					underline: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('underline', state, dispatch, view),
					overline: (state, dispatch, view) =>
						ActionUtilities.toggleTextMark('overline', state, dispatch, view)
				}),
				// TODO: We might want to write our own base commands
				// instead of using prosemirror-commands.
				keymap(baseKeymap),
				...ProseMirrorPlugins.plugins
			]
		});

		view = new EditorView(el, {
			state,
			dispatchTransaction: (transaction) => handleTransaction(view, transaction)
		});

		const obsId = crypto.randomUUID();
		const deregister = Editors.register(id, view, obsId, el.querySelector('.ProseMirror')!);
		// [...PageLayout.paginateRange(view, 0)];
		return () => deregister();
	});
</script>

<div onfocusincapture={() => TabState.activate(id)}>
	<div class="editor-host" bind:this={el}></div>
</div>

<style>
	.editor-host {
		& > :global([contenteditable]) {
			outline: none;
		}
	}
</style>
