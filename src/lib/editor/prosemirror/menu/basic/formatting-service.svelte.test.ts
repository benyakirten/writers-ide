import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { AllSelection, EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { FormattingCommand, FormattingSnapshot } from './contracts';

import { FormattingService } from './formatting-service.svelte';
import {
	createWordProcessingService,
	type WordProcessingSources,
} from '@writers-ide/word-processing';
import { INDENT_MAX } from '$lib/editor/prosemirror/view/constants';
import * as structure from '@writers-ide/word-processing/structure';
import { ActionUtilities } from '$lib/editor/prosemirror/view/actions';
import { schema as productionSchema } from '$lib/editor/prosemirror/view/schema';
import TabState from '$lib/editor/state/tab-state.svelte';
import Editors from '$lib/editor/prosemirror/prose-mirror-editor.svelte';

const markNames = [
	'bold',
	'italic',
	'superscript',
	'subscript',
	'underline',
	'overline',
	'strikethrough',
] as const;
const schema = new Schema({
	nodes: {
		doc: { content: 'page+' },
		page: {
			content: 'block+',
			attrs: { index: { default: 0 } },
			toDOM: () => ['section', 0],
		},
		paragraph: {
			group: 'block',
			content: 'text*',
			attrs: {
				peer: { default: false },
				indent: { default: 0 },
				align: { default: 'start' },
			},
			toDOM: () => ['p', 0],
		},
		atom: { group: 'block', atom: true, toDOM: () => ['hr'] },
		text: {},
	},
	marks: Object.fromEntries(markNames.map((name) => [name, { toDOM: () => ['span', 0] }])),
});

const views: EditorView[] = [];
const cleanups: (() => void)[] = [];

function paragraph(text = 'secret manuscript', attrs: Record<string, unknown> = {}) {
	return schema.node('paragraph', attrs, schema.text(text));
}

function createView(blocks: ProseMirrorNode[] = [paragraph()]) {
	const mount = document.createElement('div');
	document.body.append(mount);
	const doc = schema.node('doc', null, schema.node('page', null, blocks));
	const view = new EditorView(mount, {
		state: EditorState.create({ doc, selection: TextSelection.create(doc, 2, 8) }),
	});
	views.push(view);
	return view;
}

function fixture(view: EditorView | null = createView()) {
	let active = $state<string | null>('one');
	let registry = $state.raw<Record<string, { view: EditorView; documentId?: string }>>(
		view ? { one: { view } } : {},
	);
	const listeners = new Set<() => void>();
	const unsubscribe = vi.fn();
	const sources: WordProcessingSources = {
		activeViewId: () => active,
		listViews: () =>
			Object.entries(registry).map(([viewId, entry]) => ({
				viewId,
				documentId: entry.documentId ?? `document-${viewId}`,
				name: viewId,
				view: entry.view,
			})),
		subscribe: vi.fn((listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				unsubscribe();
			};
		}),
	};
	const api = createWordProcessingService(sources);
	cleanups.push(() => api.dispose());
	const service = new FormattingService(api);
	const emissions: (FormattingSnapshot | null)[] = [];
	let latest: FormattingSnapshot | null = null;
	return {
		service,
		api,
		sources,
		emissions,
		listeners,
		unsubscribe,
		get latest() {
			return latest!;
		},
		set active(id: string | null) {
			active = id;
		},
		set registry(value: Record<string, { view: EditorView; documentId?: string }>) {
			registry = value;
		},
		listen() {
			const stop = service.subscribe((snapshot) => {
				latest = snapshot;
				emissions.push(snapshot);
			});
			cleanups.push(stop);
			return stop;
		},
		emit() {
			for (const listener of listeners) {
				listener();
			}
		},
		request(command: FormattingCommand = 'bold') {
			return { viewId: latest!.viewId, revision: latest!.revision, command };
		},
	};
}

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	for (const view of views.splice(0)) {
		if (!view.isDestroyed) {
			view.destroy();
		}
	}
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('production document boundaries', () => {
	it.each(['forward', 'reverse', 'all'] as const)(
		'publishes and executes formatting for a %s selection across pages ending in pageEnd',
		(direction) => {
			const doc = productionSchema.node('doc', null, [
				productionSchema.node('page', null, [
					productionSchema.node('paragraph', null, productionSchema.text('First paragraph.')),
				]),
				productionSchema.node('page', null, [
					productionSchema.node('paragraph', null, productionSchema.text('Second paragraph.')),
				]),
				productionSchema.node('page', null, [
					productionSchema.node('paragraph', null, productionSchema.text('Final paragraph.')),
					productionSchema.node('pageEnd'),
				]),
			]);
			const from = 2;
			const to = doc.content.size - 3;
			const selection =
				direction === 'all'
					? new AllSelection(doc)
					: TextSelection.create(
							doc,
							direction === 'forward' ? from : to,
							direction === 'forward' ? to : from,
						);
			const view = createView();
			view.updateState(EditorState.create({ doc, selection }));
			const f = fixture(view);
			expect(() => f.listen()).not.toThrow();
			expect(f.latest.enabled['align-center']).toBe(true);
			expect(f.service.execute(f.request('align-center'))).toBe(true);
			view.state.doc.forEach((page) => {
				expect(page.firstChild!.attrs.align).toBe('center');
			});
		},
	);
});

