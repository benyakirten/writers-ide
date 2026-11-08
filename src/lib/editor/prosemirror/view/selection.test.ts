import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Schema, Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { SelectionUtilities } from './selection';
import { INDENT_MAX } from './constants';
import { schema } from './schema';

function createEditorView(
	nodes: Node[],
	schema: Schema,
	selection?: { start?: number; end?: number },
) {
	const element = document.createElement('div');

	const doc = schema.node('doc', null, [schema.node('page', { index: 0 }, nodes)]);
	doc.check();
	const state = EditorState.create({
		doc,
		schema,
		selection: TextSelection.create(
			doc,
			selection?.start ?? 2,
			selection?.end ?? doc.content.size - 2,
		),
	});
	return new EditorView(element, { state });
}

describe('findTextMarks', () => {
	it('should normalize mixed-case mark names from the current schema', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Code', [schema.mark('inlineCode')])])],
			schema,
		);

		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(1);
		expect(got.get('inlinecode')).toBe(1);
	});

	it('should identify partial marks with no overlap', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])]),
			],
			schema,
		);

		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);

		expect(got.size).toBe(2);
		expect(got.get('bold')).toBe(10 / 21);
		expect(got.get('italic')).toBe(11 / 21);
	});

	it('should identify partial marks with overlap', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [
					schema.text('First Item', [schema.mark('bold'), schema.mark('italic')]),
				]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])]),
				schema.node('paragraph', null, [schema.text('Third item')]),
			],
			schema,
		);
		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);

		expect(got.size).toBe(2);
		expect(got.get('bold')).toBe(10 / 31);
		expect(got.get('italic')).toBe(21 / 31);
	});

	it('should identify complete marks', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])])],
			schema,
		);

		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(1);
		expect(got.get('bold')).toBe(1);
	});

	it('should identify complete marks across multiple nodes', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('bold')])]),
			],
			schema,
		);

		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(1);
		expect(got.get('bold')).toEqual(1);
	});

	it('should be able to identify mixed complete and partial marks', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bold'), schema.mark('italic')]),
				]),
			],
			schema,
		);

		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(2);
		expect(got.get('bold')).toEqual(1);
		expect(got.get('italic')).toEqual(11 / 21);
	});

	it('should get the correct ratio over a partial selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])]),
				schema.node('paragraph', null, [schema.text('Third item')]),
			],
			schema,
			{ start: 4 },
		);
		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(2);
		expect(got.get('bold')).toBe(8 / 29);
		expect(got.get('italic')).toBe(11 / 29);
	});

	it('should return empty sets if the selection is empty', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bold'), schema.mark('italic')]),
				]),
			],
			schema,
			{
				start: 5,
				end: 5,
			},
		);

		const got = SelectionUtilities.findTextMarks(view.state.selection, view.state.doc);
		expect(got.size).toBe(0);
	});
});

describe('doesSelectionHaveTextMark', () => {
	it('should return true if the entire selection is bold', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Bolder text', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Boldest text', [schema.mark('bold')])]),
			],

			schema,
		);

		const result = SelectionUtilities.doesSelectionHaveTextMark(
			view.state.selection,
			view.state.doc,
			'BoLD',
		);
		expect(result).toBe(true);
	});

	it('should return false if the entire selection is not bold', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Not bold text')])],
			schema,
		);

		const result = SelectionUtilities.doesSelectionHaveTextMark(
			view.state.selection,
			view.state.doc,
			'BOLD',
		);
		expect(result).toBe(false);
	});

	it('should return false if part of the selection is not bold', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [
					schema.text('Bold text', [schema.mark('bold')]),
					schema.text(' and not bold text'),
				]),
			],
			schema,
		);

		const result = SelectionUtilities.doesSelectionHaveTextMark(
			view.state.selection,
			view.state.doc,
			'bolD',
		);
		expect(result).toBe(false);
	});

	it('should return true if the selection is partially bold but fully within bold text', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bold')])])],
			schema,
			{ start: 2, end: 5 },
		);

		const result = SelectionUtilities.doesSelectionHaveTextMark(
			view.state.selection,
			view.state.doc,
			'bold',
		);
		expect(result).toBe(true);
	});

	it('should return false if the selection is empty', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('Bold text', [schema.mark('bold')])])],
			schema,
			{ start: 2, end: 2 },
		);

		const result = SelectionUtilities.doesSelectionHaveTextMark(
			view.state.selection,
			view.state.doc,
			'BoLD',
		);
		expect(result).toBe(false);
	});
});

