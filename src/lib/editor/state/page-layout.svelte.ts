import type { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

import { getLineHeight } from '$lib/utils/css';
import {
	CM_PER_INCH,
	INDENT_MAX,
	INDENT_MIN,
	PIXELS_PER_INCH,
	PAGINATION_TRANSACTION_META_KEY,
	PROSEMIRROR_PARAGRAPH_CLASS,
	PEERED_TRANSACTION_META_KEY,
	PEERED_TRANSACTION_REUNITE_PEERS_META_VALUE
} from '../prosemirror/view/constants';
import { clamp } from '$lib/utils/numbers';
import type { Transaction } from 'prosemirror-state';

export type Unit = 'in' | 'cm' | 'mm';

/**
 * Information about the content that either overflows a page
 * or cannot grow without causing overflow. The `doesNotOverflowPage`
 * flag indicates that the content goes until the possible line page
 * while otherwise this indicates that the content is indeed overflowing.
 */
type OverflowingDetails = {
	doesNotOverflowPage: boolean;
	overflowingNode: ProseMirrorNode;
	overflowingNodeOffset: number;
	overflowingEl: HTMLElement;
};

type UnderflowingDetails = {
	hasDiscoveredPageEnd: boolean;
	lastNodeOffset: number;
};

type PageDetails = {
	pageEl: HTMLElement;
	pageNode: ProseMirrorNode;
	pageOffset: number;
};

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

	_defaultParagraphIndent = $state<number>(1);
	defaultParagraphIndent = $derived(clamp(this._defaultParagraphIndent, INDENT_MIN, INDENT_MAX));

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

	calculatePageTop(host: HTMLElement): number {
		const { top } = host.getBoundingClientRect();
		const topPadding = this.convertMeasurementToPx(this.pageYMargin, this.units);

		return top + topPadding;
	}

	getPage(view: EditorView, page: number): PageDetails | null {
		let pos = 0;
		let currentPage = 0;
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

			if (currentPage === page) {
				const el = view.nodeDOM(pos) as HTMLElement;
				if (!el) {
					return null;
				}

				return { pageEl: el, pageNode: node, pageOffset: pos };
			}

			currentPage++;
			pos += node.nodeSize;
		}

		return null;
	}

	/**
	 * Determines how to split a paragraph between pages based on widow/orphan rules.
	 */
	calculateLineSplitAmount(
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

	getLastContentfulChildOfEl(el: HTMLElement) {
		const children = Array.from(el.children).reverse();
		if (children.length === 0) {
			return el;
		}

		for (const child of children) {
			if (
				!child.classList.contains(PROSEMIRROR_PARAGRAPH_CLASS) ||
				child.textContent.trim().length !== 0
			) {
				return child;
			}
		}

		return el;
	}

	/**
	 * Get the amount of unused space on the page in pixels.
	 */
	private calculateUnusedSpace(
		view: EditorView,
		pageDetails: PageDetails,
		lastNodeOffset: number
	): number | null {
		const { pageEl, pageOffset } = pageDetails;

		const nodeEl = view.nodeDOM(pageOffset + lastNodeOffset + 1) as HTMLElement | null;
		if (!nodeEl) {
			console.warn('Could not find node element for page end at offset', lastNodeOffset);
			return null;
		}

		return this.calculatePageBottom(pageEl) - nodeEl.getBoundingClientRect().bottom;
	}

	pageHasNoNodesAfter(pageNode: ProseMirrorNode, offset: number): boolean {
		if (pageNode.childCount === 0 || offset >= pageNode.nodeSize - 1) {
			return true;
		}

		for (let i = offset; i < pageNode.nodeSize - 1; i++) {
			const node = pageNode.nodeAt(i);
			if (node) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Move all content from the page at the given offset to the next page.
	 * If the next page does not exist, it will be created.
	 */
	private paginateForwardFromOffset(
		tr: Transaction,
		pageNode: ProseMirrorNode,
		pageOffset: number,
		pageSplitOffset: number,
		hasNextPage: boolean,
		shouldDedent: boolean
	): number {
		// NOTE: node.cut WILL KEEP THE OUTER ELEMENT so if we only want the content
		// and not the page too, we need to get cutContent.content instead of cutContent.
		const contentToKeep = pageNode.cut(0, pageSplitOffset);
		const contentToMove = pageNode.cut(pageSplitOffset);

		tr.replaceWith(pageOffset, pageOffset + pageNode.nodeSize, contentToKeep);
		// Create a new page with the content that was overflowing.
		if (hasNextPage) {
			// If there is a next page, we insert the content there
			tr.insert(pageOffset + contentToKeep.nodeSize + 1, contentToMove.content);
		} else {
			// If there is no next page, we create it.
			tr.insert(pageOffset + contentToKeep.nodeSize, contentToMove);
		}

		if (shouldDedent) {
			this.setPeer(tr, pageOffset + contentToKeep.nodeSize + 1);
		}

		return hasNextPage ? 1 : 0;
	}

	/**
	 * Move all content from the next page at the given offset to the previous page.
	 * This function assumes that both pages already exist. If they don't, you're
	 * definitely calling the wrong function.
	 */
	private paginateBackwardFromOffset(
		tr: Transaction,
		pageNode: ProseMirrorNode,
		pageOffset: number,
		nextPageNode: ProseMirrorNode,
		nextPageOffset: number,
		nextPageSplitOffset: number,
		shouldDedent: boolean,
		shouldDeleteNextPage: boolean
	): number {
		const contentToMoveBackward = nextPageNode.cut(0, nextPageSplitOffset);
		const contentToKeep = nextPageNode.cut(nextPageSplitOffset);

		if (shouldDeleteNextPage) {
			tr.delete(nextPageOffset, nextPageOffset + nextPageNode.nodeSize);
		} else {
			tr.replaceWith(nextPageOffset, nextPageOffset + nextPageNode.nodeSize, contentToKeep);
			if (shouldDedent) {
				this.setPeer(tr, nextPageOffset + 1);
			}
		}
		tr.insert(pageOffset + pageNode.nodeSize - 1, contentToMoveBackward.content);

		return shouldDeleteNextPage ? -1 : 0;
	}

	private setPeer(tr: Transaction, offset: number) {
		tr.setNodeAttribute(offset, 'indent', INDENT_MIN);
		tr.setNodeAttribute(offset, 'peer', true);
	}

	/**
	 * If the page overflows, then we need to find the safe position to split the content,
	 * replace the current page with the content that fits and move eerything else to the
	 * beginning of the next page. If it overflows on a text node that needs to be split
	 * across both pages, we will want to dedent the first paragraph of the next page.
	 */
	private handlePageOverflow(
		tr: Transaction,
		pageDetails: PageDetails,
		overflowingDetails: OverflowingDetails,
		maxBottom: number,
		nextPage: PageDetails | null
	): number {
		const { overflowingNode, overflowingEl, overflowingNodeOffset } = overflowingDetails;

		const splitOffsetInfo = this.getSplitOffsetForOverflowingElement(
			maxBottom,
			overflowingNode,
			overflowingEl
		);

		const { splitOffset, shouldDedent } = splitOffsetInfo;

		return this.paginateForwardFromOffset(
			tr,
			pageDetails.pageNode,
			pageDetails.pageOffset,
			overflowingNodeOffset + splitOffset,
			nextPage !== null,
			shouldDedent
		);
	}

	/**
	 * If a page is not overflowing and ends with a page end node,
	 * we either need to find out if there are any nodes after the page end.
	 * If there aren't, we can safely move onto the next page.
	 * If there are, we need to move everything after the page end node
	 * to the next page.
	 */
	private handlePageEndTermination(
		tr: Transaction,
		pageDetails: PageDetails,
		lastNodeOffset: number,
		hasNextPage: boolean
	): number {
		if (!this.pageHasNoNodesAfter(pageDetails.pageNode, lastNodeOffset)) {
			// Page has content after the page end node. Let's move it forward.
			// If we create a new page, return it.
			return this.paginateForwardFromOffset(
				tr,
				pageDetails.pageNode,
				pageDetails.pageOffset,
				lastNodeOffset + 1,
				hasNextPage,
				false
			);
		}

		return 0;
	}

	/**
	 * We need to see if the next page includes a `pageEnd` node or not.
	 * If it doesn't, we take everything on the following page and put it.
	 * If it does, we take everything before the `pageEnd` node and the node itself.
	 */
	private handleNextPageUnderflow(
		tr: Transaction,
		pageDetails: PageDetails,
		nextPageDetails: PageDetails,
		nextPageUnderflowDetails: UnderflowingDetails
	): number {
		// If we've discovered a page end node, we want to take everything before it and the page end node.
		// If not, we want everything on the page (-2 because of the start and end markers).
		const splitOffset = nextPageUnderflowDetails.hasDiscoveredPageEnd
			? nextPageUnderflowDetails.lastNodeOffset + 1
			: nextPageDetails.pageNode.nodeSize - 2;

		// If the next page has nothing after we've moved everything off, then we should delete it.
		// Note the -2. We're ignoring the page start and end markers.
		const shouldDeleteNextPage = nextPageDetails.pageNode.nodeSize - splitOffset - 2 <= 0;

		// Returns -1 if we're removing a page or 0 in all other cases.
		return this.paginateBackwardFromOffset(
			tr,
			pageDetails.pageNode,
			pageDetails.pageOffset,
			nextPageDetails.pageNode,
			nextPageDetails.pageOffset,
			splitOffset,
			false,
			shouldDeleteNextPage
		);
	}

	/**
	 * Much like `handlePageOverflow`, but this time it's backwards.
	 * We're moving the correct amount of content from the next page to the current page.
	 */
	private handleNextPageOverflow(
		tr: Transaction,
		maxBottom: number,
		pageDetails: PageDetails,
		nextPageDetails: PageDetails,
		nextPageOverflowingDetails: OverflowingDetails
	): number {
		const lineHeight = getLineHeight(nextPageOverflowingDetails.overflowingEl);
		// Since the method will over calculate by one line, this will account for that.
		const nextPageBottom = maxBottom - lineHeight;

		const splitDetails = this.getSplitOffsetForOverflowingElement(
			nextPageBottom,
			nextPageOverflowingDetails.overflowingNode,
			nextPageOverflowingDetails.overflowingEl
		);

		const absoluteSplitPoint =
			splitDetails.splitOffset + nextPageOverflowingDetails.overflowingNodeOffset;

		return this.paginateBackwardFromOffset(
			tr,
			pageDetails.pageNode,
			pageDetails.pageOffset,
			nextPageDetails.pageNode,
			nextPageDetails.pageOffset,
			absoluteSplitPoint,
			splitDetails.shouldDedent,
			false
		);
	}

	/**
	 * This method handles underflow on the current page by dealing with 6 scenario.
	 *
	 * 1. Page ends with page end node and no content after it - move on to the next page.
	 * 2. Page ends with page end node and has content after it - move the content to the next page.
	 * These two conditions will be identified if the underflowing details indicates the current page has
	 * a `pageEnd` node. In the former case, we don't need to do anything, but in the latter case we need to
	 * move everything after the `pageEnd` node to the next page.
	 *
	 * 3. There is no following page - we're done paginating.
	 *
	 * 4. Page ends with any other block node but no remaining space on the page - move onto the next page.
	 *
	 * Then we need to look at the following page.
	 *
	 * 5. Page ends with any other block node but the following page does not exceed the available space
	 *    on the current page.
	 *
	 * This can be broken down into one of two situations:
	 *
	 * -- 5a. The next page has a `pageEnd` node - we move everything before the `pageEnd` node and the node itself
	 *     back onto the current page.
	 *
	 * -- 5b. The next page does not have a `pageEnd` node - we move everything onto the current page.
	 *
	 * Finally:
	 *
	 * 6. Page ends with any other block node, and the next page has more than enough content on it to move over.
	 *    We need to move the appropriate amount of content back and remove it from the next page.
	 *
	 * This function returns the amount of pages added or returned. This will be 0 in most cases, but
	 * if content needs to be moved over (situation #2), it will be 1 and in the case of situation #5
	 * when we take all of the content from the following page, it will be -1.
	 */
	private handlePageUnderflow(
		view: EditorView,
		tr: Transaction,
		pageNumber: number,
		pageDetails: PageDetails,
		underflowingDetails: UnderflowingDetails,
		nextPageDetails: PageDetails | null
	): number {
		const { lastNodeOffset, hasDiscoveredPageEnd } = underflowingDetails;

		// Situation #1 and #2 - `pageEnd` node discovered. We don't care about
		// the available space because we know the node doen't overflow, and
		// we don't need to worry about the next page since we'll be paginating
		// it next. We just want to dump any content after the `pageEnd` node onto it.
		if (hasDiscoveredPageEnd) {
			return this.handlePageEndTermination(
				tr,
				pageDetails,
				lastNodeOffset,
				nextPageDetails !== null
			);
		}

		// Situation #3 - We don't have a `pageEnd` node and we don't have
		// a next page. What else is there to think about?
		if (!nextPageDetails) {
			return 0;
		}

		const availableSpace = this.calculateUnusedSpace(view, pageDetails, lastNodeOffset);
		// Situation #4 - we dont' have any space left on the page so there's no use finding
		// out how much to move over.
		if (availableSpace === null || availableSpace <= 0) {
			return 0;
		}

		// Situation #5 and #6 - We need to find out how of the following page we can move
		// back onto the current page. We can reuse the same logic as finding overflowing elements
		// from the first page - but we set the maximum amount of space to the available space
		// on this page.

		// We need to take the amount of content from the next page. The content starts
		// from the page top (determined by `PageLayout.calculatePageTop)`.

		// TODO: Determine how to work with peered paragraphs.
		const maxBottom = this.calculatePageTop(nextPageDetails.pageEl) + availableSpace;
		const nextPageOverflowingDetails = this.getPageOverflowInformation(
			view,
			maxBottom,
			nextPageDetails
		);

		if (this.pageIsOverflowing(nextPageOverflowingDetails)) {
			// Situation #6. Similar behavior to if current page overflows.
			// Note that here we don't care about if the page cannot fit another block of text
			// without overflowing since at most we want to copy all of the content over
			// to the current page.
			return this.handleNextPageOverflow(
				tr,
				maxBottom,
				pageDetails,
				nextPageDetails,
				nextPageOverflowingDetails
			);
		} else {
			// Situation #5. This method handles both the case of a `pageEnd` node and no `pageEnd` node.
			return this.handleNextPageUnderflow(
				tr,
				pageDetails,
				nextPageDetails,
				nextPageOverflowingDetails
			);
		}
	}

	pageCount(view: EditorView): number {
		return view.state.doc.childCount;
	}

	deletePage(view: EditorView, page: PageDetails): number {
		const { tr } = view.state;
		tr.delete(page.pageOffset, page.pageOffset + page.pageNode.nodeSize);
		view.dispatch(tr);
		return 0;
	}

	isEmptyPage(page: PageDetails): boolean {
		return page.pageNode.content.size === 0;
	}

	/**
	 * Check if the last paragraph of the current page has a peered paragraph as the first paragraph
	 * of the next page. If so, we want to put all of the content of the peered paragraph at the end of the last
	 * paragraph of the current page and delete it.
	 */
	reunitePeeredParagraphs(
		tr: Transaction,
		pageDetails: PageDetails,
		nextPageDetails: PageDetails
	): void {
		const lastChild = pageDetails.pageNode.lastChild;
		if (lastChild?.type.name === 'paragraph' && nextPageDetails) {
			const potentialPeer = nextPageDetails.pageNode.firstChild;
			if (potentialPeer?.attrs['peer'] === true) {
				const lastParagraphInsertPosition = nextPageDetails.pageOffset - 2;
				const peerParagraphPosition = nextPageDetails.pageOffset + 1;

				const lastParagraphInsertPositionMapped = tr.mapping.map(lastParagraphInsertPosition);

				tr.deleteRange(peerParagraphPosition, peerParagraphPosition + potentialPeer.nodeSize);
				tr.insert(lastParagraphInsertPositionMapped, potentialPeer.content);
				tr.setMeta(PEERED_TRANSACTION_META_KEY, PEERED_TRANSACTION_REUNITE_PEERS_META_VALUE);
			}
		}
	}

	reunitePeerParagraphsInRange(view: EditorView, from: number, to?: number): void {
		const { tr } = view.state;
		for (
			let i = from, page = this.getPage(view, i);
			page != null;
			i++, page = this.getPage(view, i)
		) {
			if (to !== undefined && i >= to) {
				break;
			}

			const nextPage = this.getPage(view, i + 1);
			if (!nextPage) {
				break;
			}
			this.reunitePeeredParagraphs(tr, page, nextPage);
		}
		view.dispatch(tr);
	}

	/**
	 * A method that will paginate the page parameter for the given editor view. If the current
	 * page does not overflow, it finds the extra space on the page and tries to take all of
	 * the content from the next page that fits on it. IF the page ends with a `pageEnd` node,
	 * it will check for any content after it and move that to the next page.
	 *
	 * The function will return the number of pages added (`pagesAdded`) or `null`. The pages
	 * added will be `-1` |`0` | `1` if a page is removed.
	 *
	 * It returns `null` if there is no need to paginate again. This occurs in two situations:
	 * 1. There is no page corresponding to the page number.
	 * 2. The page does not overflow and the next page does not exist.
	 */
	paginate(view: EditorView, pageNumber: number): number | null {
		console.log(`Page ${pageNumber}/${this.pageCount(view)}`);
		const pageDetails = this.getPage(view, pageNumber);
		if (!pageDetails) {
			// We've run out of pages. Since the doc can only contain pages,
			// this means that there's nothing left to paginate.
			return null;
		}

		const nextPage = this.getPage(view, pageNumber + 1);
		if (this.isEmptyPage(pageDetails) && !nextPage) {
			this.deletePage(view, pageDetails);
			return -1;
		}

		const maxBottom = this.calculatePageBottom(pageDetails.pageEl);

		// Find out if the current page overflows or has available space.
		const overflowingDetails = this.getPageOverflowInformation(view, maxBottom, pageDetails);

		const { tr } = view.state;
		let delta: number;

		if (this.pageIsOverflowing(overflowingDetails)) {
			// If we are right at the limit of the page, we don't need to do anything at all.
			if (overflowingDetails.doesNotOverflowPage) {
				delta = 0;
			} else {
				delta = this.handlePageOverflow(tr, pageDetails, overflowingDetails, maxBottom, nextPage);
			}
		} else {
			delta = this.handlePageUnderflow(
				view,
				tr,
				pageNumber,
				pageDetails,
				overflowingDetails,
				nextPage
			);
		}

		tr.setNodeAttribute(pageDetails.pageOffset, 'index', pageNumber);
		tr.setMeta(PAGINATION_TRANSACTION_META_KEY, { pageNumber });
		view.dispatch(tr);

		return delta;
	}

	/**
	 * Paginate from the given `from` position to the `to` position, non-inclusive.
	 * This function is relatively complex since we need to use the DOM to measure
	 * the effects of the underlying layout engine that JS does not have access to.
	 * This function requires the main thread and cannot be run on a web/service worker
	 * because neither can access the DOM, and this function requires DOM access to measure/
	 * compare the page elements and their rendered positions.
	 *
	 * Therefore, we use a generator function to allow the caller to control the pagination
	 * and yield to allow the UI to update if necessary. The data yielded is the number of the page,
	 * which is 1 greater than the page index.
	 */
	*paginateRange(view: EditorView, from: number, to?: number): Generator<number, number, void> {
		// this.reunitePeerParagraphsInRange(view, from, to);
		let pageNumber = from;

		while (true) {
			if (to !== undefined && pageNumber >= to) {
				break;
			}

			const toDelta = this.paginate(view, pageNumber);
			if (toDelta === null) {
				break;
			}

			// This solves the apparent issue of pages that are blank. I do not know why empty pages
			// cause problems but pages with one small paragraph dpn't.
			// TODO: Determine this and repaginate only if we need it.
			if (toDelta !== -1) {
				pageNumber++;
			}

			if (to) {
				to += toDelta;
			}
			yield pageNumber;
		}
		return pageNumber;
	}

	pageIsOverflowing(details: object): details is OverflowingDetails {
		return 'overflowingNode' in details;
	}

	/**
	 * This function determines has three different possible return values:
	 * 1. The page overflows. It returns the page and overflowing node/element information (`overflowingDetails`)
	 * 2. The page ends with a `pageEnd` node. It returns the page end offset to check that the page ends with that node (`UnderflowingDetails`).
	 * 3. The page does not overflow and has no `pageEnd` node (last page of document). It returns `null`.
	 */
	getPageOverflowInformation(
		view: EditorView,
		maxBottom: number,
		pageDetails: PageDetails
	): OverflowingDetails | UnderflowingDetails {
		let pos = 0;
		let lastNodeSize = 0;

		while (pos < pageDetails.pageNode.nodeSize) {
			const node = pageDetails.pageNode.nodeAt(pos);
			if (!node) {
				break;
			}

			if (!node.isBlock) {
				pos += node.nodeSize;
				continue;
			}

			const el = view.nodeDOM(pos + pageDetails.pageOffset + 1) as HTMLElement | null;
			if (!el) {
				console.warn('No element found for node', node, pos);
				break;
			}

			if (node.type.name === 'pageEnd') {
				return { lastNodeOffset: pos, hasDiscoveredPageEnd: true };
			}

			const { bottom } = el.getBoundingClientRect();

			if (bottom >= maxBottom) {
				const lineHeight = getLineHeight(el);
				return {
					doesNotOverflowPage: bottom - maxBottom - lineHeight < 0,
					overflowingNode: node,
					overflowingNodeOffset: pos,
					overflowingEl: el
				};
			}

			pos += node.nodeSize;
			lastNodeSize = node.nodeSize;
		}

		return {
			hasDiscoveredPageEnd: false,
			lastNodeOffset: pos - lastNodeSize
		};
	}

	private getNextTextNode(walker: TreeWalker): Node | null {
		while (true) {
			const node = walker.nextNode();
			if (!node) {
				return null;
			}

			if (node.nodeType === Node.TEXT_NODE) {
				return node;
			}
		}
	}

	private doesNodeAtPositionOverflow(
		el: HTMLElement,
		node: Node,
		position: number,
		maxBottom: number
	) {
		const range = document.createRange();
		range.setStart(el, 0);
		range.setEnd(node, position);

		const { bottom } = range.getBoundingClientRect();
		return bottom > maxBottom;
	}

	private getNodeLineSplitAmount(
		firstNode: Node,
		lastNode: Node,
		maxBottom: number,
		lineHeight: number
	) {
		const range = document.createRange();

		const lastNodeText = lastNode.textContent ?? '';
		range.setStart(firstNode, 0);
		range.setEnd(lastNode, lastNodeText.length);

		const textRect = range.getBoundingClientRect();

		const totalLines = Math.round(textRect.height / lineHeight);
		const overflowingLines = Math.floor((textRect.bottom - maxBottom) / lineHeight);

		return this.calculateLineSplitAmount(totalLines - overflowingLines, overflowingLines);
	}

	/**
	 * Since in text we care about wodw and orphan lines, we need to count lines and use them
	 * alongside widow and orphan lines to determine how many lines we can keep on the page.
	 * We can use this amount to determine the offset position to split the page.
	 */
	private identifyOffsetBasedOffOverflowingLines(
		nodes: Node[],
		lineHeight: number,
		linesToKeepOnPage: number
	): number {
		const range = document.createRange();
		let offset = 0;

		// Go through the nodes and find out when we've achieved the correct number of lines.
		outer: for (const node of nodes) {
			const domText = node.textContent ?? '';
			for (let i = 0; i < domText.length; i++) {
				range.setStart(nodes[0], 0);
				range.setEnd(node, i);

				const rect = range.getBoundingClientRect();
				const numLines = Math.round(rect.height / lineHeight);
				if (numLines - 1 >= linesToKeepOnPage) {
					break outer;
				}
				offset++;
			}
		}

		return offset;
	}

	private advanceForTextNode(
		walker: TreeWalker,
		el: HTMLElement,
		text: string,
		maxBottom: number
	): { offset: number; overflowDiscovered: boolean; shouldDedent: boolean } {
		let pmOffset = 0;
		let overflowDiscovered: boolean = false;

		const sequentialTextNodes = [];
		let remaining = text.length;
		let potentialExtra = 0;

		// If we are dedenting based on splitting text based on widow/orphan lines,
		// we shouldn't dedent if we don't have any lines that we are keeping on the first page.
		let shouldDedent = false;

		while (remaining > 0) {
			const nextTextNode = this.getNextTextNode(walker);
			if (!nextTextNode) {
				throw new Error(
					`HTML Walker and PM descendents lost coordination. No text node discovered but expected finding one containing part of ${text}`
				);
			}
			sequentialTextNodes.push(nextTextNode);
			const domText = nextTextNode.textContent || '';
			const toConsume = Math.min(remaining, domText.length);
			if (this.doesNodeAtPositionOverflow(el, nextTextNode, toConsume, maxBottom)) {
				overflowDiscovered = true;
			}

			potentialExtra += toConsume;
			remaining -= toConsume;
		}

		if (overflowDiscovered) {
			const lineHeight = getLineHeight(el);
			const [linesToKeepOnPage] = this.getNodeLineSplitAmount(
				sequentialTextNodes[0],
				sequentialTextNodes[sequentialTextNodes.length - 1],
				maxBottom,
				lineHeight
			);

			const offset = this.identifyOffsetBasedOffOverflowingLines(
				sequentialTextNodes,
				lineHeight,
				linesToKeepOnPage
			);

			pmOffset += offset;
			shouldDedent = linesToKeepOnPage > 0;
		} else {
			pmOffset += potentialExtra;
		}

		return {
			overflowDiscovered,
			offset: pmOffset,
			shouldDedent
		};
	}

	/**
	 * Find the first position in the overflowing element that causes the overflow.
	 */
	getSplitOffsetForOverflowingElement(
		pageBottom: number,
		overflowingNode: ProseMirrorNode,
		overflowingEl: HTMLElement
	): { splitOffset: number; shouldDedent: boolean } {
		const walker = document.createTreeWalker(
			overflowingEl,
			NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
		);

		let pmOffset = 0;
		let shouldDedent = false;

		let consecutiveTextNodeContent: string[] = [];

		const moveForwardForNextTextNode = () => {
			const result = this.advanceForTextNode(
				walker,
				overflowingEl,
				consecutiveTextNodeContent.join(''),
				pageBottom
			);

			const { offset, overflowDiscovered, shouldDedent: _shouldDedent } = result;

			pmOffset += offset;
			consecutiveTextNodeContent = [];

			if (overflowDiscovered) {
				shouldDedent = _shouldDedent;
			}

			return overflowDiscovered;
		};

		// TODO: Change this to a while loop with the position
		overflowingNode.descendants((child) => {
			if (child.isText && child.text) {
				consecutiveTextNodeContent.push(child.text);
			} else {
				if (consecutiveTextNodeContent.length > 0) {
					const overflowDiscovered = moveForwardForNextTextNode();

					if (overflowDiscovered) {
						return false;
					}
				}

				// TODO
			}

			return true;
		});

		if (consecutiveTextNodeContent.length > 0) {
			moveForwardForNextTextNode();
		}

		return { splitOffset: pmOffset, shouldDedent };
	}
}

const PageLayout = new PageLayoutManager();
export default PageLayout;
