<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, type Transaction } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import { keymap } from 'prosemirror-keymap';
	import { undo, redo, history } from 'prosemirror-history';
	import { baseKeymap } from 'prosemirror-commands';

	import { schema } from './schema';
	import { ActionUtilities } from './actions';
	import TabState from '../../state/tab-state.svelte';
	import { createShortcuts } from '../plugins/shortcut.plugin';
	import type { TabComponentProps } from '@/editor/state/tab-state-registry.svelte';
	import ProseMirrorPlugins from '../plugins.svelte';
	import Editors from '../prose-mirror-editor.svelte';
	import { shortPages } from './sample-data';

	let { id }: TabComponentProps = $props();

	let el: HTMLElement;
	let host: HTMLElement;
	let state: EditorState;
	let view: EditorView;
	let initialState = schema.node('doc', null, shortPages);

	function handleTransaction(view: EditorView, transaction: Transaction) {
		let newState = view.state.apply(transaction);
		view.updateState(newState);
	}

	onMount(() => {
		state = EditorState.create({
			doc: initialState,
			schema,
			plugins: [
				// TODO: Replace this
				history(),
				createShortcuts({
					splitParagraph: (state, dispatch, view) =>
						ActionUtilities.splitParagraph(state, dispatch),
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
				keymap(baseKeymap),
				...ProseMirrorPlugins.plugins
			]
		});

		view = new EditorView(el, {
			state,
			dispatchTransaction: (transaction) => handleTransaction(view, transaction)
		});

		const deregister = Editors.register(id, view);
		return () => deregister();
	});
</script>

<div onfocusincapture={() => TabState.activate(id)} bind:this={host}>
	<div class="editor-host" bind:this={el}></div>
</div>

<style>
	.editor-host {
		& > :global([contenteditable]) {
			outline: none;
		}
	}
</style>
