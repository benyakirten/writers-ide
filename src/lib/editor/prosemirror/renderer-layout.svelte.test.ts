import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createRendererLayoutObserver } from '../../../../packages-js/word-processing/src/renderer-layout';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function setup() {
	const callbacks: ResizeObserverCallback[] = [];
	const observers: {
		observe: ReturnType<typeof vi.fn>;
		unobserve: ReturnType<typeof vi.fn>;
		disconnect: ReturnType<typeof vi.fn>;
	}[] = [];
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor(callback: ResizeObserverCallback) {
				callbacks.push(callback);
				observers.push(this);
			}
		},
	);
	const frames = new Map<number, FrameRequestCallback>();
	let next = 0;
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
		next++;
		frames.set(next, callback);
		return next;
	});
	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
		frames.delete(id);
	});
	const mount = document.createElement('div');
	document.body.append(mount);
	// Only the DOM/lifetime surface is needed here. A real editor's DOM observer
	// would repair these synthetic trees; production editor behavior is browser-tested.
	const view = { dom: mount, isDestroyed: false } as unknown as EditorView;
	cleanups.push(() => mount.remove());
	const invalidate = vi.fn();
	function manager(id = 'one', callback: ((id: string) => void) | undefined = invalidate) {
		const result = createRendererLayoutObserver(view, id, callback);
		cleanups.push(result.dispose);
		return result;
	}
	return {
		view,
		manager,
		observers,
		invalidate,
		frames,
		flush() {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) {
				callback(0);
			}
		},
		resize(index: number, target: Element, height: number) {
			callbacks[index](
				[
					{
						target,
						borderBoxSize: [{ inlineSize: 100, blockSize: height }],
					} as unknown as ResizeObserverEntry,
				],
				observers[index] as unknown as ResizeObserver,
			);
		},
	};
}

describe('renderer layout observation', () => {
	it('uses one observer for roots/content and coalesces changed sizes for only its view', () => {
		const h = setup();
		const first = h.manager();
		const second = h.manager('two');
		const root = document.createElement('div');
		const content = document.createElement('p');
		first.observe(root, content);
		first.observe(document.createElement('div'));
		second.observe(document.createElement('div'));
		expect(h.observers).toHaveLength(2);
		expect(h.observers[0].observe).toHaveBeenCalledTimes(3);
		h.resize(0, root, 10);
		h.resize(0, content, 10);
		h.flush();
		expect(h.invalidate).not.toHaveBeenCalled();
		h.resize(0, root, 20);
		h.resize(0, content, 20);
		first.invalidate();
		expect(h.frames.size).toBe(1);
		h.flush();
		expect(h.invalidate).toHaveBeenCalledExactlyOnceWith('one');
		h.resize(0, root, 20);
		h.flush();
		expect(h.invalidate).toHaveBeenCalledTimes(1);
	});

	it('reference-counts targets and ignores late deliveries after teardown', () => {
		const h = setup();
		const manager = h.manager();
		const root = document.createElement('div');
		const release = manager.observe(root, root);
		const other = manager.observe(root);
		expect(h.observers[0].observe).toHaveBeenCalledTimes(1);
		release();
		release();
		expect(h.observers[0].unobserve).not.toHaveBeenCalled();
		other();
		expect(h.observers[0].unobserve).toHaveBeenCalledExactlyOnceWith(root);
		h.resize(0, root, 20);
		manager.invalidate();
		manager.dispose();
		h.flush();
		expect(h.invalidate).not.toHaveBeenCalled();
		expect(h.observers[0].disconnect).toHaveBeenCalled();
	});

	it('attaches inline ancestors after mount, shares them and follows page reparenting', async () => {
		const h = setup();
		const manager = h.manager();
		const first = document.createElement('span');
		const second = document.createElement('span');
		first.style.display = second.style.display = 'inline';
		const releaseFirst = manager.observe(first);
		const releaseSecond = manager.observe(second);
		const page = document.createElement('section');
		const paragraph = document.createElement('p');
		paragraph.style.display = 'block';
		paragraph.append(first, second);
		page.append(paragraph);
		h.view.dom.append(page);
		await Promise.resolve();
		h.flush();
		expect(h.observers).toHaveLength(1);
		expect(
			h.observers[0].observe.mock.calls.filter(([element]) => element === paragraph),
		).toHaveLength(1);
		h.resize(0, paragraph, 20);
		h.resize(0, paragraph, 40);
		h.flush();
		expect(h.invalidate).toHaveBeenCalledExactlyOnceWith('one');
		const nextPage = document.createElement('section');
		const nextParagraph = document.createElement('p');
		nextParagraph.style.display = 'block';
		nextPage.append(nextParagraph);
		h.view.dom.append(nextPage);
		nextParagraph.append(first);
		await Promise.resolve();
		h.flush();
		expect(h.observers[0].observe).toHaveBeenCalledWith(nextParagraph, { box: 'border-box' });
		expect(h.observers[0].unobserve).not.toHaveBeenCalledWith(paragraph);
		releaseSecond();
		expect(h.observers[0].unobserve).toHaveBeenCalledWith(paragraph);
		h.resize(0, paragraph, 100);
		h.resize(0, nextParagraph, 40);
		h.flush();
		expect(h.invalidate).toHaveBeenCalledTimes(1);
		h.resize(0, nextParagraph, 60);
		h.flush();
		expect(h.invalidate).toHaveBeenCalledTimes(2);
		releaseFirst();
		expect(h.observers[0].unobserve).toHaveBeenCalledWith(nextParagraph);
	});

	it('does not invalidate when reconstruction replaces an inline resource in the same paragraph', async () => {
		const h = setup();
		const manager = h.manager();
		const paragraph = document.createElement('p');
		paragraph.style.display = 'block';
		h.view.dom.append(paragraph);
		const first = document.createElement('span');
		first.style.display = 'inline';
		paragraph.append(first);
		const release = manager.observe(first);
		await Promise.resolve();
		h.flush();
		h.resize(0, paragraph, 20);
		release();
		const replacement = document.createElement('span');
		replacement.style.display = 'inline';
		manager.observe(replacement);
		first.replaceWith(replacement);
		await Promise.resolve();
		h.flush();
		h.resize(0, paragraph, 40);
		h.flush();
		expect(h.invalidate).not.toHaveBeenCalled();
		manager.refresh();
		manager.dispose();
		paragraph.append(document.createElement('span'));
		await Promise.resolve();
		h.flush();
		expect(h.frames.size).toBe(0);
		expect(h.invalidate).not.toHaveBeenCalled();
	});

	it('does not allocate observers or frames without a host callback', () => {
		const h = setup();
		const manager = createRendererLayoutObserver(h.view, 'standalone');
		cleanups.push(manager.dispose);
		manager.observe(document.createElement('div'))();
		manager.invalidate();
		expect(h.observers).toHaveLength(0);
		expect(h.frames.size).toBe(0);
	});
});
