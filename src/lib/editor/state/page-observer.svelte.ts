import { PROSEMIRROR_PAGE_CLASS } from '../prosemirror/view/constants';

class PageObserver {
	public observer: IntersectionObserver | null = $state(null);
	public pageViewed: number = $state(0);

	constructor(observer: IntersectionObserver) {
		this.observer = observer;
	}

	setupObserver() {
		this.observer ??= new IntersectionObserver((entries) => {
			let maxPageViewed = 0;
			let pageCount = 0;
			entries.forEach((entry) => {
				if (
					entry.target instanceof HTMLElement &&
					entry.target.classList.contains(PROSEMIRROR_PAGE_CLASS)
				) {
					pageCount++;
					if (entry.isIntersecting) {
						maxPageViewed = Math.max(maxPageViewed, pageCount);
					}
				}
			});

			this.pageViewed = maxPageViewed;
		});
	}
}

export default PageObserver;
