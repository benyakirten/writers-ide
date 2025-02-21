<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, Plugin, Transaction } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import { keymap } from 'prosemirror-keymap';
	import { undo, redo, history } from 'prosemirror-history';
	import { baseKeymap } from 'prosemirror-commands';

	import { schema } from './schema.js';
	import { indentLess, indentMore, toggleBold, toggleItalics } from './actions.js';
	import TabState from '../../state/tab-state.svelte.js';

	let { index, id, plugins = [] }: { index: number; id: string; plugins?: Plugin[] } = $props();

	let el: HTMLElement;
	let state: EditorState;
	let view: EditorView;
	let deregister: () => void;
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
				keymap(baseKeymap),
				...plugins
			]
		});

		view = new EditorView(el, {
			state,
			dispatchTransaction: (transaction) => handleTransaction(view, transaction)
		});

		deregister = TabState.registerEditor(id, view);
		return () => {
			view.destroy();
			deregister?.();
		};
	});
</script>

<div class="outer-container" onfocusincapture={() => TabState.activate(id)}>
	<div class="editor-host" bind:this={el}></div>
</div>

<style>
	.outer-container {
		width: 100%;
		height: 100%;
	}

	.editor-host {
		& > :global([contenteditable]) {
			outline: none;
		}

		& :global(.paragraph) {
			margin: 0;
			padding: 0;
		}
	}
</style>