describe('default application sources', () => {
	it('resolves document tab IDs to distinct registered view IDs initially and on tab switches', () => {
		const previousEditors = Editors.editors;
		const previousActive = TabState.active;
		const firstDocumentId = 'formatting-regression-document-a';
		const secondDocumentId = 'formatting-regression-document-b';
		const firstViewId = 'obs-9f37a2';
		const secondViewId = 'obs-c4e81b';
		const firstView = createView();
		const secondView = createView();
		const firstDispatch = vi.spyOn(firstView, 'dispatch');
		const secondDispatch = vi.spyOn(secondView, 'dispatch');
		const api = createWordProcessingService({
			listViews: () => Object.values(Editors.editors),
			activeViewId: () => (TabState.active ? Editors.get(TabState.active)?.viewId : null),
			subscribe: () => () => {},
		});
		const service = new FormattingService(api);
		const listener = vi.fn<(snapshot: FormattingSnapshot | null) => void>();
		let stop: (() => void) | undefined;
		try {
			TabState.create('Formatting first document', firstDocumentId);
			TabState.create('Formatting second document', secondDocumentId);
			Editors.editors = {
				...previousEditors,
				[firstViewId]: {
					name: 'First',
					documentId: firstDocumentId,
					viewId: firstViewId,
					view: firstView,
				},
				[secondViewId]: {
					name: 'Second',
					documentId: secondDocumentId,
					viewId: secondViewId,
					view: secondView,
				},
			};
			TabState.activate(firstDocumentId);
			stop = service.subscribe(listener);
			const initial = listener.mock.calls.at(-1)![0]!;
			expect(initial.viewId).toBe(firstViewId);
			expect(initial.enabled.bold).toBe(true);
			expect(service.execute({ ...initial, command: 'bold' })).toBe(true);
			expect(firstDispatch).toHaveBeenCalledOnce();
			expect(secondDispatch).not.toHaveBeenCalled();
			const firstState = firstView.state;
			const oldRequest = { ...listener.mock.calls.at(-1)![0]!, command: 'italic' as const };
			flushSync();

			TabState.activate(secondDocumentId);
			expect(service.execute(oldRequest)).toBe(false);
			flushSync();
			const switched = listener.mock.calls.at(-1)![0]!;
			expect(switched.viewId).toBe(secondViewId);
			expect(switched.revision).toBeGreaterThan(initial.revision);
			expect(switched.enabled.italic).toBe(true);
			expect(service.execute({ ...switched, command: 'italic' })).toBe(true);
			expect(secondDispatch).toHaveBeenCalledOnce();
			expect(firstView.state).toBe(firstState);

			delete Editors.editors[secondViewId];
			flushSync();
			expect(listener).toHaveBeenLastCalledWith(null);
			TabState.activate(firstDocumentId);
			flushSync();
			expect(listener.mock.calls.at(-1)![0]!.viewId).toBe(firstViewId);
		} finally {
			stop?.();
			api.dispose();
			Editors.editors = previousEditors;
			TabState.remove(firstDocumentId);
			TabState.remove(secondDocumentId);
			if (previousActive) {
				TabState.activate(previousActive);
			} else {
				TabState.deactivate();
			}
		}
	});
});

