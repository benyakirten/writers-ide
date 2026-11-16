import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { undo, undoDepth } from 'prosemirror-history';
import {
	WORD_PROCESSING_PLUGIN_ID,
	wordProcessingApi,
	type WordProcessingApi,
} from '@writers-ide/word-processing';
import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import { PluginHost } from '$lib/plugins/plugin-host';
import { createView } from './editor';
import { schema } from './schema';
import Editors from '../prose-mirror-editor.svelte';
import { createWordProcessingPlugin } from '../word-processing.svelte';
import eventBus, { ProseMirrorEventBusEventType } from '../../state/event-bus.svelte';
import { PageObserverManager } from '../../state/page-observer.svelte';

class IntersectionObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
	vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

function fixture() {
	let view!: EditorView;
	vi.spyOn(Editors, 'register').mockImplementation((_id, _name, editor) => {
		view = editor;
		return () => editor.destroy();
	});
	const mount = document.createElement('div');
	document.body.append(mount);
	const doc = schema.node(
		'doc',
		null,
		['one', 'two', 'three'].map((text, index) =>
			schema.node('page', { index }, schema.node('paragraph', null, schema.text(text))),
		),
	);
	cleanups.push(createView('doc', 'Test', doc, mount));
	const register = () => () => {};
	const host = new PluginHost<SveltePresentation>({
		registries: { toolbar: { register }, view: { register }, command: { register } },
	});
	host.register(
		createWordProcessingPlugin({
			listViews: () => [{ viewId: 'view', documentId: 'doc', name: 'Test', view }],
			activeViewId: () => 'view',
			subscribe: (listener) =>
				eventBus.subscribe(({ event }) => {
					if (event.type === ProseMirrorEventBusEventType.Update) {
						listener();
					}
				}),
		}),
	);
	let api!: WordProcessingApi;
	host.register({
		manifest: {
			id: 'test.behavior',
			name: 'Test behavior',
			description: 'Test behavior',
			version: '1',
			apiVersion: 1,
			capabilities: [],
			dependencies: [{ provider: WORD_PROCESSING_PLUGIN_ID, api: wordProcessingApi.id, major: 1 }],
		},
		activate(context) {
			api = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
		},
	});
	host.activate('test.behavior');
	cleanups.push(() => {
		host.deactivate(WORD_PROCESSING_PLUGIN_ID, { cascade: true });
	});
	const manager = new PageObserverManager();
	manager.register('view', 'doc', view, mount);
	manager.map.view.paginatedTo = 3;
	cleanups.push(() => manager.close());
	const events: { transaction: Transaction; visibleText: string }[] = [];
	cleanups.push(
		eventBus.subscribe(({ event }) => {
			if (event.type === ProseMirrorEventBusEventType.PreUpdate) {
				events.push({ transaction: event.tr, visibleText: view.dom.textContent ?? '' });
			}
		}),
	);
	return { view, api, host, manager, events };
}

