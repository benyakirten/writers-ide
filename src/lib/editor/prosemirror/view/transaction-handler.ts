import { Registry } from '@/utils/registry';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export const TransactionHandlerRegistry = new Registry<
	(view: EditorView, tr: Transaction) => Transaction
>();

export function handleTransaction(view: EditorView, transaction: Transaction) {
	for (const handler of TransactionHandlerRegistry.values()) {
		transaction = handler(view, transaction);
	}

	const newState = view.state.apply(transaction);
	view.updateState(newState);
}