describe('FormattingService lifecycle and data boundary', () => {
	it('is lazy, immediately reports initial/null state, and cleans up its root and bus', () => {
		const f = fixture(null);
		expect(f.sources.subscribe).not.toHaveBeenCalled();
		const stop = f.listen();
		expect(f.emissions).toEqual([null]);
		flushSync();
		expect(f.emissions).toHaveLength(1);
		f.registry = { one: { view: createView() } };
		flushSync();
		expect(f.latest.viewId).toBe('one');
		stop();
		stop();
		expect(f.unsubscribe).toHaveBeenCalledTimes(1);
		expect(f.listeners.size).toBe(0);
		const count = f.emissions.length;
		f.active = null;
		flushSync();
		f.emit();
		expect(f.emissions).toHaveLength(count);
	});

	it('deduplicates the same state and gives independent transferable snapshots', () => {
		const f = fixture();
		f.listen();
		expect(f.emissions).toHaveLength(1);
		const original = structuredClone(f.latest);
		f.latest.marks.bold = 99;
		f.latest.enabled.bold = false;
		f.latest.blocks.indent = 99;
		const other = vi.fn();
		cleanups.push(f.service.subscribe(other));
		expect(other).toHaveBeenLastCalledWith(original);
		flushSync();
		f.emit();
		f.emit();
		expect(f.emissions).toHaveLength(1);
		expect(other).toHaveBeenCalledTimes(1);
		expect(Object.keys(original).sort()).toEqual([
			'blocks',
			'enabled',
			'marks',
			'revision',
			'viewId',
		]);
		expect(JSON.stringify(original)).not.toContain('secret');
		expect(Object.values(original.marks).every((value) => typeof value === 'number')).toBe(true);
		expect(Object.values(original.blocks).every((value) => typeof value === 'number')).toBe(true);
		expect(Object.values(original.enabled).every((value) => typeof value === 'boolean')).toBe(true);
	});

	it('isolates throwing update subscribers from other listeners and ProseMirror dispatch', () => {
		const view = createView();
		const f = fixture(view);
		const error = new Error('plugin notification failed');
		const report = vi.spyOn(console, 'error').mockImplementation(() => {});
		let throwing = false;
		cleanups.push(
			f.service.subscribe(() => {
				if (throwing) {
					throw error;
				}
			}),
		);
		f.listen();
		const other = vi.fn();
		cleanups.push(f.service.subscribe(other));
		throwing = true;
		view.setProps({
			dispatchTransaction(tr) {
				view.updateState(view.state.apply(tr));
				f.emit();
			},
		});
		const focus = vi.spyOn(view, 'focus').mockImplementation(() => {});
		expect(f.service.execute(f.request())).toBe(true);
		expect(f.latest.marks.bold).toBe(1);
		expect(other).toHaveBeenCalledTimes(2);
		expect(report).toHaveBeenLastCalledWith('Formatting subscriber failed', error);
		expect(focus).toHaveBeenCalledOnce();
		f.active = null;
		expect(() => flushSync()).not.toThrow();
		expect(other).toHaveBeenLastCalledWith(null);
	});

	it('releases a subscription whose immediate initial callback throws', () => {
		const f = fixture();
		expect(() =>
			f.service.subscribe(() => {
				throw new Error('initial failure');
			}),
		).toThrow('initial failure');
		expect(f.listeners.size).toBe(0);
		expect(f.unsubscribe).toHaveBeenCalledOnce();
		f.listen();
		expect(f.latest.viewId).toBe('one');
	});

	it('owns duplicate callback subscriptions independently and releases only after the last one', () => {
		const f = fixture();
		const listener = vi.fn();
		const first = f.service.subscribe(listener);
		const second = f.service.subscribe(listener);
		cleanups.push(first, second);
		first();
		expect(f.unsubscribe).not.toHaveBeenCalled();
		f.active = null;
		flushSync();
		expect(listener).toHaveBeenCalledTimes(3);
		expect(listener).toHaveBeenLastCalledWith(null);
		second();
		expect(f.unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('uses fresh increasing revisions after removal, replacement and re-subscription', () => {
		const f = fixture();
		const stop = f.listen();
		const old = f.request();
		flushSync();
		f.registry = {};
		flushSync();
		expect(f.emissions.at(-1)).toBeNull();
		f.registry = { one: { view: createView() } };
		flushSync();
		expect(f.latest.revision).toBeGreaterThan(old.revision);
		expect(f.service.execute(old)).toBe(false);
		const replacement = f.request();
		stop();
		expect(f.service.execute(replacement)).toBe(false);
		f.listen();
		expect(f.latest.revision).toBeGreaterThan(replacement.revision);
		expect(f.service.execute(replacement)).toBe(false);
	});
});

describe('live request validation', () => {
	it.each([
		'selection',
		'text',
		'active',
		'replacement',
		'document',
		'destroyed',
		'readonly',
	] as const)('rejects stale %s before a reactive flush or event', (change) => {
		const view = createView();
		const f = fixture(view);
		f.listen();
		const request = f.request();
		const focus = vi.spyOn(view, 'focus');
		switch (change) {
			case 'selection':
				view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 6)));
				break;
			case 'text':
				view.dispatch(view.state.tr.insertText('new', 3));
				break;
			case 'active':
				f.active = 'other';
				break;
			case 'replacement':
				f.registry = { one: { view: createView() } };
				break;
			case 'document':
				f.registry = { one: { view, documentId: 'replacement-document' } };
				break;
			case 'destroyed':
				view.destroy();
				break;
			case 'readonly':
				view.setProps({ editable: () => false });
				break;
		}
		expect(f.service.execute(request)).toBe(false);
		expect(focus).not.toHaveBeenCalled();
	});

	it('observes selection/text updates and active switches without an editor event', () => {
		const view = createView();
		const f = fixture(view);
		f.listen();
		flushSync();
		let revision = f.latest.revision;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 6)));
		f.emit();
		expect(f.latest.revision).toBeGreaterThan(revision);
		revision = f.latest.revision;
		view.dispatch(view.state.tr.insertText('changed', 3));
		f.emit();
		expect(f.latest.revision).toBeGreaterThan(revision);
		f.registry = { one: { view }, two: { view: createView() } };
		f.active = 'two';
		flushSync();
		expect(f.latest.viewId).toBe('two');
		f.active = null;
		flushSync();
		expect(f.emissions.at(-1)).toBeNull();
	});

	it('uses synchronous inspection and provider-owned active, focused command execution', () => {
		const f = fixture();
		const inspect = vi.spyOn(f.api, 'inspect');
		const runCommand = vi.spyOn(f.api, 'runCommand');
		f.listen();
		expect(inspect).toHaveBeenCalledWith(
			expect.objectContaining({ viewId: 'one', documentId: 'document-one' }),
			expect.any(Function),
			{ requireActive: true },
		);
		expect(f.service.execute(f.request())).toBe(true);
		expect(runCommand).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ viewId: 'one', documentId: 'document-one' }),
			expect.any(Function),
			{ requireActive: true, focus: true },
		);
	});

	it('rejects unknown commands, incorrect view IDs and revisions', () => {
		const f = fixture();
		f.listen();
		expect(f.service.execute({ ...f.request(), command: 'constructor' as FormattingCommand })).toBe(
			false,
		);
		expect(f.service.execute({ ...f.request(), viewId: 'other' })).toBe(false);
		expect(f.service.execute({ ...f.request(), revision: -1 })).toBe(false);
	});
});

