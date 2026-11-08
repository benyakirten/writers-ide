import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { EditorView } from 'prosemirror-view';
import type { ObservedPage } from '$lib/editor/state/page-observer.svelte';
import { PageObserver } from '$lib/editor/state/page-observer.svelte';
import PageLayout from '$lib/editor/state/page-layout.svelte';
import Editors from '$lib/editor/prosemirror/prose-mirror-editor.svelte';
import { workQueue } from '$lib/editor/state/work-queue.svelte';
import { PaginationQueue } from './queue.svelte';

// Vitest resolves Svelte's server entry by default; these lifecycle tests need client tracking.
vi.mock('svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('svelte')>();
	const client = await vi.importActual<{
		flush: typeof original.flushSync;
		untrack: typeof original.untrack;
	}>('svelte/internal/client');
	return { ...original, flushSync: client.flush, untrack: client.untrack };
});

vi.mock('$lib/editor/state/page-observer.svelte', () => {
	class ObserverMock {
		map = $state<Record<string, ObservedPage>>({});
		target(data: ObservedPage) {
			return Math.min(data.viewedPage + 2, data.view.state.doc.childCount);
		}
	}
	return { PageObserver: new ObserverMock() };
});
vi.mock('$lib/editor/state/page-layout.svelte', () => ({
	default: { paginateRange: vi.fn() },
}));
vi.mock('$lib/editor/prosemirror/prose-mirror-editor.svelte', () => ({
	default: { getView: vi.fn() },
}));

