import type { Transaction } from 'prosemirror-state';

/** Normalize parsed model attributes before rendering, including managed appended transactions. */
export function normalizePageIndexes(transaction: Transaction): Transaction {
	const { storedMarks } = transaction;
	transaction.doc.forEach((node, offset, index) => {
		if (node.type.name === 'page' && node.attrs.index !== index) {
			transaction.setNodeAttribute(offset, 'index', index);
		}
	});
	if (storedMarks !== null) {
		transaction.setStoredMarks(storedMarks);
	}
	return transaction;
}
