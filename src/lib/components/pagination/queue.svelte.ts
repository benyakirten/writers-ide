import { untrack } from 'svelte';
import PageLayout from '$lib/editor/state/page-layout.svelte';
import { PageObserver } from '$lib/editor/state/page-observer.svelte';
import Editors from '$lib/editor/prosemirror/prose-mirror-editor.svelte';
import { workQueue, type WorkHandle } from '$lib/editor/state/work-queue.svelte';

type PaginationJob = {
	viewId: string;
	revision: number;
	startedAt: number;
	dismissed: boolean;
	handle: WorkHandle;
};

export class PaginationQueue {
	jobs = $state.raw<PaginationJob[]>([]);
	now = $state(0);

	private owners = 0;
	private handles = new Set<WorkHandle>();
	private stop?: () => void;

	get catchUp() {
		return this.jobs.find((job) => {
			const data = PageObserver.map[job.viewId];
			return (
				data &&
				data.paginatedTo < PageObserver.target(data) &&
				!job.dismissed &&
				(job.handle.status === 'running' || job.handle.status === 'queued') &&
				this.now - job.startedAt >= 1000
			);
		});
	}

	dismiss(viewId: string) {
		this.jobs = this.jobs.map((job) => (job.viewId === viewId ? { ...job, dismissed: true } : job));
	}

	start(): () => void {
		if (this.owners++ === 0) {
			const stopWork = workQueue.start();
			const dispose = $effect.root(() => {
				$effect(() => {
					const requests = Object.values(PageObserver.map).map((data) => ({
						viewId: data.viewId,
						revision: data.revision,
						from: data.paginatedTo,
						to: PageObserver.target(data),
					}));
					untrack(() => this.sync(requests));
				});
			});
			this.now = performance.now();
			const timer = setInterval(() => {
				this.now = performance.now();
			}, 200);
			this.stop = () => {
				dispose();
				clearInterval(timer);
				for (const handle of this.handles) handle.cancel();
				this.handles.clear();
				this.jobs = [];
				stopWork();
			};
		}
		let stopped = false;
		return () => {
			if (stopped) return;
			stopped = true;
			if (--this.owners === 0) this.stop?.();
		};
	}

	private sync(requests: { viewId: string; revision: number; from: number; to: number }[]) {
		for (const handle of this.handles) {
			if (['completed', 'cancelled', 'failed'].includes(handle.status)) this.handles.delete(handle);
		}
		for (const job of this.jobs) {
			const request = requests.find((item) => item.viewId === job.viewId);
			if (
				!request ||
				request.revision !== job.revision ||
				(request.from >= request.to && job.handle.status === 'paused')
			)
				job.handle.cancel();
		}
		this.jobs = this.jobs.filter((job) => {
			const request = requests.find((item) => item.viewId === job.viewId);
			return request && request.revision === job.revision && request.from < request.to;
		});
		for (const request of requests) {
			if (request.from >= request.to || this.jobs.some((job) => job.viewId === request.viewId))
				continue;
			const editor = Editors.getView(request.viewId);
			if (!editor) continue;

			const handle = workQueue.enqueue({
				key: `pagination:${request.viewId}`,
				documentId: editor.documentId,
				viewId: request.viewId,
				label: `Paginating ${editor.name}`,
				priority: 'interactive',
				create: function* ({ signal }) {
					while (!signal.aborted) {
						const data = PageObserver.map[request.viewId];
						if (!data || data.revision !== request.revision) return;
						const target = PageObserver.target(data);
						if (data.paginatedTo >= target) return;
						if (editor.view.composing) {
							yield;
							continue;
						}
						const from = data.paginatedTo;
						// Keep only one page's preparation in a step; targets are re-read after each yield.
						const iter = PageLayout.paginateRange(
							editor.documentId,
							editor.view,
							from,
							from + 1,
							signal,
						);
						try {
							for (const end of iter) {
								if (signal.aborted || data.revision !== request.revision) return;
								data.paginatedTo = end;
								yield { completed: end, total: PageObserver.target(data) };
							}
						} finally {
							iter.return(from);
						}
					}
				},
			});

			this.handles.add(handle);
			this.jobs = [
				...this.jobs,
				{
					viewId: request.viewId,
					revision: request.revision,
					startedAt: performance.now(),
					dismissed: false,
					handle,
				},
			];
		}
	}
}

export const PageQueue = new PaginationQueue();
