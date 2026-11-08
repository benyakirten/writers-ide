import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { PageLayoutManager } from './page-layout.svelte';
import proseMirrorEventBus, { ProseMirrorEventBusEventType } from './event-bus.svelte';

const schema = new Schema({
	nodes: {
		doc: { content: 'page+' },
		page: {
			content: 'paragraph*',
			attrs: { index: { default: -1 } },
			toDOM: (node) => ['section', { 'data-index': node.attrs.index }, 0],
		},
		paragraph: {
			content: 'text*',
			attrs: { peer: { default: false }, indent: { default: 0 } },
			toDOM: () => ['p', 0],
		},
		text: {},
	},
	marks: { strong: { toDOM: () => ['strong', 0] } },
});

const paragraph = (text = 'hello', peer = false) =>
	schema.node('paragraph', { peer }, text ? schema.text(text) : undefined);
const page = (text = 'hello') => schema.node('page', null, paragraph(text));
const doc = (...pages: ProseMirrorNode[]) => schema.node('doc', null, pages);
const views: EditorView[] = [];

function createView(document = doc(page(), page(), page())) {
	const view = new EditorView(documentElement(), {
		state: EditorState.create({ schema, doc: document }),
	});
	views.push(view);
	return view;
}

function documentElement() {
	const element = document.createElement('div');
	document.body.append(element);
	return element;
}

function pageOffset(view: EditorView, index: number) {
	let offset = 0;
	for (let i = 0; i < index; i++) {
		offset += view.state.doc.child(i).nodeSize;
	}
	return offset;
}

let layout: PageLayoutManager;
beforeEach(() => {
	layout = new PageLayoutManager();
});
afterEach(() => {
	for (const view of views.splice(0)) {
		view.destroy();
	}
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('overflow detection', () => {
	it.each([0, 0.25])('continues past a fitting block with %s px boundary excess', (excess) => {
		const view = createView(
			doc(schema.node('page', null, [paragraph('first'), paragraph('later')])),
		);
		const details = layout.getPage(view, 0)!;
		const first = view.nodeDOM(1) as HTMLElement;
		const later = view.nodeDOM(1 + view.state.doc.firstChild!.firstChild!.nodeSize) as HTMLElement;
		vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ bottom: 100 + excess } as DOMRect);
		vi.spyOn(later, 'getBoundingClientRect').mockReturnValue({ bottom: 700 } as DOMRect);
		const info = layout.getPageOverflowInformation(view, 100, details);
		expect(layout.pageIsOverflowing(info)).toBe(true);
		if (layout.pageIsOverflowing(info)) {
			expect(info.overflowingEl).toBe(later);
		}
	});

	it('detects a partial overflowing line instead of accepting the whole page', () => {
		const view = createView();
		const details = layout.getPage(view, 0)!;
		const first = view.nodeDOM(1) as HTMLElement;
		vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ bottom: 104 } as DOMRect);
		const info = layout.getPageOverflowInformation(view, 100, details);
		expect(layout.pageIsOverflowing(info)).toBe(true);
	});

	it.each([1, 2])('uses CSS pixels rather than device pixels at DPR %s', (density) => {
		vi.stubGlobal('devicePixelRatio', density);
		expect(layout.convertMeasurementToPx(1, 'in')).toBe(96);
		expect(layout.convertMeasurementToPx(25.4, 'mm')).toBeCloseTo(96);
	});

	it('uses rendered padding and borders for the content boundaries', () => {
		const host = documentElement();
		host.style.cssText = 'padding-top: 20px; padding-bottom: 30px; border: 2px solid black;';
		vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 500 } as DOMRect);
		expect(layout.calculatePageTop(host)).toBe(122);
		expect(layout.calculatePageBottom(host)).toBe(468);
	});
});