describe('getIndentRatio', () => {
	it('should return null if there are no paragraphs', () => {
		const view = createEditorView(
			[schema.node('code', null, [schema.text('First paragraph')])],
			schema,
		);
		const result = SelectionUtilities.getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBeNull();
	});

	it('should return 0 if there are paragraphs but no indents', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: 0 }, [schema.text('First paragraph')]),
				schema.node('paragraph', { indent: 0 }, [schema.text('Second paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe(0);
	});

	it('should return the correct ratio of indents', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: 2 }, [schema.text('First paragraph')]),
				schema.node('paragraph', { indent: 1 }, [schema.text('Second paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe((2 + 1) / (INDENT_MAX * 2));
	});

	it('should handle mixed indents and no indents', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: 2 }, [schema.text('First paragraph')]),
				schema.node('paragraph', { indent: 0 }, [schema.text('Second paragraph')]),
				schema.node('paragraph', { indent: 1 }, [schema.text('Third paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe((2 + 1) / (INDENT_MAX * 3));
	});

	it('should return the correct ratio for a partial selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { indent: 2 }, [schema.text('First paragraph')]),
				schema.node('paragraph', { indent: 1 }, [schema.text('Second paragraph')]),
				schema.node('paragraph', null, [schema.text('Third paragraph')]),
			],
			schema,
			{ start: 2, end: 4 },
		);
		const result = SelectionUtilities.getIndentRatio(view.state.selection, view.state.doc);
		expect(result).toBe(2 / INDENT_MAX);
	});
});

describe('getBlockAttributeRatio', () => {
	it('should return 0 if there are no paragraphs', () => {
		const view = createEditorView(
			[schema.node('code', null, [schema.text('Code block text')])],
			schema,
		);
		const result = SelectionUtilities.getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			'center',
		);
		expect(result).toBe(0);
	});

	it('should return 0 if no paragraphs have the specified attribute value', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'left' }, [schema.text('First paragraph')]),
				schema.node('paragraph', { align: 'left' }, [schema.text('Second paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			'center',
		);
		expect(result).toBe(0);
	});

	it('should return the correct ratio of paragraphs with the specified attribute value', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'center' }, [schema.text('First paragraph')]),
				schema.node('paragraph', { align: 'left' }, [schema.text('Second paragraph')]),
				schema.node('paragraph', { align: 'center' }, [schema.text('Third paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			'center',
		);
		expect(result).toBe(2 / 3);
	});

	it('should handle mixed attribute values and no attribute', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'center' }, [schema.text('First paragraph')]),
				schema.node('paragraph', { indent: 0 }, [schema.text('Second paragraph')]),
				schema.node('paragraph', { align: 'center' }, [schema.text('Third paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			'center',
		);
		expect(result).toBe(2 / 3);
	});

	it('should return the correct ratio for a partial selection', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'center' }, [schema.text('First paragraph')]),
				schema.node('paragraph', { align: 'left' }, [schema.text('Second paragraph')]),
				schema.node('paragraph', { align: 'center' }, [schema.text('Third paragraph')]),
			],
			schema,
			{ start: 2, end: 4 },
		);
		const result = SelectionUtilities.getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			'center',
		);
		expect(result).toBe(1);
	});

	it('should return the correct ratio when using a function to check attribute value', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', { align: 'center' }, [schema.text('First paragraph')]),
				schema.node('paragraph', { align: 'left' }, [schema.text('Second paragraph')]),
				schema.node('paragraph', { align: 'center' }, [schema.text('Third paragraph')]),
			],
			schema,
		);
		const result = SelectionUtilities.getBlockAttributeRatio(
			view.state.selection,
			view.state.doc,
			'align',
			(val) => val === 'center',
		);
		expect(result).toBe(2 / 3);
	});
});