describe('PaginationQueue', () => {
	let queue: PaginationQueue;
	let frames: Map<number, FrameRequestCallback>;
	let nextFrame: number;
	let now: number;
	let releases: (() => void)[];
	let closed: ReturnType<typeof vi.fn>;
	let signals: AbortSignal[];

	beforeEach(() => {
		vi.useFakeTimers();
		frames = new Map();
		nextFrame = 0;
		now = 0;
		releases = [];
		signals = [];
		closed = vi.fn();
		PageObserver.map = {};
		queue = new PaginationQueue();
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				frames.set(++nextFrame, callback);
				return nextFrame;
			}),
		);
		vi.stubGlobal(
			'cancelAnimationFrame',
			vi.fn((id: number) => frames.delete(id)),
		);
		vi.mocked(Editors.getView).mockImplementation((id) => {
			const data = PageObserver.map[id];
			return data
				? ({ documentId: data.documentId, name: id, view: data.view } as ReturnType<
						typeof Editors.getView
					>)
				: null;
		});
		vi.mocked(PageLayout.paginateRange).mockImplementation(
			function* (_id, _view, from, to, signal) {
				signals.push(signal!);
				try {
					now += 8;
					yield to!;
					return to!;
				} finally {
					closed(from, signal?.aborted);
				}
			},
		);
	});

	afterEach(() => {
		for (const release of releases.reverse()) release();
		for (const job of workQueue.jobs) job.cancel();
		PageObserver.map = {};
		flushSync();
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.resetAllMocks();
		vi.unstubAllGlobals();
	});

	function addView(viewId = 'a', documentId = 'doc') {
		PageObserver.map[viewId] = {
			viewId,
			documentId,
			view: { composing: false, state: { doc: { childCount: 8 } } } as EditorView,
			viewedPage: 0,
			paginatedTo: 0,
			revision: 0,
			observer: {} as ObservedPage['observer'],
		};
		return PageObserver.map[viewId];
	}

	function start() {
		const release = queue.start();
		releases.push(release);
		flushSync();
		return release;
	}

	function frame() {
		const callbacks = [...frames.values()];
		frames.clear();
		for (const callback of callbacks) callback(now);
		flushSync();
	}

	function tick(time: number) {
		now = time;
		vi.advanceTimersByTime(200);
		flushSync();
	}

	it('starts an initial keyed job and publishes one-page progress up to the bounded target', () => {
		const data = addView();
		expect(queue.jobs).toEqual([]);
		expect(frames.size).toBe(0);
		start();
		const handle = queue.jobs[0].handle;
		expect(handle).toMatchObject({
			key: 'pagination:a',
			documentId: 'doc',
			viewId: 'a',
			label: 'Paginating a',
			priority: 'interactive',
			status: 'queued',
		});
		frame();
		expect(data.paginatedTo).toBe(1);
		expect(handle.progress).toEqual({ completed: 1, total: 2 });
		expect(PageLayout.paginateRange).toHaveBeenLastCalledWith('doc', data.view, 0, 1, signals[0]);
		frame();
		expect(data.paginatedTo).toBe(2);
		expect(handle.progress).toEqual({ completed: 2, total: 2 });
		expect(queue.jobs).toEqual([]);
		frame();
		expect(handle.status).toBe('completed');
		expect(PageLayout.paginateRange).toHaveBeenCalledTimes(2);
		expect(closed.mock.calls).toEqual([
			[0, false],
			[1, false],
		]);
		expect(frames.size).toBe(0);
	});

	it('extends an active target without replacing the handle, and schedules later scrolling after completion', () => {
		const data = addView();
		start();
		const handle = queue.jobs[0].handle;
		frame();
		data.viewedPage = 3;
		flushSync();
		expect(queue.jobs[0].handle).toBe(handle);
		for (let i = 0; i < 4; i++) frame();
		expect(data.paginatedTo).toBe(5);
		expect(handle.progress).toEqual({ completed: 5, total: 5 });
		frame();
		expect(handle.status).toBe('completed');
		data.viewedPage = 7;
		flushSync();
		expect(queue.jobs[0].handle).not.toBe(handle);
		for (let i = 0; i < 4; i++) frame();
		expect(data.paginatedTo).toBe(8);
		expect(PageLayout.paginateRange).toHaveBeenCalledTimes(8);
		expect(frames.size).toBe(0);
	});

	it('cancels paused work when scrolling backward satisfies its target', () => {
		const data = addView();
		data.viewedPage = 5;
		start();
		const handle = queue.jobs[0].handle;
		frame();
		frame();
		handle.pause();
		data.viewedPage = 0;
		flushSync();
		expect(handle.status).toBe('cancelled');
		expect(queue.jobs).toEqual([]);
		expect(workQueue.jobs).not.toContain(handle);
	});

	it('cancels and closes obsolete revision work before restarting at the invalidated prefix', () => {
		const data = addView();
		start();
		const old = queue.jobs[0].handle;
		frame();
		data.paginatedTo = 0;
		data.revision++;
		flushSync();
		expect(old.status).toBe('cancelled');
		expect(signals[0].aborted).toBe(true);
		expect(closed).toHaveBeenCalledOnce();
		expect(closed).toHaveBeenCalledWith(0, true);
		const replacement = queue.jobs[0];
		expect(replacement.revision).toBe(1);
		expect(replacement.handle).not.toBe(old);
		frame();
		expect(data.paginatedTo).toBe(1);
		expect(PageLayout.paginateRange).toHaveBeenLastCalledWith('doc', data.view, 0, 1, signals[1]);
	});

	it('cancels removed views independently even when they share a document', () => {
		addView('a');
		const b = addView('b');
		start();
		const aHandle = queue.jobs.find((job) => job.viewId === 'a')!.handle;
		const bHandle = queue.jobs.find((job) => job.viewId === 'b')!.handle;
		frame();
		delete PageObserver.map.a;
		flushSync();
		expect(aHandle.status).toBe('cancelled');
		expect(queue.jobs.map((job) => job.viewId)).toEqual(['b']);
		expect(bHandle.status).toBe('queued');
		frame();
		expect(b.paginatedTo).toBe(1);
		expect(bHandle.progress.completed).toBe(1);
	});

	it('refcounts owners and disposes effects, timers, frames, and active generators on last release', () => {
		const data = addView();
		const stopA = start();
		const stopB = start();
		const handle = queue.jobs[0].handle;
		expect(vi.getTimerCount()).toBe(1);
		frame();
		stopA();
		stopA();
		expect(handle.status).toBe('running');
		stopB();
		expect(handle.status).toBe('cancelled');
		expect(signals[0].aborted).toBe(true);
		expect(closed).toHaveBeenCalledOnce();
		expect(closed).toHaveBeenCalledWith(0, true);
		expect(queue.jobs).toEqual([]);
		expect(frames.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		data.revision++;
		flushSync();
		expect(queue.jobs).toEqual([]);
		start();
		expect(queue.jobs).toHaveLength(1);
		expect(queue.jobs[0].handle).not.toBe(handle);
	});

	it('shows catchup only after 1000ms, honors dismissal and pause, and resets dismissal on revision', () => {
		const data = addView();
		start();
		const job = queue.jobs[0];
		expect(queue.catchUp).toBeUndefined();
		tick(999);
		expect(queue.catchUp).toBeUndefined();
		tick(1000);
		expect(queue.catchUp).toBe(job);
		job.handle.pause();
		expect(queue.catchUp).toBeUndefined();
		job.handle.resume();
		expect(queue.catchUp).toBe(job);
		queue.dismiss('a');
		tick(2000);
		expect(queue.catchUp).toBeUndefined();
		data.revision++;
		flushSync();
		expect(queue.jobs[0].dismissed).toBe(false);
		expect(queue.catchUp).toBeUndefined();
		tick(3000);
		expect(queue.catchUp?.viewId).toBe('a');
	});

	it('waits while composing without preparing pages and resumes when composition ends', () => {
		const data = addView();
		Object.defineProperty(data.view, 'composing', { value: true, writable: true });
		start();
		frame();
		expect(data.paginatedTo).toBe(0);
		expect(PageLayout.paginateRange).not.toHaveBeenCalled();
		Object.defineProperty(data.view, 'composing', { value: false, writable: true });
		frame();
		expect(data.paginatedTo).toBe(1);
	});

	it('retains a failed job without infinite retries, and retries only after a new revision', () => {
		const data = addView();
		const failure = new Error('pagination failed');
		vi.mocked(PageLayout.paginateRange).mockImplementation(() => {
			throw failure;
		});
		start();
		const handle = queue.jobs[0].handle;
		frame();
		expect(handle).toMatchObject({ status: 'failed', error: failure });
		expect(data.paginatedTo).toBe(0);
		for (let i = 0; i < 5; i++) {
			data.viewedPage = i;
			flushSync();
			tick(2000 + i * 200);
			frame();
		}
		expect(PageLayout.paginateRange).toHaveBeenCalledOnce();
		expect(queue.jobs[0].handle).toBe(handle);
		expect(queue.catchUp).toBeUndefined();
		expect(frames.size).toBe(0);
		data.revision++;
		flushSync();
		expect(queue.jobs[0].handle).not.toBe(handle);
		frame();
		expect(PageLayout.paginateRange).toHaveBeenCalledTimes(2);
	});
});
