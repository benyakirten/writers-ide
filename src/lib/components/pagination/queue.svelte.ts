import { ArrayStream } from 'array-stream-plus';

import PageLayout from '$lib/editor/state/page-layout.svelte';
import type { ToPaginateRange } from '$lib/editor/state/page-observer.svelte';
import Editors from '@/editor/prosemirror/prose-mirror-editor.svelte';

type ToPaginate = {
	name: string;
	from: number;
	to: number;
};

type CurrentPagination = ToPaginate & {
	progress: number;
};

export class PaginationQueue {
	upcomingPagination: ToPaginate[] = $state([]);
	currentPagination: CurrentPagination | null = $state(null);
	constructor(paginationList: ToPaginateRange[]) {
		$effect.root(() => {
			if (paginationList.length === 0) {
				this.upcomingPagination = [];
				this.currentPagination = null;
				return;
			}

			this.upcomingPagination = paginationList
				.slice(0, -1)
				.map(([id, from, to]) => ({ name: id, from, to }));
			this.setCurrentPagination(paginationList[paginationList.length - 1]);
		});
	}

	setCurrentPagination(pageRange: ToPaginateRange) {
		// TODO
	}

	*getPagePaginationIterator(id: string, from: number, to: number) {
		const editor = Editors.get(id);
		if (!editor) {
			return null;
		}

		const paginationIterator = PageLayout.paginateRange(id, editor.view, from, to);
		const stream = new ArrayStream(paginationIterator).batch({ timeout: 50 });

		for (const pageNums of stream.read()) {
			const lastPage = pageNums[pageNums.length - 1];
			const numerator = lastPage - from + 1;
			const denominator = to - from;

			yield numerator / denominator;
		}
	}
}
