import { Slice, type Node } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { CM_PER_INCH, PIXELS_PER_INCH } from '../prosemirror/view/constants';
import { schema } from '../prosemirror/view/schema';

export type Unit = 'in' | 'cm' | 'mm';

export const PAGE_SIZES_INCHES = {
	A4: {
		width: 8.27,
		height: 11.69
	},
	A5: {
		width: 5.83,
		height: 8.27
	},
	A6: {
		width: 4.13,
		height: 5.83
	},
	A7: {
		width: 2.91,
		height: 4.13
	},
	A8: {
		width: 2.05,
		height: 2.91
	},
	Ledger: {
		width: 17,
		height: 11
	},
	Letter: {
		width: 8.5,
		height: 11
	},
	Legal: {
		width: 8.5,
		height: 14
	}
} as const;

export const PAGE_SIZES_MM = {
	A4: {
		width: 210,
		height: 297
	},
	A5: {
		width: 148,
		height: 210
	},
	A6: {
		width: 105,
		height: 148
	},
	A7: {
		width: 74,
		height: 105
	},
	A8: {
		width: 52,
		height: 74
	},
	Ledger: {
		width: 432,
		height: 279
	},
	Letter: {
		width: 216,
		height: 279
	},
	Legal: {
		width: 216,
		height: 356
	}
};

type PageData = {
	modified: Date;
	ref: Node;
};

type ModificationData = {
	modified: Date;
	page: number;
};

export class PageLayoutManager {
	units = $state<Unit>('in');
	pageWidth = $state<number>(0);
	pageHeight = $state<number>(0);
	pageYMargin = $state<number>(0);
	pageXMargin = $state<number>(0);
	pageBleed = $state<number>(0);
	numOrphanLines = $state<number>(2);
	numWidowLines = $state<number>(2);
	currentPage = $state<number>(0);
	lastModification = $state<ModificationData>({
		modified: new Date(),
		page: 0
	});
	pages = $state<PageData[]>([]);

	constructor() {
		// For testing purposes - this will be set by settings at a certain point
		// Also set from a menu
		this.setPredefinedPageSize('in', 'A5');
	}

	setPredefinedPageSize(units: Unit, size: keyof typeof PAGE_SIZES_MM): void {
		const { width, height } = this.getPredefinedPageSize(units, size);
		this.pageWidth = width;
		this.pageHeight = height;
		this.pageXMargin = 0.5;
		this.pageYMargin = 0.4;
		this.units = units;
	}

	getPredefinedPageSize(
		units: Unit,
		size: keyof typeof PAGE_SIZES_MM
	): { width: number; height: number } {
		if (units === 'in') {
			return PAGE_SIZES_INCHES[size];
		} else if (units === 'cm') {
			const { width, height } = PAGE_SIZES_MM[size];
			return {
				width: width / 10,
				height: height / 10
			};
		} else {
			return PAGE_SIZES_MM[size];
		}
	}

	updateLastModified(page: number) {
		this.lastModification = {
			modified: new Date(),
			page
		};
	}

	/**
	 * Reflow the pages from the from page to the to page.
	 * This function is effectively dumb and will not check if the pages do not to be reflowed.
	 * This should be done in the calling functions.
	 *
	 * This function will add meta data to each page.
	 */
	reflow(page: number) {
		const from = Math.min(this.pages.length - 1, page);
		const to = this.currentPage + 1;

		if (from > to) {
			return;
		}

		for (let i = from; i <= to + 1; i++) {
			// We can assume
		}
	}

	reflowToLandmark(landmark: unknown) {
		// TODO: Figure out
		console.log(landmark);
	}

	convertMeasurementToPx(measurement: number, units: Unit): number {
		const pixelsPerInch = window.devicePixelRatio * PIXELS_PER_INCH;
		let factor: number;
		switch (units) {
			case 'cm':
				factor = CM_PER_INCH;
				break;
			case 'mm':
				factor = CM_PER_INCH * 10;
				break;
			case 'in':
				factor = 1;
				break;
		}

		return (measurement / factor) * pixelsPerInch;
	}

	calculatePageBottom(host: HTMLElement): number {
		const { bottom } = host.getBoundingClientRect();
		const bottomPadding = this.convertMeasurementToPx(this.pageYMargin, this.units);

		return bottom - bottomPadding;
	}

	detectPageFrom(view: EditorView, host: HTMLElement) {
		const maxBottom = this.calculatePageBottom(host);
		let prevEl: HTMLElement | null = null;
		let overflowingEl: HTMLElement | null = null;

		let pos = 0;
		while (pos < view.state.doc.nodeSize) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) {
				break;
			}

			if (!node.isBlock) {
				continue;
			}

			const el = view.nodeDOM(pos) as HTMLElement | null;
			if (!el) {
				console.warn('No element found for node', node, pos);
				break;
			}
			const { bottom } = el.getBoundingClientRect();
			pos += node.nodeSize;
			if (bottom >= maxBottom) {
				overflowingEl = el;
				break;
			}

			prevEl = el;
		}

		const overflowingNode = view.state.doc.nodeAt(pos);
		if (!prevEl || !overflowingEl || !overflowingNode) {
			return;
		}

		const newBottom = prevEl.getBoundingClientRect().bottom;

		const slice = view.state.doc.slice(pos, view.state.doc.nodeSize);
		const nextPage = schema.nodes.doc.createAndFill(null, slice.content);

		const tr = view.state.tr.delete(pos - overflowingNode.nodeSize, view.state.doc.content.size);
		view.dispatch(tr);
	}
}

/**
 * we will paginate from page 0 to the current page the user is on + 1
 * which means there will be something like this:
 * [page]
 * [page]
 * [page]
 * [current page]
 * [page]
 * [rest of content]
 *
 * Whenever a page is modified, all pages from then to the current page + 1 need to be modified
 * All pages should cache the content they have
 * Also, we need to track where the user's viewport is
 *
 *
 * How will this work with multiple simultaneous users?
 * It should be possible for each user to have multiple pages open
 * and multiple users, each on different pages.
 *
 * To reduce time complexity but increase space complexity,
 * we will eep a reference to each page, including a last time modified
 * and a reference to the node (the PageData type)
 *
 * Every time a page is modified, we will search for the page and update
 * the last modified data after we have updated the node.
 *
 * We will want to update the pagination if any of the following occurs:
 * 1. Page size changes.
 * 2. Page orientation changes.
 * 3. Page margins change.
 * 4. Page bleed changes.
 * 5. Page padding changes.
 * 6. Page number of orphan lines changes.
 * 7. Page number of widow lines changes.
 * 8. Insertion of content
 * 9. Deletion of content
 * 10. Modification of content that affects layout
 *
 *
 * Any time a modification occurs that requires a reflow/checking of pagination,
 * then we will update the lastModified item
 *
 * When the user scrolls, if the page is already paginated according to
 * latest reflow, we will not act. However, if it is, we have to paginate.
 * We'll have to measure performance since it has to happen linearly - we cannot
 * calculate pagination for page 3 until page 2 is done, etc.
 */

const PageLayout = new PageLayoutManager();
export default PageLayout;
