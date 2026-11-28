<script lang="ts">
	import { onMount } from 'svelte';
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import {
		WORD_PROCESSING_PLUGIN_ID,
		wordProcessingApi,
		type WordProcessingApi,
	} from '@writers-ide/word-processing';
	import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
	import { closeHistory } from 'prosemirror-history';
	import { PluginHost } from '$lib/plugins/plugin-host';
	import {
		createSmartPunctuationPlugin,
		SMART_PUNCTUATION_PLUGIN_ID,
		UNDO_INPUT_RULE_COMMAND_ID,
	} from '$lib/editor/prosemirror/behaviors/smart-punctuation';
	import {
		createSelectionHighlightPlugin,
		SELECTION_HIGHLIGHT_PLUGIN_ID,
		HIGHLIGHT_SELECTION_COMMAND_ID,
		selectionHighlightKey,
	} from '$lib/editor/prosemirror/behaviors/selection-highlight';
	import {
		createWordAnalysisPlugin,
		WORD_ANALYSIS_PLUGIN_ID,
		ANALYZE_SELECTION_COMMAND_ID,
		wordAnalysisKey,
	} from '$lib/editor/prosemirror/behaviors/word-analysis';

	let { host, createView }: { host: PluginHost<SveltePresentation>; createView: () => void } =
		$props();
	let api: WordProcessingApi;
	let status = $state('idle');
	let pending = $state.raw<(() => void) | undefined>();
	let summary = $state('');
	let diagnostics = $state('');
	let errors = $state('');
	let order = $state('');
	let factories = 0;
	let removeLow: (() => void) | undefined;
	const counterKey = new PluginKey<number>('fixture-surviving-counter');
	const dependency = {
		provider: WORD_PROCESSING_PLUGIN_ID,
		api: wordProcessingApi.id,
		major: wordProcessingApi.major,
	};
	const controlsId = 'fixture.behavior-controls';
	const failingId = 'fixture.failing-behavior';

	function target() {
		const snapshot = api.snapshot();
		return snapshot.views.find((view) => view.viewId === snapshot.activeViewId);
	}
	function refresh() {
		const current = target();
		if (current) {
			const result = api.inspect(current, ({ state }) =>
				JSON.stringify({
					doc: state.doc.toJSON(),
					selection: state.selection.toJSON(),
					marks: state.storedMarks?.map((mark) => mark.type.name) ?? null,
					highlights:
						selectionHighlightKey
							.getState(state)
							?.find()
							.map(({ from, to }) => ({ from, to })) ?? null,
					analysis:
						wordAnalysisKey
							.getState(state)
							?.find()
							.map(({ from, to }) => ({ from, to })) ?? null,
					counter: counterKey.getState(state),
					factories,
				}),
			);
			summary = result.ok ? result.value : result.reason;
		}
		diagnostics = api
			.behaviors()
			.map((item) => `${item.ownerId}/${item.id}:${item.status}`)
			.join(' | ');
		errors = [controlsId, failingId, WORD_PROCESSING_PLUGIN_ID]
			.map((id) => `${id}:${JSON.stringify(host.get(id)?.errors ?? [])}`)
			.join(' | ');
	}
	function execute(id: string) {
		const current = target();
		if (current) {
			const result = api.executeCommand(current, id, { requireActive: true, focus: true });
			status = result.ok ? `command:${result.value}` : result.reason;
		}
		refresh();
	}
	function edit(kind: 'reset' | 'prefix' | 'caret' | 'layout' | 'chunks') {
		const current = target();
		if (!current) {
			return;
		}
		api.edit(
			current,
			({ state }) => {
				if (kind === 'chunks') {
					const { schema } = state;
					const paragraphs = [
						schema.node('paragraph', null, [
							schema.text('😀 echo '),
							schema.text('echo', [schema.marks.strong.create()]),
							schema.text(' ec'),
							schema.text('ho', [schema.marks.strong.create()]),
						]),
						schema.node('paragraph', null, schema.text('echo unique')),
					];
					const tr = closeHistory(state.tr).replaceWith(0, state.doc.content.size, paragraphs);
					return tr.setSelection(TextSelection.create(tr.doc, 1, tr.doc.content.size - 1));
				}
				if (kind === 'reset') {
					const tr = closeHistory(state.tr).insertText(
						'echo echo unique',
						1,
						state.doc.content.size - 1,
					);
					return tr.setSelection(TextSelection.create(tr.doc, 1, tr.doc.content.size - 1));
				}
				if (kind === 'prefix') {
					return closeHistory(state.tr).insertText('X ', 1);
				}
				if (kind === 'layout') {
					// A model-changing, non-history structural split exercises strict revision
					// rejection like pagination, without installing app pagination in this fixture.
					return state.tr.split(6).setMeta('addToHistory', false);
				}
				return state.tr
					.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1))
					.setStoredMarks([state.schema.marks.strong.create()]);
			},
			{ focus: true },
		);
		refresh();
	}
	function disable(id: string) {
		host.deactivate(id);
		refresh();
	}

	onMount(() => {
		host.register(createSmartPunctuationPlugin());
		host.register(createSelectionHighlightPlugin());
		host.register(
			createWordAnalysisPlugin({
				deliver(apply) {
					pending = apply;
					status = 'ready';
				},
				onStatus(value) {
					status = value;
				},
			}),
		);
		host.register({
			manifest: {
				id: controlsId,
				name: 'Behavior controls',
				description: 'Public API proof probes',
				version: '0.1.0',
				apiVersion: 1,
				capabilities: [],
				dependencies: [dependency],
			},
			activate(context) {
				api = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				api.registerBehavior({
					id: 'fixture.priority-high',
					name: 'High priority',
					priority: 50,
					create() {
						factories++;
						return new Plugin({
							key: counterKey,
							state: { init: () => 0, apply: (tr, previous) => previous + (tr.docChanged ? 1 : 0) },
							props: {
								handleKeyDown(_view, event) {
									if (event.key === 'F8') {
										order += 'high ';
									}
									return false;
								},
							},
						});
					},
				});
				removeLow = api.registerBehavior({
					id: 'fixture.priority-low',
					name: 'Low priority',
					priority: -10,
					create: () =>
						new Plugin({
							props: {
								handleKeyDown(_view, event) {
									if (event.key === 'F8') {
										order += 'low ';
										return true;
									}
									return false;
								},
							},
						}),
				});
			},
		});
		host.register({
			manifest: {
				id: failingId,
				name: 'Intentional failure',
				description: 'Failure attribution proof',
				version: '0.1.0',
				apiVersion: 1,
				capabilities: [],
				dependencies: [dependency],
			},
			activate(context) {
				const consumer = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				consumer.registerBehavior({
					id: 'fixture.failed-filter',
					name: 'Intentional throwing filter',
					create: () =>
						new Plugin({
							filterTransaction() {
								throw new Error('intentional filter failure');
							},
						}),
				});
			},
		});
		host.activate(controlsId);
		refresh();
		return () => {
			for (const id of [
				SMART_PUNCTUATION_PLUGIN_ID,
				SELECTION_HIGHLIGHT_PLUGIN_ID,
				WORD_ANALYSIS_PLUGIN_ID,
				controlsId,
				failingId,
			]) {
				host.deactivate(id);
			}
		};
	});
