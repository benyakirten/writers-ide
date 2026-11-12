import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { history, redo, undo, undoDepth } from 'prosemirror-history';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../prosemirror/view/schema';
import { createView as createProductionView } from '../prosemirror/view/editor';
import Editors from '../prosemirror/prose-mirror-editor.svelte';
import proseMirrorEventBus, { ProseMirrorEventBusEventType } from './event-bus.svelte';
import { PageLayoutManager } from './page-layout.svelte';

// These tests exercise model/selection mapping, not layout: jsdom supplies no geometry.
const paragraph = (text: string, peer = false) =>
	schema.node('paragraph', { peer }, text ? schema.text(text) : undefined);
const page = (...blocks: ProseMirrorNode[]) => schema.node('page', null, blocks);
const doc = (...pages: ProseMirrorNode[]) => schema.node('doc', null, pages);
const image = () => schema.node('image', { src: 'selection-test.png', alt: 'selected atom' });
const views: EditorView[] = [];
let layout: PageLayoutManager;

function createView(document: ProseMirrorNode, withHistory = false) {
	document.check();
	const host = window.document.createElement('div');
	window.document.body.append(host);
	const view = new EditorView(host, {
		state: EditorState.create({
			schema,
			doc: document,
			plugins: withHistory ? [history()] : [],
		}),
		dispatchTransaction(this: EditorView, tr: Transaction) {
			// Check intermediate step documents too, using the production block+ schema.
			for (const intermediate of tr.docs) {
				intermediate.check();
			}
			tr.doc.check();
			this.updateState(this.state.apply(tr));
		},
	});
	views.push(view);
	return view;
}

function pageStart(view: EditorView, index: number) {
	let position = 0;
	for (let i = 0; i < index; i++) {
		position += view.state.doc.child(i).nodeSize;
	}
	return position;
}

function blockStart(view: EditorView, pageIndex: number, blockIndex = 0) {
	let position = pageStart(view, pageIndex) + 1;
	for (let i = 0; i < blockIndex; i++) {
		position += view.state.doc.child(pageIndex).child(i).nodeSize;
	}
	return position;
}

function at(view: EditorView, pageIndex: number, blockIndex: number, textOffset: number) {
	return blockStart(view, pageIndex, blockIndex) + 1 + textOffset;
}

function select(view: EditorView, anchor: number, head = anchor) {
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
}

function expectTextSelection(view: EditorView, anchor: number, head = anchor) {
	expect(view.state.selection).toBeInstanceOf(TextSelection);
	expect(view.state.selection.anchor).toBe(anchor);
	expect(view.state.selection.head).toBe(head);
	view.state.doc.check();
}

function expectPages(view: EditorView, expected: string[][]) {
	const actual: string[][] = [];
	view.state.doc.forEach((pageNode) => {
		const blocks: string[] = [];
		pageNode.forEach((block) => blocks.push(block.textContent));
		actual.push(blocks);
	});
	expect(actual).toEqual(expected);
	view.state.doc.check();
}

function overflow(view: EditorView, pageIndex: number, blockIndex = 0) {
	const position = blockStart(view, pageIndex, blockIndex);
	return {
		overflowingNode: view.state.doc.child(pageIndex).child(blockIndex),
		overflowingNodeOffset: position - pageStart(view, pageIndex) - 1,
		overflowingEl: view.nodeDOM(position) as HTMLElement,
	};
}

function forward(view: EditorView, splitOffset: number, shouldDedent = false, blockIndex = 0) {
	vi.spyOn(layout, 'getPageOverflowInformation').mockReturnValue(overflow(view, 0, blockIndex));
	vi.spyOn(layout, 'getSplitOffsetForOverflowingElement').mockReturnValue({
		splitOffset,
		shouldDedent,
	});
	layout.paginate(view, 0);
	view.state.doc.check();
}

function backward(view: EditorView, splitOffset?: number, shouldDedent = false) {
	const information = vi.spyOn(layout, 'getPageOverflowInformation');
	information.mockReturnValueOnce({ hasDiscoveredPageEnd: false, lastNodeOffset: 0 });
	if (splitOffset === undefined) {
		information.mockReturnValue({ hasDiscoveredPageEnd: false, lastNodeOffset: 0 });
	} else {
		information.mockReturnValue(overflow(view, 1));
		vi.spyOn(layout, 'getSplitOffsetForOverflowingElement').mockReturnValue({
			splitOffset,
			shouldDedent,
		});
	}
	layout.paginate(view, 0);
	view.state.doc.check();
}

