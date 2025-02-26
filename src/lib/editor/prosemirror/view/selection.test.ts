import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { findTextMarks, getBlockAttributeRatio } from './selection.js';
import { doesSelectionHaveTextMark } from './selection.js';
import { getIndentRatio } from './selection.js';
import { INDENT_MAX } from './constants.js';
import { schema as realSchema } from './schema.js';

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

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
		text: { inline: true, group: 'inline' }
	},
	marks: {
		bOlD: {
			parseDom: [{ tag: 'strong' }],
			toDOM: () => ['strong']
		},
		itaLIC: {
			parseDOM: [{ tag: 'em' }],
			toDOM: () => ['em']
		}
	}
});

describe('findTextMarks', () => {
	it('should identify partial marks with no overlap', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('itaLIC')])])
			],
			schema
		);

		const got = findTextMarks(view.state.selection, view.state.doc);

		expect(got.size).toBe(2);
		expect(got.get('bold')).toBe(10 / 21);
		expect(got.get('italic')).toBe(11 / 21);
	});

	it('should identify partial marks with overlap', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [
					schema.text('First Item', [schema.mark('bOlD'), schema.mark('itaLIC')])
				]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('itaLIC')])]),
				schema.node('paragraph', null, [schema.text('Third item')])
			],
			schema
		);
		const got = findTextMarks(view.state.selection, view.state.doc);

		expect(got.size).toBe(2);
		expect(got.get('bold')).toBe(10 / 31);
		expect(got.get('italic')).toBe(21 / 31);
	});

	it('should identify complete marks', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])])],
			schema
		);

		const got = findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(1);
		expect(got.get('bold')).toBe(1);
	});

	it('should identify complete marks across multiple nodes', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('bOlD')])])
			],
			schema
		);

		const got = findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(1);
		expect(got.get('bold')).toEqual(1);
	});

	it('should be able to identify mixed complete and partial marks', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bOlD'), schema.mark('itaLIC')])
				])
			],
			schema
		);

		const got = findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(2);
		expect(got.get('bold')).toEqual(1);
		expect(got.get('italic')).toEqual(11 / 21);
	});

	it('should get the correct ratio over a partial selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('itaLIC')])]),
				schema.node('paragraph', null, [schema.text('Third item')])
			],
			schema,
			{ start: 3 }
		);
		const got = findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(2);
		expect(got.get('bold')).toBe(8 / 29);
		expect(got.get('italic')).toBe(11 / 29);
	});

	it('should return empty sets if the selection is empty', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bOlD'), schema.mark('itaLIC')])
				])
			],
			schema,
			{
				start: 5,
				end: 5
			}
		);

		const got = findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(0);
	});
});

describe('doesSelectionHaveTextMark', () => {
	it('should return true if the entire selection is bold', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Bolder text', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Boldest text', [schema.mark('bOlD')])])
			],

			schema
		);

		const result = doesSelectionHaveTextMark(view.state.selection, view.state.doc, 'BoLD');
		expect(result).toBe(true);
	});

	it('should return false if the entire selection is not bold', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Not bold text')])],
			schema
		);

		const result = doesSelectionHaveTextMark(view.state.selection, view.state.doc, 'BOLD');
		expect(result).toBe(false);
	});

	it('should return false if part of the selection is not bold', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [
					schema.text('Bold text', [schema.mark('bOlD')]),
					schema.text(' and not bold text')
				])
			],
			schema
		);

		const result = doesSelectionHaveTextMark(view.state.selection, view.state.doc, 'bolD');
		expect(result).toBe(false);
	});

	it('should return true if the selection is partially bold but fully within bold text', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bOlD')])])],
			schema,
			{ start: 1, end: 4 }
		);

		const result = doesSelectionHaveTextMark(view.state.selection, view.state.doc, 'bold');
		expect(result).toBe(true);
	});

	it('should return false if the selection is empty', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bOlD')])])],
			schema,
			{ start: 0, end: 0 }
		);

		const result = doesSelectionHaveTextMark(view.state.selection, view.state.doc, 'beLD');
		expect(result).toBe(false);
	});
});

describe('getIndentRatio', () => {
	it('should return null if there are no paragraphs', () => {
		const view = createEditorView(
			[realSchema.node('codeBlock', null, [realSchema.text('First paragraph')])],
			realSchema
		);
		const result = getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBeNull();
	});

	it('should return 0 if there are paragraphs but no indents', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', null, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', null, [realSchema.text('Second paragraph')])
			],
			realSchema
		);
		const result = getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe(0);
	});

	it('should return the correct ratio of indents', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { indent: 2 }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', { indent: 1 }, [realSchema.text('Second paragraph')])
			],
			realSchema
		);
		const result = getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe((2 + 1) / (INDENT_MAX * 2));
	});

	it('should handle mixed indents and no indents', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { indent: 2 }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', null, [realSchema.text('Second paragraph')]),
				realSchema.node('paragraph', { indent: 1 }, [realSchema.text('Third paragraph')])
			],
			realSchema
		);
		const result = getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe((2 + 1) / (INDENT_MAX * 3));
	});

	it('should return the correct ratio for a partial selection', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { indent: 2 }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', { indent: 1 }, [realSchema.text('Second paragraph')]),
				realSchema.node('paragraph', null, [realSchema.text('Third paragraph')])
			],
			realSchema,
			{ start: 0, end: 2 }
		);
		const result = getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe(2 / INDENT_MAX);
	});
});

describe('getBlockAttributeRatio', () => {
	it('should return 0 if there are no paragraphs', () => {
		const view = createEditorView(
			[realSchema.node('codeBlock', null, [realSchema.text('Code block text')])],
			realSchema
		);
		const result = getBlockAttributeRatio(view.state.selection, view.state.doc, 'align', 'center');
		expect(result).toBe(0);
	});

	it('should return 0 if no paragraphs have the specified attribute value', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { align: 'left' }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', { align: 'left' }, [realSchema.text('Second paragraph')])
			],
			realSchema
		);
		const result = getBlockAttributeRatio(view.state.selection, view.state.doc, 'align', 'center');
		expect(result).toBe(0);
	});

	it('should return the correct ratio of paragraphs with the specified attribute value', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', { align: 'left' }, [realSchema.text('Second paragraph')]),
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('Third paragraph')])
			],
			realSchema
		);
		const result = getBlockAttributeRatio(view.state.selection, view.state.doc, 'align', 'center');
		expect(result).toBe(2 / 3);
	});

	it('should handle mixed attribute values and no attribute', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', null, [realSchema.text('Second paragraph')]),
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('Third paragraph')])
			],
			realSchema
		);
		const result = getBlockAttributeRatio(view.state.selection, view.state.doc, 'align', 'center');
		expect(result).toBe(2 / 3);
	});

	it('should return the correct ratio for a partial selection', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', { align: 'left' }, [realSchema.text('Second paragraph')]),
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('Third paragraph')])
			],
			realSchema,
			{ start: 0, end: 2 }
		);
		const result = getBlockAttributeRatio(view.state.selection, view.state.doc, 'align', 'center');
		expect(result).toBe(1);
	});

	it('should return the correct ratio when using a function to check attribute value', () => {
		const view = createEditorView(
			[
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('First paragraph')]),
				realSchema.node('paragraph', { align: 'left' }, [realSchema.text('Second paragraph')]),
				realSchema.node('paragraph', { align: 'center' }, [realSchema.text('Third paragraph')])
			],
			realSchema
		);
		const result = getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			(val) => val === 'center'
		);
		expect(result).toBe(2 / 3);
	});
});
