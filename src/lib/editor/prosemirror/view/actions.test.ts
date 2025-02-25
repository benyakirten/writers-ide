import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Schema, Node } from 'prosemirror-model';

import { schema } from './schema.js';
import { toggleTextMark } from './actions.js';

function createEditorView(
	nodes: Node[],
	schema: Schema,
	selection?: { start?: number; end?: number }
) {
	const element = document.createElement('div');

	const doc = schema.node('doc', null, nodes);
	const state = EditorState.create({
		doc,
		schema,
		selection: TextSelection.create(doc, selection?.start ?? 0, selection?.end ?? doc.content.size)
	});
	return new EditorView(element, { state });
}

describe('toggleTextMark', () => {
	it('should return false if view or dispatch is not provided', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])])
			],
			schema
		);

		const got = toggleTextMark('bold', view.state);
		expect(got).toBe(false);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(1);
		expect(text1.marks[0].type.name).toBe('bold');

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(1);
		expect(text2.marks[0].type.name).toBe('italic');
	});

	it('should return false if selection is empty', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])])
			],
			schema,
			{
				start: 0,
				end: 0
			}
		);

		const got = toggleTextMark('bold', view.state, view.dispatch, view);
		expect(got).toBe(false);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(1);
		expect(text1.marks[0].type.name).toBe('bold');

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(1);
		expect(text2.marks[0].type.name).toBe('italic');
	});

	it('should remove the mark if every text in the selection has the mark', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bold'), schema.mark('italic')])
				])
			],
			schema
		);

		const got = toggleTextMark('bold', view.state, view.dispatch, view);
		expect(got).toBe(true);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(0);

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(1);
		expect(text2.marks[0].type.name).toBe('italic');
	});

	it("should add the mark if every text in the selection doesn't have the mark", () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item')]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])])
			],
			schema
		);

		const got = toggleTextMark('bold', view.state, view.dispatch, view);
		expect(got).toBe(true);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(1);
		expect(text1.marks[0].type.name).toBe('bold');

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(2);
		expect(text2.marks[0].type.name).toBe('italic');
		expect(text2.marks[1].type.name).toBe('bold');
	});

	it('should add the mark if the mark is not present on every text in the selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])])
			],
			schema
		);

		const got = toggleTextMark('bold', view.state, view.dispatch, view);
		expect(got).toBe(true);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(1);
		expect(text1.marks[0].type.name).toBe('bold');

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(2);
		expect(text2.marks[0].type.name).toBe('italic');
		expect(text2.marks[1].type.name).toBe('bold');
	});
});

// it('should add mark if selection does not have the mark', () => {
//     const state = EditorState.create({ schema });
//     const view = new EditorView(null, { state });
//     const dispatch = vi.fn();
//     const tr = state.tr.setSelection(state.selection.constructor.create(state.doc, 0, 5));
//     view.state = state.apply(tr);
//     view.dispatch = dispatch;

//     expect(toggleTextMark('bold', view.state, dispatch, view)).toBe(true);
//     expect(dispatch).toHaveBeenCalled();
//     expect(dispatch.mock.calls[0][0].steps[0].toJSON().stepType).toBe('addMark');
// });

// it('should remove exclusive mark if provided', () => {
//     const state = EditorState.create({ schema });
//     const view = new EditorView(null, { state });
//     const dispatch = vi.fn();
//     const tr = state.tr.setSelection(state.selection.constructor.create(state.doc, 0, 5));
//     view.state = state.apply(tr);
//     view.dispatch = dispatch;

//     expect(toggleTextMark('bold', view.state, dispatch, view, 'em')).toBe(true);
//     expect(dispatch).toHaveBeenCalled();
//     expect(dispatch.mock.calls[0][0].steps[1].toJSON().stepType).toBe('removeMark');
// });
