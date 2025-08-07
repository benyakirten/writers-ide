import type { EditorView } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

import {
	getLineHeight,
	calculateTotalLinesOfText,
	calculateOverflowingLinesOfText
} from '$lib/utils/css';
import {
	CM_PER_INCH,
	INDENT_MAX,
	INDENT_MIN,
	PIXELS_PER_INCH
} from '../prosemirror/view/constants';
import { clamp } from '@/utils/numbers';

export type Unit = 'in' | 'cm' | 'mm';

type OverflowingDetails = {
	overflowingNode: ProseMirrorNode;
	overflowingNodeOffset: number;
	overflowingEl: HTMLElement;
	pageBottom: number;
};

type NotOverflowingDetails = {
	hasDiscoveredPageEnd: boolean;
	lastNodeOffset: number;
};

type PageDetails = { pageEl: HTMLElement; pageNode: ProseMirrorNode; pageOffset: number };

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

	private splitPageAtOffset(
		view: EditorView,
		pageNode: ProseMirrorNode,
		nextPageNumber: number,
		splitOffset: number,
		pageOffset: number,
		shouldDedent: boolean
	): void {
		const { tr } = view.state;
		// NOTE: node.cut WILL KEEP THE OUTER ELEMENT so if we only want the content
		// and not the page too, we need to get cutContent.content instead of cutContent.
		const contentToKeep = pageNode.cut(0, splitOffset);
		const contentToMove = pageNode.cut(splitOffset);

		tr.replaceWith(pageOffset, pageOffset + pageNode.nodeSize, contentToKeep);
		// Create a new page with the content that was overflowing.
		const nextPageInfo = this.getPage(view, nextPageNumber);
		if (!nextPageInfo) {
			// If there is no next page, we create it.
			tr.insert(pageOffset + contentToKeep.nodeSize, contentToMove);
		} else {
			// If there is a next page, we insert the content there.
			tr.insert(pageOffset + contentToKeep.nodeSize + 1, contentToMove.content);
		}
		if (shouldDedent) {
			// Why is a paragraph made after a dedented one dedented too?
			tr.setNodeAttribute(pageOffset + contentToKeep.nodeSize + 1, 'indent', INDENT_MIN);
		}
		view.dispatch(tr);
	}

	deleteEmptyPages(view: EditorView) {
		let pageNumber = 0;
		while (true) {
			const currentPageDetails = this.getPage(view, pageNumber);
			if (!currentPageDetails) {
				break;
			}

			const nextPageDetails = this.getPage(view, pageNumber + 1);
			if (
				(nextPageDetails === null || nextPageDetails.pageNode.textContent === '') &&
				currentPageDetails.pageNode.textContent === ''
			) {
				this.deletePage(view, currentPageDetails.pageNode, currentPageDetails.pageOffset);
			} else {
				pageNumber++;
			}
		}
	}

	private deletePage(view: EditorView, pageNode: ProseMirrorNode, pageOffset: number): void {
		const { tr } = view.state;
		tr.delete(pageOffset, pageOffset + pageNode.nodeSize);
		view.dispatch(tr);
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
	*paginate(view: EditorView, from: number, to?: number): Generator<number, number, void> {
		let pageNumber = from;

		while (true) {
			// Since the page count can change while we're iterating, if a definite page count
			// is not provided, we should ignore the condition.
			if (to !== undefined && pageNumber >= to) {
				break;
			}

			const pageDetails = this.getPage(view, pageNumber);
			// We've run out of pages.
			if (!pageDetails) {
				break;
			}
			const { pageNode, pageOffset, pageEl } = pageDetails;
			pageNumber++;

			// TODO: Replace empty paragraphs with an page end node - configured by option.
			const overflowingDetails = this.getOverflowingInformation(view, pageEl, pageNode, pageOffset);
			// If we have a `hasDiscoveredPageEnd`, it means the page does not overflow.
			if ('hasDiscoveredPageEnd' in overflowingDetails) {
				const { lastNodeOffset, hasDiscoveredPageEnd } = overflowingDetails;
				// The page does not overflow - but we need to check for one of the following scenarios:
				// Five possibile courses of action:
				// 1. Page ends with page end node and no content after it - yield page number and continue.
				// 2. Page ends with page end node and has content after it - move the content to the next page.
				// 3. Page ends with any other block node but no remaining space on the page, yield page number and continue.
				// 4. Page ends with any other block node and has remaining space on the page but we don't need to move content
				//    from the next page back - yield page number and continue.
				// 5. Page ends with any other block node and has remaining space on the page but we need to move content
				//    from the next page back - move the content to the current page then yield the page number and continue.
				// const lastNode = pageDetails.pageNode.lastChild;

				if (hasDiscoveredPageEnd) {
					// If it's the lasts item on the page, we just move on.
					if (!this.pageHasNoNodesAfter(pageDetails.pageNode, lastNodeOffset)) {
						// If the page node isn't the last item on the page, all of the content
						// after the page end node should be moved to the next page. We don't
						// care about line of text, just move everything over then we can worry
						// about lines of text when we paginate that next page.
						this.splitPageAtOffset(
							view,
							pageDetails.pageNode,
							pageNumber,
							lastNodeOffset + 1,
							pageDetails.pageOffset,
							false
						);
					}

					yield pageNumber;
					continue;
				}

				// NOTE: pageNumber has already been incremented so this already points to the next page.
				const nextPageInfo = this.getPage(view, pageNumber);
				if (!nextPageInfo) {
					// If there is no next page, we can just yield the page number and continue.
					yield pageNumber;
					continue;
				}

				const availableSpace = this.calculateUnusedSpace(view, pageDetails, lastNodeOffset);
				console.log(pageNumber, availableSpace);

				// We must check if there is a page end node inside of page node. If so, that's condition 2.
				// Otherwise, we must get the remaining content on the page.
				// If we have no remaining space - situation 3
				// Then we check the next page
				// If there is no next page, situation 4
				// If there is a next page but content should not be moved back, situation 4
				// If there is a next page and content should be moved back, situation 5
				// const unusedSpace = overflowingDetails
				// 	? this.calculateUnusedSpace(view, pageDetails, overflowingDetails)
				// 	: this.pageHeight;
				// // Check
				// console.log(unusedSpace, overflowingDetails?.lastNode);
				// const nextPageInfo = this.getPage(view, pageNumber);
				// const { firstChild } = pageDetails.pageNode;
				// // TODO: Test for if we might want to move widow lines to the next page.
				// if (firstChild) {
				// 	console.log(firstChild);
				// }
				yield pageNumber;
				continue;
			}

			const { pageBottom, overflowingNode, overflowingEl, overflowingNodeOffset } =
				overflowingDetails;

			const splitOffsetInfo = this.getSplitOffsetForOverflowingElement(
				pageBottom,
				overflowingNode,
				overflowingEl
			);
			if (splitOffsetInfo === null) {
				console.warn('Could not find split position for overflowing element', overflowingEl);
				return pageNumber - 1;
			}

			const { splitOffset, shouldDedent } = splitOffsetInfo;

			this.splitPageAtOffset(
				view,
				pageNode,
				pageNumber,
				overflowingNodeOffset + splitOffset,
				pageOffset,
				shouldDedent
			);
			yield pageNumber;
		}

		return pageNumber;
	}

	calculateTextOverflow(
		pageBottom: number,
		overflowingEl: HTMLElement,
		lineHeight: number
	): [linesToKeepOnPage: number, linesToPutOnNextPage: number] {
		const numLines = calculateTotalLinesOfText(overflowingEl, lineHeight);
		const overflowingLines = calculateOverflowingLinesOfText(overflowingEl, pageBottom, lineHeight);

		// TODO: Write overflowing logic to handle non-text overflowing elements and/or nodes with combined types.
		return this.calculateLineSplitAmount(numLines - overflowingLines, overflowingLines);
	}

	/**
	 * This function determines has three different possible return values:
	 * 1. The page overflows. It returns the page and overflowing node/element information (`overflowingDetails`)
	 * 2. The page ends with a `pageEnd` node. It returns the page end offset to check that the page ends with that node (`NotOverflowingDetails`).
	 * 3. The page does not overflow and has no `pageEnd` node (last page of document). It returns `null`.
	 */
	getOverflowingInformation(
		view: EditorView,
		pageEl: HTMLElement,
		pageNode: ProseMirrorNode,
		pageOffset: number
	): OverflowingDetails | NotOverflowingDetails {
		const pageBottom = this.calculatePageBottom(pageEl);

		let overflowingEl: HTMLElement | null = null;
		let overflowingNode: ProseMirrorNode | null = null;
		let pos = 0;
		let lastNodeSize = 0;

		while (pos < pageNode.nodeSize) {
			const node = pageNode.nodeAt(pos);
			if (!node) {
				break;
			}

			if (!node.isBlock) {
				pos += node.nodeSize;
				continue;
			}

			const el = view.nodeDOM(pos + pageOffset + 1) as HTMLElement | null;
			if (!el) {
				console.warn('No element found for node', node, pos);
				break;
			}

			if (node.type.name === 'pageEnd') {
				return { lastNodeOffset: pos, hasDiscoveredPageEnd: true };
			}

			const { bottom } = el.getBoundingClientRect();
			if (bottom >= pageBottom) {
				overflowingNode = node;
				overflowingEl = el;
				break;
			}

			pos += node.nodeSize;
			lastNodeSize = node.nodeSize;
		}

		if (!overflowingEl || !overflowingNode) {
			return {
				hasDiscoveredPageEnd: false,
				lastNodeOffset: pos - lastNodeSize
			};
		}

		return {
			overflowingNode,
			overflowingNodeOffset: pos,
			overflowingEl,
			pageBottom
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
		const overflowingLines = Math.min((textRect.bottom - maxBottom) / lineHeight);
		return this.calculateLineSplitAmount(totalLines - overflowingLines, overflowingLines);
	}

	/**
	 * Since in text we care about wodw and orphan lines, we need to count lines and use them
	 * alongside widow and orphan lines to determine how many lines we can keep on the page.
	 * We can use this amount to determine the offset position to split the page.
	 */
	private identifyOffsetBasedOffOverflowingLines(
		el: HTMLElement,
		nodes: Node[],
		maxBottom: number
	) {
		const range = document.createRange();
		let offset = 0;

		const lineHeight = getLineHeight(el);
		const [linesToKeepOnPage, linesToPutOnNextPage] = this.getNodeLineSplitAmount(
			nodes[0],
			nodes[nodes.length - 1],
			maxBottom,
			lineHeight
		);

		if (linesToPutOnNextPage === 0) {
			throw new Error('Overflow detected, but no lines should be moved to the next page.');
		}

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
	): { offset: number; overflowDiscovered: boolean } {
		let pmOffset = 0;
		let overflowDiscovered: boolean = false;

		const sequentialTextNodes = [];
		let remaining = text.length;
		let potentialExtra = 0;

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
			pmOffset += this.identifyOffsetBasedOffOverflowingLines(el, sequentialTextNodes, maxBottom);
		} else {
			pmOffset += potentialExtra;
		}

		return {
			overflowDiscovered,
			offset: pmOffset
		};
	}

	/**
	 * Find the first position in the overflowing element that causes the overflow.
	 */
	getSplitOffsetForOverflowingElement(
		pageBottom: number,
		overflowingNode: ProseMirrorNode,
		overflowingEl: HTMLElement
	): { splitOffset: number; shouldDedent: boolean } | null {
		const walker = document.createTreeWalker(
			overflowingEl,
			NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
		);

		let pmOffset = 0;
		let shouldDedent = false;

		let consecutiveTextNodeContent: string[] = [];

		const moveForwardForNextNode = () => {
			const result = this.advanceForTextNode(
				walker,
				overflowingEl,
				consecutiveTextNodeContent.join(''),
				pageBottom
			);
			const { offset, overflowDiscovered } = result;

			pmOffset += offset;
			consecutiveTextNodeContent = [];

			if (overflowDiscovered) {
				shouldDedent = true;
			}

			return overflowDiscovered;
		};

		// TODO: Change this to a while loop with the position
		overflowingNode.descendants((child) => {
			if (child.isText && child.text) {
				consecutiveTextNodeContent.push(child.text);
			} else {
				if (consecutiveTextNodeContent.length > 0) {
					const overflowDiscovered = moveForwardForNextNode();
					if (overflowDiscovered) {
						return false;
					}
				}

				// TODO
			}

			return true;
		});

		if (consecutiveTextNodeContent.length > 0) {
			moveForwardForNextNode();
		}

		return { splitOffset: pmOffset, shouldDedent };
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
