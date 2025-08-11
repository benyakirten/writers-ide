import { PROSEMIRROR_PAGE_CLASS } from '../prosemirror/view/constants';

export class DocumentObserver {
	private observer: IntersectionObserver | null = $state(null);

	intersectionCallback: IntersectionObserverCallback = (entries) => {
		const newPage =
			entries.filter(
				(entry) => entry.target.classList.contains(PROSEMIRROR_PAGE_CLASS) && entry.isIntersecting
			).length - 1;

		PageObserver.scrollTo(this.doc, newPage);
	};

	constructor(
		private doc: string,
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

	observe(doc: string, obs: DocumentObserver, paginatedThrough?: number) {
		const data = this._map[doc];
		if (!data) {
			const observedPage = {
				viewedPage: 0,
				paginatedThrough: paginatedThrough ?? 0,
				observers: [obs]
			};
			this._map[doc] = observedPage;
		} else {
			data.observers.push(obs);
		}
	}

	data(doc: string): ObservedPage {
		const data = this._map[doc];
		if (!data) {
			throw new Error(`Document ${doc} is not being observed`);
		}

		return data;
	}

	scrollTo(doc: string, page: number) {
		const data = this.data(doc);
		data.viewedPage = page;
	}

	paginateTo(doc: string, page: number) {
		const data = this.data(doc);
		data.paginatedThrough = page;
	}

	stopPagination(doc: string, page: number) {
		// TODO
	}

	finishPagination(doc: string) {
		const data = this.data(doc);
		data.observers.forEach((obs) => obs.reset());
	}
}
export const PageObserver = new PageObserverManager();