describe('affected page ranges', () => {
	it('locates an insertion on a later page before or after the view applies it', () => {
		const view = createView();
		const tr = view.state.tr.insertText('extra', pageOffset(view, 2) + 2);
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([2, 2]);
		view.dispatch(tr);
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([2, 2]);
	});

	it('includes both ends of a cross-page deletion', () => {
		const view = createView();
		const tr = view.state.tr.delete(3, pageOffset(view, 2) + 3);
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([0, 2]);
	});

	it('includes a preceding page when deleting a page boundary', () => {
		const view = createView();
		const start = pageOffset(view, 1);
		const tr = view.state.tr.delete(start, pageOffset(view, 2));
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([1, 2]);
	});

	it('uses pos for empty-map node attribute steps', () => {
		const view = createView();
		const tr = view.state.tr.setNodeAttribute(pageOffset(view, 1), 'index', 42);
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([1, 1]);
	});

	it('uses from/to for empty-map mark steps', () => {
		const view = createView();
		const start = pageOffset(view, 1) + 2;
		const tr = view.state.tr.addMark(start, start + 2, schema.marks.strong.create());
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([1, 1]);
		const removal = EditorState.create({ schema, doc: tr.doc }).tr.removeMark(
			start,
			start + 2,
			schema.marks.strong,
		);
		expect(layout.getAffectedPageRangeFromTransaction(view, removal)).toEqual([1, 1]);
	});

	it('falls back to page zero for an empty-map step with no usable coordinates', () => {
		const view = createView();
		const tr = view.state.tr.setNodeAttribute(pageOffset(view, 2), 'index', 42);
		vi.spyOn(tr.steps[0], 'toJSON').mockReturnValue({ stepType: 'unknown' });
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([0, 2]);
	});

	it('keeps a safe earliest bound after large insertions shift subsequent step coordinates', () => {
		const view = createView();
		const tr = view.state.tr.insertText('x'.repeat(100), 2);
		tr.insertText('later', pageOffset(view, 1) + 102);
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([0, 2]);
	});

	it('keeps a safe earliest bound when deletion shifts later steps backward', () => {
		const view = createView();
		const tr = view.state.tr.delete(0, pageOffset(view, 1));
		tr.setNodeAttribute(0, 'index', 0);
		expect(layout.getAffectedPageRangeFromTransaction(view, tr)).toEqual([0, 2]);
	});

	it('returns a neutral range for a transaction with no steps', () => {
		const view = createView();
		expect(layout.getAffectedPageRangeFromTransaction(view, view.state.tr)).toEqual([0, 0]);
	});
});

