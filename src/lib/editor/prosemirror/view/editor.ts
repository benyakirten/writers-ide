import { Node as ProseMirrorNode } from 'prosemirror-model';
import ProseMirrorPlugins from '../plugins.svelte';
import { baseKeymap } from 'prosemirror-commands';
import { undo, redo, history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Transaction } from 'prosemirror-state';
import { createShortcuts } from '../plugins/shortcut.plugin';
import { ActionUtilities } from './actions';
import { schema } from './schema';
import { EditorView } from 'prosemirror-view';
import { Registry } from '@/utils/registry';
import Editors from '../prose-mirror-editor.svelte';

function createProseMirrorState(id: string, initialState: ProseMirrorNode) {
	const plugins = ProseMirrorPlugins.pluginRegistryFunctions.map((fn) => fn(id));
	return EditorState.create({
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
					ActionUtilities.toggleTextMark('overline', state, dispatch, view),
			}),
			// TODO: We might want to write our own base commands
			// instead of using prosemirror-commands.
			keymap(baseKeymap),
			...plugins,
		],
	});
}

export function createView(id: string, initialState: ProseMirrorNode, el: HTMLElement): () => void {
	const state = createProseMirrorState(id, initialState);
	const view = new EditorView(el, {
		state,
		dispatchTransaction: (transaction) => handleTransaction(view, transaction),
	});

	const obsId = crypto.randomUUID();
	const deregister = Editors.register(id, view, obsId, el.querySelector('.ProseMirror')!);
	return () => deregister();
}

export const TransactionHandlerRegistry = new Registry<
	(view: EditorView, tr: Transaction) => Transaction
>();

function handleTransaction(view: EditorView, transaction: Transaction) {
	for (const handler of TransactionHandlerRegistry.values()) {
		transaction = handler(view, transaction);
	}

	console.log({ ...transaction });
	const newState = view.state.apply(transaction);
	view.updateState(newState);
}