beforeEach(() => {
	layout = new PageLayoutManager();
	vi.spyOn(layout, 'calculatePageBottom').mockReturnValue(100);
	vi.spyOn(layout, 'calculatePageTop').mockReturnValue(0);
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
		top: 0,
		bottom: 20,
	} as DOMRect);
});

afterEach(() => {
	for (const view of views.splice(0)) {
		view.destroy();
	}
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('forward whole-block reflow selection', () => {
	it.each([
		{ destination: 'new', atomSelected: false },
		{ destination: 'existing', atomSelected: true },
	])('moves all content to a $destination page at split offset zero', ({ atomSelected }) => {
		const atom = image();
		const source = schema.node(
			'page',
			{ index: 41 },
			schema.node('paragraph', null, [schema.text('ab'), atom, schema.text('cd')]),
		);
		const destination = schema.node('page', { index: 73 }, paragraph('later'));
		const view = createView(atomSelected ? doc(source, destination) : doc(source));
		if (atomSelected) {
			view.dispatch(
				view.state.tr.setSelection(NodeSelection.create(view.state.doc, at(view, 0, 0, 2))),
			);
		} else {
			select(view, at(view, 0, 0, 1));
		}
		forward(view, 0);
		expectPages(view, atomSelected ? [[''], ['abcd', 'later']] : [[''], ['abcd']]);
		expect(view.state.doc.child(0).firstChild!.eq(paragraph(''))).toBe(true);
		expect(view.state.doc.child(0).attrs).toEqual({ index: 0 });
		expect(view.state.doc.child(1).attrs).toEqual({ index: atomSelected ? 73 : 41 });
		if (atomSelected) {
			expect(view.state.selection).toBeInstanceOf(NodeSelection);
			expect(view.state.selection.from).toBe(at(view, 1, 0, 2));
			expect((view.state.selection as NodeSelection).node.eq(atom)).toBe(true);
		} else {
			expectTextSelection(view, at(view, 1, 0, 1));
		}
	});
	it.each(['retained', 'moved', 'destination'] as const)(
		'preserves a caret in %s text',
		(place) => {
			const view = createView(
				doc(page(paragraph('keep'), paragraph('move')), page(paragraph('later'))),
			);
			const initial =
				place === 'destination' ? at(view, 1, 0, 2) : at(view, 0, place === 'moved' ? 1 : 0, 2);
			select(view, initial);
			forward(view, 0, false, 1);
			expectPages(view, [['keep'], ['move', 'later']]);
			const expected =
				place === 'retained' ? at(view, 0, 0, 2) : at(view, 1, place === 'destination' ? 1 : 0, 2);
			expectTextSelection(view, expected);
		},
	);
});

describe('forward text split selection', () => {
	it('maps a caret exactly at the text split to the continuation start with right association', () => {
		const view = createView(doc(page(paragraph('abcdef'))));
		select(view, at(view, 0, 0, 3));
		forward(view, 4, true);
		expectPages(view, [['abc'], ['def']]);
		expectTextSelection(view, at(view, 1, 0, 0));
		view.dispatch(view.state.tr.insertText('X'));
		expectPages(view, [['abc'], ['Xdef']]);
	});
	// page.content offset 4 includes the paragraph opening token: the existing cut
	// retains "abc", NOT "abcd". This deliberately does not change measurement semantics.
	it.each([1, 5])('preserves a caret at logical text offset %s when creating a page', (offset) => {
		const view = createView(doc(page(paragraph('abcdef'))));
		select(view, at(view, 0, 0, offset));
		forward(view, 4, true);
		expectPages(view, [['abc'], ['def']]);
		expect(view.state.doc.child(1).firstChild!.attrs).toMatchObject({ peer: true, indent: 0 });
		expectTextSelection(view, offset < 3 ? at(view, 0, 0, offset) : at(view, 1, 0, offset - 3));
	});

	it.each([false, true])('preserves a cross-boundary range (reversed=%s)', (reversed) => {
		const view = createView(doc(page(paragraph('abcdef')), page(paragraph('later'))));
		const endpoints = [at(view, 0, 0, 1), at(view, 0, 0, 5)];
		select(view, endpoints[reversed ? 1 : 0], endpoints[reversed ? 0 : 1]);
		forward(view, 4, true);
		expectPages(view, [['abc'], ['def', 'later']]);
		const expected = [at(view, 0, 0, 1), at(view, 1, 0, 2)];
		expectTextSelection(view, expected[reversed ? 1 : 0], expected[reversed ? 0 : 1]);
	});

	it('preserves inline marks on both halves as well as the caret', () => {
		const bold = schema.marks.bold.create();
		const italic = schema.marks.italic.create();
		const view = createView(
			doc(
				page(
					schema.node('paragraph', null, [
						schema.text('abcdef', [bold]),
						schema.text('gh', [italic]),
					]),
				),
			),
		);
		select(view, at(view, 0, 0, 5));
		forward(view, 4, true);
		expectPages(view, [['abc'], ['defgh']]);
		expect(view.state.doc.child(0).firstChild!.content.toJSON()).toEqual([
			schema.text('abc', [bold]).toJSON(),
		]);
		expect(view.state.doc.child(1).firstChild!.content.toJSON()).toEqual([
			schema.text('def', [bold]).toJSON(),
			schema.text('gh', [italic]).toJSON(),
		]);
		expectTextSelection(view, at(view, 1, 0, 2));
	});

	it.each([
		{ name: 'empty', marks: [] },
		{ name: 'italic', marks: [schema.marks.italic.create()] },
	])('preserves explicit $name stored marks', ({ marks }) => {
		const view = createView(
			doc(
				page(schema.node('paragraph', null, schema.text('abcdef', [schema.marks.bold.create()]))),
			),
		);
		select(view, at(view, 0, 0, 5));
		view.dispatch(view.state.tr.setStoredMarks(marks));
		forward(view, 4, true);
		expectPages(view, [['abc'], ['def']]);
		expectTextSelection(view, at(view, 1, 0, 2));
		expect(view.state.storedMarks).toEqual(marks);
		view.dispatch(view.state.tr.insertText('X'));
		expectPages(view, [['abc'], ['deXf']]);
		expect(view.state.doc.nodeAt(at(view, 1, 0, 2))!.marks).toEqual(marks);
	});

	it('keeps an inline atom NodeSelection when its text tail moves', () => {
		const atom = image();
		const view = createView(
			doc(page(schema.node('paragraph', null, [schema.text('abcdef'), atom, schema.text('gh')]))),
		);
		view.dispatch(
			view.state.tr.setSelection(NodeSelection.create(view.state.doc, at(view, 0, 0, 6))),
		);
		forward(view, 4, true);
		expectPages(view, [['abc'], ['defgh']]);
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect(view.state.selection.from).toBe(at(view, 1, 0, 3));
		expect((view.state.selection as NodeSelection).node.eq(atom)).toBe(true);
	});
});

describe('backward reflow selection', () => {
	it('pulls exactly one whole block while preserving the remaining page attributes and range', () => {
		const moved = schema.node('paragraph', { indent: 3, align: 'center' }, schema.text('move'));
		const view = createView(
			doc(
				schema.node('page', { index: 41 }, paragraph('keep')),
				schema.node('page', { index: 73 }, [moved, paragraph('stay')]),
			),
		);
		select(view, at(view, 1, 0, 1), at(view, 1, 1, 2));
		backward(view, moved.nodeSize);
		expectPages(view, [['keep', 'move'], ['stay']]);
		expectTextSelection(view, at(view, 0, 1, 1), at(view, 1, 0, 2));
		expect(view.state.doc.child(0).child(1).eq(moved)).toBe(true);
		expect(view.state.doc.child(0).attrs).toEqual({ index: 0 });
		expect(view.state.doc.child(1).attrs).toEqual({ index: 73 });
	});

	it('does not move content or a cross-page range when the backward split offset is zero', () => {
		const view = createView(
			doc(
				schema.node('page', { index: 0 }, paragraph('keep')),
				schema.node('page', { index: 73 }, paragraph('stay')),
			),
		);
		select(view, at(view, 1, 0, 2), at(view, 0, 0, 1));
		const before = view.state;
		backward(view, 0);
		expect(view.state.doc.eq(before.doc)).toBe(true);
		expect(view.state.selection.eq(before.selection)).toBe(true);
		expectPages(view, [['keep'], ['stay']]);
	});

	it('preserves explicit empty stored marks while pulling a marked text prefix backward', () => {
		const view = createView(
			doc(
				page(paragraph('keep')),
				page(schema.node('paragraph', null, schema.text('abcdef', [schema.marks.bold.create()]))),
			),
		);
		select(view, at(view, 1, 0, 1));
		view.dispatch(view.state.tr.setStoredMarks([]));
		backward(view, 4, true);
		expectPages(view, [['keep', 'abc'], ['def']]);
		expectTextSelection(view, at(view, 0, 1, 1));
		expect(view.state.storedMarks).toEqual([]);
		view.dispatch(view.state.tr.insertText('X'));
		expectPages(view, [['keep', 'aXbc'], ['def']]);
		expect(view.state.doc.nodeAt(at(view, 0, 1, 1))!.marks).toEqual([]);
	});
	it.each([0, 1])(
		'preserves a caret on page %s when pulling all blocks and deleting the next page',
		(pageIndex) => {
			const view = createView(doc(page(paragraph('keep')), page(paragraph('abcdef'))));
			select(view, at(view, pageIndex, 0, 2));
			backward(view);
			expectPages(view, [['keep', 'abcdef']]);
			expectTextSelection(view, at(view, 0, pageIndex, 2));
		},
	);

	it.each([1, 5])(
		'preserves a caret at next-page offset %s during a partial text pull',
		(offset) => {
			const view = createView(doc(page(paragraph('keep')), page(paragraph('abcdef'))));
			select(view, at(view, 1, 0, offset));
			backward(view, 4, true);
			expectPages(view, [['keep', 'abc'], ['def']]);
			expect(view.state.doc.child(1).firstChild!.attrs).toMatchObject({ peer: true, indent: 0 });
			expectTextSelection(view, offset < 3 ? at(view, 0, 1, offset) : at(view, 1, 0, offset - 3));
		},
	);

	it.each([false, true])(
		'preserves a range spanning retained and pulled text (reversed=%s)',
		(reversed) => {
			const view = createView(doc(page(paragraph('keep')), page(paragraph('abcdef'))));
			const endpoints = [at(view, 0, 0, 1), at(view, 1, 0, 5)];
			select(view, endpoints[reversed ? 1 : 0], endpoints[reversed ? 0 : 1]);
			backward(view, 4, true);
			expectPages(view, [['keep', 'abc'], ['def']]);
			const expected = [at(view, 0, 0, 1), at(view, 1, 0, 2)];
			expectTextSelection(view, expected[reversed ? 1 : 0], expected[reversed ? 0 : 1]);
		},
	);
});

describe('peer reunion followed by public pagination', () => {
	function reunite(view: EditorView) {
		// Mock no remaining space so pagination preserves the next page after reunion.
		// A sole peer receives a valid empty-paragraph filler; trailing blocks stay intact.
		layout.reunitePeerParagraphsInRange(view, 0, 1);
		view.state.doc.check();
		vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
			bottom: 100,
		} as DOMRect);
		vi.spyOn(layout, 'getPageOverflowInformation').mockReturnValue({
			hasDiscoveredPageEnd: false,
			lastNodeOffset: 0,
		});
		layout.paginate(view, 0);
		view.state.doc.check();
	}

	it('reunites a sole peer with a valid filler and preserves a reversed selection', () => {
		const view = createView(
			doc(
				schema.node('page', { index: 41 }, paragraph('abc')),
				schema.node('page', { index: 73 }, paragraph('def', true)),
			),
		);
		select(view, at(view, 1, 0, 2), at(view, 0, 0, 1));
		reunite(view);
		expectPages(view, [['abcdef'], ['']]);
		expect(view.state.doc.child(1).firstChild!.eq(paragraph(''))).toBe(true);
		expectTextSelection(view, at(view, 0, 0, 5), at(view, 0, 0, 1));
		expect(view.state.doc.child(0).attrs).toEqual({ index: 0 });
		expect(view.state.doc.child(1).attrs).toEqual({ index: 73 });
	});

	it.each([
		{ name: 'empty', marks: [] },
		{ name: 'italic', marks: [schema.marks.italic.create()] },
	])('preserves explicit $name stored marks through reunion and pagination', ({ marks }) => {
		const bold = schema.marks.bold.create();
		const view = createView(
			doc(
				page(paragraph('abc')),
				page(schema.node('paragraph', { peer: true }, schema.text('def', [bold]))),
			),
		);
		select(view, at(view, 1, 0, 1));
		view.dispatch(view.state.tr.setStoredMarks(marks));
		reunite(view);
		expectPages(view, [['abcdef'], ['']]);
		expectTextSelection(view, at(view, 0, 0, 4));
		expect(view.state.storedMarks).toEqual(marks);
		view.dispatch(view.state.tr.insertText('X'));
		expectPages(view, [['abcdXef'], ['']]);
		expect(view.state.doc.nodeAt(at(view, 0, 0, 4))!.marks).toEqual(marks);
	});

	it.each([0, 1])('preserves a cursor in the peer %s (head/tail)', (pageIndex) => {
		const view = createView(
			doc(page(paragraph('abc')), page(paragraph('def', true), paragraph('later'))),
		);
		select(view, at(view, pageIndex, 0, 1));
		reunite(view);
		expectPages(view, [['abcdef'], ['later']]);
		expectTextSelection(view, at(view, 0, 0, pageIndex === 0 ? 1 : 4));
	});

	it.each([false, true])('preserves a selection spanning peers (reversed=%s)', (reversed) => {
		const view = createView(
			doc(page(paragraph('abc')), page(paragraph('def', true), paragraph('later'))),
		);
		const endpoints = [at(view, 0, 0, 1), at(view, 1, 0, 2)];
		select(view, endpoints[reversed ? 1 : 0], endpoints[reversed ? 0 : 1]);
		reunite(view);
		expectPages(view, [['abcdef'], ['later']]);
		const expected = [at(view, 0, 0, 1), at(view, 0, 0, 5)];
		expectTextSelection(view, expected[reversed ? 1 : 0], expected[reversed ? 0 : 1]);
	});

	it('preserves an atomic inline NodeSelection in the reunited tail', () => {
		const atom = image();
		const tail = schema.node('paragraph', { peer: true }, [
			schema.text('d'),
			atom,
			schema.text('ef'),
		]);
		const view = createView(doc(page(paragraph('abc')), page(tail, paragraph('later'))));
		view.dispatch(
			view.state.tr.setSelection(NodeSelection.create(view.state.doc, at(view, 1, 0, 1))),
		);
		reunite(view);
		expectPages(view, [['abcdef'], ['later']]);
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect(view.state.selection.from).toBe(at(view, 0, 0, 4));
		expect((view.state.selection as NodeSelection).node.eq(atom)).toBe(true);
	});
});

