import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { schema } from 'prosemirror-schema-basic';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { history, undo, undoDepth } from 'prosemirror-history';
import { createWordProcessingService } from '@writers-ide/word-processing';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import type { MarkView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { defineSvelteMarkView, defineSvelteNodeView } from '@writers-ide/word-processing/svelte';
import NodeFixture from './SvelteWordProcessingNodeAdapterFixture.svelte';
import MarkFixture from './SvelteWordProcessingMarkAdapterFixture.svelte';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	flushSync();
	vi.restoreAllMocks();
});

function setup(leaf = false) {
	const nodeDestroy = vi.fn();
	const markDestroy = vi.fn();
	const control = vi.fn();
	const constructor = defineSvelteNodeView(NodeFixture, {
		props: { editable: !leaf, onDestroy: nodeDestroy, onControl: control },
		contentDOM: !leaf,
	});
	const markConstructor = defineSvelteMarkView(MarkFixture, { props: { onDestroy: markDestroy } });
	const nodes: NodeView[] = [];
	const marks: MarkView[] = [];
	const mount = document.createElement('div');
	document.body.append(mount);
	const view = new EditorView(mount, {
		state: EditorState.create({
			schema,
			doc: schema.node('doc', null, [
				leaf
					? schema.node('horizontal_rule')
					: schema.node('paragraph', null, schema.text('hello', [schema.marks.strong.create()])),
			]),
		}),
		nodeViews: {
			[leaf ? 'horizontal_rule' : 'paragraph']: (...args) => {
				const node = constructor(...args);
				nodes.push(node);
				return node;
			},
		},
		markViews: {
			strong: (...args) => {
				const mark = markConstructor(...args);
				marks.push(mark);
				return mark;
			},
		},
	});
	cleanups.push(() => {
		view.destroy();
		mount.remove();
	});
	return { view, nodes, marks, nodeDestroy, markDestroy, control };
}

function mutation(target: Node, type = 'childList'): ViewMutationRecord {
	return { type, target, removedNodes: [] } as unknown as ViewMutationRecord;
}

