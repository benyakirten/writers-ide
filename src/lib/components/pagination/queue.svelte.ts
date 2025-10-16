import { ArrayStream } from 'array-stream-plus';

import PageLayout from '$lib/editor/state/page-layout.svelte';
import { PageObserver, type ToPaginateRange } from '$lib/editor/state/page-observer.svelte';
import Editors from '@/editor/prosemirror/prose-mirror-editor.svelte';

type ToPaginate = {
	name: string;
	from: number;
	to: number;
};

type CurrentPagination = ToPaginate & {
	time: number;
	progress: number;
	iter: Generator<number, void, unknown>;
};

export class PaginationQueue {
	PAGINATION_ITERATION_TIMER_IN_MS = 50;
	MAX_ITERS_BEFORE_SHOWING_MODAL = 2;

	paginationQueue = $derived(
		PageObserver.toPaginate.slice(1).map((item) => this.processToPaginateItem(item)),
	);
	currentPagination: CurrentPagination | null = $derived(
		this.setCurrentPagination(PageObserver.toPaginate.at(0)),
	);

	constructor() {}

	processToPaginateItem([id, from, to]: ToPaginateRange): ToPaginate {
		const editor = Editors.get(id);
		const name = editor ? editor.name : 'Unknown';
		return { name, from, to };
	}

	setCurrentPagination(range?: ToPaginateRange): CurrentPagination | null {
		if (!range) {
			return null;
		}

		const [id, from, to] = range;
		const editor = Editors.get(id);

		const name = editor?.name ?? 'Unknown';
		const iter = this.getPagePaginationIterator(id, from, to);

		return {
			name,
			from,
			to,
			progress: 0,
			time: 0,
			iter,
		};
	}

	*getPagePaginationIterator(id: string, from: number, to: number) {
		const editor = Editors.get(id);
		if (!editor) {
			return;
		}

		const paginationIterator = PageLayout.paginateRange(id, editor.view, from, to);
		const stream = new ArrayStream(paginationIterator).batch({
			timeout: this.PAGINATION_ITERATION_TIMER_IN_MS,
		});

		for (const pageNums of stream.read()) {
			const lastPage = pageNums[pageNums.length - 1];
			yield lastPage;
		}
	}
}
