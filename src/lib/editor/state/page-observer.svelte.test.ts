import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DocumentObserver, PageObserverManager } from './page-observer.svelte';
import PageLayout, { PageLayoutMetaTransactionType } from './page-layout.svelte';
import eventBus, { ProseMirrorEventBusEventType } from './event-bus.svelte';
import {
	PAGINATION_TRANSACTION_META_KEY,
	PROSEMIRROR_PAGE_CLASS,
} from '../prosemirror/view/constants';

class IntersectionObserverMock {
	static instances: IntersectionObserverMock[] = [];
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
	constructor(
		readonly callback: IntersectionObserverCallback,
		readonly options: IntersectionObserverInit,
	) {
		IntersectionObserverMock.instances.push(this);
	}
	emit(...entries: [Element, boolean][]) {
		this.callback(
			entries.map(
				([target, isIntersecting]) => ({ target, isIntersecting }) as IntersectionObserverEntry,
			),
			this as unknown as IntersectionObserver,
		);
	}
}

const schema = new Schema({
	nodes: {
		doc: { content: 'page+' },
		page: {
			content: 'paragraph+',
			attrs: { index: { default: -1 } },
			toDOM: () => ['section', { class: PROSEMIRROR_PAGE_CLASS }, 0],
		},
		paragraph: { content: 'text*', toDOM: () => ['p', 0] },
		text: {},
	},
});
let manager: PageObserverManager;
const views: EditorView[] = [];
const observers: DocumentObserver[] = [];

function createView(count = 6) {
	const view = new EditorView(document.createElement('div'), {
		state: EditorState.create({
			schema,
			doc: schema.node(
				'doc',
				null,
				Array.from({ length: count }, () =>
					schema.node('page', null, schema.node('paragraph', null, schema.text('hello'))),
				),
			),
		}),
	});
	views.push(view);
	return view;
}

function edit(view: EditorView, page: number) {
	let offset = 2;
	for (let i = 0; i < page; i++) offset += view.state.doc.child(i).nodeSize;
	return view.state.tr.insertText('edit', offset);
}

function preUpdate(view: EditorView, tr: Transaction, id = 'doc') {
	eventBus.update({ id, event: { type: ProseMirrorEventBusEventType.PreUpdate, view, tr } });
}