describe('standalone Svelte ProseMirror view adapters', () => {
	it('mounts editable nodes and marks synchronously while PM owns editable children', () => {
		const { view, nodes, marks } = setup();
		const node = nodes[0];
		const content = node.contentDOM!;
		const markContent = marks[0].contentDOM!;
		expect(node.dom.contains(content)).toBe(true);
		expect(content.textContent).toBe('hello');
		expect(markContent.textContent).toBe('hello');
		expect(view.dom.querySelector('[data-mark-ui]')?.getAttribute('data-inline')).toBe('true');
		view.dispatch(view.state.tr.insertText('!', 6));
		expect(nodes).toHaveLength(1);
		expect(node.contentDOM).toBe(content);
		expect(content.textContent).toBe('hello!');
		expect(marks[0].contentDOM).toBe(markContent);
		expect(markContent.textContent).toBe('hello!');
		expect(marks[0].update).toBeTypeOf('function');
		expect(marks[0]).not.toHaveProperty('selectNode');
	});

	it('updates node, decorations and selected props without replacing DOM', () => {
		const { view, nodes } = setup();
		const node = nodes[0];
		const dom = node.dom;
		const content = node.contentDOM;
		const decoration = Decoration.node(0, view.state.doc.firstChild!.nodeSize, { class: 'test' });
		view.setProps({ decorations: (state) => DecorationSet.create(state.doc, [decoration]) });
		expect(view.dom.querySelector('[data-node-ui]')?.getAttribute('data-decorations')).toBe('1');
		view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
		expect(view.dom.querySelector('[data-node-ui]')?.getAttribute('data-selected')).toBe('true');
		expect((dom as HTMLElement).classList.contains('ProseMirror-selectednode')).toBe(true);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		expect(view.dom.querySelector('[data-node-ui]')?.getAttribute('data-selected')).toBe('false');
		expect(node.dom).toBe(dom);
		expect(node.contentDOM).toBe(content);
		expect(node.update!(schema.node('horizontal_rule'), [], DecorationSet.empty)).toBe(false);
	});

	it('isolates native controls, not wrapper/editor events or content and selection mutations', () => {
		const { view, nodes, marks, control } = setup();
		const node = nodes[0];
		const button = view.dom.querySelector('button')!;
		const input = view.dom.querySelector('input')!;
		const content = node.contentDOM!;
		function stopped(target: Node, type: string) {
			const event = new Event(type, { bubbles: true });
			target.dispatchEvent(event);
			return node.stopEvent!(event);
		}
		expect(stopped(button, 'click')).toBe(true);
		expect(control).toHaveBeenCalledWith(0);
		expect(stopped(input, 'keydown')).toBe(true);
		expect(stopped(node.dom, 'click')).toBe(false);
		expect(stopped(content, 'input')).toBe(false);
		expect(stopped(content, 'compositionstart')).toBe(false);
		expect(node.ignoreMutation!(mutation(button, 'attributes'))).toBe(true);
		expect(node.ignoreMutation!(mutation(content))).toBe(false);
		expect(node.ignoreMutation!(mutation(content.firstChild!))).toBe(false);
		expect(node.ignoreMutation!(mutation(node.dom, 'selection'))).toBe(false);
		expect(marks[0].ignoreMutation!(mutation(marks[0].contentDOM!))).toBe(false);
		expect(marks[0].ignoreMutation!(mutation(marks[0].dom, 'selection'))).toBe(false);
	});

	it('reports asynchronous reactive render failures separately from PM callbacks', async () => {
		const { view } = setup();
		let shouldFail = $state(false);
		const onError = vi.fn();
		const constructor = defineSvelteNodeView(NodeFixture, {
			props: {
				editable: false,
				onDestroy: vi.fn(),
				onControl: vi.fn(),
				readLabel() {
					if (shouldFail) {
						throw new Error('Asynchronous fixture failure');
					}
					return 'ready';
				},
			},
			onError,
		});
		const resource = constructor(
			schema.node('horizontal_rule'),
			view,
			() => 0,
			[],
			DecorationSet.empty,
		);
		cleanups.push(() => resource.destroy!());
		shouldFail = true;
		await tick();
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ message: 'Asynchronous fixture failure' }),
		);
	});

	it.each([
		{ kind: 'node', managed: false, backwards: false },
		{ kind: 'mark', managed: false, backwards: false },
		{ kind: 'node', managed: true, backwards: false },
		{ kind: 'mark', managed: true, backwards: false },
		{ kind: 'node', managed: false, backwards: true },
		{ kind: 'mark', managed: false, backwards: true },
		{ kind: 'node', managed: true, backwards: true },
		{ kind: 'mark', managed: true, backwards: true },
	])(
		'preserves editable $kind content, selection, stored marks and history after async failure (managed=$managed, backwards=$backwards)',
		async ({ kind, managed, backwards }) => {
			let failing = $state(false);
			const report = vi.fn();
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			const readLabel = () => {
				if (failing) {
					throw new Error('Editable async fixture failure');
				}
				return '';
			};
			function makeNode(onError?: (error: unknown) => void) {
				return defineSvelteNodeView(NodeFixture, {
					props: { editable: true, onDestroy: vi.fn(), onControl: vi.fn(), readLabel },
					contentDOM: true,
					onError,
				});
			}
			function makeMark(onError?: (error: unknown) => void) {
				return defineSvelteMarkView(MarkFixture, {
					props: { onDestroy: vi.fn(), readLabel },
					onError,
				});
			}
			const mount = document.createElement('div');
			document.body.append(mount);
			const listeners = new Set<() => void>();
			const view = new EditorView(mount, {
				state: EditorState.create({
					schema,
					doc: schema.node(
						'doc',
						null,
						schema.node('paragraph', null, schema.text('keep me', [schema.marks.strong.create()])),
					),
					plugins: [history()],
				}),
				nodeViews: !managed && kind === 'node' ? { paragraph: makeNode() } : {},
				markViews: !managed && kind === 'mark' ? { strong: makeMark() } : {},
				dispatchTransaction(tr) {
					view.updateState(view.state.applyTransaction(tr).state);
					for (const listener of listeners) {
						listener();
					}
				},
			});
			view.dom.style.whiteSpace = 'pre-wrap';
			cleanups.push(() => {
				view.destroy();
				mount.remove();
			});
			if (managed) {
				const service = createWordProcessingService({
					listViews: () => [{ viewId: 'editable', documentId: 'doc', name: 'Editable', view }],
					activeViewId: () => 'editable',
					subscribe(listener) {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					reportBehaviorError: report,
				});
				cleanups.push(() => service.dispose());
				if (kind === 'node') {
					service.registerNodeView({
						id: 'editable-node',
						name: 'Editable node',
						nodeType: 'paragraph',
						create: (ctx) => makeNode(ctx.reportError),
					});
				} else {
					service.registerMarkView({
						id: 'editable-mark',
						name: 'Editable mark',
						markType: 'strong',
						create: (ctx) => makeMark(ctx.reportError),
					});
				}
			}
			view.dispatch(view.state.tr.insertText('!', 8));
			view.dispatch(
				view.state.tr
					.setSelection(TextSelection.create(view.state.doc, backwards ? 6 : 4, backwards ? 2 : 4))
					.setStoredMarks([schema.marks.em.create()]),
			);
			view.focus();
			const before = view.state;
			const depth = undoDepth(before);
			if (!backwards) {
				expect(before.storedMarks).toEqual([schema.marks.em.create()]);
			}
			expect(depth).toBe(1);
			failing = true;
			await tick();
			// Let native mutation/selection observers and deferred core quarantine both run.
			await new Promise((resolve) => setTimeout(resolve, 30));
			await tick();
			expect(view.state.doc.eq(before.doc)).toBe(true);
			expect(view.state.doc.textContent).toBe('keep me!');
			expect(view.state.selection.eq(before.selection)).toBe(true);
			expect(view.state.storedMarks).toEqual(before.storedMarks);
			expect(undoDepth(view.state)).toBe(depth);
			expect(view.dom.textContent).toBe('keep me!');
			const nativeSelection = document.getSelection()!;
			expect(view.posAtDOM(nativeSelection.anchorNode!, nativeSelection.anchorOffset)).toBe(
				before.selection.anchor,
			);
			expect(view.posAtDOM(nativeSelection.focusNode!, nativeSelection.focusOffset)).toBe(
				before.selection.head,
			);
			expect(
				undo(view.state, (tr) => {
					expect(view.state.apply(tr).doc.textContent).toBe('keep me');
				}),
			).toBe(true);
			if (managed) {
				expect(report).toHaveBeenCalled();
				expect(log).not.toHaveBeenCalled();
			} else {
				expect(log).toHaveBeenCalledExactlyOnceWith(
					'Asynchronous Svelte editor view failure',
					expect.objectContaining({ message: 'Editable async fixture failure' }),
				);
				view.dispatch(view.state.tr.insertText('?', 9));
				expect(view.state.doc.textContent).toBe('keep me!?');
				expect(view.dom.textContent).toBe('keep me!?');
			}
		},
	);

	it('updates mounted mark props synchronously and rejects different mark types', () => {
		const constructor = defineSvelteMarkView(MarkFixture, { props: { onDestroy: vi.fn() } });
		const resources: MarkView[] = [];
		const mount = document.createElement('div');
		document.body.append(mount);
		const view = new EditorView(mount, {
			state: EditorState.create({
				schema,
				doc: schema.node(
					'doc',
					null,
					schema.node(
						'paragraph',
						null,
						schema.text('hello', [schema.marks.link.create({ href: 'test', title: 'before' })]),
					),
				),
			}),
			markViews: {
				link: (...args) => {
					const resource = constructor(...args);
					resources.push(resource);
					return resource;
				},
			},
		});
		cleanups.push(() => {
			view.destroy();
			mount.remove();
		});
		const resource = resources[0];
		const dom = resource.dom;
		const content = resource.contentDOM;
		expect(resource.update!(schema.marks.link.create({ href: 'test', title: 'after' }))).toBe(true);
		expect(resources).toHaveLength(1);
		expect(resource.dom).toBe(dom);
		expect(resource.contentDOM).toBe(content);
		expect(dom.querySelector('[data-mark-ui]')?.getAttribute('data-title')).toBe('after');
		expect(content!.textContent).toBe('hello');
		expect(resource.update!(schema.marks.em.create())).toBe(false);
	});

	it('updates attribute props and recreates marks through the PM lifecycle', () => {
		const { view, marks, markDestroy } = setup();
		view.dispatch(view.state.tr.removeMark(1, 6, schema.marks.strong));
		expect(markDestroy).toHaveBeenCalledTimes(1);
		view.dispatch(view.state.tr.addMark(1, 6, schema.marks.strong.create()));
		expect(marks).toHaveLength(2);
		expect(marks[1].contentDOM!.textContent).toBe('hello');
		const constructor = defineSvelteNodeView(NodeFixture, {
			props: { editable: false, onDestroy: vi.fn(), onControl: vi.fn() },
		});
		view.setProps({ nodeViews: { image: constructor } });
		view.dispatch(view.state.tr.insert(1, schema.node('image', { src: 'test', title: 'before' })));
		const imageDOM = view.dom.querySelector('[data-node-ui] span')!;
		expect(imageDOM.textContent).toBe('before');
		view.dispatch(view.state.tr.setNodeMarkup(1, undefined, { src: 'test', title: 'after' }));
		expect(view.dom.querySelector('[data-node-ui] span')).toBe(imageDOM);
		expect(imageDOM.textContent).toBe('after');
	});

	it('renders leaf nodes and unmounts node and mark components exactly once', () => {
		const { nodes, nodeDestroy } = setup(true);
		expect(nodes[0].contentDOM).toBeUndefined();
		expect(nodes[0].dom.textContent).toContain('horizontal_rule');
		nodes[0].destroy!();
		nodes[0].destroy!();
		expect(nodeDestroy).toHaveBeenCalledTimes(1);
		const container = setup();
		container.view.destroy();
		container.nodes[0].destroy!();
		container.marks[0].destroy!();
		expect(container.nodeDestroy).toHaveBeenCalledTimes(1);
		expect(container.markDestroy).toHaveBeenCalledTimes(1);
	});

	it('rejects missing synchronous content hosts and forwards synchronous render errors', () => {
		const { view } = setup();
		const missingHost = defineSvelteNodeView(NodeFixture, {
			props: { editable: false, onDestroy: vi.fn(), onControl: vi.fn() },
			contentDOM: true,
		});
		expect(() =>
			missingHost(schema.node('paragraph'), view, () => 0, [], DecorationSet.empty),
		).toThrow('Mount contentDOM synchronously');
		const failing = defineSvelteNodeView(NodeFixture, {
			props: { editable: false, onDestroy: vi.fn(), onControl: vi.fn(), fail: true },
		});
		expect(() =>
			failing(schema.node('horizontal_rule'), view, () => 0, [], DecorationSet.empty),
		).toThrow('Node adapter fixture render failed');
		const image = defineSvelteNodeView(NodeFixture, {
			props: { editable: false, onDestroy: vi.fn(), onControl: vi.fn() },
		});
		const resource = image(
			schema.node('image', { src: 'test', title: 'ok' }),
			view,
			() => 0,
			[],
			DecorationSet.empty,
		);
		cleanups.push(() => resource.destroy!());
		expect(() =>
			resource.update!(
				schema.node('image', { src: 'test', title: 'throw' }),
				[],
				DecorationSet.empty,
			),
		).toThrow('Node adapter fixture render failed');
	});
});