describe('read-only availability queries', () => {
	it('creates no transactions and groups paragraphs once for a large selected document', () => {
		const view = createView(
			Array.from({ length: 200 }, () => paragraph('a long selected paragraph')),
		);
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, 2, view.state.doc.content.size - 2),
			),
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const transactions = vi.spyOn(EditorState.prototype, 'tr', 'get');
		const groups = vi.spyOn(structure, 'groupSelectedBlocks');
		const f = fixture(view);
		f.listen();
		flushSync();
		f.emit();
		expect(transactions).not.toHaveBeenCalled();
		expect(groups).toHaveBeenCalledOnce();
		expect(markNames.every((mark) => f.latest.enabled[mark])).toBe(true);
		expect(log).not.toHaveBeenCalled();
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)));
		transactions.mockClear();
		groups.mockClear();
		f.emit();
		expect(transactions).not.toHaveBeenCalled();
		expect(groups).toHaveBeenCalledOnce();
		expect(log).not.toHaveBeenCalled();
	});

	it('disables marks missing from the schema or forbidden by the selected text parent', () => {
		const restricted = new Schema({
			nodes: schema.spec.nodes.update('paragraph', {
				...schema.spec.nodes.get('paragraph')!,
				marks: 'bold',
			}),
			marks: schema.spec.marks.remove('overline'),
		});
		const doc = restricted.node(
			'doc',
			null,
			restricted.node(
				'page',
				null,
				restricted.node('paragraph', null, restricted.text('text content')),
			),
		);
		const view = createView();
		view.updateState(EditorState.create({ doc, selection: TextSelection.create(doc, 2, 6) }));
		const f = fixture(view);
		f.listen();
		expect(f.latest.enabled.bold).toBe(true);
		for (const mark of markNames.filter((mark) => mark !== 'bold')) {
			expect(f.latest.enabled[mark]).toBe(false);
			expect(f.service.execute(f.request(mark))).toBe(false);
		}
	});

	it.each([
		{ indent: 0, align: 'left' },
		{ indent: INDENT_MAX, align: 'center' },
		{ indent: 3, align: 'right' },
		{ indent: 0, align: 'justify' },
		{ indent: 0, align: 'start' },
		{ indent: 0, align: 'end' },
	])('matches block action changes for %o without speculative edits', (attrs) => {
		const view = createView([paragraph('some text', attrs)]);
		const f = fixture(view);
		f.listen();
		for (const direction of ['indent', 'dedent'] as const) {
			let changed = false;
			ActionUtilities.dent(direction, view.state, (tr) => {
				changed = !tr.doc.eq(view.state.doc);
			});
			expect(f.latest.enabled[direction]).toBe(changed);
		}
		for (const alignment of ['left', 'center', 'right', 'justify'] as const) {
			let changed = false;
			ActionUtilities.setTextAlignment(alignment, view.state, (tr) => {
				changed = !tr.doc.eq(view.state.doc);
			});
			expect(f.latest.enabled[`align-${alignment}`]).toBe(changed);
		}
	});
});