describe('production dispatch with managed behaviors', () => {
	it('does not invalidate layout or notify/update views for filtered transactions', () => {
		const f = fixture();
		f.api.registerBehavior({
			id: 'reject',
			name: 'Reject',
			create: () => new Plugin({ filterTransaction: (tr) => !tr.getMeta('reject') }),
		});
		const before = f.view.state;
		const revision = f.manager.map.view.revision;
		f.view.dispatch(f.view.state.tr.insertText('blocked', 2).setMeta('reject', true));
		expect(f.view.state).toBe(before);
		expect(f.manager.map.view.paginatedTo).toBe(3);
		expect(f.manager.map.view.revision).toBe(revision);
		expect(f.events).toEqual([]);
	});

	it('notifies for accepted appended edits before DOM update and invalidates their actual page', () => {
		const f = fixture();
		const thirdPage = f.view.state.doc.child(0).nodeSize + f.view.state.doc.child(1).nodeSize + 2;
		f.api.registerBehavior({
			id: 'append',
			name: 'Append',
			create: () =>
				new Plugin({
					appendTransaction(transactions, _old, state) {
						return transactions.some((tr) => tr.getMeta('append'))
							? state.tr.insertText('X', thirdPage)
							: null;
					},
				}),
		});
		const oldText = f.view.dom.textContent;
		f.view.dispatch(f.view.state.tr.setMeta('append', true));
		expect(f.events).toHaveLength(2);
		expect(f.events[0].transaction.docChanged).toBe(false);
		expect(f.events[1].transaction.docChanged).toBe(true);
		expect(f.events.every((event) => event.visibleText === oldText)).toBe(true);
		expect(f.view.state.doc.child(2).textContent).toBe('Xthree');
		expect(f.manager.map.view.paginatedTo).toBe(1);
	});

	it('normalizes managed appended pages before rendering while preserving stored marks and history', () => {
		const f = fixture();
		const baseline = [...f.view.state.plugins];
		f.view.dispatch(
			f.view.state.tr
				.setSelection(TextSelection.create(f.view.state.doc, 2))
				.setStoredMarks([schema.marks.bold.create()]),
		);
		const release = f.api.registerBehavior({
			id: 'append-page',
			name: 'Append page',
			create: () =>
				new Plugin({
					appendTransaction(transactions, _old, state) {
						if (!transactions.some((tr) => tr.getMeta('page'))) {
							return null;
						}
						const page = schema.node(
							'page',
							{ index: 99 },
							schema.node('paragraph', null, schema.text('extra')),
						);
						return state.tr.insert(state.doc.content.size, page).setStoredMarks(state.storedMarks);
					},
				}),
		});
		f.view.dispatch(f.view.state.tr.setMeta('page', true));
		expect(f.view.state.doc.childCount).toBe(4);
		f.view.state.doc.forEach((page, _offset, index) => {
			expect(page.attrs.index).toBe(index);
		});
		expect(f.view.state.storedMarks?.map((mark) => mark.type.name)).toEqual(['bold']);
		expect(f.view.dom.querySelector('[data-index="99"]')).toBeNull();
		expect(undoDepth(f.view.state)).toBeGreaterThan(0);
		release();
		expect(f.view.state.plugins).toEqual(baseline);
		expect(undo(f.view.state, f.view.dispatch)).toBe(true);
		expect(f.view.state.doc.childCount).toBe(3);
	});

	it('reports hook failures to the consumer, quarantines them and permits later typing', async () => {
		const f = fixture();
		f.api.registerBehavior({
			id: 'broken',
			name: 'Broken',
			create: () =>
				new Plugin({
					filterTransaction() {
						throw new Error('Broken filter');
					},
				}),
		});
		f.view.dispatch(f.view.state.tr.insertText('blocked', 2));
		expect(f.view.state.doc.child(0).textContent).toBe('one');
		expect(f.events).toHaveLength(0);
		expect(f.host.get('test.behavior')!.errors).toEqual([
			expect.objectContaining({
				phase: 'provider',
				message: expect.stringContaining('Broken filter'),
			}),
		]);
		expect(f.host.get(WORD_PROCESSING_PLUGIN_ID)!.errors).toEqual([]);
		expect(f.api.behaviors()[0].status).toBe('failed');
		await Promise.resolve();
		f.view.dispatch(f.view.state.tr.insertText('works', 2));
		expect(f.view.state.doc.child(0).textContent).toBe('worksone');
	});

	it('quarantines appended transactions created from the wrong state without losing the accepted root edit', () => {
		const f = fixture();
		const stale = f.view.state.tr.insertText('bad', 2);
		f.api.registerBehavior({
			id: 'stale-append',
			name: 'Stale append',
			create: () => new Plugin({ appendTransaction: () => stale }),
		});
		f.view.dispatch(f.view.state.tr.insertText('good', 2));
		expect(f.view.state.doc.child(0).textContent).toBe('goodone');
		expect(f.events).toHaveLength(1);
		expect(f.api.behaviors()[0].status).toBe('failed');
		expect(f.host.get('test.behavior')!.errors.at(-1)?.message).toContain('supplied current state');
	});
});
