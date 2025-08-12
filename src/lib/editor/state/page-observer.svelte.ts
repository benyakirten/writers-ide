import { PROSEMIRROR_PAGE_CLASS } from '../prosemirror/view/constants';

export class DocumentObserver {
	private observer: IntersectionObserver | null = $state(null);

	intersectionCallback: IntersectionObserverCallback = (entries) => {
		const newPage =
			entries.filter(
				(entry) => entry.target.classList.contains(PROSEMIRROR_PAGE_CLASS) && entry.isIntersecting
			).length - 1;

		this.cb(newPage);
	};

	constructor(
		private readonly _id: string,
		private readonly cb: (page: number) => void,
		private el: HTMLElement,
		options: Partial<IntersectionObserverInit> = {}
	) {
		options.root ??= el;
		options.rootMargin ??= '800px';
		options.threshold ??= 0;
		this.observer = new IntersectionObserver(this.intersectionCallback, options);

		this.el
			.querySelectorAll(`.${PROSEMIRROR_PAGE_CLASS}`)
			.forEach((el) => this.observer?.observe(el));
	}

	get id() {
		return this._id;
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
}

type ObservedPage = {
	viewedPage: number;
	paginatedThrough: number;
	observers: DocumentObserver[];
};

class PageObserverManager {
	private _map: Record<string, ObservedPage> = $state({});
	public map = $derived(this._map);

	register(obsId: string, el: HTMLElement, docId: string, paginatedThrough?: number) {
		const data = this._map[docId];
		const obs = new DocumentObserver(obsId, (page) => this.scrollTo(docId, page), el);

		if (!data) {
			const observedPage = {
				viewedPage: 0,
				paginatedThrough: paginatedThrough ?? 0,
				observers: [obs]
			};
			this._map[docId] = observedPage;
		} else {
			data.observers.push(obs);
		}

		return () => this.deregister(obs.id, docId);
	}

	deregister(id: string, docId: string) {
		const data = this.data(docId);

		data.observers = data.observers.filter((obs) => obs.id !== id);
		if (data.observers.length === 0) {
			delete this._map[docId];
		}
	}

	data(docId: string): ObservedPage {
		const data = this._map[docId];
		if (!data) {
			throw new Error(`Document ${docId} is not being observed`);
		}

		return data;
	}

	scrollTo(docId: string, page: number) {
		const data = this.data(docId);
		data.observers.forEach((obs) => obs.disconnect());
		data.viewedPage = page;
	}

	paginateTo(docId: string, page: number) {
		const data = this.data(docId);
		data.paginatedThrough = page;
	}

	stopPagination(docId: string, page: number) {
		const data = this.data(docId);
		data.paginatedThrough = page;
		data.observers.forEach((obs) => obs.reset());
	}

	finishPagination(docId: string) {
		const data = this.data(docId);
		data.observers.forEach((obs) => obs.reset());
	}
}
export const PageObserver = new PageObserverManager();
