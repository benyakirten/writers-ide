import { Node as ProseMirrorNode } from 'prosemirror-model';
import { baseKeymap } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { EditorView } from 'prosemirror-view';

import { Registry } from '$lib/utils/registry';
import proseMirrorEventBus, {
	ProseMirrorEventBusEventType,
} from '$lib/editor/state/event-bus.svelte';
import ProseMirrorPlugins from '../plugins.svelte';
import { undo, redo, history } from 'prosemirror-history';
import { EditorState, Transaction } from 'prosemirror-state';
import { createShortcuts } from '../plugins/shortcut.plugin';
import { ActionUtilities } from './actions';
import { schema } from './schema';
import Editors from '../prose-mirror-editor.svelte';

function createProseMirrorState(id: string, initialState: ProseMirrorNode) {
	const plugins = ProseMirrorPlugins.pluginRegistryFunctions.map((fn) => fn(id));
	return EditorState.create({
		doc: initialState,
		schema,
		plugins: [
			history(),
			// TODO: There should be global shortcuts
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

export function createView(
	id: string,
	fileName: string,
	initialState: ProseMirrorNode,
	el: HTMLElement,
	viewport: HTMLElement = el,
): () => void {
	let state = createProseMirrorState(id, initialState);
	const indexed = indexPages(state.tr);
	if (indexed.docChanged) state = state.apply(indexed);
	const view = new EditorView(el, {
		state,
		dispatchTransaction: (transaction) => handleTransaction(id, view, transaction),
	});

	const obsId = crypto.randomUUID();
	const deregister = Editors.register(id, fileName, view, obsId, viewport);
	return () => deregister();
}

export const TransactionHandlerRegistry = new Registry<
	(view: EditorView, tr: Transaction) => Transaction
>();

// Keep indexes in the model before rendering: mutating parsed data-index attributes
// independently can feed back through ProseMirror's DOM observer.
function indexPages(tr: Transaction): Transaction {
	tr.doc.forEach((node, offset, index) => {
		if (node.type.name === 'page' && node.attrs.index !== index)
			tr.setNodeAttribute(offset, 'index', index);
	});
	return tr;
}

function handleTransaction(id: string, view: EditorView, transaction: Transaction) {
	for (const handler of TransactionHandlerRegistry.values()) {
		transaction = handler(view, transaction);
	}

	if (transaction.docChanged) indexPages(transaction);
	proseMirrorEventBus.update({
		id,
		event: { type: ProseMirrorEventBusEventType.PreUpdate, view, tr: transaction },
	});

	const newState = view.state.apply(transaction);
	view.updateState(newState);
}
