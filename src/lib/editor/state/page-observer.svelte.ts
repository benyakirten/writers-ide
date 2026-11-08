import type { EditorView } from 'prosemirror-view';
import {
	PROSEMIRROR_PAGE_CLASS,
	PAGINATION_TRANSACTION_META_KEY,
} from '../prosemirror/view/constants';
import proseMirrorEventBus, { ProseMirrorEventBusEventType } from './event-bus.svelte';
import PageLayout, { PageLayoutMetaTransactionType } from './page-layout.svelte';

/** Tracks changed intersection entries against a persistent set, not callback entry counts. */
export class DocumentObserver {
	private observer: IntersectionObserver;
	private pages: Element[] = [];
	private visible = new Set<Element>();
	private observed = new Set<Element>();

	constructor(
		private content: HTMLElement,
		viewport: HTMLElement,
		private cb: (page: number) => void,
	) {
		this.observer = new IntersectionObserver(this.intersectionCallback, {
			root: viewport,
			threshold: 0,
		});
		this.sync();
	}

	intersectionCallback: IntersectionObserverCallback = (entries) => {
		for (const entry of entries) {
			if (!this.observed.has(entry.target)) continue;
			if (entry.isIntersecting) this.visible.add(entry.target);
			else this.visible.delete(entry.target);
		}
		this.report();
	};

	private report() {
		const indexes = this.pages.flatMap((page, index) => (this.visible.has(page) ? [index] : []));
		// Keep the last target when the pane is hidden or between intersection notifications.
		if (indexes.length) this.cb(Math.max(...indexes));
	}

	sync() {
		const pages = Array.from(this.content.children).filter((el) =>
			el.classList.contains(PROSEMIRROR_PAGE_CLASS),
		);
		const next = new Set(pages);
		for (const page of this.pages) {
			if (!next.has(page)) {
				this.observer.unobserve(page);
				this.visible.delete(page);
			}
		}
		for (const page of pages) if (!this.observed.has(page)) this.observer.observe(page);
		this.observed = next;
		this.pages = pages;
		this.report();
	}

	close() {
		this.observer.disconnect();
		this.visible.clear();
		this.observed.clear();
		this.pages = [];
	}
}

export type ObservedPage = {
	viewId: string;
	documentId: string;
	view: EditorView;
	viewedPage: number;
	/** Exclusive end of the valid prefix. */
	paginatedTo: number;
	/** Changes only for external edits/layout changes, not pagination's own transactions. */
	revision: number;
	observer: DocumentObserver;
};

export class PageObserverManager {
	map = $state<Record<string, ObservedPage>>({});
	private unsub: () => void;

	constructor() {
		this.unsub = proseMirrorEventBus.subscribe(({ id, event }) => {
			if (event.type === ProseMirrorEventBusEventType.PreUpdate) {
				if (!event.tr.docChanged) return;
				const meta = event.tr.getMeta(PAGINATION_TRANSACTION_META_KEY);
				if (meta && meta.type !== PageLayoutMetaTransactionType.BreakPeering) return;
				const [page] = PageLayout.getAffectedPageRangeFromTransaction(event.view, event.tr);
				for (const data of Object.values(this.map)) {
					if (data.documentId === id) this.invalidate(data.viewId, page);
				}
			} else if (event.type === ProseMirrorEventBusEventType.Update) {
				for (const data of Object.values(this.map)) {
					if (data.view === event.view) {
						PageLayout.syncPageIndexes(data.view);
						data.observer.sync();
					}
				}
			}
		});
	}

	register(viewId: string, documentId: string, view: EditorView, viewport: HTMLElement) {
		this.deregister(viewId);
		PageLayout.syncPageIndexes(view);
		const observer = new DocumentObserver(view.dom, viewport, (page) => {
			const data = this.map[viewId];
			if (data) data.viewedPage = page;
		});
		this.map[viewId] = {
			viewId,
			documentId,
			view,
			viewedPage: 0,
			paginatedTo: 0,
			revision: 0,
			observer,
		};
		return () => {
			if (this.map[viewId]?.observer === observer) this.deregister(viewId);
		};
	}

	target(data: ObservedPage) {
		return Math.min(data.viewedPage + 2, data.view.state.doc.childCount);
	}

	invalidate(viewId: string, page = 0) {
		const data = this.map[viewId];
		if (!data) return;
		// A change at a page boundary can allow content to be pulled onto its predecessor.
		data.paginatedTo = Math.min(data.paginatedTo, Math.max(0, page - 1));
		data.revision++;
	}

	invalidateAll() {
		for (const viewId of Object.keys(this.map)) this.invalidate(viewId);
	}

	deregister(viewId: string) {
		this.map[viewId]?.observer.close();
		delete this.map[viewId];
	}

	close() {
		this.unsub();
		for (const id of Object.keys(this.map)) this.deregister(id);
	}
}

export const PageObserver = new PageObserverManager();