describe('pagination generator', () => {
	function setup() {
		const view = createView();
		const reunite = vi.spyOn(layout, 'reunitePeerParagraphsInRange').mockImplementation(() => {});
		const paginate = vi.spyOn(layout, 'paginate').mockReturnValue(0);
		const update = vi.spyOn(proseMirrorEventBus, 'update').mockImplementation(() => {});
		return { view, reunite, paginate, update };
	}

	it('lazily prepares only the current boundary just before pagination', () => {
		const { view, reunite, paginate, update } = setup();
		const order: string[] = [];
		reunite.mockImplementation((_, from, to) => order.push(`prepare ${from}:${to}`));
		paginate.mockImplementation((_, index) => {
			order.push(`paginate ${index}`);
			return 0;
		});
		const generator = layout.paginateRange('editor', view, 1, 3);
		expect(order).toEqual([]);
		expect(generator.next()).toEqual({ done: false, value: 2 });
		expect(order).toEqual(['prepare 1:2', 'paginate 1']);
		expect(update).not.toHaveBeenCalled();
		expect(generator.next()).toEqual({ done: false, value: 3 });
		expect(order).toEqual(['prepare 1:2', 'paginate 1', 'prepare 2:3', 'paginate 2']);
		expect(generator.next()).toEqual({ done: true, value: 3 });
		expect(update).toHaveBeenCalledWith({
			id: 'editor',
			event: { type: ProseMirrorEventBusEventType.Paginate, paginatedTo: 3 },
		});
	});

	it('does not extend the exclusive target when pages are added', () => {
		const { view, paginate } = setup();
		paginate.mockReturnValue(1);
		expect([...layout.paginateRange('editor', view, 0, 2)]).toEqual([1, 2]);
		expect(paginate.mock.calls.map(([, index]) => index)).toEqual([0, 1]);
	});

	it('revisits the same index after deletion without shrinking the target', () => {
		const { view, reunite, paginate } = setup();
		paginate.mockReturnValueOnce(-1).mockReturnValue(0);
		expect([...layout.paginateRange('editor', view, 1, 3)]).toEqual([1, 2, 3]);
		expect(paginate.mock.calls.map(([, index]) => index)).toEqual([1, 1, 2]);
		expect(reunite.mock.calls.map(([, from, to]) => [from, to])).toEqual([
			[1, 2],
			[1, 2],
			[2, 3],
		]);
	});

	it('stops an unbounded range when the engine returns null', () => {
		const { view, paginate } = setup();
		paginate.mockReturnValueOnce(0).mockReturnValue(null);
		expect([...layout.paginateRange('editor', view, 0)]).toEqual([1]);
	});

	it('does no preparation for an empty range', () => {
		const { view, reunite, paginate } = setup();
		expect([...layout.paginateRange('editor', view, 0, 0)]).toEqual([]);
		expect(reunite).not.toHaveBeenCalled();
		expect(paginate).not.toHaveBeenCalled();
	});

	it('does no work or success notification when already aborted', () => {
		const { view, reunite, paginate, update } = setup();
		const controller = new AbortController();
		controller.abort();
		const generator = layout.paginateRange('editor', view, 1, 3, controller.signal);
		expect(generator.next()).toEqual({ done: true, value: 1 });
		expect(reunite).not.toHaveBeenCalled();
		expect(paginate).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it('checks cancellation between preparation and pagination', () => {
		const { view, reunite, paginate, update } = setup();
		const controller = new AbortController();
		reunite.mockImplementation(() => controller.abort());
		expect([...layout.paginateRange('editor', view, 0, 2, controller.signal)]).toEqual([]);
		expect(paginate).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it('stops between yields and suppresses success even after the final page', () => {
		const { view, reunite, paginate, update } = setup();
		const controller = new AbortController();
		const generator = layout.paginateRange('editor', view, 0, 1, controller.signal);
		expect(generator.next()).toEqual({ done: false, value: 1 });
		controller.abort();
		expect(generator.next()).toEqual({ done: true, value: 1 });
		expect(reunite).toHaveBeenCalledTimes(1);
		expect(paginate).toHaveBeenCalledTimes(1);
		expect(update).not.toHaveBeenCalled();
	});
});

describe('DOM page indexes', () => {
	it('indexes every page in current child order without changing the document', () => {
		const view = createView();
		const original = view.state.doc;
		const dispatch = vi.spyOn(view, 'dispatch');
		const paginate = vi.spyOn(layout, 'paginate');
		layout.syncPageIndexes(view);
		expect(Array.from(view.dom.children, (element) => element.getAttribute('data-index'))).toEqual([
			'0',
			'1',
			'2',
		]);
		expect(view.state.doc).toBe(original);
		expect(original.child(2).attrs.index).toBe(-1);
		expect(dispatch).not.toHaveBeenCalled();
		expect(paginate).not.toHaveBeenCalled();
	});

	it('refreshes stale indexes after page insertion and deletion', () => {
		const view = createView();
		layout.syncPageIndexes(view);
		view.dispatch(view.state.tr.insert(0, page('new')));
		layout.syncPageIndexes(view);
		expect(Array.from(view.dom.children, (element) => element.getAttribute('data-index'))).toEqual([
			'0',
			'1',
			'2',
			'3',
		]);
		view.dispatch(view.state.tr.delete(0, view.state.doc.firstChild!.nodeSize));
		layout.syncPageIndexes(view);
		expect(Array.from(view.dom.children, (element) => element.getAttribute('data-index'))).toEqual([
			'0',
			'1',
			'2',
		]);
	});
});

describe('pagination transaction history', () => {
	it('excludes page deletion from history', () => {
		const view = createView();
		const dispatch = vi.spyOn(view, 'dispatch');
		layout.deletePage(view, layout.getPage(view, 1)!);
		expect(dispatch.mock.calls[0][0].getMeta('addToHistory')).toBe(false);
	});

	it('excludes reunion from history', () => {
		const view = createView(doc(page(), schema.node('page', null, paragraph('peer', true))));
		const dispatch = vi.spyOn(view, 'dispatch');
		layout.reunitePeerParagraphsInRange(view, 0, 1);
		expect(dispatch.mock.calls[0][0].getMeta('addToHistory')).toBe(false);
		expect(view.state.doc.firstChild!.textContent).toBe('hellopeer');
	});

	it('excludes pagination from history and preserves engine node index updates', () => {
		const view = createView(doc(page()));
		vi.spyOn(layout, 'calculatePageBottom').mockReturnValue(100);
		vi.spyOn(layout, 'getPageOverflowInformation').mockReturnValue({
			hasDiscoveredPageEnd: false,
			lastNodeOffset: 1,
		});
		const dispatch = vi.spyOn(view, 'dispatch');
		layout.paginate(view, 0);
		expect(dispatch.mock.calls[0][0].getMeta('addToHistory')).toBe(false);
		expect(view.state.doc.firstChild!.attrs.index).toBe(0);
	});

	it('does not exclude the user break-peering command from history', () => {
		const view = createView(doc(schema.node('page', null, paragraph('peer', true))));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
		const dispatch = vi.fn<(tr: Transaction) => void>();
		expect(layout.breakPeering(view.state, dispatch)).toBe(true);
		expect(dispatch.mock.calls[0][0].getMeta('addToHistory')).toBeUndefined();
	});
});
