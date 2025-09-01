import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export function peerHandler(_: EditorView, transaction: Transaction): Transaction {
	return transaction;
}
