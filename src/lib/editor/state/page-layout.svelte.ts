import type { EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';

import { getLineHeight, linesInEl } from '$lib/utils/css';
import { CM_PER_INCH, PIXELS_PER_INCH } from '../prosemirror/view/constants';

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

export class PageLayoutManager {
	units = $state<Unit>('in');
	pageWidth = $state<number>(0);
	pageHeight = $state<number>(0);
	pageYMargin = $state<number>(0);
	pageXMargin = $state<number>(0);
	pageBleed = $state<number>(0);
	orphanLines = $state<number>(2);
	widowLines = $state<number>(2);
	currentPage = $state<number>(0);

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

	getPage(
		view: EditorView,
		page: number
	): { page: HTMLElement; node: Node; offset: number } | null {
		let pos = 0;
		let currentPage = -1;
		while (pos < view.state.doc.nodeSize) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) {
				break;
			}

			if (!node.isBlock) {
				pos += node.nodeSize;
				continue;
			}

			if (node.type.name !== 'page') {
				pos += 1;
				continue;
			}

			currentPage++;
			if (currentPage === page) {
				const el = view.nodeDOM(pos) as HTMLElement;
				if (!el) {
					return null;
				}

				return { page: el, node, offset: pos };
			}

			pos += node.nodeSize;
		}

		return null;
	}

	getRemainingLineCountInPage(pageBottom: number, overflowingEl: HTMLElement): number {
		const lineHeight = getLineHeight(overflowingEl);
		const remainingPx = overflowingEl.getBoundingClientRect().bottom - pageBottom;
		return Math.floor(remainingPx / lineHeight);
	}

	/**
	 * Determines how to split a paragraph between pages based on widow/orphan rules.
	 */
	splitLinesOnPages(
		linesNotOverflowingPage: number,
		linesOverflowingPage: number
	): [linesToKeepOnPage: number, linesToPutOnNextPage: number] {
		// If either is 0, we don't need to think about widow/orphan lines.
		if (linesOverflowingPage == 0) {
			return [linesNotOverflowingPage, 0];
		} else if (linesNotOverflowingPage == 0) {
			return [0, linesOverflowingPage];
		}

		// Adjust if we violate widow rule (not enough lines on next page).
		if (linesOverflowingPage < this.widowLines) {
			const linesToTransferFromCurrentPageToNext = this.widowLines - linesOverflowingPage;

			linesNotOverflowingPage -= linesToTransferFromCurrentPageToNext;
			linesOverflowingPage += linesToTransferFromCurrentPageToNext;
		}

		if (linesNotOverflowingPage < this.orphanLines) {
			linesOverflowingPage += linesNotOverflowingPage;
			linesNotOverflowingPage = 0;
		}

		return [linesNotOverflowingPage, linesOverflowingPage];
	}

	detectPageFrom(view: EditorView) {
		const pageDetails = this.getPage(view, 0);
		if (!pageDetails) {
			// We will want to create a new page and nest all of the content
			// inside of it, i.e.:
			// this.createPage(view)
			return;
		}
		const { page, node: root, offset } = pageDetails;
		const pageBottom = this.calculatePageBottom(page);
		let prevEl: HTMLElement | null = null;
		let overflowingEl: HTMLElement | null = null;
		let overflowingNode: Node | null = null;

		let pos = 0;
		while (pos < root.nodeSize) {
			const node = root.nodeAt(pos);
			if (!node) {
				break;
			}

			if (!node.isBlock) {
				pos += node.nodeSize;
				continue;
			}

			const el = view.nodeDOM(pos + offset + 1) as HTMLElement | null;
			if (!el) {
				console.warn('No element found for node', node, pos);
				break;
			}

			const { bottom } = el.getBoundingClientRect();
			if (bottom >= pageBottom) {
				overflowingNode = node;
				overflowingEl = el;
				break;
			}

			prevEl = el;
			pos += node.nodeSize;
		}

		if (!prevEl || !overflowingEl || !overflowingNode) {
			console.log(!!prevEl, !!overflowingEl, !!overflowingNode);
			return;
		}

		// Count the number of lines that fit on the page.
		const numLinesOverflowing = this.getRemainingLineCountInPage(pageBottom, overflowingEl);

		// Count the nuber of lines that overflow the page.
		const totalLines = linesInEl(overflowingEl);

		// Count the amount of lines that should be on the current page
		// and the number of lines that should be on the next page.
		const [linesToKeepOnPage, linesToPutOnNextPage] = this.splitLinesOnPages(
			totalLines - numLinesOverflowing,
			numLinesOverflowing
		);

		if (linesToPutOnNextPage > 0) {
			// Find where the next page's words start,
			// remove them from the overflowing element,
			// and create a new page with the remaining content.
			const splitOffset = this.getSplitPosition(overflowingNode, overflowingEl, linesToKeepOnPage);

			if (splitOffset === null) {
				console.warn('Could not find split position for overflowing element', overflowingEl);
				return;
			}

			const contentToKeep = root.cut(0, pos + splitOffset);
			const contentToMove = root.cut(pos + splitOffset);

			const currentPageReplacement = overflowingNode.type.create(overflowingNode.attrs, [
				contentToKeep
			]);
			const { tr } = view.state;

			tr.replaceWith(offset, offset + root.nodeSize, currentPageReplacement);

			const newPage = root.type.create(root.attrs, contentToMove);
			tr.insert(offset + currentPageReplacement.nodeSize, newPage);

			view.dispatch(tr);
		}

		// const tr = view.state.tr.delete(pos, view.state.doc.content.size);
		// view.dispatch(tr);
	}

	/**
	 * Get the position in which to split the overflowing element so that we can split it onto two separate pages.
	 */
	getSplitPosition(node: Node, el: HTMLElement, linesToKeepOnPage: number): number | null {
		const range = document.createRange();
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

		let visualLineCount = 0;
		let pmOffset = 0;

		// We’ll iterate through the ProseMirror node’s descendants and DOM text nodes together
		let domTextNode = walker.nextNode();

		if (!domTextNode) return null;

		node.descendants((child) => {
			if (!child.isText || !child.text) return true; // only interested in text nodes

			let remaining = child.text.length;

			while (remaining > 0 && domTextNode) {
				const domText = domTextNode.textContent || '';
				const toConsume = Math.min(remaining, domText.length);

				for (let i = 1; i <= toConsume; i++) {
					range.setStart(el, 0);
					range.setEnd(domTextNode, i);

					const rects = range.getClientRects();
					const lines = rects.length;

					if (lines > visualLineCount) {
						visualLineCount = lines;
						// linesToeepOnPage + 1 becaue we want to start at the beginnign of the next line.
						if (linesToKeepOnPage + 1 === visualLineCount) {
							return false; // Stop traversal, we reached the split line
						}
					}

					pmOffset += 1;
				}

				remaining -= toConsume;
				domTextNode = walker.nextNode();
			}

			return true; // keep descending
		});

		// If we reached or passed desired line count, return offset
		return visualLineCount >= linesToKeepOnPage ? pmOffset : null;
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
