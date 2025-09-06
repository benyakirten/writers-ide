import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ReplaceAroundStep, Step } from 'prosemirror-transform';

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

	return remapToNewTransaction(view, newSteps);
}

function applyPeerTransactionToLastPeer(view: EditorView, transaction: Transaction): Transaction {
	const steps: Step[] = [];
	for (let i = 0; i < transaction.steps.length - 1; i++) {
		const step = transaction.steps[i];
		if (!(step instanceof ReplaceAroundStep)) {
			steps.push(step);
			continue;
		}

		const node = view.state.doc.nodeAt(step.from);
		if (!node) {
			steps.push(step);
			continue;
		}

		const nextStep = transaction.steps[i + 1];
		if (!(nextStep instanceof ReplaceAroundStep)) {
			steps.push(step);
			continue;
		}

		const nextNode = view.state.doc.nodeAt(nextStep.from);
		if (!nextNode) {
			steps.push(step);
			continue;
		}

		if (!node.attrs['peer'] && nextNode.attrs['peer']) {
			steps.push(nextStep);
			i++;
		}
	}

	return remapToNewTransaction(view, steps);
}

function remapToNewTransaction(view: EditorView, steps: Step[]): Transaction {
	const { tr } = view.state;
	steps.forEach((step) => tr.step(step));
	return tr;
}
