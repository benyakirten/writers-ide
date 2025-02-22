import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { findTextMarks } from './selection.js';

function createEditorView(
	nodes: Node[],
	schema: Schema,
	selection?: { start: number; end: number }
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

describe('findTextMarks', () => {
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

	it('should identify partial marks with no overlap', () => {
		const view = createEditorView(
			[
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('itaLIC')])])
			],
			schema
		);

		const got = findTextMarks(view.state.selection, view.state.doc);

		expect(got.complete.size).toBe(0);
		expect(got.partial).toEqual(new Set(['bold', 'italic']));
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

		expect(got.complete.size).toBe(0);
		expect(got.partial).toEqual(new Set(['bold', 'italic']));
	});

	it('should identify complete marks', () => {
		const view = createEditorView(
			[schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bOlD')])])],
			schema
		);

		const got = findTextMarks(view.state.selection, view.state.doc);
		expect(got.complete).toEqual(new Set(['bold']));
		expect(got.partial.size).toBe(0);
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
		expect(got.complete).toEqual(new Set(['bold']));
		expect(got.partial.size).toBe(0);
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
		expect(got.complete).toEqual(new Set(['bold']));
		expect(got.partial).toEqual(new Set(['italic']));
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
		expect(got.complete.size).toBe(0);
		expect(got.partial.size).toBe(0);
	});
});
