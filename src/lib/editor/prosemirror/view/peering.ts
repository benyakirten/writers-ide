import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ReplaceAroundStep } from 'prosemirror-transform';

import {
	PEERED_TRANSACTION_BOTH_META_VALUE,
	PEERED_TRANSACTION_FIRST_META_VALUE,
	PEERED_TRANSACTION_LAST_META_VALUE,
	PEERED_TRANSACTION_META_KEY,
} from './constants';

export function peerHandler(view: EditorView, transaction: Transaction): Transaction {
	switch (transaction.getMeta(PEERED_TRANSACTION_META_KEY)) {
		case PEERED_TRANSACTION_BOTH_META_VALUE:
			return applyPeerTransactionToBothPeers(view, transaction);
		case PEERED_TRANSACTION_FIRST_META_VALUE:
			return applyPeerTransactionToFirstPeer(view, transaction);
		case PEERED_TRANSACTION_LAST_META_VALUE:
			return applyPeerTransactionToLastPeer(view, transaction);
		default:
			break;
	}
	return transaction;
}

function applyPeerTransactionToBothPeers(view: EditorView, transaction: Transaction): Transaction {
	return transaction;
}

function applyPeerTransactionToFirstPeer(view: EditorView, transaction: Transaction): Transaction {
	const newSteps = transaction.steps.filter((step) => {
		if (!(step instanceof ReplaceAroundStep)) {
			return true;
		}

		const node = view.state.doc.nodeAt(step.from);
		return !node?.attrs['peer'];
	});

	const { tr } = view.state;
	newSteps.forEach((step) => tr.step(step));

	return tr;
}

function applyPeerTransactionToLastPeer(view: EditorView, transaction: Transaction): Transaction {
	return transaction;
}
