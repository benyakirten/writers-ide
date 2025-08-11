import { PROSEMIRROR_PAGE_CLASS } from '../prosemirror/view/constants';

export class DocumentObserver {
	private observer: IntersectionObserver | null = $state(null);

	intersectionCallback: IntersectionObserverCallback = (entries) => {
		const newPage =
			entries.filter(
				(entry) => entry.target.classList.contains(PROSEMIRROR_PAGE_CLASS) && entry.isIntersecting
			).length - 1;

		if (!PageObserver.scrollTo(this.doc, newPage)) {
			// Some sort of toast? This should probably be logged.
		}
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
};

class PageObserverManager {
	private _map: Record<string, ObservedPage> = $state({});
	public map = $derived(this._map);

	scrollTo(doc: string, page: number): boolean {
		const data = this._map[doc];
		if (!data) {
			return false;
		}

		const { paginatedThrough } = data;
		if (page > paginatedThrough) {
			// Handle pagination
		}

		data.viewedPage = page;
		data.paginatedThrough = page;

		return true;
	}
}
export const PageObserver = new PageObserverManager();

type PaginationDetails = {
	current: number;
	target: number;
};

export class PaginatorHandler {
	private _registry: Record<string, PaginationDetails> = $state({});
	public registry = $derived(this._registry);

	start(doc: string, page: number) {
		this._registry[doc] = { current: 0, target: page };
	}

	update(doc: string, page: number) {
		this._registry[doc].current = page;
	}

	remove(doc: string) {
		delete this._registry[doc];
	}
}
export const Paginator = new PaginatorHandler();
