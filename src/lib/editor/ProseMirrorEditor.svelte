<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, Transaction } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import { keymap } from 'prosemirror-keymap';
	import { undo, redo, history } from 'prosemirror-history';
	import { baseKeymap } from 'prosemirror-commands';

	import { schema } from './schema.js';
	import { isSelectionAllBold, isSelectionAllItalics } from './selection.js';
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

	function toggleBold(): boolean {
		const { tr } = view.state;
		const { from, to } = tr.selection;
		if (from === to) {
			return false;
		}

		if (isSelectionAllBold(tr)) {
			tr.removeMark(from, to, schema.marks.strong);
			view.dispatch(tr);
			return true;
		}

		tr.addMark(from, to, schema.marks.strong.create());
		view.dispatch(tr);
		return true;
	}

	function toggleItalics(): boolean {
		const { tr } = view.state;
		const { from, to } = tr.selection;
		if (from === to) {
			return false;
		}

		if (isSelectionAllItalics(tr)) {
			tr.removeMark(from, to, schema.marks.em);
			view.dispatch(tr);
			return true;
		}

		tr.addMark(from, to, schema.marks.em.create());
		view.dispatch(tr);
		return true;
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
					'Mod-i': toggleItalics
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