describe('production dispatch index normalization and stored marks', () => {
	const registeredViews: EditorView[] = [];
	const disposers: (() => void)[] = [];

	beforeEach(() => {
		registeredViews.length = 0;
		// Keep the real EditorView/dispatch/plugins, but do not register page observers.
		vi.spyOn(Editors, 'register').mockImplementation((_id, _name, view) => {
			registeredViews.push(view);
			return () => view.destroy();
		});
		vi.spyOn(proseMirrorEventBus, 'update').mockImplementation(({ event }) => {
			// PreUpdate runs after the real dispatch has appended index attribute steps.
			if (event.type === ProseMirrorEventBusEventType.PreUpdate) {
				for (const intermediate of event.tr.docs) {
					intermediate.check();
				}
				event.tr.doc.check();
			}
		});
	});

	afterEach(() => {
		for (const dispose of disposers.splice(0)) {
			dispose();
		}
	});

	function integrationView(documentNode: ProseMirrorNode) {
		documentNode.check();
		const host = document.createElement('div');
		document.body.append(host);
		const registrationIndex = registeredViews.length;
		disposers.push(
			createProductionView('selection-integration', 'selection-test', documentNode, host),
		);
		const registeredView = registeredViews[registrationIndex];
		if (!registeredView) {
			throw new Error('Production createView did not register its EditorView');
		}
		registeredView.state.doc.check();
		return registeredView;
	}

	it('preserves empty and italic typing marks when a new page needs its index normalized', () => {
		for (const marks of [[], [schema.marks.italic.create()]]) {
			const view = integrationView(
				doc(
					page(schema.node('paragraph', null, schema.text('abcdef', [schema.marks.bold.create()]))),
				),
			);
			select(view, at(view, 0, 0, 5));
			view.dispatch(view.state.tr.setStoredMarks(marks));
			forward(view, 4, true);
			expectPages(view, [['abc'], ['def']]);
			expect(view.state.doc.child(1).attrs.index).toBe(1);
			expectTextSelection(view, at(view, 1, 0, 2));
			expect(view.state.storedMarks).toEqual(marks);
			view.dispatch(view.state.tr.insertText('X'));
			expectPages(view, [['abc'], ['deXf']]);
			expect(view.state.doc.nodeAt(at(view, 1, 0, 2))!.marks).toEqual(marks);
		}
	});

	it('preserves empty and italic typing marks when deleting a nonfinal page renumbers the following page', () => {
		for (const marks of [[], [schema.marks.italic.create()]]) {
			const view = integrationView(
				doc(
					page(paragraph('keep')),
					page(schema.node('paragraph', null, schema.text('abcdef', [schema.marks.bold.create()]))),
					page(paragraph('later')),
				),
			);
			select(view, at(view, 1, 0, 2));
			view.dispatch(view.state.tr.setStoredMarks(marks));
			expect(view.state.doc.child(2).attrs.index).toBe(2);
			backward(view);
			expectPages(view, [['keep', 'abcdef'], ['later']]);
			expect(view.state.doc.child(1).attrs.index).toBe(1);
			expectTextSelection(view, at(view, 0, 1, 2));
			expect(view.state.storedMarks).toEqual(marks);
			view.dispatch(view.state.tr.insertText('X'));
			expectPages(view, [['keep', 'abXcdef'], ['later']]);
			expect(view.state.doc.nodeAt(at(view, 0, 1, 2))!.marks).toEqual(marks);
		}
	});

	it('restores the incoming transaction marks rather than stale marks from the previous state', () => {
		const view = integrationView(doc(page(paragraph('abcdef')), page(paragraph('later'))));
		const oldMarks = [schema.marks.bold.create()];
		const incomingMarks = [schema.marks.italic.create()];
		select(view, at(view, 0, 0, 1));
		view.dispatch(view.state.tr.setStoredMarks(oldMarks));
		expect(view.state.storedMarks).toEqual(oldMarks);
		const tr = view.state.tr
			.setNodeAttribute(pageStart(view, 1), 'index', 99)
			.setStoredMarks(incomingMarks);
		expect(tr.steps).toHaveLength(1);
		view.dispatch(tr);
		// The additional step proves real dispatch normalization was exercised.
		expect(tr.steps).toHaveLength(2);
		expect(view.state.doc.child(1).attrs.index).toBe(1);
		expect(view.state.storedMarks).toEqual(incomingMarks);
		expectTextSelection(view, at(view, 0, 0, 1));
		view.dispatch(view.state.tr.insertText('X'));
		expectPages(view, [['aXbcdef'], ['later']]);
		expect(view.state.doc.nodeAt(at(view, 0, 0, 1))!.marks).toEqual(incomingMarks);
	});
});

describe('user history across automatic reflow', () => {
	it('undoes/redoes the insertion rather than reflow, restoring the logical caret', () => {
		const view = createView(doc(page(paragraph('abcdef'))), true);
		select(view, at(view, 0, 0, 5));
		view.dispatch(view.state.tr.insertText('X'));
		expectPages(view, [['abcdeXf']]);
		expectTextSelection(view, at(view, 0, 0, 6));
		expect(undoDepth(view.state)).toBe(1);
		forward(view, 4, true);
		expectPages(view, [['abc'], ['deXf']]);
		expectTextSelection(view, at(view, 1, 0, 3));
		expect(undoDepth(view.state)).toBe(1);
		expect(undo(view.state, view.dispatch)).toBe(true);
		expectPages(view, [['abc'], ['def']]);
		expectTextSelection(view, at(view, 1, 0, 2));
		expect(undoDepth(view.state)).toBe(0);
		expect(redo(view.state, view.dispatch)).toBe(true);
		expectPages(view, [['abc'], ['deXf']]);
		expectTextSelection(view, at(view, 1, 0, 3));
		expect(undoDepth(view.state)).toBe(1);
	});
});
