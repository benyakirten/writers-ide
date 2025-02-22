import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { findTextMarks } from './selection.js';
import { doesSelectionAllHaveMark } from './selection.js';

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

describe('doesSelectionAllHaveMark', () => {
	it('should return true if the entire selection is bold', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Bolder text', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Boldest text', [schema.mark('bOlD')])])
			],

			schema
		);

		const result = doesSelectionAllHaveMark(view.state.selection, view.state.doc, 'BoLD');
		expect(result).toBe(true);
	});

	it('should return false if the entire selection is not bold', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Not bold text')])],
			schema
		);

		const result = doesSelectionAllHaveMark(view.state.selection, view.state.doc, 'BOLD');
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

		const result = doesSelectionAllHaveMark(view.state.selection, view.state.doc, 'bolD');
		expect(result).toBe(false);
	});

	it('should return true if the selection is partially bold but fully within bold text', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bOlD')])])],
			schema,
			{ start: 1, end: 4 }
		);

		const result = doesSelectionAllHaveMark(view.state.selection, view.state.doc, 'bold');
		expect(result).toBe(true);
	});

	it('should return false if the selection is empty', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bOlD')])])],
			schema,
			{ start: 0, end: 0 }
		);

		const result = doesSelectionAllHaveMark(view.state.selection, view.state.doc, 'beLD');
		expect(result).toBe(false);
	});
});
