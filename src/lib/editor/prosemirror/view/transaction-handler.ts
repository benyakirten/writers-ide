import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export function handleTransaction(view: EditorView, transaction: Transaction) {
	const newState = view.state.apply(transaction);
	view.updateState(newState);
}
