<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, Transaction } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import { keymap } from 'prosemirror-keymap';
	import { undo, redo, history } from 'prosemirror-history';
	import { baseKeymap } from 'prosemirror-commands';

	import { schema } from './schema.js';
	import { indentLess, indentMore, toggleBold, toggleItalics } from './actions.js';
	let el: HTMLElement;
	let state: EditorState;
	let view: EditorView;
	let initialState = schema.node('doc', null, [
		schema.node('paragraph', null, [schema.text('This is a basic paragraph with no children.')]),
		schema.node('paragraph', null, [schema.text('This is a paragraph with more nodes.')])
	]);

	function handleTransaction(view: EditorView, transaction: Transaction) {
		let newState = view.state.apply(transaction);
		view.updateState(newState);
	}

	onMount(() => {
		state = EditorState.create({
			doc: initialState,
			schema,
			plugins: [
				history(),
				keymap({
					'Mod-z': undo,
					'Mod-y': redo,
					'Mod-b': toggleBold,
					'Mod-i': toggleItalics,
					'Mod-[': indentLess,
					'Mod-]': indentMore
				}),
				keymap(baseKeymap)
			]
		});
		view = new EditorView(el, {
			state,
			dispatchTransaction: (transaction) => handleTransaction(view, transaction)
		});
	});
</script>

<div class="editor-host" bind:this={el}></div>
<p>This is outside of the editor.</p>

<style>
	.editor-host > :global([contenteditable]) {
		outline: none;
	}
</style>
