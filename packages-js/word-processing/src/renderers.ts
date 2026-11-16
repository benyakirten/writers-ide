import { DOMSerializer } from 'prosemirror-model';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import type { MarkView, NodeView } from 'prosemirror-view';

export type RendererType = { kind: 'node' | 'mark'; type: string };
type Callback = (...args: never[]) => unknown;

export function synchronousRendererResult<T>(value: T): T {
	if (value != null && typeof (value as { then?: unknown }).then === 'function') {
		if (value instanceof Promise) {
			void value.catch(() => {});
		}
		throw new TypeError('Renderer factories, constructors and callbacks must be synchronous');
	}
	return value;
}

/** Node constructors can decline rendering; mark constructors require an explicit schema view. */
function fallback(kind: RendererType['kind'], args: unknown[]): NodeView | MarkView | undefined {
	if (kind === 'node') {
		return undefined;
	}
	const mark = args[0] as Mark;
	const spec = mark.type.spec.toDOM!(mark, args[2] as boolean);
	return DOMSerializer.renderSpec(document, spec);
}

export function wrapRenderer(
	constructor: Callback,
	kind: RendererType['kind'],
	live: () => boolean,
	invoke: (callback: () => unknown) => unknown,
	fail: (phase: string, error: unknown) => void,
	observe?: (dom: globalThis.Node, contentDOM?: HTMLElement) => () => void,
): Callback {
	return function (this: unknown, ...args: never[]) {
		return invoke(() => {
			if (!live()) {
				return fallback(kind, args);
			}
			let resource: NodeView | MarkView | undefined;
			let destroyed = false;
			let releaseObservation: (() => void) | undefined;
			const cleanup = () =>
				invoke(() => {
					if (destroyed) {
						return;
					}
					destroyed = true;
					try {
						if (typeof resource?.destroy === 'function') {
							const result = synchronousRendererResult(resource!.destroy!.call(resource));
							if (result !== undefined) {
								throw new TypeError('Renderer destroy must return undefined');
							}
						}
					} catch (error) {
						fail('destroy', error);
					} finally {
						try {
							releaseObservation?.();
						} catch (error) {
							fail('layout', error);
						}
					}
				});
			try {
				resource = constructor.apply(this, args) as NodeView | MarkView;
				synchronousRendererResult(resource);
				if (
					!resource ||
					typeof resource !== 'object' ||
					!(resource.dom instanceof globalThis.Node)
				) {
					throw new TypeError('Renderer constructors must return a view with a DOM node');
				}
				if (kind === 'node' && (args[0] as ProseMirrorNode).isText && resource.dom.nodeType !== 3) {
					throw new TypeError('Text node renderers must return a DOM text node');
				}
				if (
					kind === 'node' &&
					!(args[0] as ProseMirrorNode).isText &&
					!(resource.dom instanceof Element)
				) {
					throw new TypeError('Non-text node renderers must return a DOM element');
				}
				if (kind === 'mark' && !(resource.dom instanceof HTMLElement)) {
					throw new TypeError('Mark renderers must return an HTML element');
				}
				if (
					resource.contentDOM != null &&
					(!(resource.contentDOM instanceof HTMLElement) ||
						!resource.dom.contains(resource.contentDOM))
				) {
					throw new TypeError('Renderer contentDOM must be an element inside dom');
				}
				const methods =
					kind === 'node'
						? [
								'update',
								'selectNode',
								'deselectNode',
								'setSelection',
								'stopEvent',
								'ignoreMutation',
								'destroy',
							]
						: ['update', 'ignoreMutation', 'destroy'];
				for (const name of methods) {
					const method = (resource as unknown as Record<string, unknown>)[name];
					if (method !== undefined && typeof method !== 'function') {
						throw new TypeError(`Renderer ${name} must be a function`);
					}
				}
				const dom = resource.dom;
				const contentDOM = resource.contentDOM ?? undefined;
				const wrapped: Record<string, unknown> = { dom, contentDOM, destroy: cleanup };
				if (kind === 'node') {
					const multiType = (resource as NodeView).multiType;
					if (multiType !== undefined && typeof multiType !== 'boolean') {
						throw new TypeError('Renderer multiType must be a boolean');
					}
					wrapped.multiType = multiType;
				}
				for (const name of methods) {
					if (name === 'destroy') {
						continue;
					}
					const method = (resource as unknown as Record<string, unknown>)[name] as
						| Callback
						| undefined;
					if (!method) {
						continue;
					}
					wrapped[name] = (...values: never[]) =>
						invoke(() => {
							const defaultValue = ['update', 'stopEvent', 'ignoreMutation'].includes(name)
								? false
								: undefined;
							if (destroyed || !live()) {
								return defaultValue;
							}
							try {
								const result = synchronousRendererResult(method.apply(resource, values));
								if (defaultValue === false ? typeof result !== 'boolean' : result !== undefined) {
									throw new TypeError(`Invalid synchronous renderer ${name} result`);
								}
								if (resource!.dom !== dom || (resource!.contentDOM ?? undefined) !== contentDOM) {
									throw new TypeError('Renderer dom and contentDOM must remain stable');
								}
								return live() ? result : defaultValue;
							} catch (error) {
								fail(name, error);
								return defaultValue;
							}
						});
				}
				if (!live()) {
					cleanup();
					return fallback(kind, args);
				}
				releaseObservation = observe?.(dom, contentDOM);
				return wrapped;
			} catch (error) {
				fail('constructor', error);
				cleanup();
				return fallback(kind, args);
			}
		});
	};
}
