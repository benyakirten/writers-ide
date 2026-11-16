import type { EditorView } from 'prosemirror-view';

type Size = { width: number; height: number };
type Resource = { roots: Set<Element>; elements: Set<Element> };

/** One resize observer per managed view. Ordinary state/selection updates need no notification. */
export function createRendererLayoutObserver(
	view: EditorView,
	viewId: string,
	invalidateLayout?: (viewId: string) => void,
) {
	const window = view.dom.ownerDocument.defaultView;
	const targets = new Map<Element, { owners: number; size?: Size }>();
	const resources = new Set<Resource>();
	let observer: ResizeObserver | undefined;
	let attachments: MutationObserver | undefined;
	let frame: number | undefined;
	let dirty = false;
	let refreshPending = false;
	let disposed = false;

	function schedule() {
		if (disposed || !invalidateLayout || !window || frame !== undefined) {
			return;
		}
		frame = window.requestAnimationFrame(() => {
			frame = undefined;
			if (disposed || view.isDestroyed) {
				return;
			}
			if (refreshPending) {
				refreshPending = false;
				refreshTargets();
			}
			if (dirty) {
				dirty = false;
				invalidateLayout(viewId);
			}
		});
	}

	function invalidate() {
		dirty = true;
		schedule();
	}

	function refresh() {
		refreshPending = true;
		schedule();
	}

	function retain(element: Element) {
		const target = targets.get(element);
		if (target) {
			target.owners++;
		} else {
			targets.set(element, { owners: 1 });
			observer!.observe(element, { box: 'border-box' });
		}
	}

	function release(element: Element) {
		const target = targets.get(element);
		if (!target) {
			return;
		}
		target.owners--;
		if (target.owners === 0) {
			observer?.unobserve(element);
			targets.delete(element);
		}
	}

	function refreshTargets() {
		for (const resource of resources) {
			const next = new Set(resource.roots);
			for (const root of resource.roots) {
				if (!view.dom.contains(root)) {
					continue;
				}
				// Non-replaced inline elements do not reliably deliver resize notifications.
				// Observe their nearest layout box instead, without changing text wrapping.
				let element: Element | null = root;
				while (element && element !== view.dom) {
					const display = window!.getComputedStyle(element).display;
					if (display !== 'inline' && display !== 'contents' && display !== 'none') {
						next.add(element);
						break;
					}
					element = element.parentElement;
				}
			}
			for (const element of resource.elements) {
				if (!next.has(element)) {
					release(element);
				}
			}
			for (const element of next) {
				if (!resource.elements.has(element)) {
					retain(element);
				}
			}
			resource.elements = next;
		}
	}

	function observe(dom: Node, contentDOM?: HTMLElement | null): () => void {
		if (disposed || !invalidateLayout || !window?.ResizeObserver) {
			return () => {};
		}
		observer ??= new window.ResizeObserver((entries) => {
			for (const entry of entries) {
				const target = targets.get(entry.target);
				if (!target) {
					continue;
				}
				const box = entry.borderBoxSize[0];
				const size = box
					? { width: box.inlineSize, height: box.blockSize }
					: { width: entry.contentRect.width, height: entry.contentRect.height };
				const previous = target.size;
				target.size = size;
				// Initial delivery establishes a baseline. Pagination can reconstruct renderers;
				// treating each mount as a change would continuously restart its own work.
				if (previous && (previous.width !== size.width || previous.height !== size.height)) {
					invalidate();
				}
			}
		});
		const roots = new Set<Element>();
		if (dom.nodeType === 1) {
			roots.add(dom as Element);
		}
		if (contentDOM) {
			roots.add(contentDOM);
		}
		const resource: Resource = { roots, elements: new Set(roots) };
		resources.add(resource);
		for (const element of roots) {
			retain(element);
		}
		if (!attachments) {
			// Constructors run before PM attaches their DOM. Child-list observation also
			// handles surviving inline views moving between paragraphs/pages during reflow.
			attachments = new window.MutationObserver(refresh);
			attachments.observe(view.dom, { childList: true, subtree: true });
		}
		refresh();
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			resources.delete(resource);
			for (const element of resource.elements) {
				release(element);
			}
			if (resources.size === 0) {
				attachments?.disconnect();
				attachments = undefined;
			}
		};
	}

	return {
		observe,
		/** Coalesced target refresh only; does not itself invalidate layout. */
		refresh,
		/** Call after renderer installation/removal, not after every source notification. */
		invalidate,
		dispose() {
			disposed = true;
			observer?.disconnect();
			attachments?.disconnect();
			targets.clear();
			resources.clear();
			if (frame !== undefined) {
				window?.cancelAnimationFrame(frame);
				frame = undefined;
			}
		},
	};
}
