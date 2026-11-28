import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
	createWordProcessingService,
	WORD_PROCESSING_PLUGIN_ID,
	wordProcessingApi,
	type WordProcessingApi,
	type WordProcessingSnapshot,
} from '@writers-ide/word-processing';
import type { SveltePlugin, SveltePresentation } from '@writers-ide/plugins/svelte';
import { PluginHost } from '$lib/plugins/plugin-host';
import { schema } from './view/schema';
import Editors from './prose-mirror-editor.svelte';
import TabState from '../state/tab-state.svelte';
import eventBus, { ProseMirrorEventBusEventType } from '../state/event-bus.svelte';
import { createWordProcessingPlugin, defaultWordProcessingSources } from './word-processing.svelte';
import { createQuickFormatPlugin, QUICK_FORMAT_BOLD_COMMAND_ID } from './menu/quick-format/menu';

const cleanups: (() => void)[] = [];
const views: EditorView[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	for (const view of views.splice(0)) {
		if (!view.isDestroyed) {
			view.destroy();
		}
	}
	document.body.replaceChildren();
});

function view() {
	const mount = document.createElement('div');
	document.body.append(mount);
	const doc = schema.node(
		'doc',
		null,
		schema.node('page', null, schema.node('paragraph', null, schema.text('Writer'))),
	);
	const editor = new EditorView(mount, {
		state: EditorState.create({ doc, selection: TextSelection.create(doc, 2, 8) }),
	});
	views.push(editor);
	return editor;
}

function host() {
	const register = () => () => {};
	const result = new PluginHost<SveltePresentation>({
		registries: { toolbar: { register }, view: { register }, command: { register } },
	});
	cleanups.push(() => {
		for (const entry of result.list()) {
			result.deactivate(entry.manifest.id, { cascade: true });
		}
	});
	return result;
}

function consumer(receive: (api: WordProcessingApi) => void): SveltePlugin {
	return {
		manifest: {
			id: 'test.editor-observer',
			name: 'Editor observer',
			description: 'Editor observer',
			version: '1',
			apiVersion: 1,
			capabilities: [],
			dependencies: [
				{
					provider: WORD_PROCESSING_PLUGIN_ID,
					api: wordProcessingApi.id,
					major: wordProcessingApi.major,
				},
			],
		},
		activate(context) {
			const api = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi);
			if (!api) {
				throw new Error('Missing editor provider');
			}
			receive(api);
		},
	};
}

describe('application word-processing composition', () => {
	it('resolves the active document to its distinct view identity and observes registry closure', () => {
		const editor = view();
		const previousEditors = Editors.editors;
		const previousActive = TabState.active;
		cleanups.push(() => {
			Editors.editors = previousEditors;
			if (previousActive) {
				TabState.activate(previousActive);
			}
		});
		cleanups.push(TabState.create('prosemirror', 'word-processing-document'));
		TabState.activate('word-processing-document');
		Editors.editors = {
			'independent-view': {
				documentId: 'word-processing-document',
				viewId: 'independent-view',
				name: 'Test',
				view: editor,
			},
		};
		const service = createWordProcessingService(defaultWordProcessingSources);
		cleanups.push(() => service.dispose());
		const emissions: WordProcessingSnapshot[] = [];
		cleanups.push(service.subscribe((snapshot) => emissions.push(snapshot)));
		flushSync();
		expect(emissions.at(-1)).toMatchObject({
			activeViewId: 'independent-view',
			views: [{ viewId: 'independent-view', documentId: 'word-processing-document' }],
		});
		const target = service.snapshot().views[0];
		editor.dispatch(editor.state.tr.insertText('Updated', 2, 8));
		expect(service.inspect(target, ({ state }) => state.doc.textContent)).toEqual({
			ok: false,
			reason: 'stale',
		});
		eventBus.update({
			id: 'word-processing-document',
			event: { type: ProseMirrorEventBusEventType.Update, view: editor },
		});
		expect(emissions.at(-1)!.views[0].revision).toBeGreaterThan(target.revision);
		Editors.editors = {};
		flushSync();
		expect(emissions.at(-1)).toEqual({ activeViewId: null, views: [] });
		expect(editor.isDestroyed).toBe(false);
	});

	it('keeps live editor state while provider cascades revoke consumers and re-enable fresh targets', () => {
		const editor = view();
		const h = host();
		h.register(
			createWordProcessingPlugin({
				listViews: () => [{ viewId: 'view', documentId: 'doc', name: 'Test', view: editor }],
				activeViewId: () => 'view',
				subscribe: () => () => {},
			}),
		);
		let api!: WordProcessingApi;
		h.register(
			consumer((value) => {
				api = value;
			}),
		);
		expect(h.activate('test.editor-observer').status).toBe('active');
		const oldApi = api;
		const oldTarget = api.snapshot().views[0];
		const state = editor.state;
		h.deactivate(WORD_PROCESSING_PLUGIN_ID, { cascade: true });
		expect(editor.state).toBe(state);
		expect(editor.isDestroyed).toBe(false);
		expect(() => oldApi.snapshot()).toThrow('revoked');
		h.activate('test.editor-observer');
		expect(api).not.toBe(oldApi);
		expect(api.snapshot().views[0].revision).toBeGreaterThan(oldTarget.revision);
		expect(api.edit(oldTarget, ({ state }) => state.tr.insertText('Wrong'))).toEqual({
			ok: false,
			reason: 'stale',
		});
	});

	it('runs the independent example against the production bold mark without basic formatting', () => {
		const editor = view();
		const h = host();
		h.register(
			createWordProcessingPlugin({
				listViews: () => [{ viewId: 'view', documentId: 'doc', name: 'Test', view: editor }],
				activeViewId: () => 'view',
				subscribe: () => () => {},
			}),
		);
		h.register(createQuickFormatPlugin());
		let api!: WordProcessingApi;
		h.register(
			consumer((value) => {
				api = value;
			}),
		);
		h.activate('writers-ide.quick-format');
		h.activate('test.editor-observer');
		expect(h.get('writers-ide.formatting')).toBeUndefined();
		expect(api.commands()).toEqual([
			{
				id: QUICK_FORMAT_BOLD_COMMAND_ID,
				name: 'Quick format: bold',
				ownerId: 'writers-ide.quick-format',
			},
		]);
		expect(
			api.executeCommand(api.snapshot().views[0], QUICK_FORMAT_BOLD_COMMAND_ID, {
				requireActive: true,
			}),
		).toEqual({ ok: true, value: true });
		expect(editor.state.doc.rangeHasMark(2, 8, schema.marks.bold)).toBe(true);
		h.deactivate('writers-ide.quick-format');
		expect(api.commands()).toEqual([]);
		expect(api.executeCommand(api.snapshot().views[0], QUICK_FORMAT_BOLD_COMMAND_ID)).toEqual({
			ok: false,
			reason: 'unknown-command',
		});
		expect(editor.state.doc.rangeHasMark(2, 8, schema.marks.bold)).toBe(true);
	});
});
