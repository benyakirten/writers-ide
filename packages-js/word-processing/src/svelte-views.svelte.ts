import { flushSync, mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import type { Action } from 'svelte/action';
import type {
	Decoration,
	DecorationSource,
	EditorView,
	MarkViewConstructor,
	NodeViewConstructor,
	ViewMutationRecord,
} from 'prosemirror-view';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import SvelteViewHost from './svelte-view-host.svelte';

/** Attach to one empty, unconditional element with `use:contentDOM`. Never render its children. */
export type SvelteContentDOM = Action<HTMLElement, undefined>;

export type SvelteNodeViewProps = {
	node: ProseMirrorNode;
	decorations: readonly Decoration[];
	innerDecorations: DecorationSource;
	selected: boolean;
	getPos: () => number | undefined;
	contentDOM: SvelteContentDOM;
};

export type SvelteMarkViewProps = {
	mark: Mark;
	inline: boolean;
	contentDOM: SvelteContentDOM;
};

export type SvelteViewOptions<Props extends object, Base extends object> = {
	/** Explicit feature props, including command closures. Adapter-owned props take precedence. */
	props: Omit<Props, keyof Base>;
	/** Outer element. Defaults to div for block nodes and span for inline nodes/marks. */
	tag?: keyof HTMLElementTagNameMap;
	/** Nodes default to false; marks always have editable content. */
	contentDOM?: boolean;
	/** Pass the registration context's reportError to quarantine managed asynchronous failures. */
	onError?: (error: unknown) => void;
};

function createDOM(view: EditorView, tag: keyof HTMLElementTagNameMap, editable: boolean) {
	const document = view.dom.ownerDocument;
	const dom = document.createElement(tag);
	// A separate mount area prevents Svelte root teardown from removing rescued editable content.
	const uiDOM = document.createElement(tag === 'span' ? 'span' : 'div');
	dom.append(uiDOM);
	const contentDOM = editable ? document.createElement('span') : undefined;
	let host: HTMLElement | undefined;
	let attached = false;
	let disposed = false;
	let rescued = false;
	function preserveContent() {
		if (!contentDOM || disposed || rescued) {
			return;
		}
		rescued = true;
		dom.append(contentDOM);
		// Removing the Svelte ancestor can collapse the browser selection. The model selection
		// remains authoritative; restore its direction without dispatching or changing stored marks.
		if (!view.isDestroyed && view.hasFocus()) {
			try {
				const { anchor, head } = view.state.selection;
				const start = view.domAtPos(anchor);
				const end = view.domAtPos(head);
				document.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
			} catch {
				// Selection mapping may be unavailable during PM reconstruction. Never let that
				// prevent content preservation or delivery of the original render failure.
			}
		}
	}
	const content: SvelteContentDOM = (element) => {
		if (!contentDOM) {
			throw new Error('Enable contentDOM before using the contentDOM action');
		}
		if (attached || element.childNodes.length !== 0) {
			throw new Error('contentDOM requires one stable, empty host element');
		}
		attached = true;
		host = element;
		element.append(contentDOM);
		return {
			destroy() {
				// Svelte tears down a failed branch before onerror. Rescue now, not in the reporter.
				preserveContent();
				host = undefined;
			},
		};
	};
	function verify() {
		if (contentDOM && (!host || !dom.contains(host) || contentDOM.parentNode !== host)) {
			throw new Error('Mount contentDOM synchronously and keep its host unconditional and stable');
		}
	}
	function ignoreMutation(mutation: ViewMutationRecord) {
		if (mutation.type === 'selection') {
			return false;
		}
		// UI is Svelte-owned. ProseMirror must still observe all edits inside its content subtree.
		if (contentDOM && mutation.type === 'childList') {
			for (const removed of mutation.removedNodes) {
				if (removed.contains(contentDOM)) {
					return false;
				}
			}
		}
		return !contentDOM || !contentDOM.contains(mutation.target);
	}
	function stopEvent(event: Event) {
		const target = event.target;
		if (!(target instanceof dom.ownerDocument.defaultView!.Node)) {
			return false;
		}
		if (contentDOM?.contains(target)) {
			return false;
		}
		// Only native controls opt out. Wrapper clicks, dragging, and editor events still reach PM.
		let element = target.nodeType === 1 ? (target as Element) : target.parentElement;
		while (element && element !== dom) {
			if (element.matches('button, input, select, textarea, option')) {
				return true;
			}
			element = element.parentElement;
		}
		return false;
	}
	return {
		dom,
		uiDOM,
		contentDOM,
		content,
		verify,
		ignoreMutation,
		stopEvent,
		preserveContent,
		dispose() {
			disposed = true;
		},
	};
}

function render<Props extends object>(
	component: Component<Props>,
	initial: Props,
	dom: ReturnType<typeof createDOM>,
	onError?: (error: unknown) => void,
) {
	function reportAsyncError(error: unknown) {
		if (onError) {
			onError(error);
		} else {
			console.error('Asynchronous Svelte editor view failure', error);
		}
	}
	let currentProps = $state.raw(initial as Record<string, unknown>);
	const hostProps = {
		component: component as unknown as Component<Record<string, unknown>>,
		get props() {
			return currentProps;
		},
		onerror: (error: unknown) => {
			dom.preserveContent();
			renderFailed = true;
			if (synchronous) {
				failure = { error };
			} else {
				reportAsyncError(error);
			}
		},
	};
	let renderFailed = false;
	let synchronous = false;
	let failure: { error: unknown } | undefined;
	let instance: ReturnType<typeof mount> | undefined;
	let destroyed = false;
	function sync(callback: () => void) {
		synchronous = true;
		try {
			flushSync(callback);
			if (failure) {
				throw failure.error;
			}
			dom.verify();
		} finally {
			synchronous = false;
		}
	}
	function destroy() {
		if (destroyed) {
			return;
		}
		destroyed = true;
		// PM, not Svelte, decides when editable content leaves the editor, including deferred removal.
		dom.preserveContent();
		dom.dispose();
		if (instance) {
			// With outros disabled, Svelte tears down effects and DOM synchronously.
			void unmount(instance, { outro: false }).catch(reportAsyncError);
		}
	}
	try {
		sync(() => {
			instance = mount(SvelteViewHost, { target: dom.uiDOM, props: hostProps });
		});
	} catch (error) {
		destroy();
		throw error;
	}
	return {
		update(props: Props) {
			if (destroyed || renderFailed) {
				return;
			}
			sync(() => {
				currentProps = props as Record<string, unknown>;
			});
		},
		destroy,
	};
}

/** Returns a standard synchronous PM constructor; no registration or application state is captured. */
export function defineSvelteNodeView<Props extends SvelteNodeViewProps>(
	component: Component<Props>,
	options: SvelteViewOptions<Props, SvelteNodeViewProps>,
): NodeViewConstructor {
	return (node, view, getPos, decorations, innerDecorations) => {
		if (node.isText) {
			throw new TypeError('Svelte node views cannot render ProseMirror text nodes');
		}
		const dom = createDOM(
			view,
			options.tag ?? (node.isInline ? 'span' : 'div'),
			options.contentDOM ?? false,
		);
		let current = { node, decorations, innerDecorations, selected: false };
		const props = () =>
			({ ...options.props, ...current, getPos, contentDOM: dom.content }) as Props;
		const rendering = render(component, props(), dom, options.onError);
		return {
			dom: dom.dom,
			contentDOM: dom.contentDOM,
			update(next, nextDecorations, nextInnerDecorations) {
				if (next.type !== current.node.type) {
					return false;
				}
				current = {
					...current,
					node: next,
					decorations: nextDecorations,
					innerDecorations: nextInnerDecorations,
				};
				rendering.update(props());
				return true;
			},
			selectNode() {
				current = { ...current, selected: true };
				dom.dom.classList.add('ProseMirror-selectednode');
				rendering.update(props());
			},
			deselectNode() {
				current = { ...current, selected: false };
				dom.dom.classList.remove('ProseMirror-selectednode');
				rendering.update(props());
			},
			stopEvent: dom.stopEvent,
			ignoreMutation: dom.ignoreMutation,
			destroy: rendering.destroy,
		};
	};
}

/** Marks support reactive mark updates, but have no node selection callbacks. */
export function defineSvelteMarkView<Props extends SvelteMarkViewProps>(
	component: Component<Props>,
	options: Omit<SvelteViewOptions<Props, SvelteMarkViewProps>, 'contentDOM'>,
): MarkViewConstructor {
	return (mark, view, inline) => {
		const dom = createDOM(view, options.tag ?? 'span', true);
		let current = mark;
		const rendering = render(
			component,
			{ ...options.props, mark, inline, contentDOM: dom.content } as Props,
			dom,
			options.onError,
		);
		return {
			dom: dom.dom,
			contentDOM: dom.contentDOM,
			update(next) {
				if (next.type !== current.type) {
					return false;
				}
				current = next;
				rendering.update({
					...options.props,
					mark: next,
					inline,
					contentDOM: dom.content,
				} as Props);
				return true;
			},
			ignoreMutation: dom.ignoreMutation,
			destroy: rendering.destroy,
		};
	};
}