</script>

<section aria-label="Behavior proof controls">
	<button
		onclick={() => {
			host.activate(controlsId);
			refresh();
		}}>Re-enable behavior controls</button
	>
	<button
		onclick={() => {
			host.activate(SMART_PUNCTUATION_PLUGIN_ID);
			refresh();
		}}>Enable punctuation</button
	>
	<button onclick={() => disable(SMART_PUNCTUATION_PLUGIN_ID)}>Disable punctuation</button>
	<button onclick={() => execute(UNDO_INPUT_RULE_COMMAND_ID)}>Undo input rule</button>
	<button
		onclick={() => {
			host.activate(SELECTION_HIGHLIGHT_PLUGIN_ID);
			refresh();
		}}>Enable highlights</button
	>
	<button onclick={() => disable(SELECTION_HIGHLIGHT_PLUGIN_ID)}>Disable highlights</button>
	<button onclick={() => execute(HIGHLIGHT_SELECTION_COMMAND_ID)}>Highlight selection</button>
	<button
		onclick={() => {
			host.activate(WORD_ANALYSIS_PLUGIN_ID);
			refresh();
		}}>Enable analysis</button
	>
	<button onclick={() => disable(WORD_ANALYSIS_PLUGIN_ID)}>Disable analysis</button>
	<button onclick={() => execute(ANALYZE_SELECTION_COMMAND_ID)}>Analyze selection</button>
	<button
		disabled={!pending}
		onclick={() => {
			const apply = pending;
			pending = undefined;
			apply?.();
			refresh();
		}}>Deliver analysis</button
	>
	<button onclick={() => edit('reset')}>Seed repeated text</button>
	<button onclick={() => edit('chunks')}>Seed marked chunks</button>
	<button onclick={() => edit('prefix')}>Insert prefix</button>
	<button onclick={() => edit('caret')}>Store strong at end</button>
	<button onclick={() => edit('layout')}>Structural layout edit</button>
	<button onclick={createView}>Create later view</button>
	<button
		onclick={() => {
			removeLow?.();
			refresh();
		}}>Remove low priority</button
	>
	<button
		onclick={() => {
			host.activate(failingId);
			refresh();
		}}>Enable failed filter</button
	>
	<button onclick={refresh}>Inspect behavior state</button>
	<output data-testid="behavior-status">{status}</output>
	<output data-testid="behavior-state">{summary}</output>
	<output data-testid="behavior-diagnostics">{diagnostics}</output>
	<output data-testid="behavior-errors">{errors}</output>
	<output data-testid="behavior-order">{order.trim()}</output>
</section>

<style>
	:global(.selection-highlight) {
		background: #ffe88a;
	}
	:global(.repeated-word) {
		text-decoration: underline wavy #b33;
	}
	output {
		display: block;
		overflow-wrap: anywhere;
	}
</style>