describe('formatting semantics', () => {
	it.each(markNames)('toggles %s with the existing action and requests focus', (mark) => {
		const view = createView();
		const f = fixture(view);
		f.listen();
		const focus = vi.spyOn(view, 'focus').mockImplementation(() => {});
		expect(f.latest.enabled[mark]).toBe(true);
		const request = f.request(mark);
		expect(f.service.execute(request)).toBe(true);
		expect(focus).toHaveBeenCalledTimes(1);
		expect(f.latest.marks[mark]).toBe(1);
		expect(f.service.execute(request)).toBe(false);
		expect(f.service.execute(f.request(mark))).toBe(true);
		expect(f.latest.marks[mark]).toBe(0);
	});

	it('preserves superscript/subscript mutual exclusion', () => {
		const f = fixture();
		f.listen();
		for (const mark of ['superscript', 'subscript', 'superscript'] as const) {
			expect(f.service.execute(f.request(mark))).toBe(true);
			expect(f.latest.marks[mark]).toBe(1);
			expect(f.latest.marks[mark === 'superscript' ? 'subscript' : 'superscript']).toBe(0);
		}
	});

	it('keeps caret mark toggling a disabled no-op and queries without changing state', () => {
		const view = createView();
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		const before = view.state;
		const dispatch = vi.spyOn(view, 'dispatch');
		const f = fixture(view);
		f.listen();
		expect(view.state).toBe(before);
		expect(dispatch).not.toHaveBeenCalled();
		for (const mark of markNames) {
			expect(f.latest.marks[mark]).toBe(0);
			expect(f.latest.enabled[mark]).toBe(false);
			expect(f.service.execute(f.request(mark))).toBe(false);
		}
		expect(view.state).toBe(before);
	});

	it('reports weighted marks and Snippets indentation/alignment ratios', () => {
		const marked = schema.node('paragraph', { indent: 2, align: 'start' }, [
			schema.text('ab', [schema.marks.bold.create()]),
			schema.text('cd'),
		]);
		const view = createView([marked, paragraph('efgh', { indent: 6, align: 'end' })]);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 12)));
		const f = fixture(view);
		f.listen();
		expect(f.latest.marks.bold).toBe(0.25);
		expect(f.latest.blocks).toEqual({
			indent: 4 / INDENT_MAX,
			dedent: 1 - 4 / INDENT_MAX,
			'align-left': 0.5,
			'align-right': 0.5,
			'align-center': 0,
			'align-justify': 0,
		});
	});

	it('applies indentation limits and alignment resets using existing actions', () => {
		const view = createView([paragraph('hello world', { indent: INDENT_MAX })]);
		const f = fixture(view);
		f.listen();
		expect(f.latest.enabled.indent).toBe(false);
		expect(f.service.execute(f.request('indent'))).toBe(false);
		expect(f.service.execute(f.request('dedent'))).toBe(true);
		expect(view.state.doc.child(0).child(0).attrs.indent).toBe(INDENT_MAX - 1);
		expect(f.service.execute(f.request('align-right'))).toBe(true);
		expect(view.state.doc.child(0).child(0).attrs).toMatchObject({ indent: 0, align: 'right' });
		expect(f.latest.enabled.dedent).toBe(false);
		expect(f.latest.blocks['align-right']).toBe(1);
	});

	it('retains continuation-aware indentation and alignment behavior', () => {
		const view = createView();
		const doc = schema.node('doc', null, [
			schema.node('page', { index: 0 }, paragraph('head', { indent: 2 })),
			schema.node('page', { index: 1 }, paragraph('continuation', { peer: true })),
		]);
		const continuation = doc.child(0).nodeSize + 2;
		view.updateState(
			EditorState.create({
				doc,
				selection: TextSelection.create(doc, continuation, continuation + 4),
			}),
		);
		const f = fixture(view);
		f.listen();
		expect(f.service.execute(f.request('indent'))).toBe(true);
		expect(view.state.doc.child(0).child(0).attrs.indent).toBe(3);
		expect(view.state.doc.child(1).child(0).attrs.indent).toBe(0);
		expect(f.service.execute(f.request('align-center'))).toBe(true);
		for (let page = 0; page < 2; page++) {
			expect(view.state.doc.child(page).child(0).attrs).toMatchObject({
				indent: 0,
				align: 'center',
			});
		}
	});

	it('queries peer heads for indent limits and both halves for alignment changes', () => {
		const view = createView();
		const doc = schema.node('doc', null, [
			schema.node('page', { index: 0 }, paragraph('head', { indent: INDENT_MAX, align: 'center' })),
			schema.node('page', { index: 1 }, paragraph('continuation', { peer: true, align: 'right' })),
		]);
		const continuation = doc.child(0).nodeSize + 2;
		view.updateState(
			EditorState.create({
				doc,
				selection: TextSelection.create(doc, continuation, continuation + 4),
			}),
		);
		const f = fixture(view);
		f.listen();
		expect(f.latest.enabled.indent).toBe(false);
		expect(f.latest.enabled.dedent).toBe(true);
		expect(f.latest.enabled['align-center']).toBe(true);
		expect(f.service.execute(f.request('align-center'))).toBe(true);
		expect(f.latest.enabled['align-center']).toBe(false);
		expect(f.service.execute(f.request('align-center'))).toBe(false);
	});

	it('reports read-only commands as disabled without dispatching', () => {
		const view = createView();
		view.setProps({ editable: () => false });
		const dispatch = vi.spyOn(view, 'dispatch');
		const f = fixture(view);
		f.listen();
		expect(Object.values(f.latest.enabled).every((value) => !value)).toBe(true);
		expect(f.service.execute(f.request())).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('uses zero ratios and disables block actions with no paragraph selection', () => {
		const view = createView();
		const doc = schema.node('doc', null, schema.node('page', null, schema.node('atom')));
		view.updateState(EditorState.create({ doc }));
		const f = fixture(view);
		f.listen();
		expect(Object.values(f.latest.blocks)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(Object.values(f.latest.enabled).every((value) => !value)).toBe(true);
	});
});
