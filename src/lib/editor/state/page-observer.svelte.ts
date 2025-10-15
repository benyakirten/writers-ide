import type { Transaction } from 'prosemirror-state';

import { PROSEMIRROR_PAGE_CLASS } from '../prosemirror/view/constants';
import proseMirrorEventBus, { ProseMirrorEventBusEventType } from './event-bus.svelte';
import PageLayout from './page-layout.svelte';
import type { EditorView } from 'prosemirror-view';

export class DocumentObserver {
	private observer: IntersectionObserver | null = $state(null);
	private unsub: () => void;

	intersectionCallback: IntersectionObserverCallback = (entries) => {
		const newPage =
			entries.filter(
				(entry) => entry.target.classList.contains(PROSEMIRROR_PAGE_CLASS) && entry.isIntersecting,
			).length - 1;

		this.cb(newPage);
	};

	constructor(
		private readonly _id: string,
		private readonly cb: (page: number) => void,
		private el: HTMLElement,
		private _docId: string,
		options: Partial<IntersectionObserverInit> = {},
	) {
		options.root ??= el;
		options.rootMargin ??= '800px';
		options.threshold ??= 0;

		this.observer = new IntersectionObserver(this.intersectionCallback, options);
		this.unsub = proseMirrorEventBus.subscribe(({ id, event }) => {
			if (event.type === ProseMirrorEventBusEventType.Paginate && id === this._docId) {
				this.reset();
			}
		});

		this.el
			.querySelectorAll(`.${PROSEMIRROR_PAGE_CLASS}`)
			.forEach((el) => this.observer?.observe(el));
	}

	get id() {
		return this._id;
	}

	get docId() {
		return this._docId;
	}

	disconnect() {
		this.observer?.disconnect();
	}

	reset() {
		this.disconnect();
		this.el
			.querySelectorAll(`.${PROSEMIRROR_PAGE_CLASS}`)
			.forEach((el) => this.observer?.observe(el));
	}

	close() {
		this.disconnect();
		this.unsub();
	}
}

export type ObservedPage = {
	viewedPage: number;
	obsPage: Record<string, number>;
	paginatedTo: number;
	lastChangedPage: number | null;
	observers: DocumentObserver[];
};

export type ToPaginateRange = [id: string, from: number, to: number];

class PageObserverManager {
	private _map: Record<string, ObservedPage> = $state({});
	private unsub: () => void;
	public map = $derived(this._map);

	public toPaginate = $derived(
		Object.entries(this._map).reduce<ToPaginateRange[]>((acc, [id, data]) => {
			if (data.paginatedTo < data.viewedPage) {
				acc.push([id, data.paginatedTo, data.viewedPage + 1]);
			} else if (data.lastChangedPage !== null && data.lastChangedPage < data.viewedPage) {
				acc.push([id, data.lastChangedPage, data.viewedPage + 1]);
			}
			return acc;
		}, []),
	);

	constructor() {
		this.unsub = proseMirrorEventBus.subscribe(({ id, event }) => {
			const data = this._map[id];
			if (!data) {
				return;
			}

			switch (event.type) {
				case ProseMirrorEventBusEventType.Paginate:
					data.paginatedTo = event.paginatedTo;
					break;
				case ProseMirrorEventBusEventType.PreUpdate:
					this.updateLastUpdatedPage(data, event.view, event.tr);
					break;
			}
		});
	}

	updateLastUpdatedPage(data: ObservedPage, view: EditorView, tr: Transaction) {
		const [firstPage] = PageLayout.getAffectedPageRangeFromTransaction(view, tr);
		data.lastChangedPage = firstPage;
	}

	close() {
		this.unsub();
		Object.values(this._map).forEach((data) => data.observers.forEach((obs) => obs.close()));
		this._map = {};
	}

	getMaxPage(data: ObservedPage): number {
		return Math.max(...Object.values(data.obsPage));
	}

	register(
		obsId: string,
		el: HTMLElement,
		docId: string,
		viewedPage: number = 0,
		paginatedTo: number = 0,
	) {
		const data = this._map[docId];
		const obs = new DocumentObserver(obsId, (page) => this.scrollTo(obsId, docId, page), el, docId);

		if (!data) {
			const observedPage = {
				viewedPage,
				paginatedTo,
				observers: [obs],
				needsPagination: false,
				obsPage: { [obsId]: viewedPage },
				lastChangedPage: null,
			};
			this._map[docId] = observedPage;
		} else {
			data.obsPage[obsId] = viewedPage;
			data.paginatedTo = this.getMaxPage(data);
			data.observers.push(obs);
		}

		return () => this.deregister(obs.id, docId);
	}

	deregister(id: string, docId: string) {
		const data = this.data(docId);

		const obsIndex = data.observers.findIndex((o) => o.id === id);
		if (obsIndex === -1) {
			throw new Error(`Observer ${id} not found for document ${docId}`);
		}
		const observer = data.observers[obsIndex];
		observer.close();

		if (data.observers.length === 0) {
			delete this._map[docId];
		} else {
			data.observers.splice(obsIndex, 1);
		}
	}

	data(docId: string): ObservedPage {
		const data = this._map[docId];
		if (!data) {
			throw new Error(`Document ${docId} is not being observed`);
		}

		return data;
	}

	scrollTo(obsId: string, docId: string, page: number) {
		const data = this.data(docId);
		data.obsPage[obsId] = page;
		data.viewedPage = this.getMaxPage(data);
	}

	paginateTo(docId: string, page: number) {
		const data = this.data(docId);
		data.paginatedTo = page;
		data.lastChangedPage = page;
	}

	stopPagination(docId: string, page: number) {
		const data = this.data(docId);
		data.paginatedTo = page;
		data.lastChangedPage = null;
		data.observers.forEach((obs) => obs.reset());
	}

	finishPagination(docId: string) {
		const data = this.data(docId);
		data.observers.forEach((obs) => obs.reset());
	}
}
export const PageObserver = new PageObserverManager();
