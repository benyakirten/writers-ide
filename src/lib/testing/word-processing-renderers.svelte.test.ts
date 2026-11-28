import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { schema } from 'prosemirror-schema-basic';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { MarkView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import { history, undo, undoDepth } from 'prosemirror-history';
import type { PluginApiConnection } from '@writers-ide/plugins';
import {
	createWordProcessingConnection,
	createWordProcessingService,
} from '../../../packages-js/word-processing';
import type {
	EditorBehaviorContext,
	EditorNodeViewRegistration,
	EditorRendererContext,
	WordProcessingSources,
} from '../../../packages-js/word-processing';

const cleanups: (() => void)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	await settle();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function settle() {
	flushSync();
	await Promise.resolve();
	await Promise.resolve();
}
function setup(plugins: Plugin[] = [], invalidateLayout?: (viewId: string) => void) {
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	function makeView() {
		const mount = document.createElement('div');
		mount.style.whiteSpace = 'pre-wrap';
		document.body.append(mount);
		const view = new EditorView(mount, {
			state: EditorState.create({
				schema,
				doc: schema.node('doc', null, [
					schema.node('paragraph', null, schema.text('hello', [schema.marks.strong.create()])),
				]),
				plugins: [history(), ...plugins],
			}),
			dispatchTransaction(tr) {
				view.updateState(view.state.applyTransaction(tr).state);
				emit();
			},
		});
		cleanups.push(() => {
			view.destroy();
			mount.remove();
		});
		return view;
	}
	const first = makeView();
	let entries = $state.raw([{ viewId: 'one', documentId: 'doc', name: 'Chapter', view: first }]);
	const report = vi.fn();
	const sources: WordProcessingSources = {
		listViews: () => entries,
		activeViewId: () => 'one',
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		reportBehaviorError: report,
		...(invalidateLayout ? { invalidateLayout } : {}),
	};
	const service = createWordProcessingService(sources);
	cleanups.push(() => service.dispose());
	return {
		first,
		service,
		report,
		emit,
		listeners,
		makeView,
		set: (next: typeof entries) => {
			entries = next;
		},
		add(id: string) {
			const view = makeView();
			entries = [...entries, { viewId: id, documentId: 'doc', name: id, view }];
			emit();
			return view;
		},
	};
}
function owner(service: ReturnType<typeof createWordProcessingService>) {
	const controller = new AbortController();
	const resources = new Set<() => void>();
	const connection: PluginApiConnection = {
		consumerId: 'renderer-consumer',
		signal: controller.signal,
		reportError: vi.fn(),
		guard: (fn) => fn,
		own(release) {
			resources.add(release);
			return () => {
				resources.delete(release);
				release();
			};
		},
	};
	return {
		api: createWordProcessingConnection(service, connection),
		connection,
		revoke() {
			controller.abort();
			for (const release of resources) {
				release();
			}
			resources.clear();
		},
	};
}
function registration(
	create: EditorNodeViewRegistration['create'],
	id = 'paragraph',
	views?: readonly string[],
): EditorNodeViewRegistration {
	return { id, name: id, nodeType: 'paragraph', views, create };
}
function nodeResource(): NodeView {
	const dom = document.createElement('section');
	dom.dataset.renderer = 'node';
	const contentDOM = document.createElement('div');
	dom.append(contentDOM);
	return { dom, contentDOM, update: vi.fn(() => true), destroy: vi.fn() };
}

function layoutHarness() {
	const callbacks: ResizeObserverCallback[] = [];
	const observers: {
		targets: Set<Element>;
		observe: ReturnType<typeof vi.fn>;
		unobserve: ReturnType<typeof vi.fn>;
		disconnect: ReturnType<typeof vi.fn>;
	}[] = [];
	vi.stubGlobal(
		'ResizeObserver',
		class {
			targets = new Set<Element>();
			observe = vi.fn((element: Element) => {
				this.targets.add(element);
			});
			unobserve = vi.fn((element: Element) => {
				this.targets.delete(element);
			});
			disconnect = vi.fn(() => {
				this.targets.clear();
			});
			constructor(callback: ResizeObserverCallback) {
				callbacks.push(callback);
				observers.push(this);
			}
		},
	);
	const frames = new Map<number, FrameRequestCallback>();
	let sequence = 0;
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
		sequence++;
		frames.set(sequence, callback);
		return sequence;
	});
	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
		frames.delete(id);
	});
	return {
		observers,
		frames,
		flush() {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) {
				callback(0);
			}
		},
		resize(index: number, height: number, elements = [...observers[index].targets]) {
			callbacks[index](
				elements.map(
					(target) =>
						({
							target,
							borderBoxSize: [{ inlineSize: 100, blockSize: height }],
						}) as unknown as ResizeObserverEntry,
				),
				observers[index] as unknown as ResizeObserver,
			);
		},
	};
}

