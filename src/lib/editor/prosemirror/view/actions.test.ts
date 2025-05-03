import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Schema, Node } from 'prosemirror-model';

import { schema } from './schema';
import { ActionUtilities } from './actions';
import { INDENT_MIN, INDENT_MAX } from './constants';

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

		const got = ActionUtilities.toggleTextMark('bold', view.state);
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

		const got = ActionUtilities.toggleTextMark('bold', view.state, view.dispatch, view);
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

		const got = ActionUtilities.toggleTextMark('bold', view.state, view.dispatch, view);
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

		const got = ActionUtilities.toggleTextMark('bold', view.state, view.dispatch, view);
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

		const got = ActionUtilities.toggleTextMark('bold', view.state, view.dispatch, view);
		expect(got).toBe(true);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(1);
		expect(text1.marks[0].type.name).toBe('bold');

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(2);
		expect(text2.marks[0].type.name).toBe('italic');
		expect(text2.marks[1].type.name).toBe('bold');
	});

	it("should remove the exclusive mark if it's present and the mark will be added to the selection", () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])])
			],
			schema
		);

		const got = ActionUtilities.toggleTextMark('bold', view.state, view.dispatch, view, 'italic');
		expect(got).toBe(true);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(1);
		expect(text1.marks[0].type.name).toBe('bold');

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(1);
		expect(text2.marks[0].type.name).toBe('bold');
	});

	it('should not remove the exclusive mark if the mark will be removed', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bold'), schema.mark('italic')])
				])
			],
			schema
		);

		const got = ActionUtilities.toggleTextMark('bold', view.state, view.dispatch, view, 'italic');
		expect(got).toBe(true);

		const text1 = view.state.doc.content.content[0].content.content[0];
		expect(text1.marks.length).toBe(0);

		const text2 = view.state.doc.content.content[1].content.content[0];
		expect(text2.marks.length).toBe(1);
		expect(text2.marks[0].type.name).toBe('italic');
	});
});

describe('dent', () => {
	it('should return false if dispatch is not provided', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: 1 }, [schema.text('First Item')]),
				schema.node('paragraph', { indent: 2 }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.dent('indent', view.state);
		expect(got).toBe(false);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.indent).toBe(1);

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.indent).toBe(2);
	});

	it('should increase the indent of paragraphs in the selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: INDENT_MAX - 2 }, [schema.text('First Item')]),
				schema.node('paragraph', { indent: INDENT_MAX - 1 }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.dent('indent', view.state, view.dispatch);
		expect(got).toBe(true);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.indent).toBe(INDENT_MAX - 1);

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.indent).toBe(INDENT_MAX);
	});

	it('should decrease the indent of paragraphs in the selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: INDENT_MIN + 1 }, [schema.text('First Item')]),
				schema.node('paragraph', { indent: INDENT_MIN + 2 }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.dent('dedent', view.state, view.dispatch);
		expect(got).toBe(true);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.indent).toBe(INDENT_MIN);

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.indent).toBe(INDENT_MIN + 1);
	});

	it('should prevent the indent from being less than INDENT_MIN', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: INDENT_MIN }, [schema.text('First Item')]),
				schema.node('paragraph', { indent: INDENT_MAX }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.dent('dedent', view.state, view.dispatch);
		expect(got).toBe(true);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.indent).toBe(INDENT_MIN);

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.indent).toBe(INDENT_MAX - 1);
	});

	it('should prevent the indent from being more than INDENT_MX', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: INDENT_MIN }, [schema.text('First Item')]),
				schema.node('paragraph', { indent: INDENT_MAX }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.dent('indent', view.state, view.dispatch);
		expect(got).toBe(true);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.indent).toBe(INDENT_MIN + 1);

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.indent).toBe(INDENT_MAX);
	});
});

describe('setTextAlignment', () => {
	it('should return false if dispatch is not provided', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'left' }, [schema.text('First Item')]),
				schema.node('paragraph', { align: 'right' }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.setTextAlignment('center', view.state);
		expect(got).toBe(false);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.align).toBe('left');

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.align).toBe('right');
	});

	it('should set the alignment of paragraphs in the selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'left' }, [schema.text('First Item')]),
				schema.node('paragraph', { align: 'right' }, [schema.text('Second item')])
			],
			schema
		);

		const got = ActionUtilities.setTextAlignment('center', view.state, view.dispatch);
		expect(got).toBe(true);

		const paragraph1 = view.state.doc.content.content[0];
		expect(paragraph1.attrs.align).toBe('center');

		const paragraph2 = view.state.doc.content.content[1];
		expect(paragraph2.attrs.align).toBe('center');
	});

	it('should not change alignment if no paragraphs are in the selection', () => {
		const view = createEditorView(
			[
				schema.node('heading', [schema.text('First Item')]),
				schema.node('paragraph', { align: 'right' }, [schema.text('Second item')])
			],
			schema,
			{
				start: 0,
				end: 2
			}
		);

		const got = ActionUtilities.setTextAlignment('center', view.state, view.dispatch);
		expect(got).toBe(true);

		const paragraph = view.state.doc.content.content[1];
		expect(paragraph.attrs.align).toBe('right');
	});
});