beforeEach(() => {
	IntersectionObserverMock.instances = [];
	vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
	manager = new PageObserverManager();
});
afterEach(() => {
	manager.close();
	for (const observer of observers.splice(0)) observer.close();
	for (const view of views.splice(0)) view.destroy();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('DocumentObserver', () => {
	function setup() {
		const content = document.createElement('div');
		const viewport = document.createElement('div');
		const pages = Array.from({ length: 5 }, () => {
			const page = document.createElement('section');
			page.className = PROSEMIRROR_PAGE_CLASS;
			content.append(page);
			return page;
		});
		content.append(document.createElement('aside'));
		const report = vi.fn();
		const observer = new DocumentObserver(content, viewport, report);
		observers.push(observer);
		return {
			content,
			viewport,
			pages,
			report,
			observer,
			io: IntersectionObserverMock.instances.at(-1)!,
		};
	}

	it('persists partial intersection updates and reports the furthest DOM index, not visible count', () => {
		const { pages, viewport, report, io } = setup();
		expect(io.options).toEqual({ root: viewport, threshold: 0 });
		expect(io.observe.mock.calls.map(([page]) => page)).toEqual(pages);
		expect(report).not.toHaveBeenCalled();
		io.emit([pages[1], true], [pages[4], true]);
		expect(report).toHaveBeenLastCalledWith(4);
		io.emit([pages[1], false]);
		expect(report).toHaveBeenLastCalledWith(4);
		io.emit([pages[2], true]);
		expect(report).toHaveBeenLastCalledWith(4);
		io.emit([pages[4], false]);
		expect(report).toHaveBeenLastCalledWith(2);
		report.mockClear();
		io.emit([pages[2], false]);
		expect(report).not.toHaveBeenCalled();
	});

	it('syncs added/removed pages, reindexes survivors, and ignores stale removed entries', () => {
		const { content, pages, report, observer, io } = setup();
		io.emit([pages[2], true], [pages[4], true]);
		pages[4].remove();
		pages[0].remove();
		const added = document.createElement('section');
		added.className = PROSEMIRROR_PAGE_CLASS;
		content.append(added);
		observer.sync();
		expect(io.unobserve.mock.calls.map(([page]) => page)).toEqual([pages[0], pages[4]]);
		expect(io.observe).toHaveBeenCalledTimes(6);
		expect(io.observe).toHaveBeenLastCalledWith(added);
		expect(report).toHaveBeenLastCalledWith(1);
		io.emit([pages[4], true]);
		expect(report).toHaveBeenLastCalledWith(1);
		observer.close();
		expect(io.disconnect).toHaveBeenCalledOnce();
		report.mockClear();
		io.emit([pages[2], true], [added, true]);
		expect(report).not.toHaveBeenCalled();
	});
});

describe('PageObserverManager', () => {
	it.each([1, 2, 6])('starts dirty with target two bounded by %i pages', (count) => {
		const view = createView(count);
		manager.register('view', 'doc', view, document.createElement('div'));
		const data = manager.map.view;
		expect(data).toMatchObject({ viewedPage: 0, paginatedTo: 0, revision: 0 });
		expect(manager.target(data)).toBe(Math.min(2, count));
		IntersectionObserverMock.instances[0].emit([view.dom.lastElementChild!, true]);
		expect(data.viewedPage).toBe(count - 1);
		expect(manager.target(data)).toBe(count);
	});

	it('invalidates from the earliest affected predecessor without advancing an already dirty prefix', () => {
		const view = createView();
		manager.register('view', 'doc', view, document.createElement('div'));
		const data = manager.map.view;
		data.paginatedTo = 6;
		preUpdate(view, edit(view, 4));
		expect(data).toMatchObject({ paginatedTo: 3, revision: 1 });
		preUpdate(view, edit(view, 1));
		expect(data).toMatchObject({ paginatedTo: 0, revision: 2 });
		preUpdate(view, edit(view, 5));
		expect(data).toMatchObject({ paginatedTo: 0, revision: 3 });
	});

	it('ignores selection and own pagination transactions but treats BreakPeering as an edit', () => {
		const view = createView();
		manager.register('view', 'doc', view, document.createElement('div'));
		const data = manager.map.view;
		data.paginatedTo = 6;
		preUpdate(view, view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		for (const type of [
			PageLayoutMetaTransactionType.Paginate,
			PageLayoutMetaTransactionType.DeletePage,
			PageLayoutMetaTransactionType.ReunitePeers,
		]) {
			preUpdate(view, edit(view, 3).setMeta(PAGINATION_TRANSACTION_META_KEY, { type }));
		}
		expect(data).toMatchObject({ paginatedTo: 6, revision: 0 });
		preUpdate(
			view,
			edit(view, 3).setMeta(PAGINATION_TRANSACTION_META_KEY, {
				type: PageLayoutMetaTransactionType.BreakPeering,
			}),
		);
		expect(data).toMatchObject({ paginatedTo: 2, revision: 1 });
	});

	it('keeps view targets independent, invalidates shared documents only, and syncs only the updated view', () => {
		const a = createView();
		const b = createView();
		const c = createView();
		manager.register('a', 'doc', a, document.createElement('div'));
		manager.register('b', 'doc', b, document.createElement('div'));
		manager.register('c', 'other', c, document.createElement('div'));
		IntersectionObserverMock.instances[0].emit([a.dom.children[4], true]);
		expect(manager.target(manager.map.a)).toBe(6);
		expect(manager.target(manager.map.b)).toBe(2);
		for (const data of Object.values(manager.map)) data.paginatedTo = 6;
		preUpdate(a, edit(a, 3));
		expect(manager.map.a).toMatchObject({ paginatedTo: 2, revision: 1 });
		expect(manager.map.b).toMatchObject({ paginatedTo: 2, revision: 1 });
		expect(manager.map.c).toMatchObject({ paginatedTo: 6, revision: 0 });
		const sync = vi.spyOn(PageLayout, 'syncPageIndexes');
		const syncA = vi.spyOn(manager.map.a.observer, 'sync');
		const syncB = vi.spyOn(manager.map.b.observer, 'sync');
		eventBus.update({ id: 'doc', event: { type: ProseMirrorEventBusEventType.Update, view: b } });
		expect(sync).toHaveBeenCalledOnce();
		expect(sync).toHaveBeenCalledWith(b);
		expect(syncA).not.toHaveBeenCalled();
		expect(syncB).toHaveBeenCalledOnce();
	});

	it('disconnects on replacement/deregistration and unsubscribes on close', () => {
		const view = createView();
		const staleRelease = manager.register('a', 'doc', view, document.createElement('div'));
		const old = IntersectionObserverMock.instances[0];
		const release = manager.register('a', 'doc', view, document.createElement('div'));
		expect(old.disconnect).toHaveBeenCalledOnce();
		staleRelease();
		expect(manager.map.a).toBeDefined();
		expect(IntersectionObserverMock.instances[1].disconnect).not.toHaveBeenCalled();
		release();
		release();
		expect(IntersectionObserverMock.instances[1].disconnect).toHaveBeenCalledOnce();
		expect(manager.map).toEqual({});
		manager.register('b', 'doc', view, document.createElement('div'));
		manager.invalidateAll();
		expect(manager.map.b).toMatchObject({ paginatedTo: 0, revision: 1 });
		manager.close();
		expect(IntersectionObserverMock.instances[2].disconnect).toHaveBeenCalledOnce();
		expect(manager.map).toEqual({});
		const invalidate = vi.spyOn(manager, 'invalidate');
		preUpdate(view, edit(view, 0));
		expect(invalidate).not.toHaveBeenCalled();
	});
});
