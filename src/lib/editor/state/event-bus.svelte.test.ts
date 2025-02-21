import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema, Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { ProseMirrorEventBus } from './event-bus.svelte';

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
		text: { inline: true, group: 'inline' }
	},
	marks: {
		bold: {
			parseDom: [{ tag: 'strong' }],
			toDOM: () => ['strong']
		},
		italic: {
			parseDOM: [{ tag: 'em' }],
			toDOM: () => ['em']
		}
	}
});

const createEditorView = (nodes: Node[]) => {
	const element = document.createElement('div');

	const doc = schema.node('doc', null, nodes);
	const state = EditorState.create({
		doc,
		schema,
		selection: TextSelection.create(doc, 0, doc.content.size)
	});
	return new EditorView(element, { state });
};

describe('ProseMirrorEventBus', () => {
	let bus: ProseMirrorEventBus;
	beforeEach(() => {
		bus = new ProseMirrorEventBus();
	});

	describe('analyzeTextMarks', () => {
		it('should return empty sets when the view is undefined', () => {
			const got = bus.analyzeTextMarks(undefined);
			expect(got.complete.size).toBe(0);
			expect(got.partial.size).toBe(0);
		});

		it('should identify partial marks with no overlap', () => {
			const view = createEditorView([
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])])
			]);

			const got = bus.analyzeTextMarks(view);

			expect(got.complete.size).toBe(0);
			expect(got.partial).toEqual(new Set(['bold', 'italic']));
		});

		it('should identify partial marks with overlap', () => {
			const view = createEditorView([
				schema.node('paragraph', null, [
					schema.text('First Item', [schema.mark('bold'), schema.mark('italic')])
				]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('italic')])]),
				schema.node('paragraph', null, [schema.text('Third item')])
			]);
			const got = bus.analyzeTextMarks(view);

			expect(got.complete.size).toBe(0);
			expect(got.partial).toEqual(new Set(['bold', 'italic']));
		});

		it('should identify complete marks', () => {
			const view = createEditorView([
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])])
			]);

			const got = bus.analyzeTextMarks(view);
			expect(got.complete).toEqual(new Set(['bold']));
			expect(got.partial.size).toBe(0);
		});

		it('should identify complete marks across multiple nodes', () => {
			const view = createEditorView([
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [schema.text('Second item', [schema.mark('bold')])])
			]);

			const got = bus.analyzeTextMarks(view);
			expect(got.complete).toEqual(new Set(['bold']));
			expect(got.partial.size).toBe(0);
		});

		it('should be able to identify mixed complete and partial marks', () => {
			const view = createEditorView([
				schema.node('paragraph', null, [schema.text('First Item', [schema.mark('bold')])]),
				schema.node('paragraph', null, [
					schema.text('Second item', [schema.mark('bold'), schema.mark('italic')])
				])
			]);

			const got = bus.analyzeTextMarks(view);
			expect(got.complete).toEqual(new Set(['bold']));
			expect(got.partial).toEqual(new Set(['italic']));
		});
	});
});