describe('renderer layout integration', () => {
	it('does not allocate observers or frames without the optional source hook', async () => {
		const layout = layoutHarness();
		const { service, first } = setup();
		const release = service.registerNodeView(registration(() => () => nodeResource()));
		first.dispatch(first.state.tr.insertText('!'));
		await settle();
		release();
		expect(layout.observers).toHaveLength(0);
		expect(layout.frames.size).toBe(0);
	});

	it('shares one observer across registrations and coalesces installation and resource size changes', async () => {
		const layout = layoutHarness();
		const invalidate = vi.fn();
		const { service, first, emit } = setup([], invalidate);
		service.registerNodeView(registration(() => () => nodeResource()));
		service.registerMarkView({
			id: 'mark',
			name: 'Mark',
			markType: 'strong',
			create: () => () => {
				const dom = document.createElement('b');
				return { dom, contentDOM: dom };
			},
		});
		expect(layout.observers).toHaveLength(1);
		expect(layout.observers[0].targets.size).toBe(3);
		expect(layout.frames.size).toBe(1);
		layout.flush();
		expect(invalidate).toHaveBeenCalledExactlyOnceWith('one');
		layout.resize(0, 10);
		layout.flush();
		expect(invalidate).toHaveBeenCalledTimes(1);
		layout.resize(0, 20);
		expect(layout.frames.size).toBe(1);
		layout.flush();
		expect(invalidate).toHaveBeenCalledTimes(2);
		layout.resize(0, 20);
		first.dispatch(first.state.tr.setSelection(TextSelection.create(first.state.doc, 2)));
		emit();
		service.registerBehavior({ id: 'ordinary', name: 'Ordinary', create: () => new Plugin({}) });
		await settle();
		layout.flush();
		expect(layout.frames.size).toBe(0);
		expect(invalidate).toHaveBeenCalledTimes(2);
	});

	it('does not invalidate when pagination or edits reconstruct resources without changing the renderer set', async () => {
		const layout = layoutHarness();
		const invalidate = vi.fn();
		const { service, first } = setup([], invalidate);
		const resources: NodeView[] = [];
		service.registerNodeView(
			registration(() => () => {
				const resource = nodeResource();
				resource.update = () => false;
				resources.push(resource);
				return resource;
			}),
		);
		layout.flush();
		layout.resize(0, 10);
		first.dispatch(first.state.tr.insertText('!'));
		await settle();
		expect(resources).toHaveLength(2);
		expect(resources[0].destroy).toHaveBeenCalledTimes(1);
		expect(layout.observers).toHaveLength(1);
		expect(layout.observers[0].targets.size).toBe(2);
		layout.resize(0, 15);
		layout.flush();
		expect(invalidate).toHaveBeenCalledTimes(1);
	});

	it.each(['remove', 'failure'] as const)(
		'invalidates only after physical %s and releases observations even if destruction throws',
		async (reason) => {
			const layout = layoutHarness();
			const invalidate = vi.fn();
			const { service, first } = setup([], invalidate);
			let context!: EditorRendererContext;
			const resource = nodeResource();
			resource.destroy = vi.fn(() => {
				throw new Error('cleanup failure');
			});
			const release = service.registerNodeView(
				registration((current) => {
					context = current;
					return () => resource;
				}),
			);
			layout.flush();
			invalidate.mockClear();
			if (reason === 'failure') {
				context.reportError(new Error('render failure'));
				expect(layout.frames.size).toBe(0);
				await settle();
			} else {
				release();
			}
			expect(first.dom.querySelector('section')).toBeNull();
			expect(layout.observers[0].targets.size).toBe(0);
			expect(resource.destroy).toHaveBeenCalledTimes(1);
			expect(layout.frames.size).toBe(1);
			layout.flush();
			expect(invalidate).toHaveBeenCalledExactlyOnceWith('one');
		},
	);

	it('retains observers across registration lifetimes, but disposes on source replacement, removal and service disposal', async () => {
		const layout = layoutHarness();
		const invalidate = vi.fn();
		const { service, first, set, listeners } = setup([], invalidate);
		const release = service.registerNodeView(registration(() => () => nodeResource()));
		layout.flush();
		release();
		expect(layout.observers[0].disconnect).not.toHaveBeenCalled();
		service.registerNodeView(registration(() => () => nodeResource()));
		expect(layout.observers).toHaveLength(1);
		set([{ viewId: 'one', documentId: 'replacement', name: 'Other document', view: first }]);
		await settle();
		expect(layout.observers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(layout.observers).toHaveLength(2);
		set([]);
		await settle();
		expect(layout.observers[1].disconnect).toHaveBeenCalledTimes(1);
		expect(layout.frames.size).toBe(0);
		service.dispose();
		expect(listeners.size).toBe(0);
	});

	it('releases source observation after the last renderer is removed and its view closes', async () => {
		const layout = layoutHarness();
		const { service, set, listeners } = setup([], vi.fn());
		const release = service.registerNodeView(registration(() => () => nodeResource()));
		release();
		expect(listeners.size).toBe(1);
		set([]);
		await settle();
		expect(layout.observers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(layout.frames.size).toBe(0);
		expect(listeners.size).toBe(0);
	});

	it('replaces the observer when a source swaps EditorView under the same identity', async () => {
		const layout = layoutHarness();
		const { service, makeView, set } = setup([], vi.fn());
		service.registerNodeView(registration(() => () => nodeResource()));
		const replacement = makeView();
		set([{ viewId: 'one', documentId: 'doc', name: 'Chapter', view: replacement }]);
		await settle();
		expect(layout.observers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(layout.observers).toHaveLength(2);
		expect(layout.observers[1].targets.size).toBe(2);
	});

	it.each(['direct', 'release-first', 'initial-frame-pending'] as const)(
		'preserves final fallback layout invalidation on %s disposal',
		async (mode) => {
			const layout = layoutHarness();
			const invalidate = vi.fn();
			const { service, first, emit } = setup([], invalidate);
			const release = service.registerNodeView(registration(() => () => nodeResource()));
			if (mode !== 'initial-frame-pending') {
				layout.flush();
			}
			invalidate.mockClear();
			invalidate.mockImplementation(() => {
				expect(first.dom.querySelector('section')).toBeNull();
				expect(first.dom.querySelector('p')?.textContent).toBe('hello');
			});
			if (mode === 'release-first') {
				release();
				expect(layout.frames.size).toBe(1);
			}
			service.dispose();
			expect(first.isDestroyed).toBe(false);
			expect(invalidate).toHaveBeenCalledExactlyOnceWith('one');
			expect(layout.frames.size).toBe(0);
			layout.flush();
			await settle();
			service.dispose();
			first.dispatch(first.state.tr.setSelection(TextSelection.create(first.state.doc, 2)));
			emit();
			await settle();
			expect(invalidate).toHaveBeenCalledTimes(1);
			expect(layout.frames.size).toBe(0);
		},
	);

	it.each(['closed', 'destroyed', 'replaced', 'document-replaced'] as const)(
		'does not deliver final fallback invalidation for a %s source',
		async (reason) => {
			const layout = layoutHarness();
			const invalidate = vi.fn();
			const { service, first, set, makeView } = setup([], invalidate);
			const release = service.registerNodeView(registration(() => () => nodeResource()));
			layout.flush();
			invalidate.mockClear();
			release();
			if (reason === 'closed') {
				set([]);
			} else if (reason === 'destroyed') {
				first.destroy();
			} else if (reason === 'replaced') {
				set([{ viewId: 'one', documentId: 'doc', name: 'Replacement', view: makeView() }]);
			} else {
				set([{ viewId: 'one', documentId: 'other', name: 'Other', view: first }]);
			}
			service.dispose();
			layout.flush();
			await settle();
			expect(invalidate).not.toHaveBeenCalled();
		},
	);

	it('delivers final invalidation after deferred fallback when disposed from a render hook', async () => {
		const layout = layoutHarness();
		const invalidate = vi.fn();
		const { service, first } = setup([], invalidate);
		service.registerNodeView(
			registration(() => () => {
				const resource = nodeResource();
				resource.update = () => {
					service.dispose();
					return false;
				};
				return resource;
			}),
		);
		layout.flush();
		invalidate.mockClear();
		first.dispatch(first.state.tr.insertText('!'));
		expect(invalidate).not.toHaveBeenCalled();
		await settle();
		expect(first.dom.querySelector('section')).toBeNull();
		expect(invalidate).toHaveBeenCalledExactlyOnceWith('one');
		expect(layout.frames.size).toBe(0);
	});

	it('cancels pending resize frames on disposal and invalidates final fallback for each live view', async () => {
		const layout = layoutHarness();
		const invalidate = vi.fn();
		const { service, add } = setup([], invalidate);
		add('two');
		service.registerNodeView(registration(() => () => nodeResource()));
		expect(layout.observers).toHaveLength(2);
		layout.flush();
		expect(invalidate.mock.calls).toEqual([['one'], ['two']]);
		layout.resize(1, 10);
		layout.resize(1, 20);
		service.dispose();
		layout.flush();
		expect(invalidate.mock.calls).toEqual([['one'], ['two'], ['one'], ['two']]);
		expect(layout.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
			true,
		);
		await settle();
	});
});

describe('dedicated editor renderers', () => {
	it('mounts, updates and destroys once, preserving schema, selection, stored marks and history', () => {
		const { service, first } = setup();
		const transaction = first.state.tr.insertText('!');
		first.dispatch(
			transaction
				.setSelection(TextSelection.create(transaction.doc, 2))
				.setStoredMarks([schema.marks.em.create()]),
		);
		const before = first.state;
		const resource = nodeResource();
		const create = vi.fn((_context: EditorBehaviorContext) => () => resource);
		const release = service.registerNodeView(registration(create));
		expect(first.dom.querySelector('[data-renderer]')?.textContent).toBe('!hello');
		expect(first.state.schema).toBe(before.schema);
		expect(first.state.doc).toBe(before.doc);
		expect(first.state.selection).toBe(before.selection);
		expect(first.state.storedMarks).toBe(before.storedMarks);
		expect(undoDepth(first.state)).toBe(1);
		first.dispatch(first.state.tr.insertText('X'));
		expect(resource.update).toHaveBeenCalled();
		release();
		release();
		expect(resource.destroy).toHaveBeenCalledTimes(1);
		expect(create.mock.calls[0][0].signal.aborted).toBe(true);
		expect(first.dom.querySelector('p')?.textContent).toContain('X');
		expect(undoDepth(first.state)).toBe(1);
		expect(undo(first.state, first.dispatch)).toBe(true);
	});

	it('uses standard mark constructors and restores schema rendering without content changes', () => {
		const { service, first } = setup();
		const destroy = vi.fn();
		const constructor = vi.fn((_mark, _view, inline) => {
			expect(inline).toBe(true);
			const dom = document.createElement('b');
			dom.dataset.renderer = 'mark';
			return { dom, contentDOM: dom, destroy };
		});
		const doc = first.state.doc;
		const release = service.registerMarkView({
			id: 'strong',
			name: 'Strong',
			markType: 'strong',
			create: () => constructor,
		});
		expect(first.dom.querySelector('b')?.textContent).toBe('hello');
		release();
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(first.dom.querySelector('strong')?.textContent).toBe('hello');
		expect(first.state.doc).toBe(doc);
		expect(undoDepth(first.state)).toBe(0);
	});

	it('rejects overlapping registrations but allows disjoint view scopes and re-enabling', async () => {
		const { service, first, add } = setup();
		const second = add('two');
		const release = service.registerNodeView(
			registration(() => () => nodeResource(), 'one', ['one']),
		);
		expect(() =>
			service.registerNodeView(registration(() => () => nodeResource(), 'overlap')),
		).toThrow('Overlapping');
		service.registerNodeView(registration(() => () => nodeResource(), 'two', ['two']));
		expect(first.dom.querySelector('section')).not.toBeNull();
		expect(second.dom.querySelector('section')).not.toBeNull();
		release();
		service.registerNodeView(registration(() => () => nodeResource(), 'one', ['one']));
		await settle();
		expect(first.dom.querySelector('section')).not.toBeNull();
	});

	it.each(['plugin', 'direct', 'direct-plugin'] as const)(
		'does not override a %s baseline renderer',
		(kind) => {
			const baseline = vi.fn(() => {
				const dom = document.createElement('article');
				return { dom, contentDOM: dom };
			});
			const env = setup();
			const plugin = new Plugin({ props: { nodeViews: { paragraph: baseline } } });
			if (kind === 'plugin') {
				env.first.updateState(
					env.first.state.reconfigure({ plugins: [...env.first.state.plugins, plugin] }),
				);
			} else if (kind === 'direct-plugin') {
				env.first.setProps({ plugins: [plugin] });
			} else {
				env.first.setProps({ nodeViews: { paragraph: baseline } });
			}
			env.service.registerNodeView(registration(() => () => nodeResource()));
			expect(env.report).toHaveBeenCalledWith(
				expect.objectContaining({ phase: 'renderer.conflict' }),
			);
			expect(env.first.dom.querySelector('article')).not.toBeNull();
			if (kind === 'plugin') {
				expect(env.first.state.plugins).toContain(plugin);
			}
		},
	);

	it('detects direct baseline props and late baseline additions', async () => {
		const { service, first, report, emit } = setup();
		const release = service.registerNodeView(registration(() => () => nodeResource()));
		const dom = document.createElement('article');
		first.setProps({ nodeViews: { paragraph: () => ({ dom, contentDOM: dom }) } });
		emit();
		await settle();
		expect(report).toHaveBeenCalledWith(expect.objectContaining({ phase: 'renderer.conflict' }));
		expect(first.dom.querySelector('article')).toBe(dom);
		release();
	});

	it('keeps ordinary behaviors from installing renderers', () => {
		const { service, report } = setup();
		service.registerBehavior({
			id: 'bypass',
			name: 'Bypass',
			create: () => new Plugin({ props: { nodeViews: { paragraph: () => nodeResource() } } }),
		});
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({ phase: 'create', error: expect.any(TypeError) }),
		);
	});

	it('rejects nonexistent schema types and asynchronous factory results', () => {
		const { service, report } = setup();
		service.registerNodeView({
			...registration(() => () => nodeResource(), 'unknown'),
			nodeType: 'missing',
		});
		service.registerNodeView(
			registration(
				(() =>
					Promise.resolve(() => nodeResource())) as unknown as EditorNodeViewRegistration['create'],
				'async',
			),
		);
		expect(report).toHaveBeenCalledTimes(2);
	});

	it('attributes constructor errors to the exact consumer and falls back immediately', async () => {
		const { service, first, report } = setup();
		const consumer = owner(service);
		consumer.api.registerNodeView(
			registration(() => () => {
				throw new Error('constructor exploded');
			}),
		);
		expect(first.dom.querySelector('p')?.textContent).toBe('hello');
		await settle();
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerId: 'renderer-consumer',
				id: 'paragraph',
				viewId: 'one',
				phase: 'renderer.constructor',
			}),
		);
		expect(consumer.connection.reportError).toHaveBeenCalledWith(
			expect.stringContaining('constructor exploded'),
		);
		expect(first.state.doc.textContent).toBe('hello');
		expect(undoDepth(first.state)).toBe(0);
	});

	it('recovers from a throwing mark constructor through the schema contentDOM', async () => {
		const { service, first } = setup();
		service.registerMarkView({
			id: 'mark',
			name: 'Mark',
			markType: 'strong',
			create: () => () => {
				throw new Error('mark error');
			},
		});
		expect(first.dom.querySelector('strong')?.textContent).toBe('hello');
		await settle();
		first.dispatch(first.state.tr.insertText('!'));
		expect(first.state.doc.textContent).toContain('!');
	});

	it('quarantines an entire registration on a later callback and guards retained callbacks', async () => {
		const { service, first, add, report } = setup();
		const second = add('two');
		const resources: NodeView[] = [];
		const contexts: EditorBehaviorContext[] = [];
		service.registerNodeView(
			registration((context) => {
				contexts.push(context);
				return () => {
					const resource = nodeResource();
					resource.update = vi.fn(function (this: NodeView) {
						expect(this).toBe(resource);
						throw new Error('later update');
					});
					resources.push(resource);
					return resource;
				};
			}),
		);
		const retained = first.someProp('nodeViews')!.paragraph;
		first.dispatch(first.state.tr.insertText('!'));
		expect(contexts.every((context) => context.signal.aborted)).toBe(true);
		const updateCount = resources.map((resource) => vi.mocked(resource.update!).mock.calls.length);
		await settle();
		expect(first.dom.querySelector('section')).toBeNull();
		expect(second.dom.querySelector('section')).toBeNull();
		expect(resources.map((resource) => vi.mocked(resource.destroy!).mock.calls.length)).toEqual([
			1, 1,
		]);
		expect(retained(first.state.doc.firstChild!, first, () => 0, [], null!)).toBeUndefined();
		expect(resources.map((resource) => vi.mocked(resource.update!).mock.calls.length)).toEqual(
			updateCount,
		);
		expect(report).toHaveBeenCalledWith(expect.objectContaining({ phase: 'renderer.update' }));
	});

	it('cancels on revocation immediately and removes DOM in a microtask', async () => {
		const { service, first } = setup();
		const consumer = owner(service);
		const resource = nodeResource();
		let context!: EditorBehaviorContext;
		consumer.api.registerNodeView(
			registration((value) => {
				context = value;
				return () => resource;
			}),
		);
		consumer.revoke();
		expect(context.signal.aborted).toBe(true);
		await settle();
		expect(resource.destroy).toHaveBeenCalledTimes(1);
		expect(first.dom.querySelector('p')?.textContent).toBe('hello');
	});

	it('observes late views without snapshot subscribers and cancels closed or replaced identities', async () => {
		const { service, first, add, set, makeView, listeners } = setup();
		const contexts: EditorBehaviorContext[] = [];
		service.registerNodeView(
			registration((context) => {
				contexts.push(context);
				return () => nodeResource();
			}),
		);
		const second = add('two');
		await settle();
		expect(second.dom.querySelector('section')).not.toBeNull();
		const replacement = makeView();
		set([{ viewId: 'one', documentId: 'other', name: 'Other', view: replacement }]);
		await settle();
		expect(contexts.slice(0, 2).every((context) => context.signal.aborted)).toBe(true);
		expect(first.dom.querySelector('section')).toBeNull();
		expect(second.dom.querySelector('section')).toBeNull();
		expect(replacement.dom.querySelector('section')).not.toBeNull();
		service.dispose();
		expect(listeners.size).toBe(0);
	});

	it('cleans invalid constructor resources exactly once', async () => {
		const { service, first, report } = setup();
		const destroy = vi.fn();
		service.registerNodeView(
			registration(() => (() => ({ dom: null, destroy })) as unknown as NodeViewConstructor),
		);
		await settle();
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalled();
		expect(first.dom.querySelector('p')?.textContent).toBe('hello');
	});

	it('rejects asynchronous runtime callbacks and continues cleanup after destroy errors', async () => {
		const { service, first, report } = setup();
		const resource = nodeResource();
		resource.update = (() => Promise.resolve(true)) as unknown as NodeView['update'];
		resource.destroy = vi.fn(() => {
			throw new Error('destroy error');
		});
		service.registerNodeView(registration(() => () => resource));
		first.dispatch(first.state.tr.insertText('!'));
		await settle();
		expect(resource.destroy).toHaveBeenCalledTimes(1);
		expect(report.mock.calls.map(([failure]) => failure.phase)).toEqual([
			'renderer.update',
			'renderer.destroy',
		]);
		expect(first.dom.querySelector('p')).not.toBeNull();
	});

	it.each(['update', 'stopEvent', 'ignoreMutation'] as const)(
		'validates %s, preserves its receiver and guards it after failure',
		async (method) => {
			const { service, first, report } = setup();
			const resource = nodeResource();
			const callback = vi.fn(function (this: NodeView) {
				expect(this).toBe(resource);
				return 'invalid';
			});
			Object.assign(resource, { [method]: callback });
			service.registerNodeView(registration(() => () => resource));
			const constructor = first.someProp('nodeViews')!.paragraph;
			const wrapped = constructor(first.state.doc.firstChild!, first, () => 0, [], null!);
			const invoke = () => {
				if (method === 'update') {
					return wrapped.update!(first.state.doc.firstChild!, [], null!);
				}
				if (method === 'stopEvent') {
					return wrapped.stopEvent!(new Event('click'));
				}
				return wrapped.ignoreMutation!({ type: 'selection', target: wrapped.dom });
			};
			expect(invoke()).toBe(false);
			expect(invoke()).toBe(false);
			expect(callback).toHaveBeenCalledTimes(1);
			wrapped.destroy!();
			wrapped.destroy!();
			await settle();
			expect(report).toHaveBeenCalledWith(expect.objectContaining({ phase: `renderer.${method}` }));
			expect(first.dom.querySelector('p')?.textContent).toBe('hello');
		},
	);

	it('observes edits within contentDOM instead of ignoring editable mutations', async () => {
		const { service, first } = setup();
		const resource = nodeResource();
		service.registerNodeView(registration(() => () => resource));
		resource.contentDOM!.querySelector('strong')!.firstChild!.nodeValue = 'edited';
		await settle();
		expect(first.state.doc.textContent).toBe('edited');
	});

	it('recovers from mark ignoreMutation failure without losing editable children', async () => {
		const { service, first, report } = setup();
		const destroy = vi.fn();
		service.registerMarkView({
			id: 'mark',
			name: 'Mark',
			markType: 'strong',
			create: () => () => {
				const dom = document.createElement('b');
				return {
					dom,
					contentDOM: dom,
					ignoreMutation: () => {
						throw new Error('mark mutation');
					},
					destroy,
				};
			},
		});
		const markDOM = first.dom.querySelector('b')!;
		markDOM.setAttribute('data-control', 'changed');
		markDOM.firstChild!.nodeValue = 'edited';
		await settle();
		expect(first.state.doc.textContent).toBe('edited');
		expect(first.dom.querySelector('strong')?.textContent).toBe('edited');
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({ phase: 'renderer.ignoreMutation' }),
		);
	});

	it('defers removal requested during construction and still cleans the returned resource', async () => {
		const { service, first } = setup();
		const consumer = owner(service);
		const resource = nodeResource();
		consumer.api.registerNodeView(
			registration(() => () => {
				consumer.revoke();
				return resource;
			}),
		);
		await settle();
		expect(resource.destroy).toHaveBeenCalledTimes(1);
		expect(first.dom.querySelector('p')?.textContent).toBe('hello');
	});

	it('requires lifecycle mutations from render hooks and error reporters to be deferred', async () => {
		const { service, first, report } = setup();
		const resource = nodeResource();
		resource.update = () => {
			throw new Error('update');
		};
		report.mockImplementation(() => {
			expect(() =>
				service.registerNodeView(registration(() => () => nodeResource(), 'nested')),
			).toThrow('deferred');
		});
		service.registerNodeView(registration(() => () => resource));
		first.dispatch(first.state.tr.insertText('!'));
		await settle();
		expect(report).toHaveBeenCalledTimes(1);
	});

	it('cancels factories and does not install any view when a later per-view factory fails', async () => {
		const { service, first, add, report } = setup();
		const second = add('two');
		const contexts: EditorBehaviorContext[] = [];
		service.registerNodeView(
			registration((context) => {
				contexts.push(context);
				if (context.viewId === 'two') {
					throw new Error('second factory');
				}
				return () => nodeResource();
			}),
		);
		await settle();
		expect(contexts.every((context) => context.signal.aborted)).toBe(true);
		expect(first.dom.querySelector('section')).toBeNull();
		expect(second.dom.querySelector('section')).toBeNull();
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({ viewId: 'two', phase: 'create' }),
		);
	});

	it.each(['text', 'comment', 'fragment'] as const)(
		'rejects non-element %s node DOM without disabling unrelated behaviors',
		async (kind) => {
			const { service, first, report } = setup();
			service.registerBehavior({
				id: 'unrelated',
				name: 'Unrelated',
				create: () => new Plugin({}),
			});
			const dom =
				kind === 'text'
					? document.createTextNode('invalid')
					: kind === 'comment'
						? document.createComment('invalid')
						: document.createDocumentFragment();
			const destroy = vi.fn();
			service.registerNodeView(registration(() => () => ({ dom, destroy }) as unknown as NodeView));
			await settle();
			expect(first.dom.querySelector('p')?.textContent).toBe('hello');
			expect(destroy).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith(
				expect.objectContaining({ phase: 'renderer.constructor' }),
			);
			expect(service.behaviors()).toEqual([
				expect.objectContaining({ id: 'unrelated', status: 'active' }),
			]);
		},
	);

	it.each(['node', 'mark'] as const)('accepts null contentDOM for a %s renderer', (kind) => {
		const { service, first, report } = setup();
		const dom = document.createElement('span');
		const destroy = vi.fn();
		const create = () => () => ({ dom, contentDOM: null, destroy });
		const release =
			kind === 'node'
				? service.registerNodeView(registration(create))
				: service.registerMarkView({ id: 'mark', name: 'Mark', markType: 'strong', create });
		expect(first.dom.contains(dom)).toBe(true);
		expect(first.state.doc.textContent).toBe('hello');
		if (kind === 'mark') {
			expect(dom.textContent).toBe('hello');
		}
		expect(report).not.toHaveBeenCalled();
		release();
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it.each(['reuse', 'false', 'throw', 'thenable'] as const)(
		'handles mark update returning %s with the proper receiver',
		async (result) => {
			const { service, first, report } = setup();
			first.dispatch(
				first.state.tr.removeMark(1, 6).addMark(1, 6, schema.marks.link.create({ href: 'one' })),
			);
			const resources: MarkView[] = [];
			const update = vi.fn(function (this: MarkView) {
				expect(resources).toContain(this);
				if (result === 'throw') {
					throw new Error('mark update failed');
				}
				if (result === 'thenable') {
					return { then() {} };
				}
				return result === 'reuse';
			});
			service.registerMarkView({
				id: 'link',
				name: 'Link',
				markType: 'link',
				create: () => () => {
					const dom = document.createElement('a');
					const resource: MarkView = {
						dom,
						contentDOM: dom,
						update: update as MarkView['update'],
						destroy: vi.fn(),
					};
					resources.push(resource);
					return resource;
				},
			});
			const original = resources[0];
			first.dispatch(first.state.tr.addMark(1, 6, schema.marks.link.create({ href: 'two' })));
			await settle();
			expect(update).toHaveBeenCalledWith(schema.marks.link.create({ href: 'two' }));
			expect(first.state.doc.textContent).toBe('hello');
			if (result === 'reuse') {
				expect(first.dom.contains(original.dom)).toBe(true);
				expect(original.destroy).not.toHaveBeenCalled();
			} else {
				expect(first.dom.contains(original.dom)).toBe(false);
				expect(original.destroy).toHaveBeenCalledTimes(1);
			}
			if (result === 'throw' || result === 'thenable') {
				expect(report).toHaveBeenCalledWith(expect.objectContaining({ phase: 'renderer.update' }));
			} else {
				expect(report).not.toHaveBeenCalled();
			}
		},
	);

	it('guards retained mark updates after revocation', async () => {
		const { service, first } = setup();
		const consumer = owner(service);
		const update = vi.fn(() => true);
		const destroy = vi.fn();
		consumer.api.registerMarkView({
			id: 'mark',
			name: 'Mark',
			markType: 'strong',
			create: () => () => ({ dom: document.createElement('b'), update, destroy }),
		});
		const wrapped = first.someProp('markViews')!.strong(schema.marks.strong.create(), first, true);
		expect(wrapped.update!(schema.marks.strong.create())).toBe(true);
		consumer.revoke();
		expect(wrapped.update!(schema.marks.strong.create())).toBe(false);
		expect(update).toHaveBeenCalledTimes(1);
		wrapped.destroy!();
		wrapped.destroy!();
		await settle();
		expect(destroy).toHaveBeenCalledTimes(2);
	});

	it('attributes deferred render errors and immediately disables the registration across views', async () => {
		const { service, first, add, report } = setup();
		const second = add('two');
		const consumer = owner(service);
		const contexts: EditorRendererContext[] = [];
		const resources: NodeView[] = [];
		consumer.api.registerNodeView(
			registration((context) => {
				contexts.push(context);
				return () => {
					const resource = nodeResource();
					resources.push(resource);
					return resource;
				};
			}),
		);
		const before = first.state;
		const error = new Error('async Svelte render failed');
		await Promise.resolve();
		contexts[1].reportError(error);
		expect(contexts.every((context) => context.signal.aborted)).toBe(true);
		expect(first.dom.querySelector('section')).not.toBeNull();
		contexts[0].reportError(new Error('duplicate'));
		await settle();
		expect(report).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith({
			ownerId: 'renderer-consumer',
			id: 'paragraph',
			viewId: 'two',
			phase: 'renderer.render',
			error,
		});
		expect(consumer.connection.reportError).toHaveBeenCalledWith(
			expect.stringContaining('async Svelte render failed'),
		);
		expect(first.dom.querySelector('p')?.textContent).toBe('hello');
		expect(second.dom.querySelector('p')?.textContent).toBe('hello');
		expect(
			resources.every((resource) => vi.mocked(resource.destroy!).mock.calls.length === 1),
		).toBe(true);
		expect(first.state.schema).toBe(before.schema);
		expect(first.state.doc).toBe(before.doc);
		expect(first.state.selection).toBe(before.selection);
		expect(undoDepth(first.state)).toBe(0);
	});

	it.each(['revoke', 'remove', 'detach', 'destroy'] as const)(
		'ignores late render error reports after %s',
		async (reason) => {
			const { service, first, set, report } = setup();
			const consumer = owner(service);
			let context!: EditorRendererContext;
			const release = consumer.api.registerNodeView(
				registration((current) => {
					context = current;
					return () => nodeResource();
				}),
			);
			if (reason === 'revoke') {
				consumer.revoke();
			} else if (reason === 'remove') {
				release();
			} else if (reason === 'detach') {
				set([]);
			} else {
				first.destroy();
			}
			context.reportError(new Error('late render error'));
			await settle();
			expect(report).not.toHaveBeenCalled();
			expect(consumer.connection.reportError).not.toHaveBeenCalled();
		},
	);

	it('guards retained mark update callbacks after connection revocation', async () => {
		const { service, first, report } = setup();
		const consumer = owner(service);
		const update = vi.fn(() => true);
		const resources: MarkView[] = [];
		consumer.api.registerMarkView({
			id: 'mark',
			name: 'Mark',
			markType: 'strong',
			create: () => () => {
				const dom = document.createElement('b');
				const resource = { dom, contentDOM: null, update, destroy: vi.fn() };
				resources.push(resource);
				return resource;
			},
		});
		const mark = schema.marks.strong.create();
		const wrapped = first.someProp('markViews')!.strong(mark, first, true);
		consumer.revoke();
		expect(wrapped.update!(mark)).toBe(false);
		expect(update).not.toHaveBeenCalled();
		wrapped.destroy!();
		wrapped.destroy!();
		await settle();
		expect(
			resources.every((resource) => vi.mocked(resource.destroy!).mock.calls.length === 1),
		).toBe(true);
		expect(report).not.toHaveBeenCalled();
	});

	it('does not add reportError to ordinary behavior contexts', () => {
		const { service } = setup();
		service.registerBehavior({
			id: 'ordinary',
			name: 'Ordinary',
			create(context) {
				expect('reportError' in context).toBe(false);
				return new Plugin({});
			},
		});
	});

	it('shares stable reconciliation with behaviors and preserves their keyed state', async () => {
		const { service, first } = setup();
		const plugin = new Plugin({ state: { init: () => 0, apply: (_tr, value) => value + 1 } });
		const create = vi.fn(() => plugin);
		service.registerBehavior({ id: 'behavior', name: 'Behavior', create });
		const release = service.registerNodeView(registration(() => () => nodeResource()));
		expect(service.behaviors().map(({ id }) => id)).toEqual(['behavior']);
		const plugins = first.state.plugins;
		first.dispatch(first.state.tr.insertText('!'));
		const afterEdit = first.state;
		await settle();
		expect(first.state).toBe(afterEdit);
		expect(first.state.plugins).toBe(plugins);
		expect(plugin.getState(first.state)).toBe(1);
		release();
		expect(plugin.getState(first.state)).toBe(1);
		expect(create).toHaveBeenCalledTimes(1);
	});
});
