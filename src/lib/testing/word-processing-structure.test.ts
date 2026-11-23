// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import {
	AllSelection,
	EditorState,
	NodeSelection,
	Selection,
	TextSelection,
} from 'prosemirror-state';
import {
	groupSelectedBlocks,
	identifyBlockGroup,
	type SelectedBlockGroup,
} from '@writers-ide/word-processing/structure';

const schema = new Schema({
	nodes: {
		doc: { content: 'page+' },
		page: { content: 'block*', attrs: { index: { default: -1 } } },
		paragraph: {
			group: 'block',
			content: 'text*',
			attrs: { peer: { default: false } },
		},
		pageEnd: { group: 'block', atom: true, selectable: false },
		text: {},
	},
});
const paragraph = (text: string, peer = false) =>
	schema.node('paragraph', { peer }, text ? schema.text(text) : undefined);
const page = (...blocks: ProseMirrorNode[]) => schema.node('page', { index: 999 }, blocks);

function fixture() {
	const head = paragraph('head');
	const continuation = paragraph('continued', true);
	const middle = paragraph('middle');
	const final = paragraph('final');
	const pageEnd = schema.node('pageEnd');
	const first = page(head);
	const second = page(continuation, middle);
	const doc = schema.node('doc', null, [first, second, page(final, pageEnd)]);
	const peerPosition = first.nodeSize + 1;
	const finalPosition = first.nodeSize + second.nodeSize + 1;
	const groups: SelectedBlockGroup[] = [
		{
			kind: 'continuation',
			head: { node: head, position: 1 },
			continuation: { node: continuation, position: peerPosition },
		},
		{ kind: 'single', block: { node: middle, position: peerPosition + continuation.nodeSize } },
		{ kind: 'single', block: { node: final, position: finalPosition } },
	];
	const endGroup: SelectedBlockGroup = {
		kind: 'single',
		block: { node: pageEnd, position: finalPosition + final.nodeSize },
	};
	return { doc, groups, endGroup, final, finalPosition, peerPosition };
}

describe('read-only document structure helpers', () => {
	it.each([false, true])('groups forward/reversed text selections (reversed: %s)', (reversed) => {
		const { doc, groups, final, finalPosition } = fixture();
		const end = finalPosition + final.nodeSize - 1;
		const selection = TextSelection.create(doc, reversed ? end : 2, reversed ? 2 : end);
		const state = EditorState.create({ doc, selection });
		expect(groupSelectedBlocks(state)).toEqual(groups);
	});

	it('identifies either continuation half by document order, not page index attributes', () => {
		const { doc, groups, peerPosition } = fixture();
		const state = EditorState.create({ doc });
		for (const position of [1, 2, peerPosition, peerPosition + 1]) {
			expect(identifyBlockGroup(state, position)).toEqual(groups[0]);
		}
	});

	it('includes the head when only the continuation caret is selected', () => {
		const { doc, groups, peerPosition } = fixture();
		const state = EditorState.create({
			doc,
			selection: TextSelection.create(doc, peerPosition + 1),
		});
		expect(groupSelectedBlocks(state)).toEqual([groups[0]]);
	});

	it('traverses AllSelection and includes a final leaf block exactly once', () => {
		const { doc, groups, endGroup } = fixture();
		const state = EditorState.create({ doc, selection: new AllSelection(doc) });
		expect(groupSelectedBlocks(state)).toEqual([...groups, endGroup]);
		expect(identifyBlockGroup(state, doc.content.size - 1)).toBeNull();
		expect(identifyBlockGroup(state, doc.content.size)).toBeNull();
	});

	it('handles a block NodeSelection and a leaf NodeSelection at page depth', () => {
		const { doc, groups, endGroup, finalPosition } = fixture();
		const state = EditorState.create({ doc, selection: NodeSelection.create(doc, finalPosition) });
		expect(groupSelectedBlocks(state)).toEqual([groups[2]]);
		const leaf = EditorState.create({
			doc,
			selection: NodeSelection.create(doc, finalPosition + fixture().final.nodeSize),
		});
		expect(groupSelectedBlocks(leaf)).toEqual([endGroup]);
	});

	it('finds the last text caret before an unselectable page end', () => {
		const { doc, groups } = fixture();
		const state = EditorState.create({
			doc,
			selection: Selection.near(doc.resolve(doc.content.size), -1),
		});
		expect(groupSelectedBlocks(state)).toEqual([groups[2]]);
	});

	it('handles final pages without a sentinel and first-page orphan peer flags', () => {
		const block = paragraph('only', true);
		const doc = schema.node('doc', null, page(block));
		const state = EditorState.create({ doc, selection: Selection.atEnd(doc) });
		expect(groupSelectedBlocks(state)).toEqual([
			{ kind: 'single', block: { node: block, position: 1 } },
		]);
	});

	it('keeps the existing empty-page selection behavior', () => {
		const doc = schema.node('doc', null, page());
		const state = EditorState.create({ doc, selection: new AllSelection(doc) });
		expect(groupSelectedBlocks(state)).toEqual([]);
		expect(identifyBlockGroup(state, 0)).toBeNull();
	});

	it('returns original immutable nodes without creating transactions or requiring a DOM', () => {
		const { doc, groups } = fixture();
		const state = EditorState.create({ doc, selection: new AllSelection(doc) });
		const json = doc.toJSON();
		const transactions = vi.spyOn(EditorState.prototype, 'tr', 'get');
		try {
			const result = groupSelectedBlocks(state);
			expect(transactions).not.toHaveBeenCalled();
			expect(state.doc).toBe(doc);
			expect(doc.toJSON()).toEqual(json);
			expect(result[0]).toEqual(groups[0]);
			const first = result[0];
			if (first.kind === 'continuation') {
				expect(first.head.node).toBe(doc.firstChild!.firstChild);
			}
			expect(typeof document).toBe('undefined');
		} finally {
			transactions.mockRestore();
		}
	});
});
