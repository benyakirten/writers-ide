import { describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { dent, setTextAlignment, toggleTextMark } from './formatting-actions';
import { INDENT_MAX, INDENT_MIN } from './formatting-policy';
import {
	doesSelectionHaveTextMark,
	findTextMarks,
	getBlockAttributeRatio,
	getIndentRatio,
} from './selection-coverage';
import { INDENT_MAX as APP_INDENT_MAX, INDENT_MIN as APP_INDENT_MIN } from '../../view/constants';

const schema = new Schema({
	nodes: {
		doc: { content: 'page+' },
		page: { content: 'paragraph+', toDOM: () => ['section', 0] },
		paragraph: {
			content: 'text*',
			attrs: {
				peer: { default: false },
				indent: { default: 0 },
				align: { default: 'start' },
			},
			toDOM: () => ['p', 0],
		},
		text: {},
	},
	marks: {
		bold: { toDOM: () => ['strong', 0] },
		italic: { toDOM: () => ['em', 0] },
		inlineCode: { toDOM: () => ['code', 0] },
	},
});

function state(reversed = false) {
	const doc = schema.node(
		'doc',
		null,
		schema.node('page', null, [
			schema.node('paragraph', { indent: 2, align: 'left' }, [
				schema.text('ab', [schema.mark('bold'), schema.mark('italic')]),
				schema.text('cd', [schema.mark('italic')]),
			]),
			schema.node('paragraph', { indent: 6, align: 'right' }, schema.text('efgh')),
		]),
	);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, reversed ? 11 : 3, reversed ? 3 : 11),
	});
}

describe('feature-owned formatting helpers', () => {
	it('keeps formatting limits consistent with the current app schema', () => {
		expect([INDENT_MIN, INDENT_MAX]).toEqual([APP_INDENT_MIN, APP_INDENT_MAX]);
	});

	it.each([false, true])('preserves clipped coverage ratios for reversed=%s', (reversed) => {
		const { selection, doc } = state(reversed);
		expect(findTextMarks(selection, doc)).toEqual(
			new Map([
				['bold', 1 / 6],
				['italic', 3 / 6],
			]),
		);
		expect(doesSelectionHaveTextMark(selection, doc, 'ITALIC')).toBe(false);
		expect(getIndentRatio(selection, doc)).toBe(0.5);
		expect(getBlockAttributeRatio(selection, doc, 'align', 'left')).toBe(0.5);
		expect(getBlockAttributeRatio(selection, doc, 'align', (value) => value === 'right')).toBe(0.5);
	});

	it('does not create a transaction when command prerequisites are absent', () => {
		const current = state();
		const transactions = vi.spyOn(current, 'tr', 'get');
		try {
			expect(dent('indent', current)).toBe(false);
			expect(setTextAlignment('center', current)).toBe(false);
			expect(toggleTextMark('bold', current, vi.fn())).toBe(false);
			expect(transactions).not.toHaveBeenCalled();
		} finally {
			transactions.mockRestore();
		}
	});

	it('removes a complete mark without removing its exclusive counterpart', () => {
		const current = state();
		const view = new EditorView(document.createElement('div'), {
			state: current.apply(current.tr.setSelection(TextSelection.create(current.doc, 2, 4))),
		});
		try {
			expect(toggleTextMark('bold', view.state, view.dispatch, view, 'italic')).toBe(true);
			expect(findTextMarks(view.state.selection, view.state.doc)).toEqual(new Map([['italic', 1]]));
		} finally {
			view.destroy();
		}
	});

	it('retains case-insensitive mark matching and normalized coverage names', () => {
		const doc = schema.node(
			'doc',
			null,
			schema.node(
				'page',
				null,
				schema.node('paragraph', null, schema.text('code', [schema.mark('inlineCode')])),
			),
		);
		const selection = TextSelection.create(doc, 2, 6);
		expect(doesSelectionHaveTextMark(selection, doc, 'CODE')).toBe(true);
		expect(findTextMarks(selection, doc)).toEqual(new Map([['inlinecode', 1]]));
		expect(findTextMarks(TextSelection.create(doc, 3), doc).size).toBe(0);
	});
});
